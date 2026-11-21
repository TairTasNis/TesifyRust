use crate::shared::{
    playlists::models::{ImportResult, Playlist, PlaylistDraft},
    services::AppServices,
};
use tauri::State;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpotifyImport {
    draft: PlaylistDraft,
    url: String,
    #[serde(default)]
    auto_sync: bool,
    kind: SpotifyImportKind,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum SpotifyImportKind {
    Playlist,
    Track,
}

pub async fn create_with_spotify(
    services: &AppServices,
    input: CreateSpotifyImport,
) -> Result<Playlist, String> {
    let (source, auto_sync) = match input.kind {
        SpotifyImportKind::Track => (
            super::spotify::extract_spotify_track(&services.http, &input.url).await?,
            false,
        ),
        SpotifyImportKind::Playlist => (
            super::spotify::extract_spotify_playlist(&services.http, &input.url).await?,
            input.auto_sync,
        ),
    };
    if source.tracks.is_empty() && !auto_sync {
        return Err("В этом плейлисте нет доступных для импорта музыкальных треков.".into());
    }
    services
        .library
        .create_with_import(input.draft, Some((source, auto_sync)))
}

#[tauri::command]
pub async fn create_playlist_with_spotify(
    services: State<'_, AppServices>,
    input: CreateSpotifyImport,
) -> Result<Playlist, String> {
    create_with_spotify(&services, input).await
}

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
    auto_sync: bool,
) -> Result<ImportResult, String> {
    let playlist = services.library.get(id)?;
    let source = super::spotify::extract_spotify_playlist(&services.http, url).await?;
    if source.tracks.is_empty()
        && !auto_sync
        && !playlist.spotify_sync.sources.contains_key(&source.id)
    {
        return Err("В этом плейлисте нет доступных для импорта музыкальных треков.".into());
    }
    services.library.append_import(id, source, auto_sync)
}

#[tauri::command]
pub async fn import_spotify_playlist(
    services: State<'_, AppServices>,
    id: String,
    url: String,
    auto_sync: Option<bool>,
) -> Result<ImportResult, String> {
    import_spotify(&services, &id, &url, auto_sync.unwrap_or(false)).await
}

pub async fn sync_linked_playlists(services: &AppServices) -> Result<bool, String> {
    let mut changed = false;
    for (id, destinations) in services.library.spotify_sync_sources()? {
        let url = format!("https://open.spotify.com/playlist/{id}");
        if let Ok(source) = super::spotify::extract_spotify_playlist(&services.http, &url).await {
            match services.library.sync_spotify_source(&source, &destinations) {
                Ok(updated) => changed |= updated,
                Err(error) => eprintln!("Spotify playlist sync: {error}"),
            }
        }
    }
    Ok(changed)
}

#[tauri::command]
pub async fn sync_spotify_playlists(services: State<'_, AppServices>) -> Result<bool, String> {
    sync_linked_playlists(&services).await
}
