mod audio;
mod captions_window;
mod config;
mod doctor;
mod echo_cancel;
mod error;
mod groq;
mod listener;
mod log_file;
mod models;
mod notes;
mod perf;
#[cfg(target_os = "macos")]
mod objc;
mod own_voice;
mod phonemizer;
mod pipeline;
mod piper;
mod route;
mod speakers;
mod summarizer;
mod summary_cloud;
mod system_audio;
mod system_voice;
mod translator;
mod tts;
mod virtual_mic;

use config::Settings;
use config::Lang;
use pipeline::{Direction, Pipeline, Transcription, Translation};
use std::sync::Arc;
use tauri::Manager;

struct AppState {
    pipeline: Pipeline,
    listener: listener::Listener,
    speakers: speakers::Speakers,
    /// The Mac audio capture in progress (without BlackHole).
    system_audio: std::sync::Mutex<Option<system_audio::Capture>>,
    /// The microphone with echo cancellation, when it is on.
    mic: std::sync::Mutex<Option<echo_cancel::Capture>>,
}

#[tauri::command]
async fn transcribe(
    state: tauri::State<'_, AppState>,
    wav: Vec<u8>,
    direction: Direction,
    source: Lang,
    target: Lang,
    prompt: Option<String>,
) -> error::Result<Transcription> {
    state.pipeline.transcribe(wav, direction, source, target, prompt.as_deref()).await
}

/// Loads the model that listens to `lang`. Returns whether it is available.
#[tauri::command]
async fn listen_warm_up(state: tauri::State<'_, AppState>, lang: Lang) -> error::Result<bool> {
    Ok(state.listener.warm_up(lang).await)
}

/// Drops the listening and translation models to free memory; the UI
/// asks for it a while after translation stops. They are loaded again when
/// starting once more (~1–2 s).
#[tauri::command]
async fn release_models(state: tauri::State<'_, AppState>) -> error::Result<()> {
    state.listener.release().await;
    state.pipeline.release_voices().await;
    state.speakers.release().await;
    state.pipeline.local_translator().shutdown();
    Ok(())
}

/// Recognizes the sentence in progress locally for the live captions, to
/// know where each sentence ends and as the transcription. It receives raw
/// audio (float32 LE, mono 16 kHz): the UI sends it every half second and as
/// JSON it would weigh 10 times more. The language goes in the `lang` header.
#[tauri::command]
async fn listen(state: tauri::State<'_, AppState>, request: tauri::ipc::Request<'_>) -> error::Result<Vec<listener::Word>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(error::Error::Audio("se esperaba audio en crudo".into()));
    };
    let lang = request
        .headers()
        .get("lang")
        .and_then(|v| v.to_str().ok())
        .and_then(Lang::from_code)
        .ok_or_else(|| error::Error::Audio("falta el idioma que se escucha".into()))?;
    let samples = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    state.listener.recognize(samples, lang).await
}

/// Voiceprint of a sentence, to know who is speaking in the notes. It receives
/// raw audio like `listen` (float32 LE, mono 16 kHz).
#[tauri::command]
async fn voice_print(state: tauri::State<'_, AppState>, request: tauri::ipc::Request<'_>) -> error::Result<Vec<f32>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(error::Error::Audio("se esperaba audio en crudo".into()));
    };
    let samples = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    state.speakers.voice_print(samples).await
}

/// Translates and sends the translation in chunks through `on_delta` as it arrives,
/// so the UI starts the voice with the first sentence. Returns the full text.
#[tauri::command]
async fn translate(
    state: tauri::State<'_, AppState>,
    text: String,
    source: Lang,
    target: Lang,
    context: Option<String>,
    concise: Option<bool>,
    local: Option<bool>,
    on_delta: tauri::ipc::Channel<String>,
) -> error::Result<Translation> {
    state
        .pipeline
        .translate(
            &text,
            source,
            target,
            context.as_deref(),
            concise.unwrap_or(false),
            local.unwrap_or(false),
            |delta| {
                let _ = on_delta.send(delta.to_string());
            },
        )
        .await
}

/// Starts local translation and loads the model. Returns whether it is available.
#[tauri::command]
async fn translate_warm_up(state: tauri::State<'_, AppState>) -> error::Result<bool> {
    Ok(state.pipeline.local_translator().warm_up().await)
}

