use super::{
    cache,
    fonts::LyricsFontStore,
    models::{Lyrics, LyricsCandidate, LyricsResponse},
    providers::{self, CandidatePayload, Outcome, Settings},
};
use crate::shared::playlists::models::Track;
use futures_util::{StreamExt, stream::FuturesUnordered};
use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};

pub use super::providers::Settings as LyricsSettings;

impl Settings {
    pub fn from_values(setting: &impl Fn(&str) -> Option<String>) -> Self {
        let base = |name: &str, default: &str| {
            setting(name)
                .filter(|v| {
                    v.starts_with("https://")
                        || v.starts_with("http://127.0.0.1:")
                        || v.starts_with("http://localhost:")
                })
                .unwrap_or_else(|| default.into())
                .trim_end_matches('/')
                .to_string()
        };
        let mut mirrors: Vec<String> = setting("LYRICSPLUS_SERVERS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|v| {
                v.starts_with("https://")
                    || v.starts_with("http://127.0.0.1:")
                    || v.starts_with("http://localhost:")
            })
            .map(|v| v.trim_end_matches('/').to_string())
            .collect();
        for default in providers::MIRRORS {
            if !mirrors.iter().any(|m| m == default) {
                mirrors.push((*default).into());
            }
        }
        Self {
            mirrors,
            better_url: base("BETTERLYRICS_URL", "https://api.betterlyrics.org"),
            better_key: setting("BETTERLYRICS_API_KEY").filter(|v| !v.trim().is_empty()),
            lrcapi_url: base("LRCAPI_URL", "https://api.lrc.cx"),
        }
    }
}

struct Cached {
    response: LyricsResponse,
    expires: Instant,
}

#[derive(Default)]
struct CandidateStore {
    entries: HashMap<String, CandidatePayload>,
    order: VecDeque<String>,
}

impl CandidateStore {
    fn insert(&mut self, id: String, payload: CandidatePayload) {
        if self.entries.len() >= 256 {
            while self.entries.len() >= 200 {
                if let Some(old) = self.order.pop_front() {
                    self.entries.remove(&old);
                } else {
                    break;
                }
            }
        }
        self.order.push_back(id.clone());
        self.entries.insert(id, payload);
    }

    fn get(&self, id: &str) -> Option<CandidatePayload> {
        self.entries.get(id).cloned()
    }
}

pub struct LyricsService {
    client: reqwest::Client,
    settings: Settings,
    cache: Mutex<HashMap<String, Cached>>,
    candidates: Mutex<CandidateStore>,
    directory: PathBuf,
    pub fonts: LyricsFontStore,
    flights: [Mutex<()>; 32],
    slots: Semaphore,
}

impl LyricsService {
    pub fn with_cache(client: reqwest::Client, settings: Settings, directory: PathBuf) -> Arc<Self> {
        let fonts_dir = directory
            .parent()
            .unwrap_or(&directory)
            .join("lyrics-fonts-v1");
        Arc::new(Self {
            client,
            settings,
            cache: Mutex::new(HashMap::new()),
            candidates: Mutex::new(CandidateStore::default()),
            directory,
            fonts: LyricsFontStore::new(fonts_dir),
            flights: std::array::from_fn(|_| Mutex::new(())),
            slots: Semaphore::new(2),
        })
    }

    pub async fn get(&self, track: &Track) -> LyricsResponse {
        self.get_from(track, None).await
    }

    fn override_cache_key(track: &Track) -> String {
        cache::override_key((
            &track.spotify_id,
            &track.title,
            &track.artist,
            track.duration_ms.unwrap_or(0),
        ))
    }

    pub async fn saved_override(&self, track: &Track) -> Option<LyricsResponse> {
        let key = Self::override_cache_key(track);
        let stripe = usize::from_str_radix(&key[..2], 16).expect("hex digest") % self.flights.len();
        let _flight = self.flights[stripe].lock().await;
        if let Some(cached) = self.cache.lock().await.get(&key).filter(|c| c.expires > Instant::now()) {
            let mut response = cached.response.clone();
            response.custom = true;
            return Some(response);
        }
        let mut response = cache::read(self.directory.clone(), &key).await?;
        response.custom = true;
        self.remember(key, &response).await;
        Some(response)
    }

