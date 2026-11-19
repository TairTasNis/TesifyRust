pub(crate) const MAX_BYTES: usize = 8 * 1024 * 1024;

pub(crate) fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

#[cfg(target_os = "android")]
pub(super) fn valid_local_cover(url: &str) -> bool {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let Some((mime, encoded)) = url.strip_prefix("data:").and_then(|url| url.split_once(";base64,")) else {
        return false;
    };
    if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
        return false;
    }
    STANDARD.decode(encoded).is_ok_and(|bytes| {
        bytes.len() <= MAX_BYTES && image_type(&bytes).is_some_and(|(found, _)| found == mime)
    })
}
