use super::models::{
    BulkMembershipEdit, CollectionEdit, ImportResult, LibraryIndex, Playlist, PlaylistDraft,
    PlaylistSummary, SavedCollection, SpotifyImport, Track,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{BufReader, BufWriter, Write},
    path::PathBuf,
};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryData {
    schema_version: u32,
    playlists: Vec<Playlist>,
    #[serde(default)]
    collections: Vec<SavedCollection>,
}

impl LibraryData {
    fn summaries(&self) -> Vec<PlaylistSummary> {
        let mut playlists: Vec<_> = self.playlists.iter().map(PlaylistSummary::from).collect();
        playlists.sort_by_key(|playlist| std::cmp::Reverse(playlist.updated_at));
        playlists
    }

    fn into_index(self) -> LibraryIndex {
        let playlists = self.summaries();
        let mut memberships: HashMap<String, Vec<String>> = HashMap::new();
        for playlist in self.playlists {
            for track in playlist.tracks {
                let owners = memberships.entry(track.spotify_id).or_default();
                if owners.last() != Some(&playlist.id) {
                    owners.push(playlist.id.clone());
                }
            }
        }
        LibraryIndex {
            playlists,
            collections: self.collections,
            memberships,
        }
    }
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
        lock_file(&file).map_err(|_| "Библиотека занята. Попробуйте ещё раз.".to_string())?;
        Ok(file)
    }

    fn read(&self) -> Result<LibraryData, String> {
        let path = self.directory.join("library.json");
        if !path.exists() {
            return Ok(LibraryData {
                schema_version: 1,
                playlists: Vec::new(),
                collections: Vec::new(),
            });
        }
        let data: LibraryData = serde_json::from_reader(BufReader::new(
            File::open(path).map_err(|_| "Не удалось прочитать библиотеку.".to_string())?,
        ))
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
            let mut writer = BufWriter::new(File::create(&temporary)?);
            serde_json::to_writer(&mut writer, data)?;
            writer.flush()?;
            writer.get_ref().sync_all()?;
            drop(writer);
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
        Ok(self.read()?.summaries())
    }

    pub fn index(&self) -> Result<LibraryIndex, String> {
        let _lock = self.lock()?;
        Ok(self.read()?.into_index())
    }

    pub fn wave_library(&self) -> Result<(Vec<Track>, Vec<String>), String> {
        let _lock = self.lock()?;
        let data = self.read()?;
        let linked: HashSet<_> = data.playlists.iter()
            .flat_map(|playlist| playlist.spotify_sync.sources.keys()).collect();
        let saved = data.collections.into_iter()
            .filter(|item| item.kind == super::models::CollectionKind::Playlist && !linked.contains(&item.id))
            .map(|item| item.id).collect();
        let tracks = data.playlists.into_iter().flat_map(|playlist| playlist.tracks).collect();
        Ok((tracks, saved))
    }

    pub fn edit_memberships(
        &self,
        edit: BulkMembershipEdit,
        mut sources: HashMap<String, Track>,
    ) -> Result<(LibraryIndex, Vec<Track>), String> {
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let add: HashSet<_> = edit.add.into_iter().collect();
        let remove: HashSet<_> = edit.remove.into_iter().collect();
        if add
            .iter()
            .any(|id| !data.playlists.iter().any(|playlist| &playlist.id == id))
        {
            return Err("Плейлист не найден.".into());
        }
        let requested: HashSet<_> = edit.spotify_ids.iter().collect();
        for track in data.playlists.iter().flat_map(|playlist| &playlist.tracks) {
            if requested.contains(&track.spotify_id) {
                sources.insert(track.spotify_id.clone(), track.clone());
            }
        }
        let now = Utc::now().timestamp_millis();
        let mut changed = false;
        for playlist in &mut data.playlists {
            let before = playlist.tracks.len();
            if add.contains(&playlist.id) {
                let mut existing: HashSet<_> = playlist
                    .tracks
                    .iter()
                    .map(|track| track.spotify_id.clone())
                    .collect();
                for id in &edit.spotify_ids {
                    if !existing.insert(id.clone()) {
                        continue;
                    }
                    let mut track = sources
                        .get(id)
                        .cloned()
                        .ok_or("Обновите страницу каталога и попробуйте снова.")?;
                    track.id = Uuid::new_v4().to_string();
                    track.added_at = now;
                    track.source_added_at = None;
                    playlist
                        .spotify_sync
                        .managed_tracks
                        .remove(&track.spotify_id);
                    playlist.tracks.push(track);
                }
            } else if remove.contains(&playlist.id) {
                playlist
                    .tracks
                    .retain(|track| !requested.contains(&track.spotify_id));
            }
            if playlist.tracks.len() != before {
                playlist.updated_at = now;
                changed = true;
            }
        }
        if changed {
            self.save(&data)?;
        }
        Ok((data.into_index(), sources.into_values().collect()))
    }

    pub fn edit_collection(
        &self,
        edit: CollectionEdit,
        collection: Option<SavedCollection>,
    ) -> Result<LibraryIndex, String> {
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let existing = data
            .collections
            .iter()
            .position(|item| item.kind == edit.kind && item.id == edit.id);
        match (edit.saved, existing) {
            (true, None) => data
                .collections
                .insert(0, collection.ok_or("Подборка недоступна.")?),
            (false, Some(index)) => {
                data.collections.remove(index);
            }
            _ => return Ok(data.into_index()),
        }
        self.save(&data)?;
        Ok(data.into_index())
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
        self.create_with_import(draft, None)
    }

    pub fn create_with_import(
        &self,
        draft: PlaylistDraft,
        source: Option<(SpotifyImport, bool)>,
    ) -> Result<Playlist, String> {
        let draft = validate_draft(draft)?;
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let now = Utc::now().timestamp_millis();
        let mut playlist = Playlist {
            id: Uuid::new_v4().to_string(),
            name: draft.name,
            description: draft.description,
            cover_url: draft.cover_url,
            created_at: now,
            updated_at: now,
            tracks: Vec::new(),
            spotify_sync: Default::default(),
        };
        if let Some((source, auto_sync)) = source {
            apply_import(&mut playlist, source, auto_sync);
        }
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
        source: SpotifyImport,
        auto_sync: bool,
    ) -> Result<ImportResult, String> {
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let playlist = data
            .playlists
            .iter_mut()
            .find(|playlist| playlist.id == id)
            .ok_or("Плейлист не найден.")?;
        let result = apply_import(playlist, source, auto_sync);
        self.save(&data)?;
        Ok(result)
    }

    pub fn spotify_sync_sources(
        &self,
    ) -> Result<BTreeMap<String, Vec<(String, Vec<String>)>>, String> {
        let _lock = self.lock()?;
        let mut sources = BTreeMap::<_, Vec<_>>::new();
        for playlist in self.read()?.playlists {
            for (source, tracks) in playlist.spotify_sync.sources {
                sources
                    .entry(source)
                    .or_default()
                    .push((playlist.id.clone(), tracks));
            }
        }
        Ok(sources)
    }

    pub fn sync_spotify_source(
        &self,
        source: &SpotifyImport,
        destinations: &[(String, Vec<String>)],
    ) -> Result<bool, String> {
        let _lock = self.lock()?;
        let mut data = self.read()?;
        let mut changed = false;
        for (id, expected) in destinations {
            let Some(playlist) = data
                .playlists
                .iter_mut()
                .find(|playlist| &playlist.id == id)
            else {
                continue;
            };
            if playlist.spotify_sync.sources.get(&source.id) != Some(expected) {
                continue;
            }
            let added = append_tracks(playlist, &source.tracks, true);
            if added == 0 && expected == &source.track_ids {
                continue;
            }
            playlist
                .spotify_sync
                .sources
                .insert(source.id.clone(), source.track_ids.clone());
            remove_detached_tracks(playlist, expected);
            playlist.updated_at = Utc::now().timestamp_millis();
            changed = true;
        }
        if changed {
            self.save(&data)?;
        }
        Ok(changed)
    }
}

