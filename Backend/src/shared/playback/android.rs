use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
use tauri::{
    DynRuntime, Manager,
    plugin::{Builder, PluginHandle, TauriPlugin},
};
use tokio::sync::OnceCell;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AndroidRuntime {
    pub python: PathBuf,
    pub yt_dlp: PathBuf,
    pub quick_js: PathBuf,
    pub python_home: PathBuf,
    pub cache_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundPlaybackArgs {
    enabled: bool,
}

#[derive(Clone)]
pub struct AndroidTools {
    plugin: PluginHandle<DynRuntime>,
    runtime: Arc<OnceCell<AndroidRuntime>>,
}

impl AndroidTools {
    pub(super) async fn runtime(&self) -> Result<&AndroidRuntime, String> {
        self.runtime.get_or_try_init(|| async {
            self.plugin.run_mobile_plugin_async("prepare", ()).await.map_err(|error| {
                eprintln!("Android playback runtime: {error}");
                "Не удалось запустить модуль воспроизведения на Android.".into()
            })
        }).await
    }

    pub(super) async fn set_background_playback(&self, enabled: bool) {
        if let Err(error) = self
            .plugin
            .run_mobile_plugin_async::<serde_json::Value>(
                "setBackgroundPlayback",
                BackgroundPlaybackArgs { enabled },
            )
            .await
        {
            eprintln!("Android background playback: {error}");
        }
    }

    pub(super) async fn update_media_state(&self, state: &super::MediaStateInput) {
        if let Err(error) = self
            .plugin
            .run_mobile_plugin_async::<serde_json::Value>("updateMediaState", state)
            .await
        {
            eprintln!("Android media state: {error}");
        }
    }
}

pub(crate) fn init() -> TauriPlugin<DynRuntime> {
    Builder::new("playback-tools")
        .setup(|app, api| {
            let plugin = api.register_android_plugin("app.tesify.desktop", "PlaybackTools")?;
            app.manage(AndroidTools { plugin, runtime: Arc::new(OnceCell::new()) });
            Ok(())
        })
        .build()
}
