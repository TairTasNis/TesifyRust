use super::PlaybackSource;
use crate::shared::services::AppServices;
use tauri::State;

pub async fn prepare(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
) -> Result<PlaybackSource, String> {
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
