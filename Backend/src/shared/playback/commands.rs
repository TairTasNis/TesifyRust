use super::{MediaStateInput, PlaybackSource};
use crate::shared::services::AppServices;
use tauri::State;
use crate::pages::downloads::commands::QUEUE_ID;

pub async fn prepare(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
) -> Result<PlaybackSource, String> {
    if playlist_id == QUEUE_ID || playlist_id.starts_with("spotify:") {
        if let Some(source) = services.playback.offline_source(track_id).await {
            return Ok(source);
        }
    }
    if playlist_id == QUEUE_ID {
        return Err("Скачанный трек недоступен.".into());
    }
    if playlist_id.starts_with("spotify:") {
        return services.playback.resolve(services.spotify.playback_track(track_id)?).await;
    }
    let playlist = services.library.get(playlist_id)?;
    let track = playlist
        .tracks
        .into_iter()
        .find(|track| track.id == track_id)
        .ok_or_else(|| "Этот трек больше не находится в плейлисте.".to_string())?;
    services.playback.resolve(track).await
}

pub async fn prefetch(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
) -> Result<PlaybackSource, String> {
    if playlist_id == QUEUE_ID {
        return prepare(services, playlist_id, track_id).await;
    }
    if playlist_id.starts_with("spotify:") {
        return services.playback.prefetch(services.spotify.playback_track(track_id)?).await;
    }
    let playlist = services.library.get(playlist_id)?;
    let track = playlist
        .tracks
        .into_iter()
        .find(|track| track.id == track_id)
        .ok_or_else(|| "Этот трек больше не находится в плейлисте.".to_string())?;
    services.playback.prefetch(track).await
}

#[tauri::command]
pub async fn prefetch_track(
    services: State<'_, AppServices>,
    playlist_id: String,
    track_id: String,
) -> Result<PlaybackSource, String> {
    prefetch(&services, &playlist_id, &track_id).await
}

#[tauri::command]
pub async fn prepare_track(
    services: State<'_, AppServices>,
    playlist_id: String,
    track_id: String,
) -> Result<PlaybackSource, String> {
    prepare(&services, &playlist_id, &track_id).await
}

#[tauri::command]
pub async fn set_background_playback(
    services: State<'_, AppServices>,
    enabled: bool,
) -> Result<(), String> {
    services.playback.set_background_playback(enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn sync_media_state(
    services: State<'_, AppServices>,
    state: MediaStateInput,
) -> Result<(), String> {
    services.playback.sync_media_state(state).await;
    Ok(())
}
