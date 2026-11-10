use serde::{Deserialize, Serialize};

/// A language of the app: an index into `LANGS`. It travels to the UI as its code
/// (`"es"`, `"zh-hant"`…).
///
/// They are the ones HY-MT2 translated locally (all but Uyghur) and Whisper
/// transcribes; Index-Translate, the current translator, covers them all. The
/// rest depends on the language:
/// - Parakeet (live text and Fast transcription) only understands European
///   languages.
/// - The voice is Supertonic where it has one; otherwise the system's (`system_voice.rs`),
///   which varies from one computer to another. With no voice installed, there are only captions.
///
/// See docs/plan-idiomas.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Lang(u8);

/// What each piece needs to know about a language.
pub struct LangInfo {
    /// Code used by the app and the UI.
    pub code: &'static str,
    /// Code Whisper expects.
    pub whisper: &'static str,
    /// Names for the translator's instructions and for the UI.
    pub english: &'static str,
    pub chinese: &'static str,
    pub spanish: &'static str,
    /// Parakeet v3 understands it.
    pub parakeet: bool,
    /// Supertonic speaks it (with the same code as `code`); if not, the
    /// system voice is used.
    pub supertonic: bool,
    /// espeak-ng locale. The light voice (`piper.rs`) uses each voice's own
    /// instead; the bundled espeak-ng-data has the catalogue's languages
    /// (`DICTS` in `scripts/build-espeak.sh`).
    pub espeak: &'static str,
    /// BCP-47 tags of the system voices that fit this language,
    /// in order of preference ("ja-JP", "yue", "zh-HK"…). A tag also fits
    /// its variants: "ar" includes "ar-001" and "ar-SA".
    pub voice_tags: &'static [&'static str],
}

macro_rules! lang {
    ($code:literal, $whisper:literal, $en:literal, $zh:literal, $es:literal, parakeet: $p:literal, tags: [$($tag:literal),*]) => {
        LangInfo { code: $code, whisper: $whisper, english: $en, chinese: $zh, spanish: $es, parakeet: $p, supertonic: false, espeak: "", voice_tags: &[$($tag),*] }
    };
    ($code:literal, $whisper:literal, $en:literal, $zh:literal, $es:literal, parakeet: $p:literal, supertonic, tags: [$($tag:literal),*]) => {
        LangInfo { code: $code, whisper: $whisper, english: $en, chinese: $zh, spanish: $es, parakeet: $p, supertonic: true, espeak: "", voice_tags: &[$($tag),*] }
    };
}

/// All the languages; the ones marked `supertonic` have a Lingora voice. The
/// `Lang` constants (`Lang::Es`, `Lang::Ja`…) point by position: do not
/// change the order of the first nine.
pub static LANGS: &[LangInfo] = &[
    LangInfo { code: "en", whisper: "en", english: "English", chinese: "英语", spanish: "Inglés", parakeet: true, supertonic: true, espeak: "en-us", voice_tags: &["en-US", "en"] },
    LangInfo { code: "es", whisper: "es", english: "Spanish", chinese: "西班牙语", spanish: "Español", parakeet: true, supertonic: true, espeak: "es", voice_tags: &["es-ES", "es"] },
    LangInfo { code: "fr", whisper: "fr", english: "French", chinese: "法语", spanish: "Francés", parakeet: true, supertonic: true, espeak: "fr-fr", voice_tags: &["fr-FR", "fr"] },
    LangInfo { code: "it", whisper: "it", english: "Italian", chinese: "意大利语", spanish: "Italiano", parakeet: true, supertonic: true, espeak: "it", voice_tags: &["it"] },
    LangInfo { code: "pt", whisper: "pt", english: "Portuguese", chinese: "葡萄牙语", spanish: "Portugués", parakeet: true, supertonic: true, espeak: "pt-br", voice_tags: &["pt-BR", "pt"] },
    lang!("zh", "zh", "Chinese", "中文", "Chino", parakeet: false, tags: ["zh-CN", "cmn"]),
    lang!("zh-hant", "zh", "Traditional Chinese", "繁体中文", "Chino tradicional", parakeet: false, tags: ["zh-TW"]),
    // Whisper turbo understands it, but writes it in Mandarin.
    lang!("yue", "yue", "Cantonese", "粤语", "Cantonés", parakeet: false, tags: ["yue", "zh-HK"]),
    lang!("ja", "ja", "Japanese", "日语", "Japonés", parakeet: false, supertonic, tags: ["ja"]),
    lang!("ko", "ko", "Korean", "韩语", "Coreano", parakeet: false, supertonic, tags: ["ko"]),
    lang!("de", "de", "German", "德语", "Alemán", parakeet: true, supertonic, tags: ["de-DE", "de"]),
    lang!("nl", "nl", "Dutch", "荷兰语", "Neerlandés", parakeet: true, supertonic, tags: ["nl-NL", "nl"]),
    lang!("pl", "pl", "Polish", "波兰语", "Polaco", parakeet: true, supertonic, tags: ["pl"]),
    lang!("cs", "cs", "Czech", "捷克语", "Checo", parakeet: true, supertonic, tags: ["cs"]),
    lang!("ru", "ru", "Russian", "俄语", "Ruso", parakeet: true, supertonic, tags: ["ru"]),
    lang!("uk", "uk", "Ukrainian", "乌克兰语", "Ucraniano", parakeet: true, supertonic, tags: ["uk"]),
    lang!("tr", "tr", "Turkish", "土耳其语", "Turco", parakeet: false, supertonic, tags: ["tr"]),
    lang!("ar", "ar", "Arabic", "阿拉伯语", "Árabe", parakeet: false, supertonic, tags: ["ar"]),
    lang!("he", "he", "Hebrew", "希伯来语", "Hebreo", parakeet: false, tags: ["he"]),
    lang!("fa", "fa", "Persian", "波斯语", "Persa", parakeet: false, tags: ["fa"]),
    lang!("hi", "hi", "Hindi", "印地语", "Hindi", parakeet: false, supertonic, tags: ["hi"]),
    lang!("bn", "bn", "Bengali", "孟加拉语", "Bengalí", parakeet: false, tags: ["bn"]),
    lang!("ur", "ur", "Urdu", "乌尔都语", "Urdu", parakeet: false, tags: ["ur"]),
    lang!("gu", "gu", "Gujarati", "古吉拉特语", "Guyaratí", parakeet: false, tags: ["gu"]),
    lang!("mr", "mr", "Marathi", "马拉地语", "Maratí", parakeet: false, tags: ["mr"]),
    lang!("ta", "ta", "Tamil", "泰米尔语", "Tamil", parakeet: false, tags: ["ta"]),
    lang!("te", "te", "Telugu", "泰卢固语", "Telugu", parakeet: false, tags: ["te"]),
    lang!("th", "th", "Thai", "泰语", "Tailandés", parakeet: false, tags: ["th"]),
    lang!("vi", "vi", "Vietnamese", "越南语", "Vietnamita", parakeet: false, supertonic, tags: ["vi"]),
    lang!("id", "id", "Indonesian", "印尼语", "Indonesio", parakeet: false, supertonic, tags: ["id"]),
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
    #[cfg(test)]
    pub const Zh: Lang = Lang(5);
    #[cfg(test)]
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

    /// Code Whisper expects.
    pub fn iso(self) -> &'static str {
        self.info().whisper
    }

    /// espeak-ng locale used to phonemize.
    pub fn espeak_voice(self) -> &'static str {
        self.info().espeak
    }

    /// English name for the translator's instructions.
    pub fn english_name(self) -> &'static str {
        self.info().english
    }

    /// Chinese name: Index-Translate's instructions always go in Chinese.
    pub fn chinese_name(self) -> &'static str {
        self.info().chinese
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

