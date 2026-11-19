use super::models::*;
use serde_json::Value;

pub fn valid_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub fn uri_id(uri: &str, kind: &str) -> Option<String> {
    uri.strip_prefix(&format!("spotify:{kind}:"))
        .filter(|id| valid_id(id))
        .map(str::to_owned)
}

pub fn text<'a>(value: &'a Value, path: &str) -> &'a str {
    value.pointer(path).and_then(Value::as_str).unwrap_or("")
}
pub fn number(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}
pub fn image(value: &Value) -> Option<String> {
    value
        .as_array()?
        .iter()
        .filter(|item| safe_image(text(item, "/url")))
        .max_by_key(|item| {
            item.get("width")
                .or_else(|| item.get("maxWidth"))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        })
        .map(|item| text(item, "/url").to_owned())
}
fn safe_image(value: &str) -> bool {
    reqwest::Url::parse(value).ok().is_some_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some_and(|host| {
                host == "i.scdn.co"
                    || host == "mosaic.scdn.co"
                    || host.ends_with(".spotifycdn.com")
                    || host == "t.scdn.co"
            })
    })
}
pub fn image_at(value: &Value, path: &str) -> Option<String> {
    value.pointer(path).and_then(image)
}

pub fn plain_text(input: &str) -> String {
    let breaks = regex::Regex::new(r"(?i)<(?:br\s*/?|/p|/div)>").expect("static regex");
    let tags = regex::Regex::new(r"<[^>]*>").expect("static regex");
    let broken = breaks.replace_all(input, "\n");
    let clean = tags.replace_all(&broken, "");
    let entities = regex::Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);")
        .expect("static regex");
    entities
        .replace_all(&clean, |captures: &regex::Captures| match &captures[1] {
            "amp" => "&".to_owned(),
            "lt" => "<".to_owned(),
            "gt" => ">".to_owned(),
            "quot" => "\"".to_owned(),
            "apos" => "'".to_owned(),
            "nbsp" => " ".to_owned(),
            encoded => encoded
                .strip_prefix("#x")
                .and_then(|v| u32::from_str_radix(v, 16).ok())
                .or_else(|| encoded.strip_prefix('#').and_then(|v| v.parse().ok()))
                .and_then(char::from_u32)
                .map(|v| v.to_string())
                .unwrap_or_default(),
        })
        .trim()
        .to_owned()
}

pub fn artists(value: &Value) -> Vec<ArtistRef> {
    value
        .pointer("/artists/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|artist| {
            Some(ArtistRef {
                id: uri_id(text(artist, "/uri"), "artist")?,
                name: text(artist, "/profile/name").to_owned(),
                image_url: image_at(artist, "/visuals/avatarImage/sources"),
            })
        })
        .collect()
}

pub fn node(value: &Value) -> &Value {
    for path in ["/item/data", "/itemV2/data", "/data", "/track"] {
        if let Some(node) = value.pointer(path).filter(|node| !node.is_null()) {
            return node;
        }
    }
    value
}

pub fn item(value: &Value, hint: Option<&str>) -> Option<CatalogItem> {
    let value = node(value);
    let uri = text(value, "/uri");
    let kind = uri.split(':').nth(1).or(hint)?;
    if !["track", "artist", "album", "playlist"].contains(&kind) {
        return None;
    }
    let id = uri_id(uri, kind).or_else(|| {
        value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
            .map(str::to_owned)
    })?;
    let name = if kind == "artist" {
        text(value, "/profile/name")
    } else {
        text(value, "/name")
    };
    if name.trim().is_empty() {
        return None;
    }
    let artists = artists(value);
    let subtitle = if kind == "playlist" {
        text(value, "/ownerV2/data/name").to_owned()
    } else {
        artists
            .iter()
            .map(|artist| artist.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let image_url = match kind {
        "artist" => image_at(value, "/visuals/avatarImage/sources"),
        "playlist" => image_at(value, "/images/items/0/sources"),
        "album" => image_at(value, "/coverArt/sources"),
        _ => image_at(value, "/albumOfTrack/coverArt/sources"),
    };
    let color = [
        "/coverArt/extractedColors/colorDark/hex",
        "/visuals/avatarImage/extractedColors/colorDark/hex",
        "/visuals/avatarImage/extractedColors/colorRaw/hex",
        "/albumOfTrack/coverArt/extractedColors/colorDark/hex",
        "/images/items/0/extractedColors/colorDark/hex",
    ]
    .iter()
    .map(|path| text(value, path))
    .find(|v| v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit()))
    .map(str::to_owned);
    Some(CatalogItem {
        id,
        kind: kind.into(),
        name: name.into(),
        subtitle,
        image_url,
        color,
        artists,
        album_id: uri_id(text(value, "/albumOfTrack/uri"), "album"),
        album_name: value
            .pointer("/albumOfTrack/name")
            .and_then(Value::as_str)
            .map(str::to_owned),
        duration_ms: [
            "/duration/totalMilliseconds",
            "/trackDuration/totalMilliseconds",
            "/playcast/durationMs",
        ]
        .iter()
        .find_map(|path| value.pointer(path).and_then(number))
        .filter(|v| *v > 0)
        .and_then(|v| i64::try_from(v).ok()),
        year: value.pointer("/date/year").and_then(Value::as_i64),
        release_type: value.get("type").and_then(Value::as_str).map(str::to_owned),
        play_count: value.get("playcount").and_then(number),
        added_at: None,
        disc_number: value.get("discNumber").and_then(number),
        track_number: value.get("trackNumber").and_then(number),
        verified: value
            .pointer("/onPlatformReputationTrait/verification/isVerified")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        playable: value
            .pointer("/playability/playable")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

pub fn items(value: &Value) -> Vec<CatalogItem> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| item(entry, None))
        .collect()
}
pub fn page(value: &Value, offset: u64, releases: bool) -> CatalogPage {
    let raw = value
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let items = raw
        .iter()
        .filter_map(|entry| {
            if releases {
                item(
                    entry.pointer("/releases/items/0").unwrap_or(entry),
                    Some("album"),
                )
            } else {
                item(entry, None)
            }
        })
        .collect();
    let total = value
        .get("totalCount")
        .and_then(number)
        .unwrap_or(raw.len() as u64);
    let next_offset = if let Some(next) = value.pointer("/pagingInfo/nextOffset") {
        next.as_u64()
    } else {
        let next = offset + raw.len() as u64;
        (next < total && !raw.is_empty()).then_some(next)
    };
    CatalogPage {
        items,
        total,
        offset,
        next_offset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn validates_spotify_ids_and_strips_markup() {
        assert!(valid_id("00FQb4jTyendYWaN8pK0wa"));
        assert!(!valid_id("../../arbitrary-address"));
        assert_eq!(
            plain_text("<p>A &amp; B</p><br/>C &#x2665;"),
            "A & B\n\nC ♥"
        );
    }
    #[test]
    fn prefers_large_images_and_rejects_untrusted_hosts() {
        assert_eq!(image(&json!([{"url":"http://localhost/private","width":5000},{"url":"https://i.scdn.co/image/small","width":64},{"url":"https://i.scdn.co/image/large","width":640}])).as_deref(), Some("https://i.scdn.co/image/large"));
    }
    #[test]
    fn unsupported_wrappers_do_not_become_fake_results() {
        assert!(item(&json!({"data":{"__typename":"NotFound"}}), None).is_none());
    }
}
