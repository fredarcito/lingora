//! Traducción local con HY-MT2 1.8B (Tencent) sobre `llama-server`.
//!
//! Alternativa a qwen en Groq para no depender de su cuota (1.000 peticiones
//! al día y 8.000 tokens por minuto en el plan gratuito). Medido en un M1 Pro:
//! Q4_K_M pesa 1,1 GB, ocupa ~1,4 GB de RAM y tarda ~0,3 s por frase. Q8 dio
//! la misma calidad, más lento y el doble de grande.
//!
//! Inglés → español sale bien. Con español coloquial y trozos cortados es más
//! flojo ("Dale" queda sin traducir, "o sea" se pierde), así que:
//! - se le pasan frases completas (la UI espera al punto en modo local),
//! - un glosario de coloquialismos va en el prompt solo si la frase los usa,
//! - lo que el glosario no arregla se sustituye antes de traducir.
//!
//! Pasarle el contexto empeora: a veces traduce también el contexto y la voz lo
//! repite. Por eso no se usa. Tampoco sigue la instrucción de condensar.
//!
//! llama.cpp va **dentro** de la app (crate `llama-cpp-2`, con Metal): nada
//! que instalar. Un hilo propio tiene el modelo y su contexto; las
//! traducciones van en cola, una tras otra (llama.cpp no permite crear
//! contextos a la vez sobre el mismo modelo). El muestreo es el que usaba
//! `llama-server` por defecto, para traducir igual que antes.

use crate::config::Lang;
use crate::error::{Error, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};

/// Archivo del modelo dentro de `models/`; es el nombre publicado.
pub const MODEL_FILE: &str = "Hy-MT2-1.8B-Q4_K_M.gguf";
pub const MODEL_URL: &str = "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf";

/// Contexto en tokens, como con `llama-server -c 4096`.
const CONTEXT_TOKENS: u32 = 4096;
/// Todas las capas en la GPU, como con `llama-server -ngl 99`.
const GPU_LAYERS: u32 = 99;
/// La temperatura oficial (0,7) inventa más; baja es más fiel.
const TEMPERATURE: f32 = 0.3;
/// El resto del muestreo, los valores por defecto de `llama-server`.
const TOP_K: i32 = 40;
const TOP_P: f32 = 0.95;
const MIN_P: f32 = 0.05;

/// Un término coloquial y cómo traducirlo. `find` son las formas en
/// minúsculas que lo activan.
struct Term {
    find: &'static [&'static str],
    source: &'static str,
    target: &'static str,
}

/// Coloquialismos que HY-MT2 tradujo mal en las pruebas. Ampliar con lo que
/// se oiga mal en llamadas reales.
const GLOSSARY_ES: &[Term] = &[
    Term { find: &["o sea"], source: "o sea", target: "I mean" },
    Term {
        find: &["buscarle otra vuelta", "buscarle la vuelta"],
        source: "buscarle otra vuelta",
        target: "find another way around it",
    },
    Term {
        find: &["llegamos con los tiempos", "llegar con los tiempos"],
        source: "llegar con los tiempos",
        target: "make the deadline",
    },
    Term {
        find: &["me escuchás", "me escuchas", "me oyes", "me oís"],
        source: "¿me escuchás?",
        target: "can you hear me?",
    },
    Term {
        find: &["se me está cortando", "se me esta cortando", "se me corta"],
        source: "se me está cortando",
        target: "I'm breaking up",
    },
    Term {
        find: &["no me quedó claro", "no me quedó muy claro", "no me quedo claro"],
        source: "no me quedó claro",
        target: "I didn't quite get",
    },
];

const GLOSSARY_EN: &[Term] = &[
    Term { find: &["churn"], source: "churn", target: "tasa de cancelación" },
    Term { find: &["can you hear me"], source: "Can you hear me?", target: "¿Me oyes?" },
    Term { find: &["acting up"], source: "acting up", target: "está fallando" },
    Term { find: &["scroll down"], source: "scroll down", target: "desplázate hacia abajo" },
];

