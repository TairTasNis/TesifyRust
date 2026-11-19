use super::models::LyricsResponse;
use crate::shared::services::AppServices;
use tauri::State;

pub async fn get(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
    source: Option<&str>,
) -> Result<LyricsResponse, String> {
    let track = if playlist_id.starts_with("spotify:") {
        services.spotify.playback_track(track_id)?
    } else {
        services
            .library
            .get(playlist_id)?
            .tracks
            .into_iter()
            .find(|t| t.id == track_id)
            .ok_or_else(|| "Трек больше не находится в плейлисте.".to_string())?
    };
    Ok(services.lyrics.get_from(&track, source).await)
}

#[tauri::command]
pub async fn get_track_lyrics(
    services: State<'_, AppServices>,
    playlist_id: String,
    track_id: String,
    source: Option<String>,
) -> Result<LyricsResponse, String> {
    get(&services, &playlist_id, &track_id, source.as_deref()).await
}
