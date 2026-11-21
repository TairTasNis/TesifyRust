use std::{collections::HashMap, path::PathBuf};

pub struct Config {
    pub imgbb_api_key: Option<String>,
    pub lastfm_api_key: Option<String>,
    pub data_dir: PathBuf,
    pub yt_dlp_path: Option<PathBuf>,
    pub yt_dlp_js_runtime: Option<String>,
    pub lyrics: crate::pages::lyrics::service::LyricsSettings,
}

impl Config {
    pub fn load() -> Result<Self, String> {
        Self::load_with_data_dir(dirs::data_dir().map(|path| path.join("app.tesify.desktop")))
    }

    pub fn load_with_data_dir(default_data_dir: Option<PathBuf>) -> Result<Self, String> {
        let mut values = HashMap::new();
        let mut paths = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env")];
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                paths.push(parent.join(".env"));
            }
        }
        if let Some(data) = &default_data_dir {
            paths.push(data.join(".env"));
        }
        if let Some(path) = std::env::var_os("TESIFY_ENV_FILE") {
            paths.push(path.into());
        }
        for path in paths {
            if !path.is_file() {
                continue;
            }
            let entries = dotenvy::from_path_iter(&path)
                .map_err(|_| "Не удалось прочитать .env.".to_string())?;
            for entry in entries {
                let (key, value) = entry.map_err(|_| "Некорректный формат .env.".to_string())?;
                values.insert(key, value);
            }
        }
        let setting = |name: &str| {
            std::env::var(name)
                .ok()
                .or_else(|| values.get(name).cloned())
        };
        let data_dir = setting("TESIFY_DATA_DIR")
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .or(default_data_dir)
            .ok_or_else(|| "Не удалось найти папку данных приложения.".to_string())?;
        Ok(Self {
            imgbb_api_key: setting("IMGBB_API_KEY").filter(|key| !key.trim().is_empty()),
            lastfm_api_key: setting("LASTFM_API_KEY").filter(|key| !key.trim().is_empty()),
            data_dir,
            yt_dlp_path: setting("YT_DLP_PATH")
                .filter(|path| !path.trim().is_empty())
                .map(PathBuf::from),
            yt_dlp_js_runtime: setting("YT_DLP_JS_RUNTIME")
                .filter(|value| !value.trim().is_empty()),
            lyrics: crate::pages::lyrics::service::LyricsSettings::from_values(&setting),
        })
    }
}