pub struct LocalTranslator {
    model: PathBuf,
    /// El hilo del modelo; `None` sin modelo cargado.
    worker: Mutex<Option<Worker>>,
    /// Solo un arranque a la vez: dos cargarían el modelo dos veces.
    starting: tokio::sync::Mutex<()>,
}

/// El hilo que tiene el modelo cargado. Soltar `jobs` lo cierra y libera la memoria.
struct Worker {
    jobs: mpsc::Sender<Job>,
    thread: std::thread::JoinHandle<()>,
}

/// Una traducción para el hilo del modelo.
struct Job {
    prompt: String,
    max_tokens: usize,
    /// Sin azar, para comparar con `llama-server` en las pruebas.
    greedy: bool,
    events: tokio::sync::mpsc::UnboundedSender<Event>,
}

enum Event {
    /// Un trozo de la traducción, según sale.
    Delta(String),
    Done(Result<String>),
}

impl LocalTranslator {
    pub fn new(model: PathBuf) -> Self {
        Self { model, worker: Mutex::new(None), starting: tokio::sync::Mutex::new(()) }
    }

    /// El modelo está descargado.
    pub fn is_installed(model: &Path) -> bool {
        model.exists()
    }

    /// El canal del hilo del modelo; lo arranca (y carga el modelo) la
    /// primera vez o después de liberarlo.
    async fn jobs(&self) -> Result<mpsc::Sender<Job>> {
        let _starting = self.starting.lock().await;
        if let Some(worker) = self.worker.lock().unwrap().as_ref() {
            return Ok(worker.jobs.clone());
        }
        if !Self::is_installed(&self.model) {
            return Err(Error::Audio(format!("falta el modelo de traducción local en {}", self.model.display())));
        }
        let (jobs, inbox) = mpsc::channel();
        let (ready, loaded) = tokio::sync::oneshot::channel();
        let path = self.model.clone();
        let thread = std::thread::Builder::new()
            .name("traductor".into())
            .spawn(move || run(&path, inbox, ready))
            .map_err(|e| Error::Audio(format!("no se pudo arrancar la traducción local: {e}")))?;
        loaded.await.map_err(|_| Error::Audio("la traducción local se cerró al cargar".into()))??;
        *self.worker.lock().unwrap() = Some(Worker { jobs: jobs.clone(), thread });
        Ok(jobs)
    }

    /// Carga el modelo. Devuelve si la traducción local está disponible.
    pub async fn warm_up(&self) -> bool {
        match self.jobs().await {
            Ok(_) => true,
            Err(e) => {
                tracing::warn!("traducción local no disponible: {e}");
                false
            }
        }
    }

    /// Libera el modelo (al salir o tras un rato sin usarlo). Espera a que el
    /// hilo lo suelte (como mucho, lo que tarde la traducción en curso): al
    /// salir con memoria de la GPU sin liberar, Metal aborta el proceso.
    pub fn shutdown(&self) {
        let worker = self.worker.lock().unwrap().take();
        if let Some(Worker { jobs, thread }) = worker {
            drop(jobs);
            let _ = thread.join();
        }
    }

    /// Traduce entre inglés y español; `on_delta` recibe la traducción a
    /// trozos según llega.
    pub async fn translate(&self, text: &str, from: Lang, to: Lang, on_delta: impl FnMut(&str)) -> Result<String> {
        let text = substitute(text, from);
        // Proporcional al texto: si el modelo se embala, no habla de más.
        let max_tokens = (text.chars().count() / 2 + 32).min(512);
        self.generate(chat_prompt(&prompt(&text, from, to)), max_tokens, false, on_delta).await
    }

