// audio/mic_error.rs — structured microphone capture failures.
//
// CPAL exposes useful cross-platform variants for disconnect/config failures,
// while WASAPI permission and exclusive-use failures arrive as backend-specific
// HRESULT text. Keep those implementation details here so hotkey/UI code only
// handles stable categories and never displays raw backend errors.

use std::error::Error;
use std::fmt::{Display, Formatter};

use cpal::{
    BackendSpecificError, BuildStreamError, DefaultStreamConfigError, DevicesError,
    PlayStreamError, StreamError,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum MicErrorKind {
    Unplugged = 1,
    InUse = 2,
    PermissionBlocked = 3,
    UnsupportedConfig = 4,
    Unknown = 5,
}

impl MicErrorKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unplugged => "mic_unplugged",
            Self::InUse => "mic_in_use",
            Self::PermissionBlocked => "mic_permission_blocked",
            Self::UnsupportedConfig => "mic_config_unsupported",
            Self::Unknown => "mic_error",
        }
    }

    pub fn user_message(self) -> &'static str {
        match self {
            Self::Unplugged => "Microphone unplugged. Plug it in or pick another in Settings.",
            Self::InUse => {
                "Microphone is in use by another app. Close it or pick another in Settings."
            }
            Self::PermissionBlocked => "Microphone blocked by Windows.",
            Self::UnsupportedConfig => {
                "Microphone configuration is not supported. Pick another in Settings."
            }
            Self::Unknown => "Microphone error. Restart popo or pick another in Settings.",
        }
    }

    pub(crate) fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::Unplugged),
            2 => Some(Self::InUse),
            3 => Some(Self::PermissionBlocked),
            4 => Some(Self::UnsupportedConfig),
            5 => Some(Self::Unknown),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct MicCaptureError {
    kind: MicErrorKind,
    technical_detail: String,
}

impl MicCaptureError {
    pub fn new(kind: MicErrorKind, technical_detail: impl Into<String>) -> Self {
        Self {
            kind,
            technical_detail: technical_detail.into(),
        }
    }

    pub fn no_input_device() -> Self {
        Self::new(MicErrorKind::Unplugged, "no input device available")
    }

    pub fn device_name_unavailable() -> Self {
        Self::new(MicErrorKind::Unknown, "input device name unavailable")
    }

    pub fn unsupported_sample_format(format: cpal::SampleFormat) -> Self {
        Self::new(
            MicErrorKind::UnsupportedConfig,
            format!("unsupported sample format: {format:?}"),
        )
    }

    pub fn kind(&self) -> MicErrorKind {
        self.kind
    }

    pub fn code(&self) -> &'static str {
        self.kind.code()
    }

    pub fn user_message(&self) -> &'static str {
        self.kind.user_message()
    }
}

impl Display for MicCaptureError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code(), self.technical_detail)
    }
}

impl Error for MicCaptureError {}

fn classify_backend(err: BackendSpecificError) -> MicCaptureError {
    let detail = err.description;
    let normalized = detail.to_ascii_lowercase();

    // E_ACCESSDENIED. Windows microphone privacy controls commonly surface
    // this through WASAPI when desktop-app microphone access is disabled.
    if normalized.contains("0x80070005")
        || normalized.contains("e_accessdenied")
        || normalized.contains("access is denied")
        || normalized.contains("access denied")
    {
        return MicCaptureError::new(MicErrorKind::PermissionBlocked, detail);
    }

    // AUDCLNT_E_DEVICE_IN_USE and AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED.
    // CPAL uses shared mode, so these are reported only when another client or
    // driver policy prevents opening the endpoint; do not probe exclusive mode
    // pre-emptively because that would create false positives for healthy mics.
    if normalized.contains("0x8889000a")
        || normalized.contains("audclnt_e_device_in_use")
        || normalized.contains("device in use")
        || normalized.contains("0x88890012")
        || normalized.contains("audclnt_e_exclusive_mode_not_allowed")
    {
        return MicCaptureError::new(MicErrorKind::InUse, detail);
    }

    MicCaptureError::new(MicErrorKind::Unknown, detail)
}

