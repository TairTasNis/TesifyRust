use super::models::AppInfo;

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        name: "Tesify",
        version: app.package_info().version.to_string(),
    }
}