    pub async fn get_from(&self, track: &Track, requested_source: Option<&str>) -> LyricsResponse {
        let requested_source = requested_source.map(|source| source.trim().to_ascii_lowercase());
        if requested_source.is_none() {
            if let Some(response) = self.saved_override(track).await {
                return response;
            }
        }

        let key = cache::key((
            &track.spotify_id,
            &track.title,
            &track.artist,
            track.duration_ms.unwrap_or(0),
            requested_source.as_deref(),
        ));
        let stripe = usize::from_str_radix(&key[..2], 16).expect("hex digest") % self.flights.len();
        let _flight = self.flights[stripe].lock().await;
        if let Some(cached) = self
            .cache
            .lock()
            .await
            .get(&key)
            .filter(|c| c.expires > Instant::now())
        {
            return cached.response.clone();
        }
        if let Some(response) = cache::read(self.directory.clone(), &key).await {
            self.remember(key, &response).await;
            return response;
        }
        let Ok(_slot) = self.slots.acquire().await else {
            return LyricsResponse { status: "unavailable".into(), lyrics: None, custom: false };
        };

        let client = &self.client;
        let settings = &self.settings;

        if let Some(src) = requested_source.as_deref() {
            let outcome = match src {
                "lyricsplus" => providers::lyricsplus(client, track, settings).await,
                "binilyrics" | "binimum" => providers::binimum(client, track).await,
                "better" | "betterlyrics" | "better lyrics" => providers::better(client, track, settings).await,
                "lrcmux" => providers::lrcmux(client, track).await,
                "amll" | "amll ttml database" => providers::amll(client, track).await,
                "kugou" | "kugou music" => providers::kugou(client, track).await,
                "netease" | "netease cloud music" => providers::netease(client, track).await,
                "lrclib" => providers::lrclib(client, track).await,
                "lrcapi" => providers::lrcapi(client, track, settings).await,
                _ => providers::lyricsplus(client, track, settings).await,
            };

            let response = match outcome {
                Outcome::Found(doc) => LyricsResponse {
                    status: "found".into(),
                    lyrics: Some(doc),
                    custom: false,
                },
                Outcome::Instrumental => LyricsResponse {
                    status: "instrumental".into(),
                    lyrics: None,
                    custom: false,
                },
                Outcome::Failed => LyricsResponse {
                    status: "unavailable".into(),
                    lyrics: None,
                    custom: false,
                },
                Outcome::Miss => LyricsResponse {
                    status: "not_found".into(),
                    lyrics: None,
                    custom: false,
                },
            };

            self.store(key, &response).await;
            return response;
        }

        let response = self.fetch_best(track).await;
        self.store(key, &response).await;
        response
    }

    async fn fetch_best(&self, track: &Track) -> LyricsResponse {
        let client = &self.client;
        let settings = &self.settings;
        let mut requests: FuturesUnordered<Pin<Box<dyn Future<Output = Outcome> + Send + '_>>> =
            FuturesUnordered::new();
        requests.push(Box::pin(providers::lyricsplus(client, track, settings)));
        requests.push(Box::pin(providers::binimum(client, track)));
        requests.push(Box::pin(providers::better(client, track, settings)));
        requests.push(Box::pin(providers::lrcmux(client, track)));
        requests.push(Box::pin(providers::amll(client, track)));
        requests.push(Box::pin(providers::kugou(client, track)));
        requests.push(Box::pin(providers::netease(client, track)));
        requests.push(Box::pin(providers::lrclib(client, track)));
        requests.push(Box::pin(providers::lrcapi(client, track, settings)));
        let track_dur = track.duration_ms.unwrap_or(0) as f64 / 1000.0;
        let mut best: Option<Lyrics> = None;
        let mut failed = false;
        let mut instrumental = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(22);
        loop {
            match tokio::time::timeout_at(deadline, requests.next()).await {
                Ok(Some(Outcome::Found(doc))) => {
                    let is_better = match &best {
                        None => true,
                        Some(b) => providers::quality(&doc, track_dur) > providers::quality(b, track_dur),
                    };
                    if is_better {
                        best = Some(doc);
                    }
                    // Accept a confirmed word-timed version immediately. Compare other providers by duration.
                    if let Some(b) = &best {
                        if b.sync == "word"
                            && providers::precise_duration(b, track_dur)
                        {
                            break;
                        }
                    }
                }
                Ok(Some(Outcome::Instrumental)) => instrumental = true,
                Ok(Some(Outcome::Failed)) => failed = true,
                Ok(Some(Outcome::Miss)) => {}
                Ok(None) => break,
                Err(_) => {
                    failed = true;
                    break;
                }
            }
        }
        let status = if best.is_some() {
            "found"
        } else if instrumental {
            "instrumental"
        } else if failed {
            "unavailable"
        } else {
            "not_found"
        };
        LyricsResponse {
            status: status.into(),
            lyrics: best,
            custom: false,
        }
    }

    pub async fn search_candidates(&self, query: &str) -> Vec<LyricsCandidate> {
        let results = providers::search_candidates(&self.client, query).await;
        let mut store = self.candidates.lock().await;
        let mut out = Vec::with_capacity(results.len());
        for item in results {
            store.insert(item.info.id.clone(), item.payload);
            out.push(item.info);
        }
        out
    }