/// Synthesizes the voice of a fragment; the UI asks for it sentence by sentence
/// so the first one plays while the next ones are generated. Returns it raw
/// (`Speech::to_bytes`), not as JSON.
#[tauri::command]
async fn speak(
    state: tauri::State<'_, AppState>,
    text: String,
    lang: Lang,
    voice: tts::Gender,
    speed: Option<f32>,
    voice_id: Option<String>,
    hq: Option<bool>,
) -> error::Result<tauri::ipc::Response> {
    let speech = state.pipeline.speak(&text, lang, voice, voice_id.as_deref(), speed.unwrap_or(1.0), hq.unwrap_or(false)).await?;
    Ok(tauri::ipc::Response::new(speech.to_bytes()))
}

/// A voice that can be chosen for a language.
#[derive(serde::Serialize)]
struct VoiceInfo {
    /// "supertonic:5", "piper:<model>:<speaker>", "system:<identifier>" or
    /// "own" (your voice); it is passed as is to `speak`.
    id: String,
    /// The system voice's name, or the number (1–5) of a Supertonic voice
    /// within its gender: the UI names it ("Voice 1").
    name: String,
    engine: &'static str,
    gender: Option<tts::Gender>,
    /// Country and quality ("México · Premium"), or empty.
    detail: String,
}

/// The language's voices: your voice (if it is recorded and speaks the language),
/// Supertonic's (if it is downloaded), the downloaded light ones and the system's,
/// each group from best to worst.
#[tauri::command]
async fn voices(state: tauri::State<'_, AppState>, lang: Lang) -> error::Result<Vec<VoiceInfo>> {
    let mut out = Vec::new();
    if own_voice::speaks(lang) && own_voice::is_installed(&own_voice::model_dir()) && own_voice::has_sample() {
        out.push(VoiceInfo { id: own_voice::ID.into(), name: String::new(), engine: "own", gender: None, detail: String::new() });
    }
    if tts::TtsEngine::is_installed(&state.pipeline.settings().tts_model_dir) {
        out.extend(tts::voices(lang).into_iter().map(|v| VoiceInfo {
            id: format!("supertonic:{}", v.sid),
            name: v.number.to_string(),
            engine: "supertonic",
            gender: Some(v.gender),
            detail: String::new(),
        }));
    }
    out.extend(piper::voices(lang).filter(|v| piper::is_installed(v.model())).map(|v| VoiceInfo {
        id: v.id.clone(),
        name: v.name.clone(),
        engine: "piper",
        gender: Some(v.gender),
        detail: system_voice::region(&v.tag),
    }));
    let all = tauri::async_runtime::spawn_blocking(system_voice::voices).await.unwrap_or_default();
    let mut system = system_voice::voices_for(lang, &all);
    system.sort_by_key(|v| std::cmp::Reverse(system_voice::score(v)));
    out.extend(system.into_iter().map(|v| {
        let quality = match v.quality {
            3 => " · Premium",
            2 => " · Mejorada",
            _ => "",
        };
        VoiceInfo {
            id: format!("system:{}", v.id),
            name: v.name.clone(),
            engine: "system",
            gender: v.gender,
            detail: format!("{}{quality}", system_voice::region(&v.tag)),
        }
    }));
    Ok(out)
}

/// A light voice of the catalogue, downloaded or not, for the voice menu.
#[derive(serde::Serialize)]
struct LightVoice {
    /// What `speak` gets ("piper:es_ES-sharvard-medium:1").
    id: &'static str,
    /// What `download_model` gets ("piper:es_ES-sharvard-medium"); several
    /// voices can share one download.
    model: &'static str,
    name: &'static str,
    gender: tts::Gender,
    /// The country ("España").
    detail: String,
    installed: bool,
    bytes: u64,
}

/// What can be downloaded to give the language a voice: the natural voice
/// (one download, all its languages) and the light ones (one per voice), and
/// which kind this computer should use. docs/plan-voz-ligera.md.
#[derive(serde::Serialize)]
struct VoiceDownloads {
    /// This is a low-end computer: the light voice goes first.
    light_recommended: bool,
    /// The natural voice speaks the language.
    natural: bool,
    natural_installed: bool,
    natural_bytes: u64,
    light: Vec<LightVoice>,
}

