use serde::Deserialize;
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
