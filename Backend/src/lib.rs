pub mod pages;
pub mod preview;
pub mod shared;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(shared::playback::android::init());
    builder
        .setup(|app| {
            #[cfg(target_os = "android")]
            let config = shared::config::Config::load_with_data_dir(Some(app.path().app_data_dir()?))?;
            #[cfg(not(target_os = "android"))]
            let config = shared::config::Config::load()?;
            let services = shared::services::AppServices::new(
                config,
                #[cfg(target_os = "android")]
                app.state::<shared::playback::android::AndroidTools>().inner().clone(),
            )?;
            app.manage(services);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pages::about::commands::get_app_info,
            pages::library::commands::list_playlists,
            pages::library::commands::get_library_index,
            pages::library::commands::set_track_memberships,
            pages::library::commands::set_bulk_track_memberships,
            pages::library::commands::set_saved_collection,
            pages::settings::commands::get_storage_usage,
            pages::settings::commands::clear_song_previews,
            pages::library::commands::create_playlist,
            pages::library::commands::delete_playlist,
            pages::library::commands::upload_playlist_cover,
            pages::lyrics::commands::get_track_lyrics,
            pages::playlist::commands::get_playlist,
            pages::playlist::commands::update_playlist,
            pages::playlist::commands::import_spotify_playlist,
            pages::playlist::commands::create_playlist_with_spotify,
            pages::playlist::commands::sync_spotify_playlists,
            pages::search::commands::search_spotify,
            pages::artist::commands::get_spotify_artist,
            pages::artist::commands::get_spotify_artist_releases,
            pages::album::commands::get_spotify_album,
            pages::spotify_playlist::commands::get_spotify_playlist,
            shared::playback::commands::prepare_track,
            shared::playback::commands::prefetch_track,
            shared::wave::commands::get_wave_profile,
            shared::wave::commands::set_wave_api_key,
            shared::wave::commands::get_wave_tracks,
            shared::wave::commands::save_wave_feedback,
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Tesify");
}
