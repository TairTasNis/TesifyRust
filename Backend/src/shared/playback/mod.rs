mod audio_range;
#[cfg(target_os = "android")]
pub(crate) mod android;
pub mod commands;
mod intro_cache;
#[cfg(any(target_os = "android", test))]
mod music_search;
pub mod play_engine;
mod stream;

use self::{
    intro_cache::{CachedIntro, IntroCache},
    play_engine::{AudioSource, PlayEngine, VideoMatch},
};
use crate::shared::playlists::models::Track;
use crate::pages::{downloads::store::DownloadStore, lyrics::models::LyricsResponse};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStateInput {
    pub has_track: bool,
    pub playing: bool,
    pub loading: bool,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub duration_ms: u64,
    pub position_ms: u64,
}

#[derive(Clone)]
pub(super) struct SourceEntry {
    key: String,
    token: String,
    video: VideoMatch,
    source: AudioSource,
    created: Instant,
    intro: Arc<OnceLock<CachedIntro>>,
    source_lock: Arc<AsyncMutex<()>>,
    warm_lock: Arc<AsyncMutex<()>>,
    warming: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    audio_url: String,
    video_url: String,
    duration_seconds: Option<f64>,
    intro_cached: bool,
}

pub struct PlaybackService {
    engine: PlayEngine,
    #[cfg(target_os = "android")]
    android_tools: android::AndroidTools,
    client: reqwest::Client,
    sources: Mutex<HashMap<String, SourceEntry>>,
    flights: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    intro_cache: IntroCache,
    pub(crate) downloads: DownloadStore,
    offline_token: String,
    workers: Arc<Semaphore>,
    origin: String,
    background_playback: AtomicBool,
    active_playing: AtomicBool,
}