#[tauri::command]
fn voice_downloads(state: tauri::State<'_, AppState>, lang: Lang) -> VoiceDownloads {
    VoiceDownloads {
        light_recommended: perf::light_device(),
        natural: lang.info().supertonic,
        natural_installed: tts::TtsEngine::is_installed(&state.pipeline.settings().tts_model_dir),
        natural_bytes: models::Model::Voice.approx_bytes(),
        light: piper::voices(lang)
            .map(|v| LightVoice {
                id: &v.id,
                model: &v.model().id,
                name: &v.name,
                gender: v.gender,
                detail: system_voice::region(&v.tag),
                installed: piper::is_installed(v.model()),
                bytes: v.model().bytes,
            })
            .collect(),
    }
}

/// Your voice: whether its model is downloaded and the recording saved (Settings → Speak).
#[tauri::command]
fn own_voice_status() -> own_voice::Status {
    own_voice::status()
}

/// Keeps a new recording of your voice. Raw, like `play_audio`: sample rate
/// (u32 LE), then the samples (f32 LE). Returns the problem if it was not kept
/// ("silent", "too_short").
#[tauri::command]
async fn save_own_voice(state: tauri::State<'_, AppState>, request: tauri::ipc::Request<'_>) -> error::Result<Option<own_voice::Problem>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(error::Error::Audio("se esperaba audio en crudo".into()));
    };
    let rate = bytes.get(..4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).filter(|r| *r > 0);
    let rate = rate.ok_or_else(|| error::Error::Audio("grabación inválida".into()))?;
    let samples: Vec<f32> = bytes[4..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let saved = tauri::async_runtime::spawn_blocking(move || own_voice::save_sample(&samples, rate))
        .await
        .map_err(|e| error::Error::Audio(format!("guardar tu voz terminó mal: {e}")))??;
    state.pipeline.own_voice().forget_sample().await;
    Ok(saved.err())
}

/// The saved recording of your voice, to hear it back. Raw: sample rate (u32
/// LE), then the samples (f32 LE).
#[tauri::command]
async fn own_voice_sample() -> error::Result<tauri::ipc::Response> {
    let (samples, rate) = tauri::async_runtime::spawn_blocking(own_voice::saved_sample)
        .await
        .map_err(|e| error::Error::Audio(format!("leer tu voz terminó mal: {e}")))?
        .ok_or_else(|| error::Error::Audio("aún no has grabado tu voz".into()))?;
    let mut out = Vec::with_capacity(4 + samples.len() * 4);
    out.extend_from_slice(&rate.to_le_bytes());
    samples.iter().for_each(|s| out.extend_from_slice(&s.to_le_bytes()));
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
async fn delete_own_voice(state: tauri::State<'_, AppState>) -> error::Result<()> {
    own_voice::delete_sample()?;
    state.pipeline.own_voice().forget_sample().await;
    Ok(())
}

/// This is a low-end computer (`perf::light_device`): Welcome skips the voice.
#[tauri::command]
fn light_device() -> bool {
    perf::light_device()
}

/// The natural voice is in use and can't keep up: the lane suggests the light one.
#[tauri::command]
fn voice_struggling(state: tauri::State<'_, AppState>) -> bool {
    state.pipeline.voice_struggling()
}

#[tauri::command]
async fn warm_up(state: tauri::State<'_, AppState>) -> error::Result<()> {
    state.pipeline.warm_up().await
}

/// Plays the translated voice on a given output (by name; empty =
/// system output) and returns when it finishes playing. Raw, like `listen`
/// (layout in `parse_playback`).
#[tauri::command]
async fn play_audio(request: tauri::ipc::Request<'_>) -> error::Result<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(error::Error::Audio("se esperaba audio en crudo".into()));
    };
    let (samples, sample_rate, volume, device_name) =
        parse_playback(bytes).ok_or_else(|| error::Error::Audio("audio para reproducir inválido".into()))?;
    tauri::async_runtime::spawn_blocking(move || audio::play_blocking(&samples, sample_rate, &device_name, volume))
        .await
        .map_err(|e| error::Error::Audio(format!("la reproducción terminó mal: {e}")))?
}