/// Pipeline configuration. Everything that can change without recompiling lives
/// here and can be overridden with environment variables.
#[derive(Debug, Clone)]
pub struct Settings {
    pub groq_api_key: String,
    pub stt_model: String,
    pub translation_model: String,
    /// Path to the espeak-ng binary (to phonemize Spanish and English). By
    /// default, the one bundled inside the app.
    pub espeak_bin: String,
    /// Folder of the voice model (Supertonic, see `tts.rs`).
    pub tts_model_dir: std::path::PathBuf,
    /// Folder of the local listening model (Parakeet, see `listener.rs`).
    pub listener_model_dir: std::path::PathBuf,
    /// Folder of the local listening model for Chinese, Japanese, Korean and Cantonese (SenseVoice).
    pub sense_voice_model_dir: std::path::PathBuf,
    /// Local translation model (Index-Translate, GGUF).
    pub translator_model: std::path::PathBuf,
    /// Voiceprint model that tells people apart in the notes (see `speakers.rs`).
    pub speaker_model: std::path::PathBuf,
}

impl Settings {
    pub fn from_env() -> crate::error::Result<Self> {
        let groq_api_key = std::env::var("GROQ_API_KEY")
            .map_err(|_| crate::error::Error::MissingEnv("GROQ_API_KEY"))?;
        Ok(Self::build(groq_api_key))
    }

    /// Configuration without a key: the app starts and the UI warns that it is missing.
    pub fn from_env_fallback() -> Self {
        Self::build(std::env::var("GROQ_API_KEY").unwrap_or_default())
    }

    fn build(groq_api_key: String) -> Self {
        Self {
            groq_api_key,
            stt_model: env_or("LINGORA_STT_MODEL", "whisper-large-v3-turbo"),
            // qwen3.8-27b: 344 ms on average and the most stable latency of the
            // models available on the account (see the phase 0 notes).
            translation_model: env_or("LINGORA_TRANSLATION_MODEL", "qwen/qwen3.8-27b"),
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

/// espeak-ng ships inside the app, next to the executable (`externalBin` in
/// tauri.conf.json; `scripts/build-espeak.sh` builds it). Tauri leaves it there
/// in development too.
fn bundled_espeak() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("espeak-ng")))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "espeak-ng".into())
}

/// Downloaded models: they are not in the bundle, they are fetched the first time.
pub(crate) fn models_dir() -> std::path::PathBuf {
    // Windows has no HOME: the folder goes in %LOCALAPPDATA%.
    #[cfg(windows)]
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
        std::path::Path::new(&base).join("lingora").join("models")
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        std::path::Path::new(&home).join("Library/Application Support/lingora/models")
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
