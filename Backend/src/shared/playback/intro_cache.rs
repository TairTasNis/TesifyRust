use super::play_engine::{AudioSource, VideoMatch};
use crate::shared::playlists::models::Track;
use axum::body::Bytes;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs, io,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::SystemTime,
};

const MAX_FILE: u64 = 1024 * 1024;
const MAX_CACHE: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 128;

#[derive(Serialize, Deserialize)]
pub(super) struct CachedIntro {
    pub version: u32,
    pub video: VideoMatch,
    pub content_type: String,
    pub format_id: Option<String>,
    pub duration: f64,
    pub total: u64,
    #[serde(with = "encoded_bytes")]
    pub head: Vec<u8>,
    #[serde(with = "encoded_bytes")]
    pub tail: Vec<u8>,
}

impl CachedIntro {
    pub fn source(&self) -> AudioSource {
        AudioSource {
            url: String::new(),
            headers: HashMap::new(),
            content_type: self.content_type.clone(),
            duration_seconds: Some(self.duration),
            format_id: self.format_id.clone(),
            filesize: Some(self.total),
        }
    }

    pub fn chunk(&self, start: u64, end: u64) -> Option<Bytes> {
        if start < self.head.len() as u64 {
            return Some(Bytes::copy_from_slice(
                &self.head[start as usize..=(end.min(self.head.len() as u64 - 1)) as usize],
            ));
        }
        let tail_start = self.total - self.tail.len() as u64;
        if !self.tail.is_empty() && start >= tail_start && start < self.total {
            let first = (start - tail_start) as usize;
            let last = (end.min(self.total - 1) - tail_start) as usize;
            return Some(Bytes::copy_from_slice(&self.tail[first..=last]));
        }
        None
    }

    fn valid(&self) -> bool {
        let video_id = self
            .video
            .url
            .strip_prefix("https://www.youtube.com/watch?v=")
            .unwrap_or("");
        self.version == 1
            && video_id.len() == 11
            && video_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            && self.duration.is_finite()
            && self.duration > 0.
            && self.total > 0
            && !self.head.is_empty()
            && self.head.len() <= 512 * 1024
            && self.tail.len() <= 64 * 1024
            && (self.head.len() + self.tail.len()) as u64 <= self.total
            && matches!(self.content_type.as_str(), "audio/mp4" | "audio/webm")
    }
}

#[derive(Clone)]
pub(super) struct IntroCache {
    root: PathBuf,
    generation: Arc<Mutex<u64>>,
}

