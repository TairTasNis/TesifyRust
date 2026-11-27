use crate::shared::{
    playlists::models::Track, services::AppServices, spotify::mapping::valid_id,
};
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, sync::Mutex, time::Instant};
use tauri::State;

pub(crate) const QUEUE_ID: &str = "downloads";
const DOWNLOAD_FAILED: &str = "Не удалось скачать аудио.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInput {
    playlist_id: String,
    track_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    active: bool,
    total: usize,
    completed: usize,
    failed: usize,
    percent: u8,
    eta_seconds: Option<u64>,
}

#[derive(Default)]
struct Batch {
    started: Option<Instant>,
    total: usize,
    completed: usize,
    failed: usize,
    fraction: f64,
}

#[derive(Default)]
pub(crate) struct DownloadJob(Mutex<Batch>);

impl Batch {
    fn progress(&self) -> DownloadProgress {
        let processed = self.completed + self.failed;
        let active = self.started.is_some() && processed < self.total;
        let done = processed as f64 + self.fraction;
        let percent = if self.total == 0 { 0 } else { (100.0 * done / self.total as f64).floor() as u8 };
        let eta_seconds = self.started.filter(|_| active && done >= 0.15).map(|started| {
            ((self.total as f64 - done) * started.elapsed().as_secs_f64() / done).ceil() as u64
        });
        DownloadProgress { active, total: self.total, completed: self.completed, failed: self.failed, percent, eta_seconds }
    }
}

pub fn progress(services: &AppServices) -> DownloadProgress {
    services.download_job.0.lock().expect("download progress lock").progress()
}

pub async fn list(services: &AppServices) -> Result<Vec<Track>, String> {
    services.playback.downloads.list().await.map_err(|_| "Не удалось открыть скачанные треки.".into())
}

pub async fn start(services: &AppServices, input: DownloadInput) -> Result<DownloadProgress, String> {
    let local = if input.playlist_id.starts_with("spotify:") {
        None
    } else {
        let library = services.library.clone();
        let id = input.playlist_id;
        let playlist = tokio::task::spawn_blocking(move || library.get(&id)).await
            .map_err(|_| DOWNLOAD_FAILED)??;
        Some(playlist.tracks.into_iter().map(|track| (track.id.clone(), track)).collect::<HashMap<_, _>>())
    };
    let mut seen = HashSet::new();
    let mut tracks = Vec::new();
    let mut missing = 0;
    for id in input.track_ids {
        let track = match &local {
            Some(tracks) => tracks.get(&id).cloned(),
            None => services.spotify.playback_track(&id).ok(),
        };
        match track {
            Some(track) if valid_id(&track.spotify_id) => {
                if seen.insert(track.spotify_id.clone()) && services.playback.downloads.get(&track.spotify_id).await.is_none() {
                    tracks.push(track);
                }
            }
            _ => missing += 1,
        }
    }
    let snapshot = {
        let mut batch = services.download_job.0.lock().expect("download progress lock");
        if batch.progress().active {
            return Err("Скачивание уже идёт.".into());
        }
        *batch = Batch { total: tracks.len() + missing, failed: missing, started: Some(Instant::now()), ..Batch::default() };
        batch.progress()
    };
    if !tracks.is_empty() {
        let services = services.clone();
        tauri::async_runtime::spawn(async move {
            for track in tracks {
                let already_saved = services.playback.downloads.get(&track.spotify_id).await.is_some();
                let success = already_saved || services.playback.save_audio(
                    track.clone(),
                    services.lyrics.get(&track),
                    |bytes, total| {
                        if let Some(total) = total.filter(|total| *total > 0) {
                            services.download_job.0.lock().expect("download progress lock").fraction =
                                (0.9 * bytes as f64 / total as f64).min(0.9);
                        }
                    },
                ).await.is_ok();
                let mut batch = services.download_job.0.lock().expect("download progress lock");
                if success { batch.completed += 1; } else { batch.failed += 1; }
                batch.fraction = 0.0;
            }
        });
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn list_downloads(services: State<'_, AppServices>) -> Result<Vec<Track>, String> {
    list(&services).await
}

#[tauri::command]
pub fn get_download_progress(services: State<'_, AppServices>) -> DownloadProgress {
    progress(&services)
}

#[tauri::command]
pub async fn download_tracks(services: State<'_, AppServices>, input: DownloadInput) -> Result<DownloadProgress, String> {
    start(&services, input).await
}