    pub async fn apply_candidate(&self, track: &Track, candidate_id: &str) -> Result<LyricsResponse, String> {
        let payload = self
            .candidates
            .lock()
            .await
            .get(candidate_id)
            .ok_or_else(|| "Результат поиска устарел. Повторите поиск.".to_string())?;
        let lyrics = providers::resolve_candidate(&self.client, payload).await?;
        let response = self.save_override(track, lyrics).await;
        Ok(response)
    }

    pub async fn apply_from_other_track(
        &self,
        target: &Track,
        source_track: &Track,
    ) -> Result<LyricsResponse, String> {
        let fetched = self.get_from(source_track, None).await;
        let Some(lyrics) = fetched.lyrics.filter(|_| fetched.status == "found") else {
            return Err(match fetched.status.as_str() {
                "instrumental" => "У выбранной песни нет слов (инструментал).".into(),
                "unavailable" => "Источники текста сейчас недоступны. Попробуйте ещё раз.".into(),
                _ => "Для выбранной песни не удалось найти текст.".into(),
            });
        };
        Ok(self.save_override(target, lyrics).await)
    }

    pub async fn save_override(&self, track: &Track, lyrics: Lyrics) -> LyricsResponse {
        let ovr_key = Self::override_cache_key(track);
        let stripe = usize::from_str_radix(&ovr_key[..2], 16).expect("hex digest") % self.flights.len();
        let _flight = self.flights[stripe].lock().await;
        let response = LyricsResponse {
            status: "found".into(),
            lyrics: Some(lyrics),
            custom: true,
        };
        self.store(ovr_key, &response).await;
        response
    }

    pub async fn clear_override(&self, track: &Track) {
        let ovr_key = Self::override_cache_key(track);
        let stripe = usize::from_str_radix(&ovr_key[..2], 16).expect("hex digest") % self.flights.len();
        let _flight = self.flights[stripe].lock().await;
        self.cache.lock().await.remove(&ovr_key);
        cache::remove(self.directory.clone(), &ovr_key).await;
    }

    async fn store(&self, key: String, response: &LyricsResponse) {
        if response.status == "found" {
            cache::write(self.directory.clone(), &key, response.clone()).await;
        }
        self.remember(key, response).await;
    }

    async fn remember(&self, key: String, response: &LyricsResponse) {
        if response.status != "unavailable" {
            let mut cache = self.cache.lock().await;
            cache.retain(|_, c| c.expires > Instant::now());
            if cache.len() >= 128 {
                cache.clear();
            }
            cache.insert(
                key,
                Cached {
                    response: response.clone(),
                    expires: Instant::now()
                        + Duration::from_secs(if response.status == "found" { 3600 } else { 30 }),
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::lyrics::parse;

    #[tokio::test]
    async fn manual_override_takes_priority_and_clears_cleanly() {
        let dir = std::env::temp_dir().join(format!("tesify-lyrics-svc-{}", uuid::Uuid::new_v4()));
        let service = LyricsService::with_cache(
            reqwest::Client::new(),
            Settings::from_values(&|_| None),
            dir.clone(),
        );
        let track = Track {
            id: "t1".into(),
            spotify_id: "sp1".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            artists: vec![],
            cover_url: None,
            duration_ms: Some(120_000),
            added_at: 0,
            source_added_at: None,
            source_url: "".into(),
        };
        let custom_lyrics = parse::document(
            parse::lrc("[00:05.00]Custom fixed line\n[00:50.00]Second custom line\n[01:40.00]Third custom line"),
            "LRCLIB",
            "https://lrclib.net",
            120.0,
        )
        .unwrap();
        let saved = service.save_override(&track, custom_lyrics).await;
        assert!(saved.custom);
        assert_eq!(saved.status, "found");

        let loaded = service.get_from(&track, None).await;
        assert!(loaded.custom);
        assert_eq!(loaded.lyrics.unwrap().lines[0].text, "Custom fixed line");

        // Fresh service reading from disk should also see the override immediately.
        let reloaded_service = LyricsService::with_cache(
            reqwest::Client::new(),
            Settings::from_values(&|_| None),
            dir.clone(),
        );
        let from_disk = reloaded_service.get_from(&track, None).await;
        assert!(from_disk.custom);
        assert_eq!(from_disk.lyrics.unwrap().lines[0].text, "Custom fixed line");

        reloaded_service.clear_override(&track).await;
        let ovr_key = LyricsService::override_cache_key(&track);
        assert!(cache::read(dir.clone(), &ovr_key).await.is_none());

        let _ = std::fs::remove_dir_all(dir);
    }
}
