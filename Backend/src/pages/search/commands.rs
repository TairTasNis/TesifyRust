use crate::shared::{playlists::models::Track, services::AppServices, spotify::{mapping::valid_id, models::SearchResults}};
use std::time::Duration;
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

pub async fn track_detail(services: &AppServices, id: &str) -> Result<Track, String> {
    if !valid_id(id) {
        return Err("Трек Spotify недоступен. Проверьте ссылку и повторите попытку.".into());
    }
    if let Some(saved) = services.playback.downloads.get(id).await {
        return Ok(saved.track);
    }
    if let Ok(track) = services.spotify.playback_track(id) {
        return Ok(track);
    }
    let imported = crate::pages::playlist::spotify::extract_spotify_track(
        &services.http, &format!("https://open.spotify.com/track/{id}"),
    ).await?;
    let track = imported.tracks.into_iter().next()
        .ok_or("Трек Spotify недоступен. Проверьте ссылку и повторите попытку.")?;
    services.spotify.remember_library_track(track.clone());
    Ok(track)
}

#[tauri::command]
pub async fn get_spotify_track(services: tauri::State<'_, AppServices>, id: String) -> Result<Track, String> {
    track_detail(&services, &id).await
}

fn allowed_short_link(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
        && matches!(url.host_str(), Some("spotify.link" | "spotify.app.link"))
}

pub async fn expand_link(link: &str) -> Result<String, String> {
    let unavailable = "Не удалось открыть ссылку Spotify.";
    let url = reqwest::Url::parse(link).map_err(|_| unavailable)?;
    if !allowed_short_link(&url) {
        return Err(unavailable.into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if url.scheme() == "https" && url.host_str() == Some("open.spotify.com") {
                attempt.stop()
            } else if attempt.previous().len() < 5 && allowed_short_link(url) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        })).build().map_err(|_| unavailable)?;
    let response = client.get(url).send().await.map_err(|_| unavailable)?;
    let location = response.headers().get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok()).ok_or(unavailable)?;
    let target = response.url().join(location).map_err(|_| unavailable)?;
    if target.scheme() != "https" || target.host_str() != Some("open.spotify.com") {
        return Err(unavailable.into());
    }
    Ok(target.into())
}

#[tauri::command]
pub async fn expand_spotify_link(link: String) -> Result<String, String> {
    expand_link(&link).await
}
