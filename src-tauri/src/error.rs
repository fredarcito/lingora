use serde::Serialize;

/// The single error that crosses the Tauri boundary. It serializes as `{ kind, message }`
/// so the frontend can tell apart, for example, a quota limit (429)
/// from a network failure.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("falta la variable de entorno {0}")]
    MissingEnv(&'static str),

    #[error("la API respondió {status}: {body}")]
    Api { status: u16, body: String },

    #[error("límite de cuota alcanzado, reintenta en {retry_after_secs:?} s")]
    RateLimited { retry_after_secs: Option<u64> },

    #[error("respuesta inválida de la API: {0}")]
    BadResponse(String),

    #[error("fallo de red: {0}")]
    Network(#[from] reqwest::Error),

    #[error("error de audio: {0}")]
    Audio(String),

    /// A model download; the message is already written for the app's user.
    #[error("{0}")]
    Download(String),

    /// Saved notes; the message is already written for the app's user.
    #[error("{0}")]
    Notes(String),

    #[error("error de E/S: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        let kind = match self {
            Error::MissingEnv(_) => "missing_env",
            Error::Api { .. } => "api",
            Error::RateLimited { .. } => "rate_limited",
            Error::BadResponse(_) => "bad_response",
            Error::Network(_) => "network",
            Error::Audio(_) => "audio",
            Error::Download(_) => "download",
            Error::Notes(_) => "notes",
            Error::Io(_) => "io",
        };
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
