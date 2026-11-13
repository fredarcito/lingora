//! The chat on the computer, with the summary's model (`summarizer.rs`).
//!
//! A chat asks a question every few seconds about the same note, so the model
//! stays loaded on a thread of its own (the "worker") and what it read stays
//! in its memory (`session.rs`): the next question only adds to it. The
//! worker frees the model after 3 minutes without questions, before a summary
//! and when the app quits. While it has the model it holds the summary's
//! `BUSY`, so the two never load it twice.

use super::session::{self, Session};
use super::{start_answer, OnToken, Turn};
use crate::error::{Error, Result};
use crate::summarizer::{is_installed, model_path, BUSY, CANCEL, CONTEXT_TOKENS, GPU_LAYERS};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, PoisonError};
use std::time::Duration;

/// Without questions for this long, the chat frees the model, like the other models.
const IDLE: Duration = Duration::from_secs(180);
/// Tokens for the instructions, the note, the history and the question: what
/// `chat` can read with room for the answer (and the template's few markers).
pub const ROOM: usize = CONTEXT_TOKENS as usize - session::MAX_TOKENS - 64;

/// The model's answer to the last message of `turns` (the user's question),
/// with the instructions and the note in `system`, streamed through `on_token`.
///
/// The model stays loaded for the next question and remembers what it read:
/// when the next call repeats this one, plus the answer returned here word for
/// word and a new question, only the new question is read. Anything else
/// (another note, an edited or deleted message) reads it all again. If the
/// history doesn't fit, the oldest questions go first; `system` plus the last
/// question must fit in `ROOM` (`count_tokens` tells).
///
/// The caller frees the translator before (`local_translator().shutdown()`),
/// as the summary does: both models don't fit together on every computer.
pub async fn chat(system: String, turns: Vec<Turn>, on_token: OnToken) -> Result<String> {
    if !is_installed(&model_path()) {
        return Err(Error::Notes("Falta descargar el resumen.".into()));
    }
    start_answer();
    let (reply, answer) = tokio::sync::oneshot::channel();
    send(Job::Answer { system, turns, on_token, reply });
    answer.await.map_err(|_| interrupted())?
}

/// Tokens of each text, to decide what fits in `ROOM` (a long note goes by
/// excerpts). Loads the chat's model if it isn't.
pub async fn count_tokens(texts: Vec<String>) -> Result<Vec<usize>> {
    if !is_installed(&model_path()) {
        return Err(Error::Notes("Falta descargar el resumen.".into()));
    }
    let (reply, counts) = tokio::sync::oneshot::channel();
    send(Job::Count { texts, reply });
    counts.await.map_err(|_| interrupted())?
}

/// Takes the worker out of service: it answers what it already has and frees
/// the model. Before a summary and when the app quits.
pub fn stop() {
    drop(WORKER.lock().unwrap_or_else(PoisonError::into_inner).take());
}

fn interrupted() -> Error {
    Error::Notes("el chat se interrumpió".into())
}

enum Job {
    Answer { system: String, turns: Vec<Turn>, on_token: OnToken, reply: tokio::sync::oneshot::Sender<Result<String>> },
    Count { texts: Vec<String>, reply: tokio::sync::oneshot::Sender<Result<Vec<usize>>> },
}

impl Job {
    fn fail(self, message: &str) {
        let error = || Error::Notes(message.to_string());
        // A caller that is gone doesn't need the answer.
        match self {
            Job::Answer { reply, .. } => drop(reply.send(Err(error()))),
            Job::Count { reply, .. } => drop(reply.send(Err(error()))),
        }
    }
}

/// The worker's thread, from when it starts loading the model until it retires.
struct Worker {
    id: u64,
    jobs: mpsc::Sender<Job>,
}

/// The worker in service, if any. Sending and retiring both go through this
/// lock, so a job is never sent to a worker that is leaving without serving it.
static WORKER: std::sync::Mutex<Option<Worker>> = std::sync::Mutex::new(None);
static WORKER_IDS: AtomicU64 = AtomicU64::new(0);

