use super::models::{ImportResult, Playlist, PlaylistDraft, PlaylistSummary, Track};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryData {
    schema_version: u32,
    playlists: Vec<Playlist>,
}

pub struct LibraryStore {
    directory: PathBuf,
}

impl LibraryStore {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory)
            .map_err(|_| "Не удалось создать папку библиотеки.".to_string())?;
        Ok(Self { directory })
    }

    fn lock(&self) -> Result<File, String> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.directory.join("library.lock"))
            .map_err(|_| "Не удалось открыть библиотеку.".to_string())?;
        file.lock()
            .map_err(|_| "Библиотека занята. Попробуйте ещё раз.".to_string())?;
        Ok(file)
    }

    fn read(&self) -> Result<LibraryData, String> {
        let path = self.directory.join("library.json");
        if !path.exists() {
            return Ok(LibraryData {
                schema_version: 1,
                playlists: Vec::new(),
            });
        }
        let data: LibraryData = serde_json::from_reader(
            File::open(path).map_err(|_| "Не удалось прочитать библиотеку.".to_string())?,
        )
        .map_err(|_| {
            "Файл библиотеки повреждён. Исходный файл сохранён без изменений.".to_string()
        })?;
        if data.schema_version != 1 {
            return Err("Эта версия библиотеки не поддерживается.".into());
        }
        Ok(data)
    }

    fn save(&self, data: &LibraryData) -> Result<(), String> {
        let temporary = self
            .directory
            .join(format!("library-{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let mut file = File::create(&temporary)?;
            serde_json::to_writer(&mut file, data)?;
            file.flush()?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, self.directory.join("library.json"))
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result.map_err(|_: std::io::Error| {
            "Не удалось сохранить библиотеку. Повторите попытку.".to_string()
        })
    }

    pub fn list(&self) -> Result<Vec<PlaylistSummary>, String> {
        let _lock = self.lock()?;
        let data = self.read()?;
        let mut playlists: Vec<_> = data.playlists.iter().map(PlaylistSummary::from).collect();
        playlists.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(playlists)
    }

    pub fn get(&self, id: &str) -> Result<Playlist, String> {
        let _lock = self.lock()?;
        self.read()?
            .playlists
            .into_iter()
            .find(|playlist| playlist.id == id)
            .ok_or_else(|| "Плейлист не найден.".into())
    }

    pub fn create(&self, draft: PlaylistDraft) -> Result<Playlist, String> {
        let draft = validate_draft(draft)?;
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let now = Utc::now().timestamp_millis();
        let playlist = Playlist {
            id: Uuid::new_v4().to_string(),
            name: draft.name,
            description: draft.description,
            cover_url: draft.cover_url,
            created_at: now,
            updated_at: now,
            tracks: Vec::new(),
        };
        data.playlists.push(playlist.clone());
        self.save(&data)?;
        Ok(playlist)
    }

    pub fn update(&self, id: &str, draft: PlaylistDraft) -> Result<Playlist, String> {
        let draft = validate_draft(draft)?;
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let playlist = data
            .playlists
            .iter_mut()
            .find(|playlist| playlist.id == id)
            .ok_or("Плейлист не найден.")?;
        playlist.name = draft.name;
        playlist.description = draft.description;
        playlist.cover_url = draft.cover_url;
        playlist.updated_at = Utc::now().timestamp_millis();
        let result = playlist.clone();
        self.save(&data)?;
        Ok(result)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let before = data.playlists.len();
        data.playlists.retain(|playlist| playlist.id != id);
        if before == data.playlists.len() {
            return Err("Плейлист не найден.".into());
        }
        self.save(&data)
    }

    pub fn append_import(
        &self,
        id: &str,
        tracks: Vec<Track>,
        source_name: String,
        source_cover: Option<String>,
        unavailable_count: usize,
    ) -> Result<ImportResult, String> {
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let playlist = data
            .playlists
            .iter_mut()
            .find(|playlist| playlist.id == id)
            .ok_or("Плейлист не найден.")?;
        let mut ids: HashSet<_> = playlist
            .tracks
            .iter()
            .map(|track| track.spotify_id.clone())
            .collect();
        let mut duplicate_count = 0;
        let mut added_count = 0;
        for track in tracks {
            if ids.insert(track.spotify_id.clone()) {
                playlist.tracks.push(track);
                added_count += 1;
            } else {
                duplicate_count += 1;
            }
        }
        if playlist.cover_url.is_none() {
            playlist.cover_url = source_cover;
        }
        playlist.updated_at = Utc::now().timestamp_millis();
        let playlist = playlist.clone();
        self.save(&data)?;
        Ok(ImportResult {
            playlist,
            added_count,
            duplicate_count,
            unavailable_count,
            source_name,
        })
    }
}

