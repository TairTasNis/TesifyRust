use crate::shared::playlists::{models::Track, store::lock_file};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const READ_ERROR: &str = "Не удалось прочитать данные Моей волны.";
const WRITE_ERROR: &str = "Не удалось сохранить данные Моей волны.";

#[derive(Clone, Deserialize, Serialize)]
pub struct Signal {
    pub track: Track,
    pub points: i32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_tags: Vec<String>,
}

pub struct Store {
    directory: PathBuf,
}

impl Store {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            directory: data_dir.join("wave-v1"),
        }
    }

    fn tag_path(&self, track: &Track) -> PathBuf {
        let key = if track.spotify_id.is_empty() {
            format!("{}\0{}", track.artist, track.title)
        } else {
            track.spotify_id.clone()
        };
        let hash = Sha256::digest(key.as_bytes());
        self.directory.join("tags").join(format!("{hash:x}.json"))
    }

    pub fn tags(&self, track: &Track) -> Option<Vec<String>> {
        read_json(&self.tag_path(track)).ok().flatten()
    }

    pub fn save_tags(&self, track: &Track, tags: &[String]) -> Result<(), String> {
        write_json(&self.tag_path(track), tags).map_err(|_| WRITE_ERROR.into())
    }

    pub fn signals(&self) -> Result<HashMap<String, Signal>, String> {
        read_json(&self.directory.join("signals.json"))
            .map(Option::unwrap_or_default)
            .map_err(|_| READ_ERROR.into())
    }

    pub fn lastfm_key(&self) -> Option<String> {
        read_json(&self.directory.join("lastfm-key.json"))
            .ok()
            .flatten()
    }

    pub fn save_lastfm_key(&self, key: &str) -> Result<(), String> {
        write_json(&self.directory.join("lastfm-key.json"), key).map_err(|_| WRITE_ERROR.into())
    }

    pub fn add_signal(
        &self,
        track: Track,
        points: i32,
        source_tags: Vec<String>,
    ) -> Result<(), String> {
        let result = (|| {
            fs::create_dir_all(&self.directory)?;
            let lock = OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(self.directory.join("signals.lock"))?;
            lock_file(&lock)?;
            let path = self.directory.join("signals.json");
            let mut signals: HashMap<String, Signal> = read_json(&path)?.unwrap_or_default();
            if points == 0
                && signals
                    .get(&track.spotify_id)
                    .is_some_and(|signal| !signal.source_tags.is_empty())
            {
                return Ok(());
            }
            let signal = signals.entry(track.spotify_id.clone()).or_insert(Signal {
                track,
                points: 0,
                source_tags: vec![],
            });
            if signal.source_tags.is_empty() {
                signal.source_tags = source_tags;
            }
            signal.points = signal.points.saturating_add(points);
            write_json(&path, &signals)
        })();
        result.map_err(|_| WRITE_ERROR.into())
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> io::Result<Option<T>> {
    match File::open(path) {
        Ok(file) => serde_json::from_reader(BufReader::new(file))
            .map(Some)
            .map_err(io::Error::from),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn write_json(path: &Path, data: &(impl Serialize + ?Sized)) -> io::Result<()> {
    let directory = path.parent().expect("wave files have a directory");
    fs::create_dir_all(directory)?;
    let temporary = directory.join(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut writer = BufWriter::new(File::create(&temporary)?);
        serde_json::to_writer(&mut writer, data)?;
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