impl PlaybackService {
    pub fn new(
        client: reqwest::Client,
        engine: PlayEngine,
        cache_dir: PathBuf,
        #[cfg(target_os = "android")] android_tools: android::AndroidTools,
    ) -> Result<Arc<Self>, String> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|_| "Не удалось запустить сервис воспроизведения.".to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Не удалось настроить сервис воспроизведения.".to_string())?;
        let port = listener
            .local_addr()
            .map_err(|_| "Не удалось получить адрес плеера.".to_string())?
            .port();
        let service = Arc::new(Self {
            engine,
            #[cfg(target_os = "android")]
            android_tools,
            client,
            sources: Mutex::new(HashMap::new()),
            flights: Mutex::new(HashMap::new()),
            downloads: DownloadStore::new(cache_dir.with_file_name("downloads-v1")),
            intro_cache: IntroCache::new(cache_dir),
            offline_token: uuid::Uuid::new_v4().to_string(),
            workers: Arc::new(Semaphore::new(2)),
            origin: format!("http://127.0.0.1:{port}"),
            background_playback: AtomicBool::new(true),
            active_playing: AtomicBool::new(false),
        });
        let state = service.clone();
        tauri::async_runtime::spawn(async move {
            match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => {
                    if let Err(error) = axum::serve(listener, stream::router(state)).await {
                        eprintln!("Playback server: {error}");
                    }
                }
                Err(error) => eprintln!("Playback listener: {error}"),
            }
        });
        Ok(service)
    }

    pub async fn resolve(self: &Arc<Self>, track: Track) -> Result<PlaybackSource, String> {
        if let Some(source) = self.offline_source(&track.spotify_id).await {
            return Ok(source);
        }
        self.resolve_online(track).await
    }

    pub async fn offline_source(&self, id: &str) -> Option<PlaybackSource> {
        let item = self.downloads.get(id).await?;
        Some(PlaybackSource {
            audio_url: format!("{}/offline/{}/{id}", self.origin, self.offline_token),
            video_url: String::new(),
            duration_seconds: item.duration_seconds,
            intro_cached: true,
        })
    }

    pub(crate) async fn save_audio(
        self: &Arc<Self>,
        track: Track,
        lyrics: impl Future<Output = LyricsResponse>,
        on_progress: impl Fn(u64, Option<u64>),
    ) -> Result<(), String> {
        let source = self.resolve_online(track.clone()).await?;
        let audio = self.client.get(&source.audio_url)
            .timeout(Duration::from_secs(240))
            .send().await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| "Не удалось скачать аудио.".to_string())?;
        self.downloads.save(track, audio, source.duration_seconds, lyrics, on_progress).await
            .map_err(|error| {
                eprintln!("Offline audio: {error}");
                "Не удалось скачать аудио.".to_string()
            })
    }

    async fn resolve_online(self: &Arc<Self>, track: Track) -> Result<PlaybackSource, String> {
        let key = IntroCache::key(&track);
        if let Some(entry) = self.cached(&key) {
            if entry.source.url.is_empty() {
                self.background(entry.clone());
            }
            return Ok(self.response(&entry));
        }
        let flight = {
            let mut flights = self.flights.lock().map_err(|_| "Плеер недоступен.")?;
            flights.retain(|_, lock| lock.strong_count() > 0);
            if let Some(lock) = flights.get(&key).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(AsyncMutex::new(()));
                flights.insert(key.clone(), Arc::downgrade(&lock));
                lock
            }
        };
        let _guard = flight.lock().await;
        if let Some(entry) = self.cached(&key) {
            if entry.source.url.is_empty() {
                self.background(entry.clone());
            }
            return Ok(self.response(&entry));
        }
        let cache = self.intro_cache.clone();
        let disk_key = key.clone();
        let disk = tauri::async_runtime::spawn_blocking(move || cache.load(&disk_key))
            .await
            .ok()
            .flatten();
        let (video, source) = if let Some(intro) = &disk {
            (intro.video.clone(), intro.source())
        } else {
            let permit = self
                .workers
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| "Плеер недоступен.".to_string())?;
            let artist = track.artist.split(',').next().unwrap_or(&track.artist).trim();
            static CREDITS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
                regex::Regex::new(r"(?i)\s*[\(\[](?:feat\.?|ft\.?|with)\s+[^\)\]]*[\)\]]")
                    .expect("static regex")
            });
            let title = CREDITS.replace_all(&track.title, "");
            let duration = track.duration_ms.filter(|ms| *ms > 0)
                .map(|ms| Duration::from_millis(ms as u64));
            #[cfg(target_os = "android")]
            let (engine, catalog_video) = tokio::join!(
                self.engine(), music_search::find(&self.client, &title, artist, duration)
            );
            #[cfg(target_os = "android")]
            let engine = engine?;
            #[cfg(not(target_os = "android"))]
            let engine = self.engine().await?;
            let title = title.into_owned();
            let artist = artist.to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                #[cfg(target_os = "android")]
                if let Some(video) = catalog_video {
                    if let Ok(source) = engine.clone().with_timeout(Duration::from_secs(10)).audio_source(&video) {
                        return Ok((video, source));
                    }
                }
                let video = engine
                    .find_with_duration(&title, &artist, duration)
                    .map_err(engine_error)?;
                let source = engine.audio_source(&video).map_err(engine_error)?;
                Ok::<_, String>((video, source))
            })
            .await
            .map_err(|_| "Не удалось подготовить трек.".to_string())??
        };
        let intro = Arc::new(OnceLock::new());
        if let Some(disk) = disk {
            let _ = intro.set(disk);
        }
        let entry = SourceEntry {
            key: key.clone(),
            token: uuid::Uuid::new_v4().to_string(),
            video,
            source,
            created: Instant::now(),
            intro,
            source_lock: flight.clone(),
            warm_lock: Arc::new(AsyncMutex::new(())),
            warming: Arc::new(AtomicBool::new(false)),
        };
        {
            let mut sources = self
                .sources
                .lock()
                .map_err(|_| "Плеер недоступен.".to_string())?;
            if sources.len() >= 64 {
                if let Some(oldest) = sources
                    .iter()
                    .min_by_key(|(_, value)| value.created)
                    .map(|(key, _)| key.clone())
                {
                    sources.remove(&oldest);
                }
            }
            sources.insert(key, entry.clone());
        }
        if entry.source.url.is_empty() {
            self.background(entry.clone());
        }
        Ok(self.response(&entry))
    }

    fn background(self: &Arc<Self>, entry: SourceEntry) {
        if entry.warming.swap(true, Ordering::AcqRel) {
            return;
        }
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            if entry.intro.get().is_some() {
                if entry.source.url.is_empty() {
                    let _ = service.refresh(&entry).await;
                }
            } else if let Err(error) = service.warm_intro(&entry).await {
                eprintln!("Audio intro: {error}");
            }
            entry.warming.store(false, Ordering::Release);
        });
    }

    pub async fn prefetch(self: &Arc<Self>, track: Track) -> Result<PlaybackSource, String> {
        if let Some(source) = self.offline_source(&track.spotify_id).await {
            return Ok(source);
        }
        let source = self.resolve_online(track).await?;
        let token = source.audio_url.rsplit('/').next().unwrap_or("");
        let entry = self.source(token).ok_or("Источник трека истёк.")?;
        self.warm_intro(&entry).await?;
        Ok(self.response(&entry))
    }

    async fn warm_intro(&self, entry: &SourceEntry) -> Result<(), String> {
        let generation = self.intro_cache.generation();
        let _guard = entry.warm_lock.lock().await;
        if entry.intro.get().is_some() {
            return Ok(());
        }
        let mut entry = entry.clone();
        let probe = stream::request_chunk(self, &mut entry, 0, 0)
            .await
            .map_err(|(_, error)| error.to_string())?;
        let total = stream::content_range(&probe)
            .map_err(|(_, error)| error.to_string())?
            .total;
        drop(probe);
        let duration = entry
            .source
            .duration_seconds
            .or(entry.video.duration_seconds)
            .filter(|value| value.is_finite() && *value > 0.)
            .ok_or("Неизвестная длительность записи.")?;
        // Five seconds of audio plus container/index headroom, bounded to avoid downloading the song.
        let head_len = ((total as f64 / duration * 5. + 128. * 1024.).ceil() as u64)
            .clamp(256 * 1024, 512 * 1024)
            .min(total);
        let tail_len = (64 * 1024).min(total - head_len);
        let head_response = stream::request_chunk(self, &mut entry, 0, head_len - 1)
            .await
            .map_err(|(_, error)| error.to_string())?;
        let head_range =
            stream::content_range(&head_response).map_err(|(_, error)| error.to_string())?;
        if head_range.start != 0 || head_range.end != head_len - 1 || head_range.total != total {
            return Err("Несогласованный фрагмент начала записи.".into());
        }
        let head = head_response
            .bytes()
            .await
            .map_err(|_| "Не удалось получить начало записи.")?
            .to_vec();
        if head.len() as u64 != head_len {
            return Err("Неполный фрагмент начала записи.".into());
        }
        let tail = if tail_len > 0 {
            let tail_response =
                stream::request_chunk(self, &mut entry, total - tail_len, total - 1)
                    .await
                    .map_err(|(_, error)| error.to_string())?;
            let range =
                stream::content_range(&tail_response).map_err(|(_, error)| error.to_string())?;
            if range.start != total - tail_len || range.end != total - 1 || range.total != total {
                return Err("Несогласованный индекс записи.".into());
            }
            let bytes = tail_response
                .bytes()
                .await
                .map_err(|_| "Не удалось получить индекс записи.")?
                .to_vec();
            if bytes.len() as u64 != tail_len {
                return Err("Неполный индекс записи.".into());
            }
            bytes
        } else {
            Vec::new()
        };
        let intro = CachedIntro {
            version: 1,
            video: entry.video.clone(),
            content_type: entry.source.content_type.clone(),
            format_id: entry.source.format_id.clone(),
            duration,
            total,
            head,
            tail,
        };
        let _ = entry.intro.set(intro);
        let cache = self.intro_cache.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Some(intro) = entry.intro.get() {
                if let Err(error) = cache.save_if_current(generation, &entry.key, intro) {
                    eprintln!("Audio intro cache: {error}");
                }
            }
        })
        .await
        .map_err(|_| "Не удалось сохранить начало записи.")?;
        Ok(())
    }

    pub fn intro_storage_bytes(&self) -> std::io::Result<u64> {
        self.intro_cache.size()
    }

    pub fn clear_intro_storage(&self) -> std::io::Result<()> {
        self.intro_cache.clear()
    }

    fn cached(&self, key: &str) -> Option<SourceEntry> {
        self.sources
            .lock()
            .ok()?
            .get(key)
            .filter(|entry| {
                entry.intro.get().is_some()
                    || entry.created.elapsed() < Duration::from_secs(45 * 60)
            })
            .cloned()
    }

    fn response(&self, entry: &SourceEntry) -> PlaybackSource {
        PlaybackSource {
            audio_url: format!("{}/audio/{}", self.origin, entry.token),
            video_url: entry.video.url.clone(),
            duration_seconds: entry
                .source
                .duration_seconds
                .or(entry.video.duration_seconds),
            intro_cached: entry.intro.get().is_some(),
        }
    }

    fn source(&self, token: &str) -> Option<SourceEntry> {
        self.sources
            .lock()
            .ok()?
            .values()
            .find(|entry| entry.token == token)
            .cloned()
    }

    async fn refresh(&self, entry: &SourceEntry) -> Result<AudioSource, String> {
        let _guard = entry.source_lock.lock().await;
        if let Some(current) = self.source(&entry.token) {
            if !current.source.url.is_empty()
                && (entry.source.url.is_empty() || current.source.url != entry.source.url)
            {
                return Ok(current.source);
            }
        }
        let engine = self.engine().await?;
        let video = entry.video.clone();
        let source = tauri::async_runtime::spawn_blocking(move || {
            engine.audio_source(&video).map_err(engine_error)
        })
        .await
        .map_err(|_| "Не удалось обновить источник трека.".to_string())??;
        if let Some(intro) = entry.intro.get() {
            if (source.format_id.is_some() && source.format_id != intro.format_id)
                || source.filesize.is_some_and(|size| size != intro.total)
            {
                self.intro_cache.remove(&entry.key);
                if let Ok(mut sources) = self.sources.lock() {
                    sources.remove(&entry.key);
                }
                return Err("Версия записи изменилась. Включите трек снова.".into());
            }
        }
        if let Ok(mut sources) = self.sources.lock() {
            if let Some(cached) = sources.get_mut(&entry.key) {
                cached.source = source.clone();
                cached.created = Instant::now();
            }
        }
        Ok(source)
    }

    pub fn background_playback_enabled(&self) -> bool {
        self.background_playback.load(Ordering::Relaxed)
    }

    pub fn is_playing(&self) -> bool {
        self.active_playing.load(Ordering::Relaxed)
    }

    pub async fn set_background_playback(&self, enabled: bool) {
        self.background_playback.store(enabled, Ordering::Relaxed);
        #[cfg(target_os = "android")]
        self.android_tools.set_background_playback(enabled).await;
    }

    pub async fn sync_media_state(&self, state: MediaStateInput) {
        self.active_playing
            .store(state.has_track && state.playing, Ordering::Relaxed);
        #[cfg(target_os = "android")]
        self.android_tools.update_media_state(&state).await;
    }

    async fn engine(&self) -> Result<PlayEngine, String> {
        let engine = self.engine.clone();
        #[cfg(target_os = "android")]
        let engine = engine.with_android_runtime(self.android_tools.runtime().await?.clone());
        Ok(engine)
    }
}

fn engine_error(error: play_engine::PlayEngineError) -> String {
    eprintln!("PlayEngine: {error}");
    match error {
        play_engine::PlayEngineError::ToolNotFound(_) => {
            "Не найден yt-dlp. Установите его или укажите YT_DLP_PATH в .env.".into()
        }
        play_engine::PlayEngineError::NoMatch => {
            "Не удалось найти подходящую запись этой песни.".into()
        }
        play_engine::PlayEngineError::Timeout(_) => {
            "Источник музыки не ответил вовремя. Повторите попытку.".into()
        }
        _ => "Не удалось получить запись. Попробуйте другой трек или повторите попытку.".into(),
    }
}
