use serde::{Deserialize, Serialize};

/// Un idioma de la app: índice en `LANGS`. Viaja a la UI como su código
/// (`"es"`, `"zh-hant"`…).
///
/// Son los que traduce HY-MT2 en local y transcribe Whisper (todos los de
/// HY-MT2 menos el uigur). Lo demás depende del idioma:
/// - Parakeet (texto en vivo y transcripción Rápida) solo entiende idiomas
///   europeos.
/// - La voz es Kokoro donde tiene; si no, la del sistema (`system_voice.rs`),
///   que cambia de un equipo a otro. Sin voz instalada, solo hay subtítulos.
///
/// Ver docs/plan-idiomas.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Lang(u8);

/// Lo que cada pieza necesita saber de un idioma.
pub struct LangInfo {
    /// Código de la app y de la UI.
    pub code: &'static str,
    /// Código que espera Whisper.
    pub whisper: &'static str,
    /// Nombres para las instrucciones del traductor y para la UI.
    pub english: &'static str,
    pub chinese: &'static str,
    pub spanish: &'static str,
    /// Lo entiende Parakeet v3.
    pub parakeet: bool,
    /// Voces de Kokoro (mujer, hombre). Sin voz de hombre se usa la de mujer.
    pub kokoro: Option<(&'static str, Option<&'static str>)>,
    /// Locale de espeak-ng para fonemizar (solo con Kokoro).
    pub espeak: &'static str,
    /// Etiquetas BCP-47 de las voces del sistema que valen para este idioma,
    /// por orden de preferencia ("ja-JP", "yue", "zh-HK"…). Una etiqueta vale
    /// también para sus variantes: "ar" incluye "ar-001" y "ar-SA".
    pub voice_tags: &'static [&'static str],
}

macro_rules! lang {
    ($code:literal, $whisper:literal, $en:literal, $zh:literal, $es:literal, parakeet: $p:literal, tags: [$($tag:literal),*]) => {
        LangInfo { code: $code, whisper: $whisper, english: $en, chinese: $zh, spanish: $es, parakeet: $p, kokoro: None, espeak: "", voice_tags: &[$($tag),*] }
    };
}