    async fn generate(&self, prompt: String, max_tokens: usize, greedy: bool, mut on_delta: impl FnMut(&str)) -> Result<String> {
        let jobs = self.jobs().await?;
        let (events, mut inbox) = tokio::sync::mpsc::unbounded_channel();
        if jobs.send(Job { prompt, max_tokens, greedy, events }).is_err() {
            // El hilo se cayó: la próxima vez se vuelve a cargar.
            self.worker.lock().unwrap().take();
            return Err(Error::Audio("la traducción local se cerró; vuelve a intentarlo".into()));
        }
        while let Some(event) = inbox.recv().await {
            match event {
                Event::Delta(delta) => on_delta(&delta),
                Event::Done(out) => {
                    let out = out?.trim().to_string();
                    if out.is_empty() {
                        return Err(Error::BadResponse("la traducción local llegó vacía".into()));
                    }
                    return Ok(out);
                }
            }
        }
        Err(Error::Audio("la traducción local se interrumpió".into()))
    }
}

/// llama.cpp se inicia una vez por proceso; sus mensajes van al registro.
fn backend() -> &'static LlamaBackend {
    static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
    BACKEND.get_or_init(|| {
        llama_cpp_2::send_logs_to_tracing(llama_cpp_2::LogOptions::default());
        LlamaBackend::init().expect("llama.cpp se inicia una sola vez")
    })
}

/// El hilo del modelo: lo carga, avisa por `ready` y traduce lo que llegue
/// hasta que se suelta el canal.
fn run(path: &Path, inbox: mpsc::Receiver<Job>, ready: tokio::sync::oneshot::Sender<Result<()>>) {
    let t0 = std::time::Instant::now();
    let params = LlamaModelParams::default().with_n_gpu_layers(GPU_LAYERS);
    let model = match LlamaModel::load_from_file(backend(), path, &params) {
        Ok(model) => model,
        Err(e) => {
            let _ = ready.send(Err(Error::Audio(format!("no se pudo cargar el modelo de traducción: {e}"))));
            return;
        }
    };
    let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(CONTEXT_TOKENS));
    let mut ctx = match model.new_context(backend(), params) {
        Ok(ctx) => ctx,
        Err(e) => {
            let _ = ready.send(Err(Error::Audio(format!("no se pudo preparar la traducción local: {e}"))));
            return;
        }
    };
    tracing::info!("traducción local lista en {:?}", t0.elapsed());
    let _ = ready.send(Ok(()));
    for job in inbox {
        let out = complete(&model, &mut ctx, &job);
        let _ = job.events.send(Event::Done(out));
    }
    tracing::info!("traducción local liberada");
}

/// Genera la respuesta a `job.prompt`, mandando cada trozo según sale.
fn complete(model: &LlamaModel, ctx: &mut LlamaContext, job: &Job) -> Result<String> {
    let fail = |e: &dyn std::fmt::Display| Error::Audio(format!("falló la traducción local: {e}"));
    ctx.clear_kv_cache();
    let vocab = model.vocab();
    // El prompt ya trae el inicio de frase como texto: sin añadir otro.
    let tokens = vocab.tokenize(job.prompt.as_bytes(), false, true);
    if tokens.is_empty() || tokens.len() + job.max_tokens > ctx.n_ctx() as usize {
        return Err(Error::Audio("el texto es demasiado largo para traducirlo de una vez".into()));
    }
    let mut batch = LlamaBatch::new(tokens.len(), 1);
    let last = tokens.len() - 1;
    for (i, &token) in tokens.iter().enumerate() {
        batch.add(token, i as i32, &[0], i == last).map_err(|e| fail(&e))?;
    }
    ctx.decode(&mut batch).map_err(|e| fail(&e))?;

    let mut sampler = if job.greedy {
        LlamaSampler::greedy()
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::top_k(TOP_K),
            LlamaSampler::top_p(TOP_P, 1),
            LlamaSampler::min_p(MIN_P, 1),
            LlamaSampler::temp(TEMPERATURE),
            LlamaSampler::dist(seed()),
        ])
    };
    let mut out = String::new();
    // Una letra puede venir partida entre dos tokens: se espera a tenerla entera.
    let mut bytes: Vec<u8> = Vec::new();
    let mut pos = tokens.len() as i32;
    for _ in 0..job.max_tokens {
        let token = sampler.sample(ctx, batch.n_tokens() - 1);
        if vocab.is_eog(token) {
            break;
        }
        bytes.extend(vocab.token_to_piece(token, false, None));
        let piece = take_utf8(&mut bytes);
        if !piece.is_empty() {
            out.push_str(&piece);
            let _ = job.events.send(Event::Delta(piece));
        }
        batch.clear();
        batch.add(token, pos, &[0], true).map_err(|e| fail(&e))?;
        pos += 1;
        ctx.decode(&mut batch).map_err(|e| fail(&e))?;
    }
    Ok(out)
}

