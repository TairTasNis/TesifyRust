use crate::shared::{
    playlists::models::{
        CollectionEdit, CollectionKind, CoverUpload, LibraryIndex, Playlist, PlaylistDraft,
        PlaylistSummary, SavedCollection, TrackMembershipEdit, UploadedCover,
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
    let catalog_track = services.spotify.playback_track(&edit.spotify_id).ok();
    let library = services.library.clone();
    let (index, source) =
        tauri::async_runtime::spawn_blocking(move || library.edit_memberships(edit, catalog_track))
            .await
            .map_err(|_| "Не удалось сохранить библиотеку. Повторите попытку.")??;
    if let Some(track) = source {
        services.spotify.remember_library_track(track);
    }
    Ok(index)
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