/// Todos los idiomas. Los cinco primeros tienen voz de Kokoro. Las
/// constantes de `Lang` (`Lang::Es`, `Lang::Ja`…) apuntan por posición: no
/// cambiar el orden de los nueve primeros.
pub static LANGS: &[LangInfo] = &[
    LangInfo { code: "en", whisper: "en", english: "English", chinese: "英语", spanish: "Inglés", parakeet: true, kokoro: Some(("af_heart", Some("am_michael"))), espeak: "en-us", voice_tags: &["en-US", "en"] },
    LangInfo { code: "es", whisper: "es", english: "Spanish", chinese: "西班牙语", spanish: "Español", parakeet: true, kokoro: Some(("ef_dora", Some("em_alex"))), espeak: "es", voice_tags: &["es-ES", "es"] },
    LangInfo { code: "fr", whisper: "fr", english: "French", chinese: "法语", spanish: "Francés", parakeet: true, kokoro: Some(("ff_siwis", None)), espeak: "fr-fr", voice_tags: &["fr-FR", "fr"] },
    LangInfo { code: "it", whisper: "it", english: "Italian", chinese: "意大利语", spanish: "Italiano", parakeet: true, kokoro: Some(("if_sara", Some("im_nicola"))), espeak: "it", voice_tags: &["it"] },
    // Las voces portuguesas de Kokoro son brasileñas.
    LangInfo { code: "pt", whisper: "pt", english: "Portuguese", chinese: "葡萄牙语", spanish: "Portugués", parakeet: true, kokoro: Some(("pf_dora", Some("pm_alex"))), espeak: "pt-br", voice_tags: &["pt-BR", "pt"] },
    lang!("zh", "zh", "Chinese", "中文", "Chino", parakeet: false, tags: ["zh-CN", "cmn"]),
    lang!("zh-hant", "zh", "Traditional Chinese", "繁体中文", "Chino tradicional", parakeet: false, tags: ["zh-TW"]),
    // Whisper turbo lo entiende, pero lo escribe en mandarín.
    lang!("yue", "yue", "Cantonese", "粤语", "Cantonés", parakeet: false, tags: ["yue", "zh-HK"]),
    lang!("ja", "ja", "Japanese", "日语", "Japonés", parakeet: false, tags: ["ja"]),
    lang!("ko", "ko", "Korean", "韩语", "Coreano", parakeet: false, tags: ["ko"]),
    lang!("de", "de", "German", "德语", "Alemán", parakeet: true, tags: ["de-DE", "de"]),
    lang!("nl", "nl", "Dutch", "荷兰语", "Neerlandés", parakeet: true, tags: ["nl-NL", "nl"]),
    lang!("pl", "pl", "Polish", "波兰语", "Polaco", parakeet: true, tags: ["pl"]),
    lang!("cs", "cs", "Czech", "捷克语", "Checo", parakeet: true, tags: ["cs"]),
    lang!("ru", "ru", "Russian", "俄语", "Ruso", parakeet: true, tags: ["ru"]),
    lang!("uk", "uk", "Ukrainian", "乌克兰语", "Ucraniano", parakeet: true, tags: ["uk"]),
    lang!("tr", "tr", "Turkish", "土耳其语", "Turco", parakeet: false, tags: ["tr"]),
    lang!("ar", "ar", "Arabic", "阿拉伯语", "Árabe", parakeet: false, tags: ["ar"]),
    lang!("he", "he", "Hebrew", "希伯来语", "Hebreo", parakeet: false, tags: ["he"]),
    lang!("fa", "fa", "Persian", "波斯语", "Persa", parakeet: false, tags: ["fa"]),
    lang!("hi", "hi", "Hindi", "印地语", "Hindi", parakeet: false, tags: ["hi"]),
    lang!("bn", "bn", "Bengali", "孟加拉语", "Bengalí", parakeet: false, tags: ["bn"]),
    lang!("ur", "ur", "Urdu", "乌尔都语", "Urdu", parakeet: false, tags: ["ur"]),
    lang!("gu", "gu", "Gujarati", "古吉拉特语", "Guyaratí", parakeet: false, tags: ["gu"]),
    lang!("mr", "mr", "Marathi", "马拉地语", "Maratí", parakeet: false, tags: ["mr"]),
    lang!("ta", "ta", "Tamil", "泰米尔语", "Tamil", parakeet: false, tags: ["ta"]),
    lang!("te", "te", "Telugu", "泰卢固语", "Telugu", parakeet: false, tags: ["te"]),
    lang!("th", "th", "Thai", "泰语", "Tailandés", parakeet: false, tags: ["th"]),
    lang!("vi", "vi", "Vietnamese", "越南语", "Vietnamita", parakeet: false, tags: ["vi"]),
    lang!("id", "id", "Indonesian", "印尼语", "Indonesio", parakeet: false, tags: ["id"]),
    lang!("ms", "ms", "Malay", "马来语", "Malayo", parakeet: false, tags: ["ms"]),
    lang!("tl", "tl", "Filipino", "菲律宾语", "Filipino", parakeet: false, tags: ["fil", "tl"]),
    lang!("km", "km", "Khmer", "高棉语", "Jemer", parakeet: false, tags: ["km"]),
    lang!("my", "my", "Burmese", "缅甸语", "Birmano", parakeet: false, tags: ["my"]),
    lang!("bo", "bo", "Tibetan", "藏语", "Tibetano", parakeet: false, tags: ["bo"]),
    lang!("kk", "kk", "Kazakh", "哈萨克语", "Kazajo", parakeet: false, tags: ["kk"]),
    lang!("mn", "mn", "Mongolian", "蒙古语", "Mongol", parakeet: false, tags: ["mn"]),
];

#[allow(non_upper_case_globals)]
impl Lang {
    pub const En: Lang = Lang(0);
    pub const Es: Lang = Lang(1);
    pub const Zh: Lang = Lang(5);
    pub const ZhHant: Lang = Lang(6);
    pub const Yue: Lang = Lang(7);
    #[cfg(test)]
    pub const Ja: Lang = Lang(8);

    pub fn all() -> impl Iterator<Item = Lang> {
        (0..LANGS.len() as u8).map(Lang)
    }

    pub fn from_code(code: &str) -> Option<Lang> {
        LANGS.iter().position(|l| l.code.eq_ignore_ascii_case(code)).map(|i| Lang(i as u8))
    }

    pub fn info(self) -> &'static LangInfo {
        &LANGS[self.0 as usize]
    }

    /// Código que espera Whisper.
    pub fn iso(self) -> &'static str {
        self.info().whisper
    }

    /// Locale de espeak-ng para fonemizar.
    pub fn espeak_voice(self) -> &'static str {
        self.info().espeak
    }

    /// Nombre en inglés para las instrucciones del traductor.
    pub fn english_name(self) -> &'static str {
        self.info().english
    }

    /// Nombre en chino: HY-MT2 se entrenó con instrucciones en chino cuando
    /// el chino está en uno de los dos lados.
    pub fn chinese_name(self) -> &'static str {
        self.info().chinese
    }

    /// Si se escribe en chino (también tradicional y cantonés).
    pub fn is_chinese(self) -> bool {
        matches!(self, Lang::Zh | Lang::ZhHant | Lang::Yue)
    }
}

