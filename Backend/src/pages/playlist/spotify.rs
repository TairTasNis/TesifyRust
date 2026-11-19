// Adapted from the user's D:/Python/Tesify/src-tauri/src/backend.rs:
// extract_spotify_playlist and spotify_playlist_track_from_item.
// Original copyright (c) 2026 Tair Tasmukhambetov (@ttfotg), TFG License.
// Guest token, persisted query, pagination and field mapping are preserved.

use crate::shared::playlists::models::Track;
use crate::shared::spotify::mapping;
use chrono::{DateTime, Utc};
use regex::Regex;
use reqwest::{Client, Url};
use serde_json::{Value, json};
use uuid::Uuid;

const SPOTIFY_PLAYLIST_HASH: &str =
    "9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f";

pub struct ImportedPlaylist {
    pub name: String,
    pub cover_url: Option<String>,
    pub tracks: Vec<Track>,
    pub unavailable_count: usize,
}

pub fn playlist_id(input: &str) -> Result<String, String> {
    let url =
        Url::parse(input.trim()).map_err(|_| "Вставьте ссылку на плейлист Spotify.".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("open.spotify.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Нужна ссылка вида https://open.spotify.com/playlist/…".into());
    }
    let segments: Vec<_> = url
        .path_segments()
        .ok_or("Некорректная ссылка Spotify.")?
        .filter(|segment| !segment.is_empty())
        .collect();
    let position = segments
        .iter()
        .position(|segment| *segment == "playlist")
        .ok_or("Ссылка должна вести на плейлист Spotify.")?;
    if position > 1
        || (position == 1 && !segments[0].starts_with("intl-"))
        || segments.len() != position + 2
    {
        return Err("Ссылка должна вести на плейлист Spotify.".into());
    }
    let id = segments[position + 1];
    if id.len() != 22 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("Некорректный идентификатор плейлиста Spotify.".into());
    }
    Ok(id.into())
}

pub async fn extract_spotify_playlist(
    http: &Client,
    input: &str,
) -> Result<ImportedPlaylist, String> {
    let id = playlist_id(input)?;
    let html = http
        .get("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M")
        .send()
        .await
        .map_err(|_| "Не удалось подключиться к Spotify.".to_string())?
        .error_for_status()
        .map_err(|_| "Spotify временно не отвечает. Попробуйте позже.".to_string())?
        .text()
        .await
        .map_err(|_| "Не удалось получить страницу Spotify.".to_string())?;
    let token_re = Regex::new(r#""accessToken":"([^"]+)""#)
        .map_err(|_| "Не удалось подготовить импорт.".to_string())?;
    let token = token_re
        .captures(&html)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().to_string())
        .ok_or("Spotify не выдал гостевой доступ. Попробуйте позже.")?;

    let mut result = ImportedPlaylist {
        name: String::new(),
        cover_url: None,
        tracks: Vec::new(),
        unavailable_count: 0,
    };
    let mut offset = 0_u64;
    const LIMIT: u64 = 100;
    let imported_at = Utc::now().timestamp_millis();
    loop {
        let variables = json!({"uri": format!("spotify:playlist:{id}"), "offset":offset, "limit":LIMIT, "enableWatchFeedEntrypoint":false});
        let extensions = json!({"persistedQuery":{"version":1,"sha256Hash":SPOTIFY_PLAYLIST_HASH}});
        let response = http
            .get("https://api-partner.spotify.com/pathfinder/v1/query")
            .query(&[
                ("operationName", "fetchPlaylist"),
                ("variables", &variables.to_string()),
                ("extensions", &extensions.to_string()),
            ])
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|_| {
                "Соединение со Spotify прервалось. Треки не были добавлены; повторите импорт."
                    .to_string()
            })?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 | 404 => {
                    "Плейлист недоступен. Откройте доступ к нему в Spotify и проверьте ссылку."
                }
                429 => "Spotify ограничил запросы. Подождите немного и повторите импорт.",
                _ => "Spotify не смог отдать плейлист. Повторите импорт позже.",
            }
            .into());
        }
        let data: Value = response
            .json()
            .await
            .map_err(|_| "Spotify вернул некорректный ответ.".to_string())?;
        if data
            .get("errors")
            .and_then(Value::as_array)
            .is_some_and(|errors| !errors.is_empty())
        {
            return Err("Не удалось получить все данные Spotify. Проверьте, что плейлист публичный, и повторите попытку.".into());
        }
        let playlist = data
            .pointer("/data/playlistV2")
            .filter(|value| value.get("name").is_some())
            .ok_or("Плейлист недоступен. Проверьте ссылку и доступ в Spotify.")?;
        if offset == 0 {
            result.name = playlist
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Spotify")
                .to_string();
            result.cover_url = playlist_cover(playlist);
        }
        let total = playlist
            .pointer("/content/totalCount")
            .and_then(Value::as_u64)
            .ok_or("Spotify не вернул количество треков. Импорт отменён.")?;
        if total > 50_000 {
            return Err("В плейлисте слишком много треков для одного импорта.".into());
        }
        let items = playlist
            .pointer("/content/items")
            .and_then(Value::as_array)
            .ok_or("Spotify не вернул список треков.")?;
        if items.is_empty() && offset < total {
            return Err("Spotify вернул не все треки. Импорт отменён; попробуйте ещё раз.".into());
        }
        for item in items {
            match spotify_playlist_track_from_item(item, imported_at) {
                Some(track) => result.tracks.push(track),
                None => result.unavailable_count += 1,
            }
        }
        offset += items.len() as u64;
        if offset >= total {
            break;
        }
    }
    Ok(result)
}

