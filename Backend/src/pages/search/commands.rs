use crate::shared::{services::AppServices, spotify::models::SearchResults};
#[tauri::command]
pub async fn search_spotify(
    services: tauri::State<'_, AppServices>,
    query: String,
    category: String,
    offset: u64,
    limit: u64,
) -> Result<SearchResults, String> {
    super::service::search(&services.spotify, &query, &category, offset, limit).await
}