/// Hands `job` to the worker, starting one if there is none.
fn send(job: Job) {
    if CANCEL.load(Ordering::SeqCst) {
        return job.fail("la app se está cerrando");
    }
    let mut worker = WORKER.lock().unwrap_or_else(PoisonError::into_inner);
    let job = match &*worker {
        Some(w) => match w.jobs.send(job) {
            Ok(()) => return,
            // Its thread ended without retiring (a panic): a new one takes over.
            Err(mpsc::SendError(job)) => job,
        },
        None => job,
    };
    let id = WORKER_IDS.fetch_add(1, Ordering::SeqCst);
    let (jobs, inbox) = mpsc::channel();
    let _ = jobs.send(job);
    let path = model_path();
    *worker = match std::thread::Builder::new().name("lingora-chat".into()).spawn(move || work(id, inbox, path)) {
        Ok(_) => Some(Worker { id, jobs }),
        // The job goes with the thread that didn't start: its caller gets "interrupted".
        Err(e) => {
            tracing::warn!("chat: no se pudo crear el hilo: {e}");
            None
        }
    };
}

/// The worker `id` leaves the service (if it is still the one in it). Its
/// sender goes with it: the jobs already queued are served, then it ends.
fn retire(id: u64) {
    let mut worker = WORKER.lock().unwrap_or_else(PoisonError::into_inner);
    if worker.as_ref().is_some_and(|w| w.id == id) {
        *worker = None;
    }
}

