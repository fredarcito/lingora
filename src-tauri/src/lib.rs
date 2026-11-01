mod audio;
mod captions_window;
mod config;
mod doctor;
mod error;
mod groq;
mod listener;
mod log_file;
mod models;
mod notes;
#[cfg(target_os = "macos")]
mod objc;
mod phonemizer;
mod pipeline;
mod route;
mod speakers;
mod system_audio;
mod system_voice;
mod translator;
mod tts;

use config::Settings;
use config::Lang;
use pipeline::{Direction, Pipeline, Speech, Transcription, Translation};
use std::sync::Arc;
use tauri::Manager;

struct AppState {
    pipeline: Pipeline,
    listener: listener::Listener,
    speakers: speakers::Speakers,
    /// Captura del audio del Mac en curso (sin BlackHole).
    system_audio: std::sync::Mutex<Option<system_audio::Capture>>,
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
    state.pipeline.tts().release().await;
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
/// primera suene mientras se generan las siguientes.
#[tauri::command]
async fn speak(
    state: tauri::State<'_, AppState>,
    text: String,
    lang: Lang,
    voice: tts::Gender,
    speed: Option<f32>,
    voice_id: Option<String>,
    hq: Option<bool>,
) -> error::Result<Speech> {
    state.pipeline.speak(&text, lang, voice, voice_id.as_deref(), speed.unwrap_or(1.0), hq.unwrap_or(false)).await
}

/// Una voz que se puede elegir para un idioma.
#[derive(serde::Serialize)]
struct VoiceInfo {
    /// "supertonic:5" o "system:<identificador>"; se pasa tal cual a `speak`.
    id: String,
    /// The system voice's name, or the number (1–5) of a Supertonic voice
    /// within its gender: the UI names it ("Voice 1").
    name: String,
    engine: &'static str,
    gender: Option<tts::Gender>,
    /// País y calidad ("México · Premium"), o vacío.
    detail: String,
}

/// Las voces del idioma: las de Supertonic (si está descargado) y las del
/// sistema, cada grupo de mejor a peor.
#[tauri::command]
async fn voices(state: tauri::State<'_, AppState>, lang: Lang) -> error::Result<Vec<VoiceInfo>> {
    let mut out = Vec::new();
    if tts::TtsEngine::is_installed(&state.pipeline.settings().tts_model_dir) {
        out.extend(tts::voices(lang).into_iter().map(|v| VoiceInfo {
            id: format!("supertonic:{}", v.sid),
            name: v.number.to_string(),
            engine: "supertonic",
            gender: Some(v.gender),
            detail: String::new(),
        }));
    }
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

#[tauri::command]
async fn warm_up(state: tauri::State<'_, AppState>) -> error::Result<()> {
    state.pipeline.warm_up().await
}

/// Reproduce la voz traducida en una salida concreta (por nombre; vacío =
/// salida del sistema) y vuelve cuando termina de sonar.
#[tauri::command]
async fn play_audio(samples: Vec<f32>, sample_rate: u32, device_name: String, volume: Option<f32>) -> error::Result<()> {
    let volume = volume.unwrap_or(1.0);
    tauri::async_runtime::spawn_blocking(move || audio::play_blocking(&samples, sample_rate, &device_name, volume))
        .await
        .map_err(|e| error::Error::Audio(format!("la reproducción terminó mal: {e}")))?
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
    state.pipeline.tts().release().await;
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
async fn languages() -> Vec<LanguageInfo> {
    let voices = tauri::async_runtime::spawn_blocking(system_voice::voices).await.unwrap_or_default();
    let mut out: Vec<LanguageInfo> = Lang::all()
        .map(|lang| {
            let info = lang.info();
            let (female_voice, male_voice) =
                if info.supertonic { (true, true) } else { system_voice::available(lang, &voices) };
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
    out
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
            open_captions,
            languages,
            release_models,
            speak,
            voices,
            play_audio,
            run_diagnostics,
            fix_diagnostic,
            setup_status,
            storage_status,
            remove_download,
            download_model,
            list_audio_devices,
            route::audio_route,
            settings_summary,
            log_ui,
            notes::notes_list,
            notes::note_read,
            notes::note_save,
            notes::note_delete,
            notes::note_reveal,
            notes::note_export,
            notes::note_export_image,
            notes::summary_key_status,
            notes::summary_key_set,
            notes::summary_key_clear,
            notes::summary_key_help,
            notes::note_summarize
        ])
        .build(tauri::generate_context!())
        .expect("error al arrancar Lingora")
        .run(|app, event| {
            // El modelo de traducción usa la GPU: si sigue cargado al salir, Metal aborta.
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().pipeline.local_translator().shutdown();
            }
        });
}
