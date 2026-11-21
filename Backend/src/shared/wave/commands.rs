use super::{Feedback, Options, Profile, WaveService};
use crate::shared::{playlists::models::Track, services::AppServices};
use tauri::State;

#[tauri::command]
pub async fn get_wave_profile(services: State<'_, AppServices>) -> Result<Profile, String> {
    WaveService::profile(&services).await
}

#[tauri::command]
pub async fn set_wave_api_key(services: State<'_, AppServices>, key: String) -> Result<(), String> {
    services.wave.set_api_key(key).await
}

#[tauri::command]
pub async fn get_wave_tracks(
    services: State<'_, AppServices>,
    recent: Vec<String>,
    options: Option<Options>,
) -> Result<Vec<Track>, String> {
    WaveService::recommend(&services, recent, options.unwrap_or_default()).await
}

#[tauri::command]
pub async fn save_wave_feedback(
    services: State<'_, AppServices>,
    track_id: String,
    feedback: Feedback,
) -> Result<(), String> {
    WaveService::feedback(&services, &track_id, feedback).await
}
