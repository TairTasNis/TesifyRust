// Guest request format adapted from the user's D:/Python/Tesify/src-tauri/src/search.rs.
// Copyright (c) 2026 Tair Tasmukhambetov (@ttfotg), TFG License.
use super::{mapping::valid_id, models::CatalogItem};
use crate::shared::playlists::models::Track;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Mutex as AsyncMutex;

pub const SEARCH_HASH: &str = "eef7cc54888d91bdd6802623477873caa3948ae173a0c34fd86827b267e94c03";
pub const ARTIST_HASH: &str = "9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6";
pub const DISCOGRAPHY_HASH: &str =
    "5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599";
pub const ALBUM_HASH: &str = "0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f";
pub const PLAYLIST_HASH: &str = "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf";

struct GuestToken {
    token: String,
    created: Instant,
}
pub struct SpotifyClient {
    http: reqwest::Client,
    guest: AsyncMutex<Option<GuestToken>>,
    cache: Mutex<HashMap<String, (Instant, Arc<Value>)>>,
    tracks: Mutex<HashMap<String, (Instant, Track)>>,
    requests: tokio::sync::Semaphore,
}
impl SpotifyClient {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            guest: AsyncMutex::new(None),
            cache: Mutex::new(HashMap::new()),
            tracks: Mutex::new(HashMap::new()),
            requests: tokio::sync::Semaphore::new(4),
        }
    }
    async fn token(&self) -> Result<String, String> {
        let mut guest = self.guest.lock().await;
        if let Some(auth) = guest
            .as_ref()
            .filter(|auth| auth.created.elapsed() < Duration::from_secs(50 * 60))
        {
            return Ok(auth.token.clone());
        }
        let html = self
            .http
            .get("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M")
            .send()
            .await
            .map_err(|_| "Не удалось подключиться к Spotify.")?
            .error_for_status()
            .map_err(|_| "Spotify временно недоступен.")?
            .text()
            .await
            .map_err(|_| "Не удалось получить гостевой доступ Spotify.")?;
        let regex = regex::Regex::new(r#""accessToken":"([^"]+)""#).expect("static regex");
        let token = regex
            .captures(&html)
            .and_then(|caps| caps.get(1))
            .map(|value| value.as_str().to_owned())
            .ok_or("Spotify не выдал гостевой доступ. Повторите попытку позже.")?;
        *guest = Some(GuestToken {
            token: token.clone(),
            created: Instant::now(),
        });
        Ok(token)
    }
    pub async fn query(
        &self,
        operation: &str,
        hash: &str,
        variables: Value,
    ) -> Result<Arc<Value>, String> {
        let key = format!("{operation}:{variables}");
        if let Some(value) = self
            .cache
            .lock()
            .map_err(|_| "Каталог недоступен.")?
            .get(&key)
            .filter(|(at, _)| at.elapsed() < Duration::from_secs(300))
            .map(|(_, value)| value.clone())
        {
            return Ok(value);
        }
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|_| "Каталог недоступен.")?;
        for attempt in 0..2 {
            let token = self.token().await?;
            let response = self.http.post("https://api-partner.spotify.com/pathfinder/v2/query")
                .bearer_auth(token).header("app-platform", "WebPlayer").header("Referer", "https://open.spotify.com/")
                .json(&json!({"operationName":operation,"variables":variables,"extensions":{"persistedQuery":{"version":1,"sha256Hash":hash}}}))
                .send().await.map_err(|_| "Spotify не ответил. Проверьте соединение и повторите попытку.")?;
            let status = response.status();
            if status.as_u16() == 401 && attempt == 0 {
                *self.guest.lock().await = None;
                continue;
            }
            if !status.is_success() {
                return Err(match status.as_u16() {
                    401 | 403 => {
                        "Spotify временно ограничил гостевой доступ. Повторите попытку позже."
                    }
                    404 => "Страница Spotify не найдена или недоступна.",
                    429 => "Spotify ограничил частоту запросов. Подождите немного.",
                    _ => "Spotify временно недоступен. Повторите попытку.",
                }
                .into());
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|_| "Ответ Spotify прервался.")?;
            if bytes.len() > 12 * 1024 * 1024 {
                return Err(
                    "Ответ Spotify слишком большой. Уменьшите страницу результатов.".into(),
                );
            }
            let value: Value =
                serde_json::from_slice(&bytes).map_err(|_| "Spotify вернул некорректный ответ.")?;
            if value
                .get("errors")
                .and_then(Value::as_array)
                .is_some_and(|errors| !errors.is_empty())
                && value.get("data").is_none_or(Value::is_null)
            {
                return Err(
                    "Spotify не смог отдать данные каталога. Повторите попытку позже.".into(),
                );
            }
            let value = Arc::new(value);
            let mut cache = self.cache.lock().map_err(|_| "Каталог недоступен.")?;
            cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(300));
            if cache.len() >= 64 {
                if let Some(oldest) = cache
                    .iter()
                    .min_by_key(|(_, (at, _))| *at)
                    .map(|(key, _)| key.clone())
                {
                    cache.remove(&oldest);
                }
            }
            cache.insert(key, (Instant::now(), value.clone()));
            return Ok(value);
        }
        Err("Не удалось обновить гостевой доступ Spotify.".into())
    }
    pub fn remember(&self, items: &[CatalogItem]) {
        if let Ok(mut tracks) = self.tracks.lock() {
            for item in items
                .iter()
                .filter(|item| item.kind == "track" && item.playable && valid_id(&item.id))
            {
                tracks.insert(
                    item.id.clone(),
                    (
                        Instant::now(),
                        Track {
                            id: item.id.clone(),
                            spotify_id: item.id.clone(),
                            title: item.name.clone(),
                            artist: item.subtitle.clone(),
                            artists: item.artists.clone(),
                            cover_url: item.image_url.clone(),
                            duration_ms: item.duration_ms,
                            added_at: chrono::Utc::now().timestamp_millis(),
                            source_added_at: item.added_at,
                            source_url: format!("https://open.spotify.com/track/{}", item.id),
                        },
                    ),
                );
            }
            while tracks.len() > 10000 {
                if let Some(oldest) = tracks
                    .iter()
                    .min_by_key(|(_, (at, _))| *at)
                    .map(|(key, _)| key.clone())
                {
                    tracks.remove(&oldest);
                } else {
                    break;
                }
            }
        }
    }
    pub fn playback_track(&self, id: &str) -> Result<Track, String> {
        self.tracks
            .lock()
            .map_err(|_| "Каталог недоступен.".to_owned())?
            .get(id)
            .map(|(_, track)| track.clone())
            .ok_or_else(|| "Обновите страницу каталога и включите трек снова.".into())
    }
}
