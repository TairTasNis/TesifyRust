pub mod pages;
pub mod preview;
pub mod shared;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .setup(|app| {
            let services = shared::services::AppServices::new(shared::config::Config::load()?)?;
            app.manage(services);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pages::about::commands::get_app_info,
            pages::library::commands::list_playlists,
            pages::library::commands::create_playlist,
            pages::library::commands::delete_playlist,
            pages::library::commands::upload_playlist_cover,
            pages::lyrics::commands::get_track_lyrics,
            pages::playlist::commands::get_playlist,
            pages::playlist::commands::update_playlist,
            pages::playlist::commands::import_spotify_playlist,
            pages::search::commands::search_spotify,
            pages::artist::commands::get_spotify_artist,
            pages::artist::commands::get_spotify_artist_releases,
            pages::album::commands::get_spotify_album,
            pages::spotify_playlist::commands::get_spotify_playlist,
            shared::playback::commands::prepare_track,
            shared::playback::commands::prefetch_track
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Tesify");
}
