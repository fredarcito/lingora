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
    /// Captura del audio del Mac en curso (sin BlackHole).
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

/// Carga el modelo que escucha `lang`. Devuelve si está disponible.
#[tauri::command]
async fn listen_warm_up(state: tauri::State<'_, AppState>, lang: Lang) -> error::Result<bool> {
    Ok(state.listener.warm_up(lang).await)
}

/// Suelta los modelos de escucha y de traducción para liberar memoria; la UI
/// lo pide un rato después de detener la traducción. Se vuelven a cargar al
/// empezar otra vez (~1–2 s).
#[tauri::command]
async fn release_models(state: tauri::State<'_, AppState>) -> error::Result<()> {
    state.listener.release().await;
    state.pipeline.release_voices().await;
    state.speakers.release().await;
    state.pipeline.local_translator().shutdown();
    Ok(())
}

/// Reconoce en local la frase en curso para los subtítulos en vivo, para
/// saber dónde termina cada frase y como transcripción. Recibe el audio en
/// crudo (float32 LE, mono 16 kHz): la UI lo manda cada medio segundo y en
/// JSON pesaría 10 veces más. El idioma va en la cabecera `lang`.
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

/// Huella de voz de una frase, para saber en las notas quién habla. Recibe
/// el audio en crudo como `listen` (float32 LE, mono 16 kHz).
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

/// Traduce y manda la traducción a trozos por `on_delta` según llega, para
/// que la UI empiece la voz con la primera frase. Devuelve el texto completo.
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

/// Arranca la traducción local y carga el modelo. Devuelve si está disponible.
#[tauri::command]
async fn translate_warm_up(state: tauri::State<'_, AppState>) -> error::Result<bool> {
    Ok(state.pipeline.local_translator().warm_up().await)
}

/// Sintetiza la voz de un fragmento; la UI la pide frase a frase para que la
/// primera suene mientras se generan las siguientes. Returns it raw
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

/// Una voz que se puede elegir para un idioma.
#[derive(serde::Serialize)]
struct VoiceInfo {
    /// "supertonic:5", "piper:<model>:<speaker>", "system:<identificador>" u
    /// "own" (tu voz); se pasa tal cual a `speak`.
    id: String,
    /// The system voice's name, or the number (1–5) of a Supertonic voice
    /// within its gender: the UI names it ("Voice 1").
    name: String,
    engine: &'static str,
    gender: Option<tts::Gender>,
    /// País y calidad ("México · Premium"), o vacío.
    detail: String,
}

/// Las voces del idioma: tu voz (si está grabada y habla el idioma), las de
/// Supertonic (si está descargado), las ligeras descargadas y las del sistema,
/// cada grupo de mejor a peor.
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

/// Reproduce la voz traducida en una salida concreta (por nombre; vacío =
/// salida del sistema) y vuelve cuando termina de sonar. Raw, like `listen`
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

/// Aplica un arreglo automático y devuelve el diagnóstico actualizado.
#[tauri::command]
async fn fix_diagnostic(state: tauri::State<'_, AppState>, id: String) -> error::Result<Vec<doctor::Check>> {
    if let Some(model) = models::Model::from_id(&id) {
        models::download(model, state.pipeline.settings(), &|_, _| {}).await?;
        return Ok(doctor::run(state.pipeline.settings(), true).await);
    }
    doctor::fix(&id)?;
    Ok(doctor::run(state.pipeline.settings(), false).await)
}

/// Lo descargado que hay en disco (Ajustes → Espacio en disco): los modelos
/// y lo que dejaron versiones anteriores.
#[tauri::command]
fn storage_status(state: tauri::State<'_, AppState>) -> Vec<models::OnDisk> {
    models::on_disk(state.pipeline.settings())
}