fn validate_draft(mut draft: PlaylistDraft) -> Result<PlaylistDraft, String> {
    draft.name = draft.name.trim().to_string();
    draft.description = draft.description.trim().to_string();
    if draft.name.is_empty() {
        return Err("Введите название плейлиста.".into());
    }
    if draft.name.chars().count() > 500 {
        return Err("Название должно быть не длиннее 500 символов.".into());
    }
    if draft.description.chars().count() > 5000 {
        return Err("Описание должно быть не длиннее 5000 символов.".into());
    }
    if let Some(url) = &draft.cover_url {
        let parsed =
            reqwest::Url::parse(url).map_err(|_| "Некорректная ссылка на обложку.".to_string())?;
        if parsed.scheme() != "https" {
            return Err("Ссылка на обложку должна использовать HTTPS.".into());
        }
    }
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("tesify-library-test-{}", Uuid::new_v4())))
        }
        fn store(&self) -> LibraryStore {
            LibraryStore::new(self.0.clone()).unwrap()
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn draft(name: &str) -> PlaylistDraft {
        PlaylistDraft {
            name: name.into(),
            description: "Описание".into(),
            cover_url: None,
        }
    }
    fn track(id: &str) -> Track {
        Track {
            id: Uuid::new_v4().to_string(),
            spotify_id: id.into(),
            title: "Song".into(),
            artist: "Artist".into(),
            artists: vec![],
            cover_url: None,
            duration_ms: Some(200000),
            added_at: 1,
            source_added_at: Some(2),
            source_url: format!("https://open.spotify.com/track/{id}"),
        }
    }

    #[test]
    fn playlists_survive_reopening_and_editing() {
        let directory = TestDirectory::new();
        let store = directory.store();
        let created = store.create(draft("  Музыка в дорогу  ")).unwrap();
        assert_eq!(created.name, "Музыка в дорогу");
        let reopened = directory.store();
        assert_eq!(reopened.get(&created.id).unwrap().description, "Описание");
        reopened
            .update(&created.id, draft("Новое название"))
            .unwrap();
        assert_eq!(store.get(&created.id).unwrap().name, "Новое название");
        reopened.delete(&created.id).unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn import_deduplicates_and_preserves_custom_metadata() {
        let directory = TestDirectory::new();
        let store = directory.store();
        let created = store
            .create(PlaylistDraft {
                cover_url: Some("https://i.ibb.co/custom.png".into()),
                ..draft("Мой плейлист")
            })
            .unwrap();
        let result = store
            .append_import(
                &created.id,
                vec![track("one"), track("two"), track("one")],
                "Spotify name".into(),
                Some("https://i.scdn.co/source".into()),
                1,
            )
            .unwrap();
        assert_eq!(
            (
                result.added_count,
                result.duplicate_count,
                result.unavailable_count
            ),
            (2, 1, 1)
        );
        assert_eq!(result.playlist.name, "Мой плейлист");
        assert_eq!(
            result.playlist.cover_url.as_deref(),
            Some("https://i.ibb.co/custom.png")
        );
        let repeated = store
            .append_import(
                &created.id,
                vec![track("two")],
                "Spotify name".into(),
                None,
                0,
            )
            .unwrap();
        assert_eq!((repeated.added_count, repeated.duplicate_count), (0, 1));
        assert_eq!(repeated.playlist.tracks.len(), 2);
        assert_eq!(repeated.playlist.tracks[0].source_added_at, Some(2));
    }

    #[test]
    fn concurrent_store_instances_do_not_lose_updates() {
        let directory = TestDirectory::new();
        let path = directory.0.clone();
        std::thread::scope(|scope| {
            for number in 0..6 {
                let path = path.clone();
                scope.spawn(move || {
                    LibraryStore::new(path)
                        .unwrap()
                        .create(draft(&format!("Playlist {number}")))
                        .unwrap();
                });
            }
        });
        assert_eq!(directory.store().list().unwrap().len(), 6);
    }

    #[test]
    fn corrupt_storage_is_not_overwritten() {
        let directory = TestDirectory::new();
        let store = directory.store();
        fs::write(directory.0.join("library.json"), b"broken input").unwrap();
        assert!(store.create(draft("New")).is_err());
        assert_eq!(
            fs::read(directory.0.join("library.json")).unwrap(),
            b"broken input"
        );
    }

    #[test]
    fn rejects_empty_names_and_unsafe_cover_urls() {
        let directory = TestDirectory::new();
        let store = directory.store();
        assert!(store.create(draft(" ")).is_err());
        assert!(
            store
                .create(PlaylistDraft {
                    cover_url: Some("javascript:alert(1)".into()),
                    ..draft("Name")
                })
                .is_err()
        );
        assert!(store.list().unwrap().is_empty());
    }
}
