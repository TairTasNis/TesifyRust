use crate::shared::{
    playlists::models::{
        BulkMembershipEdit, CollectionEdit, CollectionKind, CoverUpload, LibraryIndex, Playlist,
        PlaylistDraft, PlaylistSummary, SavedCollection, TrackMembershipEdit, UploadedCover,
    },
    services::AppServices,
};
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
        edit.spotify_ids
            .iter()
            .filter_map(|id| {
                services
                    .spotify
                    .playback_track(id)
                    .ok()
                    .map(|track| (id.clone(), track))
            })
            .collect()
    };
    let library = services.library.clone();
    let (index, tracks) =
        tauri::async_runtime::spawn_blocking(move || library.edit_memberships(edit, sources))
            .await
            .map_err(|_| "Не удалось сохранить библиотеку. Повторите попытку.")??;
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
