use super::{
    config::Config,
    playback::{PlaybackService, play_engine::PlayEngine},
    playlists::store::LibraryStore,
    spotify::SpotifyClient,
};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
pub struct AppServices {
    pub library: Arc<LibraryStore>,
    pub http: reqwest::Client,
    pub imgbb_api_key: Option<Arc<str>>,
    pub playback: Arc<PlaybackService>,
    pub spotify: Arc<SpotifyClient>,
    pub lyrics: Arc<crate::pages::lyrics::service::LyricsService>,
}

impl AppServices {
    pub fn new(config: Config) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36")
            .timeout(Duration::from_secs(35)).connect_timeout(Duration::from_secs(12))
            .build().map_err(|_| "Не удалось создать сетевой клиент.".to_string())?;
        let mut engine = PlayEngine::new();
        if let Some(path) = config.yt_dlp_path {
            engine = engine.with_yt_dlp(path);
        }
        if let Some(runtime) = config.yt_dlp_js_runtime {
            engine = engine.with_js_runtime(runtime);
        }
        let playback = PlaybackService::new(
            http.clone(),
            engine,
            config.data_dir.join("audio-intros-v1"),
        )?;
        Ok(Self {
            lyrics: crate::pages::lyrics::service::LyricsService::with_cache(
                http.clone(), config.lyrics, config.data_dir.join("lyrics-v1"),
            ),
            spotify: Arc::new(SpotifyClient::new(http.clone())),
            library: Arc::new(LibraryStore::new(config.data_dir)?),
            http,
            imgbb_api_key: config.imgbb_api_key.map(Arc::from),
            playback,
        })
    }
}