impl Serialize for Lang {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.info().code)
    }
}

impl<'de> Deserialize<'de> for Lang {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let code = String::deserialize(d)?;
        Lang::from_code(&code).ok_or_else(|| serde::de::Error::custom(format!("idioma desconocido: {code}")))
    }
}

/// Configuración del pipeline. Todo lo que puede cambiar sin recompilar vive
/// aquí y se puede sobrescribir con variables de entorno.
#[derive(Debug, Clone)]
pub struct Settings {
    pub groq_api_key: String,
    pub stt_model: String,
    pub translation_model: String,
    /// Modelo de Groq que resume las notas.
    pub summary_model: String,
    /// Ruta al binario de espeak-ng (para fonemizar español e inglés). Por
    /// defecto, el que va dentro de la app.
    pub espeak_bin: String,
    /// Carpeta del modelo de voz (Kokoro, ver `tts.rs`).
    pub tts_model_dir: std::path::PathBuf,
    /// Carpeta del modelo de escucha local (Parakeet, ver `listener.rs`).
    pub listener_model_dir: std::path::PathBuf,
    /// Carpeta del modelo de escucha local para chino, japonés, coreano y cantonés (SenseVoice).
    pub sense_voice_model_dir: std::path::PathBuf,
    /// Modelo de traducción local (HY-MT2, GGUF).
    pub translator_model: std::path::PathBuf,
    /// Modelo de huella de voz para distinguir personas en las notas (ver `speakers.rs`).
    pub speaker_model: std::path::PathBuf,
}

impl Settings {
    pub fn from_env() -> crate::error::Result<Self> {
        let groq_api_key = std::env::var("GROQ_API_KEY")
            .map_err(|_| crate::error::Error::MissingEnv("GROQ_API_KEY"))?;
        Ok(Self::build(groq_api_key))
    }

    /// Configuración sin clave: la app arranca y la UI avisa de que falta.
    pub fn from_env_fallback() -> Self {
        Self::build(std::env::var("GROQ_API_KEY").unwrap_or_default())
    }

    fn build(groq_api_key: String) -> Self {
        Self {
            groq_api_key,
            stt_model: env_or("LINGORA_STT_MODEL", "whisper-large-v3-turbo"),
            // qwen3.8-27b: 344 ms de media y la latencia más estable de los
            // modelos disponibles en la cuenta (ver notas de la fase 0).
            translation_model: env_or("LINGORA_TRANSLATION_MODEL", "qwen/qwen3.8-27b"),
            summary_model: env_or("LINGORA_SUMMARY_MODEL", "qwen/qwen3.8-27b"),
            espeak_bin: std::env::var("LINGORA_ESPEAK_BIN").unwrap_or_else(|_| bundled_espeak()),
            tts_model_dir: std::env::var("LINGORA_TTS_MODEL_DIR")
                .map(Into::into)
                .unwrap_or_else(|_| models_dir().join(crate::tts::MODEL_NAME)),
            listener_model_dir: std::env::var("LINGORA_LISTENER_MODEL_DIR")
                .map(Into::into)
                .unwrap_or_else(|_| models_dir().join(crate::listener::Engine::Parakeet.model_name())),
            sense_voice_model_dir: std::env::var("LINGORA_SENSE_VOICE_MODEL_DIR")
                .map(Into::into)
                .unwrap_or_else(|_| models_dir().join(crate::listener::Engine::SenseVoice.model_name())),
            translator_model: std::env::var("LINGORA_TRANSLATOR_MODEL")
                .map(Into::into)
                .unwrap_or_else(|_| models_dir().join(crate::translator::MODEL_FILE)),
            speaker_model: std::env::var("LINGORA_SPEAKER_MODEL")
                .map(Into::into)
                .unwrap_or_else(|_| models_dir().join(crate::speakers::MODEL_FILE)),
        }
    }
}

/// espeak-ng va dentro de la app, junto al ejecutable (`externalBin` en
/// tauri.conf.json; lo compila `scripts/build-espeak.sh`). Tauri lo deja ahí
/// también en desarrollo.
fn bundled_espeak() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("espeak-ng")))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "espeak-ng".into())
}

/// Modelos descargados: no van en el bundle, se bajan la primera vez.
fn models_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::Path::new(&home).join("Library/Application Support/lingora/models")
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