/// Reads what `playAudio` (api.js) sends: sample rate (u32 LE), volume (f32 LE)
/// and sample count (u32 LE), then the samples (f32 LE) and the output device
/// name (UTF-8, to the end).
fn parse_playback(bytes: &[u8]) -> Option<(Vec<f32>, u32, f32, String)> {
    let word = |i: usize| bytes.get(i..i + 4).map(|b| [b[0], b[1], b[2], b[3]]);
    let sample_rate = u32::from_le_bytes(word(0)?);
    let volume = f32::from_le_bytes(word(4)?);
    let count = u32::from_le_bytes(word(8)?) as usize;
    let end = count.checked_mul(4)?.checked_add(12)?;
    let samples = bytes
        .get(12..end)?
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let device_name = String::from_utf8(bytes.get(end..)?.to_vec()).ok()?;
    Some((samples, sample_rate, volume, device_name))
}

#[tauri::command]
async fn run_diagnostics(state: tauri::State<'_, AppState>, full: bool) -> error::Result<Vec<doctor::Check>> {
    Ok(doctor::run(state.pipeline.settings(), full).await)
}

/// Applies an automatic fix and returns the updated diagnostics.
#[tauri::command]
async fn fix_diagnostic(state: tauri::State<'_, AppState>, id: String) -> error::Result<Vec<doctor::Check>> {
    if let Some(model) = models::Model::from_id(&id) {
        models::download(model, state.pipeline.settings(), &|_, _| {}).await?;
        return Ok(doctor::run(state.pipeline.settings(), true).await);
    }
    doctor::fix(&id)?;
    Ok(doctor::run(state.pipeline.settings(), false).await)
}

/// What is downloaded on disk (Settings → Disk space): the models
/// and what earlier versions left behind.
#[tauri::command]
fn storage_status(state: tauri::State<'_, AppState>) -> Vec<models::OnDisk> {
    models::on_disk(state.pipeline.settings())
}

/// Deletes something downloaded and returns the updated list. It first drops the
/// models from memory, like `release_models`: the UI does not allow deleting while translating.
#[tauri::command]
async fn remove_download(state: tauri::State<'_, AppState>, id: String) -> error::Result<Vec<models::OnDisk>> {
    state.listener.release().await;
    state.pipeline.release_voices().await;
    state.speakers.release().await;
    state.pipeline.local_translator().shutdown();
    models::remove(&id, state.pipeline.settings())?;
    Ok(models::on_disk(state.pipeline.settings()))
}

/// A model for the welcome screen: what it is, how much it weighs and whether it is there.
#[derive(serde::Serialize)]
struct ModelStatus {
    id: &'static str,
    required: bool,
    installed: bool,
    /// There is a half-finished download: it resumes, it does not start from scratch.
    partial: bool,
    approx_bytes: u64,
}

/// Status of the models that are downloaded.
#[tauri::command]
fn setup_status(state: tauri::State<'_, AppState>) -> Vec<ModelStatus> {
    let settings = state.pipeline.settings();
    models::Model::ALL
        .into_iter()
        .map(|m| ModelStatus {
            id: m.id(),
            required: m.required(),
            installed: m.is_installed(settings),
            partial: m.is_partial(settings),
            approx_bytes: m.approx_bytes(),
        })
        .collect()
}

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