/// Lo que ya forma texto UTF-8 completo; el resto se queda esperando.
fn take_utf8(bytes: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        // Bytes que nunca serán válidos: se sueltan tal cual (con �).
        Err(e) if e.error_len().is_some() => bytes.len(),
        Err(e) => e.valid_up_to(),
    };
    let text = String::from_utf8_lossy(&bytes[..valid]).into_owned();
    bytes.drain(..valid);
    text
}

/// Semilla distinta en cada traducción, como `llama-server` sin `seed`.
fn seed() -> u32 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos())
}

/// La plantilla de chat de HY-MT2, tal como la aplica `llama-server`.
fn chat_prompt(user: &str) -> String {
    format!("<｜hy_begin▁of▁sentence｜><｜hy_User｜>{user}<｜hy_Assistant｜>")
}

/// Prompt oficial de HY-MT2; con el formato de terminología si la frase usa
/// algún término del glosario.
fn prompt(text: &str, from: Lang, to: Lang) -> String {
    let lower = text.to_lowercase();
    let glossary = match from {
        Lang::Es => GLOSSARY_ES,
        Lang::En => GLOSSARY_EN,
        _ => &[],
    };
    let hits: Vec<String> = glossary
        .iter()
        .filter(|t| t.find.iter().any(|f| lower.contains(f)))
        .map(|t| format!("{} translates to {}", t.source, t.target))
        .collect();
    // Con chino en algún lado, la instrucción oficial de HY-MT2 va en chino.
    let chinese = from.is_chinese() || to.is_chinese();
    let instruction = if chinese {
        format!("将以下文本翻译为{}，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}", to.chinese_name())
    } else {
        format!(
            "Translate the following text into {}. Note that you should only output the translated result without any additional explanation:\n\n{text}",
            to.english_name()
        )
    };
    if hits.is_empty() {
        instruction
    } else {
        format!("Reference the following translations:\n{}\n\n{instruction}", hits.join("\n"))
    }
}

