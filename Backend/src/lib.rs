pub mod pages;
pub mod preview;
pub mod shared;
use tauri::Manager;

#[cfg(not(target_os = "android"))]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

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
            #[cfg(not(target_os = "android"))]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                let open_item = MenuItemBuilder::with_id("open", "Открыть Tesify").build(app)?;
                let quit_item = MenuItemBuilder::with_id("quit", "Выход").build(app)?;
                let menu = MenuBuilder::new(app).items(&[&open_item, &quit_item]).build()?;
                let mut tray = TrayIconBuilder::with_id("tesify-tray")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .tooltip("Tesify");
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "android"))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if let Some(services) = window.app_handle().try_state::<shared::services::AppServices>() {
                        if services.playback.background_playback_enabled() && services.playback.is_playing() {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                }
            }
            #[cfg(target_os = "android")]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            pages::about::commands::get_app_info,
            pages::downloads::commands::list_downloads,
            pages::downloads::commands::get_download_progress,
            pages::downloads::commands::download_tracks,
            pages::library::commands::list_playlists,
            pages::library::commands::get_library_index,
            pages::library::commands::set_track_memberships,
            pages::library::commands::set_bulk_track_memberships,
            pages::library::commands::set_saved_collection,
            pages::settings::commands::get_storage_usage,
            pages::settings::commands::clear_song_previews,
            pages::library::commands::create_playlist,
            pages::library::commands::create_playlist_with_tracks,
            pages::library::commands::delete_playlist,
            pages::library::commands::upload_playlist_cover,
            pages::lyrics::commands::get_track_lyrics,
            pages::lyrics::commands::search_lyrics_candidates,
            pages::lyrics::commands::apply_lyrics_candidate,
            pages::lyrics::commands::apply_spotify_lyrics,
            pages::lyrics::commands::clear_track_lyrics_override,
            pages::lyrics::commands::list_lyrics_fonts,
            pages::lyrics::commands::upload_lyrics_font,
            pages::lyrics::commands::delete_lyrics_font,
            pages::playlist::commands::get_playlist,
            pages::playlist::commands::update_playlist,
            pages::playlist::commands::import_spotify_playlist,
            pages::playlist::commands::create_playlist_with_spotify,
            pages::playlist::commands::sync_spotify_playlists,
            pages::search::commands::search_spotify,
            pages::search::commands::get_spotify_track,
            pages::search::commands::expand_spotify_link,
            pages::artist::commands::get_spotify_artist,
            pages::artist::commands::get_spotify_artist_releases,
            pages::album::commands::get_spotify_album,
            pages::spotify_playlist::commands::get_spotify_playlist,
            shared::playback::commands::prepare_track,
            shared::playback::commands::prefetch_track,
            shared::playback::commands::set_background_playback,
            shared::playback::commands::sync_media_state,
            shared::wave::commands::get_wave_profile,
            shared::wave::commands::set_wave_api_key,
            shared::wave::commands::get_wave_tracks,
            shared::wave::commands::save_wave_feedback,
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Tesify");
}
