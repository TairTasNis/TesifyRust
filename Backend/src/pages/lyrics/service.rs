use super::{
    cache,
    models::{Lyrics, LyricsResponse},
    providers::{self, Outcome, Settings},
};
use crate::shared::playlists::models::Track;
use futures_util::{StreamExt, stream::FuturesUnordered};
use std::{
    collections::HashMap,
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
pub struct LyricsService {
    client: reqwest::Client,
    settings: Settings,
    cache: Mutex<HashMap<String, Cached>>,
    directory: PathBuf,
    flights: [Mutex<()>; 32],
    slots: Semaphore,
}

impl LyricsService {
    pub fn with_cache(client: reqwest::Client, settings: Settings, directory: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            client,
            settings,
            cache: Mutex::new(HashMap::new()),
            directory,
            flights: std::array::from_fn(|_| Mutex::new(())),
            slots: Semaphore::new(2),
        })
    }

    pub async fn get(&self, track: &Track) -> LyricsResponse {
        self.get_from(track, None).await
    }

    pub async fn get_from(&self, track: &Track, requested_source: Option<&str>) -> LyricsResponse {
        let requested_source = requested_source.map(|source| source.trim().to_ascii_lowercase());
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
            return LyricsResponse { status: "unavailable".into(), lyrics: None };
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
                },
                Outcome::Instrumental => LyricsResponse {
                    status: "instrumental".into(),
                    lyrics: None,
                },
                Outcome::Failed => LyricsResponse {
                    status: "unavailable".into(),
                    lyrics: None,
                },
                Outcome::Miss => LyricsResponse {
                    status: "not_found".into(),
                    lyrics: None,
                },
            };

            self.store(key, &response).await;
            return response;
        }

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
        let response = LyricsResponse {
            status: status.into(),
            lyrics: best,
        };
        self.store(key, &response).await;
        response
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