fn apply_import(playlist: &mut Playlist, source: SpotifyImport, auto_sync: bool) -> ImportResult {
    let added_count = append_tracks(playlist, &source.tracks, auto_sync);
    if auto_sync {
        if let Some(previous) = playlist
            .spotify_sync
            .sources
            .insert(source.id, source.track_ids)
        {
            remove_detached_tracks(playlist, &previous);
        }
    } else if playlist.spotify_sync.sources.remove(&source.id).is_some() {
        let linked = linked_track_ids(playlist);
        playlist
            .spotify_sync
            .managed_tracks
            .retain(|id| linked.contains(id));
    }
    if playlist.cover_url.is_none() {
        playlist.cover_url = source.cover_url;
    }
    playlist.updated_at = Utc::now().timestamp_millis();
    ImportResult {
        playlist: playlist.clone(),
        added_count,
        duplicate_count: source.tracks.len() - added_count,
        unavailable_count: source.unavailable_count,
        source_name: source.name,
    }
}

fn append_tracks(playlist: &mut Playlist, tracks: &[Track], managed: bool) -> usize {
    let mut ids: HashSet<_> = playlist
        .tracks
        .iter()
        .map(|track| track.spotify_id.clone())
        .collect();
    let before = playlist.tracks.len();
    for track in tracks {
        if ids.insert(track.spotify_id.clone()) {
            let mut local = track.clone();
            local.id = Uuid::new_v4().to_string();
            playlist.tracks.push(local);
            if managed {
                playlist
                    .spotify_sync
                    .managed_tracks
                    .insert(track.spotify_id.clone());
            }
        }
    }
    playlist.tracks.len() - before
}

fn linked_track_ids(playlist: &Playlist) -> HashSet<String> {
    playlist
        .spotify_sync
        .sources
        .values()
        .flatten()
        .cloned()
        .collect()
}

