use crate::shared::{services::AppServices, spotify::models::CollectionDetail};
#[tauri::command]
pub async fn get_spotify_playlist(
    services: tauri::State<'_, AppServices>,
    id: String,
    offset: u64,
    limit: u64,
) -> Result<CollectionDetail, String> {
    super::service::detail(&services.spotify, &id, offset, limit).await
}