fn spotify_playlist_track_from_item(wrapper: &Value, imported_at: i64) -> Option<Track> {
    let data = wrapper.pointer("/itemV2/data")?;
    if data.get("__typename").and_then(Value::as_str) != Some("Track") {
        return None;
    }
    let uri = data.get("uri")?.as_str()?;
    let id = uri.strip_prefix("spotify:track:")?;
    if id.len() != 22 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return None;
    }
    let title = data.get("name")?.as_str()?.to_string();
    let artists = data
        .pointer("/artists/items")?
        .as_array()?
        .iter()
        .filter_map(|artist| artist.pointer("/profile/name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    let duration_ms = [
        "/playcast/durationMs",
        "/duration/totalMilliseconds",
        "/trackDuration/totalMilliseconds",
    ]
    .iter()
    .find_map(|path| data.pointer(path).and_then(as_i64))
    .filter(|duration| *duration > 0);
    let source_added_at = wrapper
        .pointer("/addedAt/isoString")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|date| date.timestamp_millis());
    Some(Track {
        id: Uuid::new_v4().to_string(),
        spotify_id: id.into(),
        title,
        artist: artists,
        artists: mapping::artists(data),
        cover_url: data
            .pointer("/albumOfTrack/coverArt/sources")
            .and_then(best_image),
        duration_ms,
        added_at: imported_at,
        source_added_at,
        source_url: format!("https://open.spotify.com/track/{id}"),
    })
}

fn as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn best_image(value: &Value) -> Option<String> {
    value
        .as_array()?
        .iter()
        .filter(|image| image.get("url").and_then(Value::as_str).is_some())
        .max_by_key(|image| {
            image
                .get("width")
                .or_else(|| image.get("maxWidth"))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        })
        .and_then(|image| image.get("url"))
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(str::to_owned)
}

fn playlist_cover(playlist: &Value) -> Option<String> {
    playlist
        .pointer("/images/items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|image| image.get("sources"))
        .and_then(best_image)
        .or_else(|| {
            playlist
                .pointer("/visualIdentity/image")
                .and_then(best_image)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_playlist_links_and_rejects_other_hosts_and_resources() {
        let id = "37i9dQZF1DXcBWIGoYBM5M";
        for link in [
            format!("https://open.spotify.com/playlist/{id}?si=example"),
            format!("https://open.spotify.com/intl-ru/playlist/{id}"),
        ] {
            assert_eq!(playlist_id(&link).unwrap(), id);
        }
        for link in [
            "https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M",
            "https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M",
            "https://open.spotify.com/playlist/short",
            "http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
        ] {
            assert!(playlist_id(link).is_err());
        }
    }

    #[test]
    fn keeps_all_track_metadata_from_original_importer() {
        let wrapper = json!({"addedAt":{"isoString":"2026-10-16T04:01:13.791Z"},"itemV2":{"data":{
            "__typename":"Track","uri":"spotify:track:3XmwAZpIMNpTJy8faw3ajD","name":"Song",
            "artists":{"items":[{"uri":"spotify:artist:3XmwAZpIMNpTJy8faw3ajD","profile":{"name":"Artist"}}]},"trackDuration":{"totalMilliseconds":223935},
            "albumOfTrack":{"coverArt":{"sources":[{"width":64,"url":"https://i.scdn.co/small"},{"width":640,"url":"https://i.scdn.co/large"}]}}
        }}});
        let track = spotify_playlist_track_from_item(&wrapper, 123).unwrap();
        assert_eq!(track.title, "Song");
        assert_eq!(track.artist, "Artist");
        assert_eq!(track.artists[0].id, "3XmwAZpIMNpTJy8faw3ajD");
        assert_eq!(track.duration_ms, Some(223935));
        assert!(track.source_added_at.is_some());
        assert_eq!(track.cover_url.as_deref(), Some("https://i.scdn.co/large"));
        assert_eq!(track.added_at, 123);
        assert!(
            spotify_playlist_track_from_item(
                &json!({"itemV2":{"data":{"__typename":"Episode"}}}),
                123
            )
            .is_none()
        );
    }
}