fn remove_detached_tracks(playlist: &mut Playlist, previous: &[String]) {
    let linked = linked_track_ids(playlist);
    let detached: HashSet<_> = previous
        .iter()
        .filter(|id| !linked.contains(*id) && playlist.spotify_sync.managed_tracks.remove(*id))
        .collect();
    playlist
        .tracks
        .retain(|track| !detached.contains(&track.spotify_id));
}

#[cfg(not(target_os = "android"))]
pub(crate) fn lock_file(file: &File) -> std::io::Result<()> {
    file.lock()
}

#[cfg(target_os = "android")]
pub(crate) fn lock_file(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    // Rust's File::lock is unsupported on Android. The kernel still supports flock.
    loop {
        // The descriptor belongs to the borrowed File and the lock lives until it is closed.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
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
        #[cfg(target_os = "android")]
        let valid = parsed.scheme() == "https" || super::covers::valid_local_cover(url);
        #[cfg(not(target_os = "android"))]
        let valid = parsed.scheme() == "https";
        if !valid {
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

    fn source(id: &str, tracks: &[&str]) -> SpotifyImport {
        SpotifyImport {
            id: id.into(),
            name: "Spotify name".into(),
            cover_url: None,
            tracks: tracks.iter().map(|id| track(id)).collect(),
            track_ids: tracks.iter().map(|id| (*id).into()).collect(),
            unavailable_count: 0,
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
                SpotifyImport {
                    cover_url: Some("https://i.scdn.co/source".into()),
                    unavailable_count: 1,
                    ..source("first", &["one", "two", "one"])
                },
                false,
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
            .append_import(&created.id, source("first", &["two"]), false)
            .unwrap();
        assert_eq!((repeated.added_count, repeated.duplicate_count), (0, 1));
        assert_eq!(repeated.playlist.tracks.len(), 2);
        assert_eq!(repeated.playlist.tracks[0].source_added_at, Some(2));
    }

    #[test]
    fn spotify_sync_keeps_local_tracks_and_shared_source_tracks_after_reopening() {
        let directory = TestDirectory::new();
        let store = directory.store();
        let playlist = store.create(draft("Mixed sources")).unwrap();
        let id = &playlist.id;
        store
            .append_import(id, source("local", &["manual"]), false)
            .unwrap();
        store
            .append_import(id, source("first", &["manual", "shared", "removed"]), true)
            .unwrap();
        let original = store.get(id).unwrap().tracks[1].id.clone();
        store
            .append_import(id, source("second", &["shared"]), true)
            .unwrap();

        let reopened = directory.store();
        let plan = reopened.spotify_sync_sources().unwrap();
        assert!(
            reopened
                .sync_spotify_source(&source("first", &["new"]), &plan["first"])
                .unwrap()
        );
        let tracks = reopened.get(id).unwrap().tracks;
        assert_eq!(
            tracks
                .iter()
                .map(|track| track.spotify_id.as_str())
                .collect::<Vec<_>>(),
            ["manual", "shared", "new"]
        );
        assert_eq!(tracks[1].id, original);
        assert!(
            !reopened
                .sync_spotify_source(&source("first", &["old"]), &plan["first"])
                .unwrap()
        );
        reopened
            .append_import(id, source("second", &["shared"]), false)
            .unwrap();
        assert!(
            !reopened
                .sync_spotify_source(&source("second", &[]), &plan["second"])
                .unwrap()
        );
        assert_eq!(reopened.get(id).unwrap().tracks.len(), 3);
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
    fn track_membership_edits_apply_only_to_selected_playlists() {
        let directory = TestDirectory::new();
        let store = directory.store();
        let first = store.create(draft("First")).unwrap();
        let second = store.create(draft("Second")).unwrap();
        let third = store.create(draft("Third")).unwrap();
        let edit = |add, remove| BulkMembershipEdit {
            spotify_ids: vec!["song".into(), "other".into()],
            add,
            remove,
        };
        store
            .edit_memberships(
                edit(vec![first.id.clone(), second.id.clone()], vec![]),
                HashMap::from([
                    ("song".into(), track("song")),
                    ("other".into(), track("other")),
                ]),
            )
            .unwrap();
        store
            .edit_memberships(
                edit(
                    vec![third.id.clone(), second.id.clone()],
                    vec![first.id.clone()],
                ),
                HashMap::new(),
            )
            .unwrap();

        let index = directory.store().index().unwrap();
        assert_eq!(
            index.memberships["song"],
            [second.id.clone(), third.id.clone()]
        );
        assert!(store.get(&first.id).unwrap().tracks.is_empty());
        let second = store.get(&second.id).unwrap();
        let third = store.get(&third.id).unwrap();
        assert_eq!(second.tracks.len(), 2);
        assert_eq!(third.tracks.len(), 2);
        assert_ne!(second.tracks[0].id, third.tracks[0].id);
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