/// Cambios previos para lo que el glosario no arregla: con "Dale" en el
/// glosario el modelo lo dejaba igual. Solo cuando va suelto ("Dale,",
/// "dale."), no en "dale una vuelta".
fn substitute(text: &str, from: Lang) -> String {
    if from != Lang::Es {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut prev: Option<char> = None;
    let mut i = 0;
    while let Some(c) = text[i..].chars().next() {
        let word = text.get(i..i + 4).filter(|w| w.eq_ignore_ascii_case("dale"));
        let alone = text[i..].chars().nth(4).map_or(true, |n| ",.!;".contains(n));
        match word {
            Some(w) if prev.map_or(true, |p| !p.is_alphanumeric()) && alone => {
                out.push_str(if w.starts_with('D') { "OK" } else { "ok" });
                prev = Some('k');
                i += 4;
            }
            _ => {
                out.push(c);
                prev = Some(c);
                i += c.len_utf8();
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_dale_only_when_alone() {
        assert_eq!(substitute("Dale, perfecto.", Lang::Es), "OK, perfecto.");
        assert_eq!(substitute("bueno dale.", Lang::Es), "bueno ok.");
        assert_eq!(substitute("dale una vuelta", Lang::Es), "dale una vuelta");
        assert_eq!(substitute("Vandale, sí", Lang::Es), "Vandale, sí");
        assert_eq!(substitute("Dale, perfect.", Lang::En), "Dale, perfect.");
    }

    /// Lo que arma `llama-server` con la plantilla del modelo (`/apply-template`).
    #[test]
    fn chat_prompt_matches_llama_server() {
        assert_eq!(
            chat_prompt("Hola"),
            "<｜hy_begin▁of▁sentence｜><｜hy_User｜>Hola<｜hy_Assistant｜>"
        );
    }

    #[test]
    fn keeps_split_letters_until_complete() {
        let mut bytes = "añ".as_bytes()[..2].to_vec();
        assert_eq!(take_utf8(&mut bytes), "a");
        bytes.extend(&"ñ".as_bytes()[1..]);
        assert_eq!(take_utf8(&mut bytes), "ñ");
        assert!(bytes.is_empty());
    }

    /// Compara, sin azar, con un `llama-server` de referencia ya arrancado con
    /// el mismo modelo: `LINGORA_REF_SERVER=http://127.0.0.1:18765 cargo test
    /// --lib translator::tests::same_as_llama_server -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn same_as_llama_server() {
        let server = std::env::var("LINGORA_REF_SERVER").expect("LINGORA_REF_SERVER");
        let s = crate::config::Settings::from_env_fallback();
        let t = LocalTranslator::new(s.translator_model);
        let lang = |c| Lang::from_code(c).unwrap();
        let cases = [
            ("Dale, lo vemos el jueves.", "es", "en"),
            ("O sea que no llegamos con los tiempos.", "es", "en"),
            ("¿Me escuchás? Se me está cortando.", "es", "en"),
            ("No me quedó claro lo del presupuesto.", "es", "en"),
            ("Tenemos que buscarle otra vuelta a este problema.", "es", "en"),
            ("Mañana tenemos una reunión a las tres de la tarde.", "es", "en"),
            ("El cliente pidió un descuento del quince por ciento.", "es", "en"),
            ("Bueno, creo que eso es todo por hoy, gracias a todos.", "es", "en"),
            ("¿Podés compartir la pantalla un momento?", "es", "en"),
            ("La versión nueva sale el lunes si no hay sorpresas.", "es", "en"),
            ("Can you hear me? My connection is acting up.", "en", "es"),
            ("Our churn went down by two points last quarter.", "en", "es"),
            ("Let's scroll down to the pricing section.", "en", "es"),
            ("I think we should ship it on Friday and fix the rest later.", "en", "es"),
            ("The meeting has been moved to next Tuesday at ten.", "en", "es"),
            ("Thanks everyone, that was really helpful.", "en", "es"),
            ("We need to double-check the numbers before sending them.", "en", "es"),
            ("Could you send me the slides after the call?", "en", "es"),
            ("The quarterly numbers look really good this time.", "en", "es"),
            ("I'm not sure I follow, could you say that again?", "en", "es"),
            ("Mañana tenemos una reunión a las tres de la tarde.", "es", "zh"),
            ("Mañana tenemos una reunión a las tres de la tarde.", "es", "ja"),
            ("明日の会議は午後3時に始まります。", "ja", "es"),
            ("我们今天去饮茶，你想吃什么？", "zh", "es"),
            ("我哋今日去飲茶，你想食乜嘢？", "yue", "en"),
            ("Nous devons finir le rapport avant vendredi.", "fr", "es"),
            ("Wir sehen uns nächste Woche im Büro.", "de", "es"),
            ("Mañana tenemos una reunión a las tres de la tarde.", "es", "de"),
            ("Mañana tenemos una reunión a las tres de la tarde.", "es", "ko"),
            ("Mañana tenemos una reunión a las tres de la tarde.", "es", "ar"),
        ];
        let http = reqwest::Client::new();
        tauri::async_runtime::block_on(async {
            let mut same = 0;
            for (text, from, to) in cases {
                let (from, to) = (lang(from), lang(to));
                let text = substitute(text, from);
                let user = prompt(&text, from, to);
                let max_tokens = (text.chars().count() / 2 + 32).min(512);
                let t0 = std::time::Instant::now();
                let ours = t.generate(chat_prompt(&user), max_tokens, true, |_| {}).await.unwrap();
                let ms = t0.elapsed().as_millis();
                let body = serde_json::json!({
                    "temperature": 0.0, "max_tokens": max_tokens,
                    "messages": [{ "role": "user", "content": user }]
                });
                let resp: serde_json::Value =
                    http.post(format!("{server}/v1/chat/completions")).json(&body).send().await.unwrap().json().await.unwrap();
                let theirs = resp["choices"][0]["message"]["content"].as_str().unwrap().trim().to_string();
                let ok = ours == theirs;
                same += ok as usize;
                eprintln!("{} {ms:>4} ms  {from:?}→{to:?}: {ours}{}", if ok { "=" } else { "≠" }, if ok { String::new() } else { format!("\n          servidor: {theirs}") });
            }
            eprintln!("iguales: {same}/{}", cases.len());
            t.shutdown();
        });
    }

    #[test]
    fn glossary_only_when_used() {
        let p = prompt("o sea que no", Lang::Es, Lang::En);
        assert!(p.starts_with("Reference the following translations:\no sea translates to I mean\n\n"), "{p}");
        assert!(p.ends_with("into English. Note that you should only output the translated result without any additional explanation:\n\no sea que no"));
        assert!(prompt("Hola, ¿qué tal?", Lang::Es, Lang::En).starts_with("Translate"));
    }

    /// Con el modelo descargado: `cargo test --lib translator -- --ignored`.
    #[test]
    #[ignore]
    fn translates_with_downloaded_model() {
        let s = crate::config::Settings::from_env_fallback();
        let t = LocalTranslator::new(s.translator_model);
        tauri::async_runtime::block_on(async {
            let out = t.translate("Dale, lo vemos el jueves.", Lang::Es, Lang::En, |_| {}).await.unwrap();
            assert!(out.to_lowercase().contains("thursday"), "{out}");
            t.shutdown();
        });
    }

    #[test]
    #[ignore]
    fn translates_chinese_japanese_cantonese() {
        let s = crate::config::Settings::from_env_fallback();
        let t = LocalTranslator::new(s.translator_model);
        tauri::async_runtime::block_on(async {
            for (text, from, to) in [
                ("Mañana tenemos una reunión a las tres de la tarde.", Lang::Es, Lang::Zh),
                ("Mañana tenemos una reunión a las tres de la tarde.", Lang::Es, Lang::Ja),
                ("Mañana tenemos una reunión a las tres de la tarde.", Lang::Es, Lang::Yue),
                ("明日の会議は午後3時に始まります。", Lang::Ja, Lang::Es),
                ("我们今天去饮茶，你想吃什么？", Lang::Zh, Lang::Es),
                ("我哋今日去飲茶，你想食乜嘢？", Lang::Yue, Lang::En),
            ] {
                let out = t.translate(text, from, to, |_| {}).await.unwrap();
                eprintln!("{from:?}→{to:?}: {out}");
                assert!(!out.trim().is_empty());
            }
            t.shutdown();
        });
    }

    #[test]
    #[ignore]
    fn translates_more_languages() {
        let s = crate::config::Settings::from_env_fallback();
        let t = LocalTranslator::new(s.translator_model);
        let lang = |c| Lang::from_code(c).unwrap();
        tauri::async_runtime::block_on(async {
            for code in ["de", "ko", "ar", "th", "ru", "hi", "zh-hant", "fa"] {
                let out = t.translate("Mañana tenemos una reunión a las tres de la tarde.", Lang::Es, lang(code), |_| {}).await.unwrap();
                let back = t.translate(&out, lang(code), Lang::Es, |_| {}).await.unwrap();
                eprintln!("{code}: {out} → {back}");
            }
            t.shutdown();
        });
    }
}
