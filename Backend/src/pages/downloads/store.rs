use crate::{pages::lyrics::models::LyricsResponse, shared::{playlists::models::Track, spotify::mapping::valid_id}};
use serde::{Deserialize, Serialize};
use std::{io, path::{Path, PathBuf}};
use tokio::{fs, io::AsyncWriteExt};

const MAX_AUDIO_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
pub(crate) struct Download {
    pub track: Track,
    pub content_type: String,
    pub duration_seconds: Option<f64>,
    pub bytes: u64,
}

pub(crate) struct DownloadStore {
    root: PathBuf,
}

impl DownloadStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn audio_path(&self, id: &str) -> PathBuf {
        self.root.join(id).join("audio")
    }

    pub fn directory(&self) -> &Path {
        &self.root
    }

    pub fn audio_bytes(&self) -> io::Result<u64> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error),
        };
        let mut bytes = 0_u64;
        for entry in entries {
            let entry = entry?;
            if !entry.file_name().to_str().is_some_and(valid_id) || !entry.file_type()?.is_dir() {
                continue;
            }
            match std::fs::symlink_metadata(entry.path().join("audio")) {
                Ok(audio) if audio.is_file() => bytes = bytes.saturating_add(audio.len()),
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(bytes)
    }

    pub async fn get(&self, id: &str) -> Option<Download> {
        if !valid_id(id) {
            return None;
        }
        let manifest = fs::read(self.root.join(id).join("track.json")).await.ok()?;
        let item: Download = serde_json::from_slice(&manifest).ok()?;
        let audio = fs::metadata(self.audio_path(id)).await.ok()?;
        (item.track.spotify_id == id && audio.is_file() && item.bytes > 0 && audio.len() == item.bytes).then_some(item)
    }

    pub async fn lyrics(&self, id: &str) -> Option<LyricsResponse> {
        if !valid_id(id) {
            return None;
        }
        let saved = fs::read(self.root.join(id).join("lyrics.json")).await.ok()?;
        serde_json::from_slice(&saved).ok()
    }

    pub async fn list(&self) -> io::Result<Vec<Track>> {
        let mut entries = match fs::read_dir(&self.root).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut tracks = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if let Some(track) = self.get(&entry.file_name().to_string_lossy()).await {
                tracks.push(track.track);
            }
        }
        tracks.sort_by_key(|track| std::cmp::Reverse(track.added_at));
        Ok(tracks)
    }

    pub async fn save(
        &self,
        track: Track,
        audio: reqwest::Response,
        duration_seconds: Option<f64>,
        lyrics: impl Future<Output = LyricsResponse>,
        on_progress: impl Fn(u64, Option<u64>),
    ) -> io::Result<()> {
        let id = track.spotify_id.clone();
        if !valid_id(&id) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid track ID"));
        }
        fs::create_dir_all(&self.root).await?;
        let staging = self.root.join(format!(".{}.part", uuid::Uuid::new_v4()));
        fs::create_dir(&staging).await?;
        let result = async {
            let content_type = audio.headers().get(reqwest::header::CONTENT_TYPE)
                .and_then(|header| header.to_str().ok())
                .filter(|header| header.starts_with("audio/"))
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Missing audio type"))?
                .to_owned();
            let (bytes, lyrics) = tokio::try_join!(
                write_audio(&staging, audio, on_progress),
                async { Ok(lyrics.await) },
            )?;
            let track = Track {
                id: id.clone(),
                added_at: chrono::Utc::now().timestamp_millis(),
                ..track
            };
            let item = Download { track, content_type, duration_seconds, bytes };
            let mut text = fs::File::create(staging.join("lyrics.json")).await?;
            text.write_all(&serde_json::to_vec(&lyrics)?).await?;
            text.sync_all().await?;
            drop(text);
            let mut manifest = fs::File::create(staging.join("track.json")).await?;
            manifest.write_all(&serde_json::to_vec(&item)?).await?;
            manifest.sync_all().await?;
            drop(manifest);
            let destination = self.root.join(&id);
            // A damaged or interrupted old copy must not block a fresh download.
            if fs::metadata(&destination).await.is_ok() && self.get(&id).await.is_none() {
                fs::remove_dir_all(&destination).await?;
            }
            fs::rename(&staging, destination).await
        }.await;
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging).await;
        }
        result
    }
}

async fn write_audio(
    directory: &Path,
    mut response: reqwest::Response,
    on_progress: impl Fn(u64, Option<u64>),
) -> io::Result<u64> {
    let expected = response.content_length();
    if expected.is_some_and(|length| length > MAX_AUDIO_BYTES) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Audio exceeds size limit"));
    }
    let mut file = fs::File::create(directory.join("audio")).await?;
    let mut bytes = 0;
    while let Some(chunk) = response.chunk().await.map_err(io::Error::other)? {
        bytes += chunk.len() as u64;
        if bytes > MAX_AUDIO_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "Audio exceeds size limit"));
        }
        file.write_all(&chunk).await?;
        on_progress(bytes, expected);
    }
    if bytes == 0 || expected.is_some_and(|length| bytes != length) {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "Incomplete audio"));
    }
    file.sync_all().await?;
    Ok(bytes)
}
