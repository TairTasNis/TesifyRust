use crate::shared::{services::AppServices, spotify::models::*};
#[tauri::command]
pub async fn get_spotify_artist(
    services: tauri::State<'_, AppServices>,
    id: String,
) -> Result<ArtistDetail, String> {
    super::service::detail(&services.spotify, &id).await
}
#[tauri::command]
pub async fn get_spotify_artist_releases(
    services: tauri::State<'_, AppServices>,
    id: String,
    kind: String,
    offset: u64,
    limit: u64,
) -> Result<CatalogPage, String> {
    super::service::releases(&services.spotify, &id, &kind, offset, limit).await
}
