use crate::shared::{
    playlists::models::{
        BulkMembershipEdit, CollectionEdit, CollectionKind, CoverUpload, LibraryIndex, Playlist,
        PlaylistDraft, PlaylistSummary, SavedCollection, Track, TrackMembershipEdit, UploadedCover,
    },
    services::AppServices,
};
use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn list_playlists(services: State<'_, AppServices>) -> Result<Vec<PlaylistSummary>, String> {
    services.library.list()
}

#[tauri::command]
pub async fn get_library_index(services: State<'_, AppServices>) -> Result<LibraryIndex, String> {
    let library = services.library.clone();
    tauri::async_runtime::spawn_blocking(move || library.index())
        .await
        .map_err(|_| "Не удалось прочитать библиотеку.")?
}

pub async fn edit_memberships(
    services: &AppServices,
    edit: TrackMembershipEdit,
) -> Result<LibraryIndex, String> {
    edit_bulk_memberships(services, edit.into()).await
}

pub async fn edit_bulk_memberships(
    services: &AppServices,
    edit: BulkMembershipEdit,
) -> Result<LibraryIndex, String> {
    let sources = if edit.add.is_empty() {
        Default::default()
    } else {
        known_tracks(services, &edit.spotify_ids).await
    };
    let library = services.library.clone();
    let wave = services.wave.clone();
    let (index, tracks) = tauri::async_runtime::spawn_blocking(move || {
        let (index, tracks) = library.edit_memberships(edit, sources)?;
        for track in &tracks {
            if index.memberships.contains_key(&track.spotify_id) { wave.remember_saved_tags(track); }
        }
        Ok::<_, String>((index, tracks))
    }).await.map_err(|_| "Не удалось сохранить библиотеку. Повторите попытку.")??;
    for track in tracks {
        services.spotify.remember_library_track(track);
    }
    Ok(index)
}

#[tauri::command]
pub async fn set_bulk_track_memberships(
    services: State<'_, AppServices>,
    edit: BulkMembershipEdit,
) -> Result<LibraryIndex, String> {
    edit_bulk_memberships(&services, edit).await
}

#[tauri::command]
pub async fn set_track_memberships(
    services: State<'_, AppServices>,
    edit: TrackMembershipEdit,
) -> Result<LibraryIndex, String> {
    edit_memberships(&services, edit).await
}

pub async fn edit_collection(
    services: &AppServices,
    edit: CollectionEdit,
) -> Result<LibraryIndex, String> {
    let collection = if edit.saved {
        let detail = match edit.kind {
            CollectionKind::Album => {
                crate::pages::album::service::detail(&services.spotify, &edit.id, 0, 50).await?
            }
            CollectionKind::Playlist => {
                crate::pages::spotify_playlist::service::detail(&services.spotify, &edit.id, 0, 50)
                    .await?
            }
        };
        Some(SavedCollection {
            kind: edit.kind,
            id: detail.item.id,
            name: detail.item.name,
            cover_url: detail.item.image_url,
            owner: detail.owner,
        })
    } else {
        None
    };
    let library = services.library.clone();
    tauri::async_runtime::spawn_blocking(move || library.edit_collection(edit, collection))
        .await
        .map_err(|_| "Не удалось сохранить библиотеку. Повторите попытку.")?
}

#[tauri::command]
pub async fn set_saved_collection(
    services: State<'_, AppServices>,
    edit: CollectionEdit,
) -> Result<LibraryIndex, String> {
    edit_collection(&services, edit).await
}

#[tauri::command]
pub fn create_playlist(
    services: State<'_, AppServices>,
    draft: PlaylistDraft,
) -> Result<Playlist, String> {
    services.library.create(draft)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistWithTracks {
    draft: PlaylistDraft,
    spotify_ids: Vec<String>,
}

async fn known_tracks(services: &AppServices, ids: &[String]) -> HashMap<String, Track> {
    let mut tracks = HashMap::new();
    for id in ids {
        let track = match services.spotify.playback_track(id) {
            Ok(track) => Some(track),
            Err(_) => services.playback.downloads.get(id).await.map(|item| item.track),
        };
        if let Some(track) = track {
            tracks.insert(id.clone(), track);
        }
    }
    tracks
}

pub async fn create_with_tracks(services: &AppServices, input: PlaylistWithTracks) -> Result<LibraryIndex, String> {
    let sources = known_tracks(services, &input.spotify_ids).await;
    let services = services.clone();
    tokio::task::spawn_blocking(move || {
        let playlist = services.library.create_with_tracks(input.draft, &input.spotify_ids, sources)?;
        for track in playlist.tracks {
            services.wave.remember_saved_tags(&track);
            services.spotify.remember_library_track(track);
        }
        services.library.index()
    }).await.map_err(|_| "Не удалось сохранить библиотеку. Повторите попытку.")?
}

#[tauri::command]
pub async fn create_playlist_with_tracks(services: State<'_, AppServices>, input: PlaylistWithTracks) -> Result<LibraryIndex, String> {
    create_with_tracks(&services, input).await
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
