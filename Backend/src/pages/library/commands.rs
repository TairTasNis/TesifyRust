use crate::shared::{
    playlists::models::{CoverUpload, Playlist, PlaylistDraft, PlaylistSummary, UploadedCover},
    services::AppServices,
};
use tauri::State;

#[tauri::command]
pub fn list_playlists(services: State<'_, AppServices>) -> Result<Vec<PlaylistSummary>, String> {
    services.library.list()
}

#[tauri::command]
pub fn create_playlist(
    services: State<'_, AppServices>,
    draft: PlaylistDraft,
) -> Result<Playlist, String> {
    services.library.create(draft)
}

#[tauri::command]
pub fn delete_playlist(services: State<'_, AppServices>, id: String) -> Result<(), String> {
    services.library.delete(&id)
}

#[tauri::command]
pub async fn upload_playlist_cover(
    services: State<'_, AppServices>,
    input: CoverUpload,
) -> Result<UploadedCover, String> {
    super::covers::upload_cover(&services, input).await
}