/// Borra algo descargado y devuelve la lista al día. Antes suelta los modelos
/// de memoria, como `release_models`: la UI no deja borrar mientras se traduce.
#[tauri::command]
async fn remove_download(state: tauri::State<'_, AppState>, id: String) -> error::Result<Vec<models::OnDisk>> {
    state.listener.release().await;
    state.pipeline.release_voices().await;
    state.speakers.release().await;
    state.pipeline.local_translator().shutdown();
    models::remove(&id, state.pipeline.settings())?;
    Ok(models::on_disk(state.pipeline.settings()))
}

/// Un modelo para la bienvenida: qué es, cuánto pesa y si ya está.
#[derive(serde::Serialize)]
struct ModelStatus {
    id: &'static str,
    required: bool,
    installed: bool,
    /// Hay una descarga a medias: se continúa, no empieza de cero.
    partial: bool,
    approx_bytes: u64,
}

/// Estado de los modelos que se descargan.
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

/// Descarga un modelo y manda el progreso por `on_progress`.
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

/// Un idioma tal como lo necesita la UI: si Parakeet lo entiende y qué voces
/// tiene en este equipo.
#[derive(serde::Serialize)]
struct LanguageInfo {
    code: Lang,
    name: &'static str,
    parakeet: bool,
    /// Se puede escuchar en local (Parakeet o SenseVoice); si no, solo sirve
    /// como idioma de la traducción.
    can_listen: bool,
    female_voice: bool,
    male_voice: bool,
}

/// Todos los idiomas, español e inglés primero y el resto por orden alfabético.
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
    // Sin tildes para ordenar: "Árabe" va con la A.
    let key = |name: &str| name.replace(['Á', 'á'], "a").replace(['É', 'é'], "e").to_lowercase();
    out.sort_by_key(|l| (![Lang::Es, Lang::En].contains(&l.code), key(l.name)));
    Ok(out)
}

/// Si este Mac puede capturar su audio sin BlackHole (macOS 14.2+).
#[tauri::command]
fn system_audio_supported() -> bool {
    system_audio::supported()
}

/// Empieza a capturar el audio del Mac (todo menos Lingora) y lo manda en
/// bloques float32 LE mono por `on_audio`. Devuelve la frecuencia.
#[tauri::command]
fn system_audio_start(
    state: tauri::State<'_, AppState>,
    on_audio: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> error::Result<u32> {
    let mut slot = state.system_audio.lock().unwrap_or_else(|e| e.into_inner());
    // Solo una captura a la vez: la anterior se suelta antes de crear otra.
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

/// Abre (o muestra) la ventana flotante de subtítulos.
#[tauri::command]
async fn open_captions(app: tauri::AppHandle) -> error::Result<()> {
    captions_window::open(&app).map_err(|e| error::Error::Audio(format!("no se pudo abrir los subtítulos: {e}")))
}

/// Fuera del hilo de la ventana, como `audio_route`: Core Audio puede tardar.
#[tauri::command]
async fn list_audio_devices() -> error::Result<Vec<audio::DeviceInfo>> {
    tauri::async_runtime::spawn_blocking(audio::list_devices)
        .await
        .map_err(|e| error::Error::Audio(format!("no se pudo leer los dispositivos: {e}")))?
}

/// Deja en el registro un error de la interfaz (en Windows, el archivo del escritorio).
#[tauri::command]
fn log_ui(message: String) {
    tracing::warn!("interfaz: {message}");
}

/// Deja en el registro una medida de la interfaz (retraso de la voz, frases
/// omitidas, tiempo de preparación). No es un error.
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
    // El .env vive en la raíz del proyecto en desarrollo y junto al binario en
    // producción. Nunca se empaqueta la clave en el bundle.
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
            // Sin icono en el Dock: la app acompaña a la videollamada.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            Ok(())
        })
        // Sin la ventana principal no llega texto: los subtítulos se cierran con ella.
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
            // Los modelos de traducción y de resumen usan la GPU: si siguen cargados al salir, Metal aborta.
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