impl IntroCache {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            generation: Arc::new(Mutex::new(0)),
        }
    }

    pub fn key(track: &Track) -> String {
        let identity = serde_json::to_vec(&(
            &track.spotify_id,
            &track.title,
            &track.artist,
            track.duration_ms,
        ))
        .expect("serializable identity");
        format!("{:x}", Sha256::digest(identity))
    }

    pub fn load(&self, key: &str) -> Option<CachedIntro> {
        let path = self.root.join(format!("{key}.json"));
        if fs::metadata(&path).ok()?.len() > MAX_FILE {
            return None;
        }
        let intro: CachedIntro = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
        if !intro.valid() {
            return None;
        }
        if let Ok(file) = fs::OpenOptions::new().write(true).open(path) {
            let _ = file.set_modified(SystemTime::now());
        }
        Some(intro)
    }

    pub fn save(&self, key: &str, intro: &CachedIntro) -> Result<(), String> {
        if !intro.valid() {
            return Err("Некорректный фрагмент аудиокэша.".into());
        }
        fs::create_dir_all(&self.root).map_err(|_| "Не удалось создать аудиокэш.")?;
        let target = self.root.join(format!("{key}.json"));
        let temporary = self
            .root
            .join(format!("{key}-{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(intro).map_err(|_| "Не удалось подготовить аудиокэш.")?;
        let result = fs::write(&temporary, bytes).and_then(|_| fs::rename(&temporary, &target));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
            return Err("Не удалось сохранить аудиокэш.".into());
        }
        self.prune();
        Ok(())
    }

    pub fn generation(&self) -> u64 {
        *self.generation.lock().expect("intro cache lock")
    }

    pub fn save_if_current(
        &self,
        generation: u64,
        key: &str,
        intro: &CachedIntro,
    ) -> Result<(), String> {
        let current = self.generation.lock().expect("intro cache lock");
        if *current == generation {
            self.save(key, intro)?;
        }
        Ok(())
    }

    pub fn size(&self) -> io::Result<u64> {
        let _guard = self.generation.lock().expect("intro cache lock");
        Ok(self.files()?.iter().map(|(_, size, _)| size).sum())
    }

    pub fn clear(&self) -> io::Result<()> {
        let mut generation = self.generation.lock().expect("intro cache lock");
        *generation += 1;
        for (_, _, path) in self.files()? {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub fn remove(&self, key: &str) {
        let _ = fs::remove_file(self.root.join(format!("{key}.json")));
    }

    fn prune(&self) {
        let Ok(mut files) = self.files() else {
            return;
        };
        files.sort_by_key(|(modified, _, _)| *modified);
        let mut bytes: u64 = files.iter().map(|(_, size, _)| size).sum();
        let mut count = files.len();
        for (_, size, path) in files {
            if bytes <= MAX_CACHE && count <= MAX_ENTRIES {
                break;
            }
            if fs::remove_file(path).is_ok() {
                bytes = bytes.saturating_sub(size);
                count -= 1;
            }
        }
    }

    fn files(&self) -> io::Result<Vec<(SystemTime, u64, PathBuf)>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut files = Vec::new();
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let Some(stem) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            if stem.len() != 64 || !stem.bytes().all(|c| c.is_ascii_hexdigit()) {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if metadata.is_file() {
                files.push((
                    metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    metadata.len(),
                    entry.path(),
                ));
            }
        }
        Ok(files)
    }
}

mod encoded_bytes {
    use super::*;
    pub fn serialize<S: serde::Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<u8>, D::Error> {
        STANDARD
            .decode(String::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub fn sample() -> CachedIntro {
        CachedIntro {
            version: 1,
            video: VideoMatch {
                url: "https://www.youtube.com/watch?v=aaaaaaaaaaa".into(),
                title: "Song".into(),
                channel: None,
                duration_seconds: Some(100.),
                duration_difference_seconds: None,
            },
            content_type: "audio/mp4".into(),
            format_id: Some("140".into()),
            duration: 100.,
            total: 1_000_000,
            head: vec![7; 32],
            tail: vec![9; 16],
        }
    }

    pub struct TemporaryCache(pub PathBuf);
    impl TemporaryCache {
        pub fn new() -> Self {
            Self(std::env::temp_dir().join(format!("tesify-intro-test-{}", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for TemporaryCache {
        fn drop(&mut self) {
            if self.0.starts_with(std::env::temp_dir())
                && self
                    .0
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("tesify-intro-test-"))
            {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn persists_intro_and_container_tail_across_reopening() {
        let directory = TemporaryCache::new();
        let cache = IntroCache::new(directory.0.clone());
        let key = "a".repeat(64);
        cache.save(&key, &sample()).unwrap();
        let reopened = IntroCache::new(directory.0.clone()).load(&key).unwrap();
        assert_eq!(reopened.chunk(2, 10).unwrap().as_ref(), &[7; 9]);
        assert_eq!(reopened.chunk(999_990, 999_999).unwrap().as_ref(), &[9; 10]);
        assert!(reopened.chunk(100, 200).is_none());
        assert!(
            reopened.source().url.is_empty(),
            "Expired signed URLs must not be persisted"
        );
    }

    #[test]
    fn clear_removes_only_previews_and_ignores_pending_downloads() {
        let directory = TemporaryCache::new();
        let cache = IntroCache::new(directory.0.clone());
        let key = "a".repeat(64);
        let generation = cache.generation();
        cache.save_if_current(generation, &key, &sample()).unwrap();
        assert!(cache.size().unwrap() > 0);
        let other = directory.0.join("other.json");
        fs::write(&other, "keep").unwrap();

        cache.clear().unwrap();
        cache.save_if_current(generation, &key, &sample()).unwrap();
        assert_eq!(cache.size().unwrap(), 0);
        assert!(other.exists());
        cache
            .save_if_current(cache.generation(), &key, &sample())
            .unwrap();
        assert!(cache.size().unwrap() > 0);
    }

    #[test]
    fn ignores_corrupt_oversized_or_incompatible_cache_files() {
        let directory = TemporaryCache::new();
        let cache = IntroCache::new(directory.0.clone());
        let key = "b".repeat(64);
        cache.save(&key, &sample()).unwrap();
        let path = directory.0.join(format!("{key}.json"));
        fs::write(&path, b"broken").unwrap();
        assert!(cache.load(&key).is_none());
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_FILE + 1)
            .unwrap();
        assert!(cache.load(&key).is_none());
        let mut invalid = sample();
        invalid.video.url = "https://example.com/".into();
        assert!(cache.save(&key, &invalid).is_err());
    }

    #[test]
    fn bounds_cache_and_preserves_unrelated_files() {
        let directory = TemporaryCache::new();
        let cache = IntroCache::new(directory.0.clone());
        fs::create_dir_all(&directory.0).unwrap();
        fs::write(directory.0.join("notes.json"), "keep").unwrap();
        for index in 0..MAX_ENTRIES + 2 {
            cache.save(&format!("{index:064x}"), &sample()).unwrap();
        }
        let entries = fs::read_dir(&directory.0).unwrap().count();
        assert_eq!(entries, MAX_ENTRIES + 1);
        assert_eq!(
            fs::read_to_string(directory.0.join("notes.json")).unwrap(),
            "keep"
        );
    }
}