impl From<DevicesError> for MicCaptureError {
    fn from(error: DevicesError) -> Self {
        match error {
            DevicesError::BackendSpecific { err } => classify_backend(err),
        }
    }
}

impl From<DefaultStreamConfigError> for MicCaptureError {
    fn from(error: DefaultStreamConfigError) -> Self {
        match error {
            DefaultStreamConfigError::DeviceNotAvailable => {
                Self::new(MicErrorKind::Unplugged, error.to_string())
            }
            DefaultStreamConfigError::StreamTypeNotSupported => {
                Self::new(MicErrorKind::UnsupportedConfig, error.to_string())
            }
            DefaultStreamConfigError::BackendSpecific { err } => classify_backend(err),
        }
    }
}

impl From<BuildStreamError> for MicCaptureError {
    fn from(error: BuildStreamError) -> Self {
        match error {
            BuildStreamError::DeviceNotAvailable => {
                Self::new(MicErrorKind::Unplugged, error.to_string())
            }
            BuildStreamError::StreamConfigNotSupported | BuildStreamError::InvalidArgument => {
                Self::new(MicErrorKind::UnsupportedConfig, error.to_string())
            }
            BuildStreamError::BackendSpecific { err } => classify_backend(err),
            BuildStreamError::StreamIdOverflow => {
                Self::new(MicErrorKind::Unknown, error.to_string())
            }
        }
    }
}

impl From<PlayStreamError> for MicCaptureError {
    fn from(error: PlayStreamError) -> Self {
        match error {
            PlayStreamError::DeviceNotAvailable => {
                Self::new(MicErrorKind::Unplugged, error.to_string())
            }
            PlayStreamError::BackendSpecific { err } => classify_backend(err),
        }
    }
}

pub fn classify_stream_error(error: &StreamError) -> MicErrorKind {
    match error {
        StreamError::DeviceNotAvailable => MicErrorKind::Unplugged,
        StreamError::BackendSpecific { err } => classify_backend(err.clone()).kind(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend(description: &str) -> BackendSpecificError {
        BackendSpecificError {
            description: description.to_string(),
        }
    }

    #[test]
    fn classifies_cross_platform_cpal_variants() {
        assert_eq!(
            MicCaptureError::from(BuildStreamError::DeviceNotAvailable).kind(),
            MicErrorKind::Unplugged
        );
        assert_eq!(
            MicCaptureError::from(BuildStreamError::StreamConfigNotSupported).kind(),
            MicErrorKind::UnsupportedConfig
        );
        assert_eq!(
            MicCaptureError::from(PlayStreamError::DeviceNotAvailable).kind(),
            MicErrorKind::Unplugged
        );
    }

    #[test]
    fn classifies_windows_permission_hresult() {
        let build_error = BuildStreamError::BackendSpecific {
            err: backend("Access is denied. (0x80070005)"),
        };
        assert_eq!(
            MicCaptureError::from(build_error).kind(),
            MicErrorKind::PermissionBlocked
        );

        let enumeration_error = DevicesError::BackendSpecific {
            err: backend("E_ACCESSDENIED (0x80070005)"),
        };
        assert_eq!(
            MicCaptureError::from(enumeration_error).kind(),
            MicErrorKind::PermissionBlocked
        );
    }

    #[test]
    fn classifies_windows_busy_hresult() {
        let error = BuildStreamError::BackendSpecific {
            err: backend("The device is in use. (0x8889000A)"),
        };
        assert_eq!(MicCaptureError::from(error).kind(), MicErrorKind::InUse);
    }

    #[test]
    fn unknown_backend_errors_do_not_leak_into_user_copy() {
        let error = BuildStreamError::BackendSpecific {
            err: backend("driver returned private diagnostic details"),
        };
        let classified = MicCaptureError::from(error);
        assert_eq!(classified.kind(), MicErrorKind::Unknown);
        assert!(!classified.user_message().contains("private diagnostic"));
    }
}
