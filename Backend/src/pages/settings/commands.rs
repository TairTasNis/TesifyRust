use crate::shared::services::AppServices;
use serde::Serialize;
use std::{fs, io, path::Path};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeUsage {
    used_bytes: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    app_bytes: u64,
    preview_bytes: u64,
    download_bytes: u64,
    download_directory: String,
    volume: Option<VolumeUsage>,
}

pub async fn storage_usage(services: &AppServices, clear: bool) -> Result<StorageUsage, String> {
    let services = services.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if clear {
            services
                .playback
                .clear_intro_storage()
                .map_err(|_| "Не удалось удалить превью песен.")?;
        }
        let app_bytes = directory_size(&services.data_dir)
            .map_err(|_| "Не удалось получить данные о памяти.")?;
        let preview_bytes = services
            .playback
            .intro_storage_bytes()
            .map_err(|_| "Не удалось получить данные о памяти.")?;
        let downloads = &services.playback.downloads;
        Ok(StorageUsage {
            app_bytes,
            preview_bytes,
            download_bytes: downloads.audio_bytes().map_err(|_| "Не удалось получить данные о памяти.")?,
            download_directory: downloads.directory().to_string_lossy().into_owned(),
            volume: volume_usage(&services.data_dir),
        })
    })
    .await
    .map_err(|_| "Не удалось получить данные о памяти.")?
}

#[tauri::command]
pub async fn get_storage_usage(services: State<'_, AppServices>) -> Result<StorageUsage, String> {
    storage_usage(&services, false).await
}

#[tauri::command]
pub async fn clear_song_previews(services: State<'_, AppServices>) -> Result<StorageUsage, String> {
    storage_usage(&services, true).await
}

fn directory_size(root: &Path) -> io::Result<u64> {
    let mut bytes = 0_u64;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if metadata.is_dir() {
            bytes = bytes.saturating_add(directory_size(&entry.path())?);
        } else if metadata.is_file() {
            bytes = bytes.saturating_add(metadata.len());
        }
    }
    Ok(bytes)
}

#[cfg(windows)]
fn volume_usage(path: &Path) -> Option<VolumeUsage> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let path: Vec<_> = path
        .canonicalize()
        .ok()?
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect();
    let (mut total, mut free) = (0, 0);
    // The API reads a terminated UTF-16 path and writes into the two live outputs.
    let success =
        unsafe { GetDiskFreeSpaceExW(path.as_ptr(), std::ptr::null_mut(), &mut total, &mut free) };
    (success != 0).then(|| VolumeUsage {
        total_bytes: total,
        used_bytes: total.saturating_sub(free),
    })
}

#[cfg(unix)]
fn volume_usage(path: &Path) -> Option<VolumeUsage> {
    use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};

    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stats = MaybeUninit::<libc::statvfs>::uninit();
    // statvfs initializes the output on success.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return None;
    }
    let stats = unsafe { stats.assume_init() };
    let block_size = stats.f_frsize as u64;
    let total_blocks = stats.f_blocks as u64;
    let free_blocks = stats.f_bfree as u64;
    Some(VolumeUsage {
        total_bytes: total_blocks.saturating_mul(block_size),
        used_bytes: total_blocks
            .saturating_sub(free_blocks)
            .saturating_mul(block_size),
    })
}

#[cfg(not(any(windows, unix)))]
fn volume_usage(_: &Path) -> Option<VolumeUsage> {
    None
}
