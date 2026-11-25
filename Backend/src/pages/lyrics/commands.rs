use super::{
    fonts::{CustomLyricsFont, UploadLyricsFontInput},
    models::{LyricsCandidate, LyricsResponse},
};
use crate::shared::{playlists::models::Track, services::AppServices};
use tauri::State;

fn resolve_track(services: &AppServices, playlist_id: &str, track_id: &str) -> Result<Track, String> {
    if playlist_id.starts_with("spotify:") {
        services.spotify.playback_track(track_id)
    } else {
        services
            .library
            .get(playlist_id)?
            .tracks
            .into_iter()
            .find(|t| t.id == track_id)
            .ok_or_else(|| "Трек больше не находится в плейлисте.".to_string())
    }
}

pub async fn get(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
    source: Option<&str>,
) -> Result<LyricsResponse, String> {
    let track = resolve_track(services, playlist_id, track_id)?;
    Ok(services.lyrics.get_from(&track, source).await)
}

pub async fn search_candidates(services: &AppServices, query: &str) -> Result<Vec<LyricsCandidate>, String> {
    Ok(services.lyrics.search_candidates(query).await)
}

pub async fn apply_candidate(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
    candidate_id: &str,
) -> Result<LyricsResponse, String> {
    let track = resolve_track(services, playlist_id, track_id)?;
    services.lyrics.apply_candidate(&track, candidate_id).await
}

pub async fn apply_spotify_track(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
    spotify_track_id: &str,
) -> Result<LyricsResponse, String> {
    let target = resolve_track(services, playlist_id, track_id)?;
    let source = services.spotify.playback_track(spotify_track_id)?;
    services.lyrics.apply_from_other_track(&target, &source).await
}

pub async fn clear_override(
    services: &AppServices,
    playlist_id: &str,
    track_id: &str,
) -> Result<LyricsResponse, String> {
    let track = resolve_track(services, playlist_id, track_id)?;
    services.lyrics.clear_override(&track).await;
    Ok(services.lyrics.get_from(&track, None).await)
}

pub async fn list_fonts(services: &AppServices) -> Result<Vec<CustomLyricsFont>, String> {
    let services = services.clone();
    tauri::async_runtime::spawn_blocking(move || services.lyrics.fonts.list())
        .await
        .map_err(|_| "Не удалось загрузить пользовательские шрифты.".to_string())?
}

pub async fn upload_font(
    services: &AppServices,
    input: UploadLyricsFontInput,
) -> Result<CustomLyricsFont, String> {
    let services = services.clone();
    tauri::async_runtime::spawn_blocking(move || services.lyrics.fonts.upload(input))
        .await
        .map_err(|_| "Не удалось сохранить шрифт.".to_string())?
}

pub async fn delete_font(services: &AppServices, id: String) -> Result<(), String> {
    let services = services.clone();
    tauri::async_runtime::spawn_blocking(move || services.lyrics.fonts.delete(&id))
        .await
        .map_err(|_| "Не удалось удалить шрифт.".to_string())?
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

#[tauri::command]
pub async fn search_lyrics_candidates(
    services: State<'_, AppServices>,
    query: String,
) -> Result<Vec<LyricsCandidate>, String> {
    search_candidates(&services, &query).await
}

#[tauri::command]
pub async fn apply_lyrics_candidate(
    services: State<'_, AppServices>,
    playlist_id: String,
    track_id: String,
    candidate_id: String,
) -> Result<LyricsResponse, String> {
    apply_candidate(&services, &playlist_id, &track_id, &candidate_id).await
}

#[tauri::command]
pub async fn apply_spotify_lyrics(
    services: State<'_, AppServices>,
    playlist_id: String,
    track_id: String,
    spotify_track_id: String,
) -> Result<LyricsResponse, String> {
    apply_spotify_track(&services, &playlist_id, &track_id, &spotify_track_id).await
}

#[tauri::command]
pub async fn clear_track_lyrics_override(
    services: State<'_, AppServices>,
    playlist_id: String,
    track_id: String,
) -> Result<LyricsResponse, String> {
    clear_override(&services, &playlist_id, &track_id).await
}

#[tauri::command]
pub async fn list_lyrics_fonts(
    services: State<'_, AppServices>,
) -> Result<Vec<CustomLyricsFont>, String> {
    list_fonts(&services).await
}

#[tauri::command]
pub async fn upload_lyrics_font(
    services: State<'_, AppServices>,
    file_name: String,
    font_base64: String,
) -> Result<CustomLyricsFont, String> {
    upload_font(
        &services,
        UploadLyricsFontInput {
            file_name,
            font_base64,
        },
    )
    .await
}

#[tauri::command]
pub async fn delete_lyrics_font(
    services: State<'_, AppServices>,
    id: String,
) -> Result<(), String> {
    delete_font(&services, id).await
}
