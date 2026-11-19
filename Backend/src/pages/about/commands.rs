use super::models::AppInfo;

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Tesify",
        version: env!("CARGO_PKG_VERSION"),
    }
}
