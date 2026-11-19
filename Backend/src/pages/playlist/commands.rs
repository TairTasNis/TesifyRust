use crate::shared::{
    playlists::models::{ImportResult, Playlist, PlaylistDraft},
    services::AppServices,
};
use tauri::State;

#[tauri::command]
pub fn get_playlist(services: State<'_, AppServices>, id: String) -> Result<Playlist, String> {
    services.library.get(&id)
}

#[tauri::command]
pub fn update_playlist(
    services: State<'_, AppServices>,
    id: String,
    draft: PlaylistDraft,
) -> Result<Playlist, String> {
    services.library.update(&id, draft)
}

pub async fn import_spotify(
    services: &AppServices,
    id: &str,
    url: &str,
) -> Result<ImportResult, String> {
    services.library.get(id)?;
    let source = super::spotify::extract_spotify_playlist(&services.http, url).await?;
    if source.tracks.is_empty() {
        return Err("В этом плейлисте нет доступных для импорта музыкальных треков.".into());
    }
    services.library.append_import(
        id,
        source.tracks,
        source.name,
        source.cover_url,
        source.unavailable_count,
    )
}

#[tauri::command]
pub async fn import_spotify_playlist(
    services: State<'_, AppServices>,
    id: String,
    url: String,
) -> Result<ImportResult, String> {
    import_spotify(&services, &id, &url).await
}