/// Downloads a model and sends the progress through `on_progress`.
#[tauri::command]
async fn download_model(
    state: tauri::State<'_, AppState>,
    id: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> error::Result<()> {
    let model = models::Model::from_id(&id).ok_or_else(|| error::Error::Audio(format!("modelo desconocido: {id}")))?;
    models::download(model, state.pipeline.settings(), &move |downloaded, total| {
        let _ = on_progress.send(DownloadProgress { downloaded, total });
    })
    .await
}

/// A language as the UI needs it: whether Parakeet understands it and what voices
/// it has on this computer.
#[derive(serde::Serialize)]
struct LanguageInfo {
    code: Lang,
    name: &'static str,
    parakeet: bool,
    /// It can be listened to locally (Parakeet or SenseVoice); otherwise it only
    /// works as a translation language.
    can_listen: bool,
    female_voice: bool,
    male_voice: bool,
}

/// All the languages, Spanish and English first and the rest in alphabetical order.
#[tauri::command]
async fn languages(state: tauri::State<'_, AppState>) -> error::Result<Vec<LanguageInfo>> {
    let natural = tts::TtsEngine::is_installed(&state.pipeline.settings().tts_model_dir);
    let voices = tauri::async_runtime::spawn_blocking(system_voice::voices).await.unwrap_or_default();
    let mut out: Vec<LanguageInfo> = Lang::all()
        .map(|lang| {
            let info = lang.info();
            // The natural voice counts once it is downloaded; until then the lane offers it.
            let (female_voice, male_voice) = if info.supertonic && natural {
                (true, true)
            } else {
                let (female, male) = system_voice::available(lang, &voices);
                let light = |g| piper::voices(lang).any(|v| v.gender == g && piper::is_installed(v.model()));
                (female || light(tts::Gender::Female), male || light(tts::Gender::Male))
            };
            LanguageInfo {
                code: lang,
                name: info.spanish,
                parakeet: info.parakeet,
                can_listen: listener::Engine::for_lang(lang).is_some(),
                female_voice,
                male_voice,
            }
        })
        .collect();
    // Without accents for sorting: "Árabe" goes with the A.
    let key = |name: &str| name.replace(['Á', 'á'], "a").replace(['É', 'é'], "e").to_lowercase();
    out.sort_by_key(|l| (![Lang::Es, Lang::En].contains(&l.code), key(l.name)));
    Ok(out)
}

/// Whether this Mac can capture its audio without BlackHole (macOS 14.2+).
#[tauri::command]
fn system_audio_supported() -> bool {
    system_audio::supported()
}

/// Starts capturing the Mac's audio (everything but Lingora) and sends it in
/// float32 LE mono blocks through `on_audio`. Returns the sample rate.
#[tauri::command]
fn system_audio_start(
    state: tauri::State<'_, AppState>,
    on_audio: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> error::Result<u32> {
    let mut slot = state.system_audio.lock().unwrap_or_else(|e| e.into_inner());
    // Only one capture at a time: the previous one is dropped before creating another.
    slot.take();
    let capture = system_audio::start(move |block| {
        let bytes = block.iter().flat_map(|v| v.to_le_bytes()).collect();
        let _ = on_audio.send(tauri::ipc::InvokeResponseBody::Raw(bytes));
    })?;
    let rate = capture.sample_rate;
    *slot = Some(capture);
    Ok(rate)
}

#[tauri::command]
fn system_audio_stop(state: tauri::State<'_, AppState>) {
    state.system_audio.lock().unwrap_or_else(|e| e.into_inner()).take();
}

/// Opens the microphone `device` ("" for the default one) with echo
/// cancellation and sends it in float32 LE mono blocks through `on_audio`,
/// like `system_audio_start`. Returns the sample rate.
#[tauri::command]
fn mic_start(
    state: tauri::State<'_, AppState>,
    device: String,
    auto_gain: bool,
    on_audio: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> error::Result<u32> {
    let mut slot = state.mic.lock().unwrap_or_else(|e| e.into_inner());
    slot.take();
    let capture = echo_cancel::start(&device, auto_gain, move |block| {
        let bytes = block.iter().flat_map(|v| v.to_le_bytes()).collect();
        let _ = on_audio.send(tauri::ipc::InvokeResponseBody::Raw(bytes));
    })?;
    let rate = capture.sample_rate;
    *slot = Some(capture);
    Ok(rate)
}

#[tauri::command]
fn mic_stop(state: tauri::State<'_, AppState>) {
    state.mic.lock().unwrap_or_else(|e| e.into_inner()).take();
}

/// Opens (or shows) the floating captions window.
#[tauri::command]
async fn open_captions(app: tauri::AppHandle) -> error::Result<()> {
    captions_window::open(&app).map_err(|e| error::Error::Audio(format!("no se pudo abrir los subtítulos: {e}")))
}

/// Off the window thread, like `audio_route`: Core Audio can take a while.
#[tauri::command]
async fn list_audio_devices() -> error::Result<Vec<audio::DeviceInfo>> {
    tauri::async_runtime::spawn_blocking(audio::list_devices)
        .await
        .map_err(|e| error::Error::Audio(format!("no se pudo leer los dispositivos: {e}")))?
}

/// Writes an interface error to the log (on Windows, the file on the desktop).
#[tauri::command]
fn log_ui(message: String) {
    tracing::warn!("interfaz: {message}");
}

/// Writes an interface measurement to the log (voice delay, skipped
/// sentences, preparation time). It is not an error.
#[tauri::command]
fn log_ui_event(message: String) {
    tracing::info!("interfaz: {message}");
}

#[tauri::command]
fn settings_summary(state: tauri::State<'_, AppState>) -> serde_json::Value {
    let s = state.pipeline.settings();
    serde_json::json!({
        "stt_model": s.stt_model,
        "translation_model": s.translation_model,
        "espeak_bin": s.espeak_bin,
        "tts_model": s.tts_model_dir.display().to_string(),
        "has_api_key": !s.groq_api_key.is_empty(),
        "local_translation": translator::LocalTranslator::is_installed(&s.translator_model),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The .env lives at the project root in development and next to the binary in
    // production. The key is never packaged in the bundle.
    let _ = dotenvy::dotenv();
    log_file::init();
    perf::log_system();
    perf::start_monitor();

    let settings = Arc::new(Settings::from_env().unwrap_or_else(|e| {
        tracing::warn!("configuración incompleta: {e}");
        Settings::from_env_fallback()
    }));

    tauri::Builder::default()
        .setup(|app| {
            // No Dock icon: the app accompanies the video call.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            Ok(())
        })
        // Without the main window no text arrives: the captions close with it.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                captions_window::close(window.app_handle());
            }
        })
        .manage(AppState {
            listener: listener::Listener::new(
                settings.listener_model_dir.clone(),
                settings.sense_voice_model_dir.clone(),
            ),
            speakers: speakers::Speakers::new(settings.speaker_model.clone()),
            pipeline: Pipeline::new(settings),
            system_audio: std::sync::Mutex::new(None),
            mic: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            transcribe,
            translate,
            translate_warm_up,
            warm_up,
            listen_warm_up,
            listen,
            voice_print,
            system_audio_supported,
            system_audio_start,
            system_audio_stop,
            mic_start,
            mic_stop,
            open_captions,
            languages,
            release_models,
            speak,
            voices,
            voice_downloads,
            own_voice_status,
            save_own_voice,
            own_voice_sample,
            delete_own_voice,
            light_device,
            voice_struggling,
            play_audio,
            run_diagnostics,
            fix_diagnostic,
            setup_status,
            storage_status,
            remove_download,
            download_model,
            list_audio_devices,
            route::audio_route,
            virtual_mic::virtual_mic_status,
            virtual_mic::virtual_mic_install,
            virtual_mic::virtual_mic_uninstall,
            settings_summary,
            log_ui,
            log_ui_event,
            notes::notes_list,
            notes::note_read,
            notes::note_save,
            notes::note_delete,
            notes::note_reveal,
            notes::note_export,
            notes::note_export_image,
            notes::note_summarize,
            summary_cloud::summary_key_status,
            summary_cloud::summary_key_set,
            summary_cloud::summary_models,
            summary_cloud::summary_key_hint,
            summary_cloud::summary_key_clear,
            summary_cloud::summary_key_help,
            summary_cloud::system_memory
        ])
        .build(tauri::generate_context!())
        .expect("error al arrancar Lingora")
        .run(|app, event| {
            // The translation and summary models use the GPU: if they are still loaded on exit, Metal aborts.
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().pipeline.local_translator().shutdown();
                summarizer::shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same layout `playAudio` builds in api.js.
    #[test]
    fn reads_raw_playback() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&44_100u32.to_le_bytes());
        bytes.extend_from_slice(&1.5f32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0.25f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.5f32).to_le_bytes());
        bytes.extend_from_slice("Altavoces (Realtek®)".as_bytes());
        let (samples, rate, volume, name) = parse_playback(&bytes).unwrap();
        assert_eq!((samples, rate, volume, name.as_str()), (vec![0.25, -0.5], 44_100, 1.5, "Altavoces (Realtek®)"));
        // Fewer samples than announced.
        assert!(parse_playback(&bytes[..16]).is_none());
    }
}