/// The worker's thread: loads the model, answers jobs until 3 minutes pass
/// without any (or it is taken out of service), and frees it.
fn work(id: u64, inbox: mpsc::Receiver<Job>, path: PathBuf) {
    // Dropped last: the model and its context go first.
    let _busy = BUSY.blocking_lock();
    if CANCEL.load(Ordering::SeqCst) {
        return give_up(id, &inbox, "la app se está cerrando");
    }
    let t0 = std::time::Instant::now();
    let backend = crate::translator::backend();
    let params = LlamaModelParams::default().with_n_gpu_layers(GPU_LAYERS);
    let model = match LlamaModel::load_from_file(backend, &path, &params) {
        Ok(model) => model,
        Err(e) => return give_up(id, &inbox, &format!("no se pudo cargar el chat: {e}")),
    };
    let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(CONTEXT_TOKENS));
    let ctx = match model.new_context(backend, params) {
        Ok(ctx) => ctx,
        Err(e) => return give_up(id, &inbox, &format!("no se pudo preparar el chat: {e}")),
    };
    tracing::info!("chat: modelo listo en {:?}", t0.elapsed());
    let mut session = Session { model: &model, ctx, read: None };
    loop {
        match inbox.recv_timeout(IDLE) {
            Ok(Job::Answer { system, turns, mut on_token, reply }) => {
                let _ = reply.send(session.answer(&system, &turns, &mut on_token));
            }
            Ok(Job::Count { texts, reply }) => {
                let _ = reply.send(Ok(texts.iter().map(|t| session.count(t)).collect()));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => retire(id),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(session);
    tracing::info!("chat: modelo liberado");
}

/// Without the model: retires and fails the jobs already queued.
fn give_up(id: u64, inbox: &mpsc::Receiver<Job>, message: &str) {
    tracing::warn!("chat: {message}");
    retire(id);
    // Its sender is gone after `retire`: this ends with the last queued job.
    for job in inbox.iter() {
        job.fail(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::{stop_answer, Role};

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    /// Talks to the real model: `cargo test --release chat_real_model -- --ignored --nocapture`
    /// (with the summary downloaded). Checks that the second question only
    /// reads itself, that the answers still make sense, stopping, and handing
    /// the model to a summary.
    #[tokio::test]
    #[ignore]
    async fn chat_real_model() {
        // ~10K tokens of small talk around the facts, so reading it all shows in the time.
        let filler: String = (0..250)
            .map(|i| format!("[{:02}:{:02}] Luis: Comentamos otra vez el tráfico de la mañana y el tiempo del fin de semana.\n", 1 + i / 60, i % 60))
            .collect();
        let system = format!(
            "Respondes preguntas sobre esta conversación, solo con lo que se dijo en ella. Responde en una frase.\n\n\
            [00:05] Ana: El presupuesto para la campaña es de 3.000 euros.\n{filler}\
            [05:20] Luis: Perfecto. La entrega del diseño es el viernes.\n\
            [05:41] Ana: Y Marta se encarga de las fotos."
        );
        let ask = |turns: Vec<Turn>| {
            let streamed = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let sink = streamed.clone();
            let system = system.clone();
            async move {
                let t0 = std::time::Instant::now();
                let text = chat(system, turns, Box::new(move |p| sink.lock().unwrap().push_str(p))).await.unwrap();
                let secs = t0.elapsed().as_secs_f32();
                println!("→ {text} ({secs:.1} s)");
                assert_eq!(*streamed.lock().unwrap(), text, "lo enviado no es la respuesta");
                (text, secs)
            }
        };

        let counts = count_tokens(vec![system.clone()]).await.unwrap();
        println!("nota: {} tokens", counts[0]);
        assert!(counts[0] > 5_000 && counts[0] < ROOM);

        let mut turns = vec![turn(Role::User, "¿Cuál es el presupuesto?")];
        let (a1, first) = ask(turns.clone()).await;
        assert!(a1.contains("3.000") || a1.contains("3000"), "{a1}");

        turns.extend([turn(Role::Assistant, &a1), turn(Role::User, "¿Y cuándo es la entrega?")]);
        let (a2, second) = ask(turns.clone()).await;
        assert!(a2.to_lowercase().contains("viernes"), "{a2}");
        assert!(second < first / 3.0, "la segunda pregunta volvió a leer la nota ({first:.1} s → {second:.1} s)");

        turns.extend([turn(Role::Assistant, &a2), turn(Role::User, "¿Quién hace las fotos?")]);
        let (a3, _) = ask(turns.clone()).await;
        assert!(a3.contains("Marta"), "{a3}");

        // Another chat on the same note: everything is read again, and it doesn't remember a1/a2.
        let (fresh, again) = ask(vec![turn(Role::User, "¿Quién se encarga de las fotos?")]).await;
        assert!(fresh.contains("Marta"), "{fresh}");
        assert!(again > second * 2.0, "un chat nuevo debía leer la nota entera");

        // Stopping mid-answer keeps what was written (the same chat, so it is
        // already read and writing starts at once).
        let long = vec![
            turn(Role::User, "¿Quién se encarga de las fotos?"),
            turn(Role::Assistant, &fresh),
            turn(Role::User, "Escribe un poema largo sobre la campaña, de al menos veinte versos."),
        ];
        let handle = tokio::spawn(chat(system.clone(), long.clone(), Box::new(|_| {})));
        tokio::time::sleep(Duration::from_secs(2)).await;
        stop_answer();
        let cut = handle.await.unwrap().unwrap();
        println!("→ cortado: {} letras", cut.chars().count());
        assert!(!cut.is_empty(), "al detener se perdió lo escrito");
        // And the chat goes on from the cut answer without reading the note again.
        let mut after = long;
        after.extend([turn(Role::Assistant, &cut), turn(Role::User, "¿Cuál era el presupuesto?")]);
        let (a4, quick) = ask(after).await;
        assert!(a4.contains("3.000") || a4.contains("3000"), "{a4}");
        assert!(quick < again / 3.0, "tras detener volvió a leer la nota");

        // A summary takes the model from the chat.
        let said = crate::summarizer::with_model(|s| s.complete("Responde solo «hola».", "Saluda.")).await.unwrap();
        println!("→ resumen: {said}");
        assert!(WORKER.lock().unwrap().is_none());
    }
}
