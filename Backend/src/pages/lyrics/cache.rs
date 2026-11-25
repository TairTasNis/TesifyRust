use super::models::LyricsResponse;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
    time::UNIX_EPOCH,
};
use tokio::task::spawn_blocking;
use uuid::Uuid;

const MAX_ENTRIES: usize = 128;
const MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ENTRY: u64 = 2 * 1024 * 1024;

pub fn key(fields: (&str, &str, &str, i64, Option<&str>)) -> String {
    let input = serde_json::to_vec(&fields).expect("lyrics cache key fields are serializable");
    format!("{:x}", Sha256::digest(input))
}

pub fn override_key(fields: (&str, &str, &str, i64)) -> String {
    let input = serde_json::to_vec(&("override-v1", fields))
        .expect("lyrics override key fields are serializable");
    format!("{:x}", Sha256::digest(input))
}

pub async fn remove(directory: PathBuf, key: &str) {
    let path = directory.join(format!("{key}.json"));
    let _ = spawn_blocking(move || fs::remove_file(path)).await;
}

pub async fn read(directory: PathBuf, key: &str) -> Option<LyricsResponse> {
    let path = directory.join(format!("{key}.json"));
    spawn_blocking(move || {
        let mut bytes = Vec::new();
        File::open(path).ok()?.take(MAX_ENTRY + 1).read_to_end(&mut bytes).ok()?;
        if bytes.len() as u64 > MAX_ENTRY {
            return None;
        }
        let response: LyricsResponse = serde_json::from_slice(&bytes).ok()?;
        (response.status == "found" && response.lyrics.as_ref().is_some_and(|doc| !doc.lines.is_empty()))
            .then_some(response)
    }).await.ok().flatten()
}

pub async fn write(directory: PathBuf, key: &str, response: LyricsResponse) {
    let name = format!("{key}.json");
    let _ = spawn_blocking(move || {
        let bytes = serde_json::to_vec(&response)?;
        if bytes.len() as u64 > MAX_ENTRY {
            return Ok::<_, std::io::Error>(());
        }
        fs::create_dir_all(&directory)?;
        let temporary = directory.join(format!("{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let mut file = File::create(&temporary)?;
            file.write_all(&bytes)?;
            drop(file);
            fs::rename(&temporary, directory.join(name))
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        let mut entries: Vec<_> = fs::read_dir(&directory)?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let stem = path.file_stem()?.to_str()?;
                let metadata = entry.metadata().ok()?;
                (path.extension().is_some_and(|ext| ext == "json") && stem.len() == 64
                    && stem.bytes().all(|byte| byte.is_ascii_hexdigit()) && metadata.is_file())
                    .then(|| (metadata.modified().unwrap_or(UNIX_EPOCH), metadata.len(), path))
            })
            .collect();
        entries.sort_by_key(|entry| entry.0);
        let mut size: u64 = entries.iter().map(|entry| entry.1).sum();
        let mut count = entries.len();
        for (_, length, path) in entries {
            if count <= MAX_ENTRIES && size <= MAX_BYTES {
                break;
            }
            if fs::remove_file(path).is_ok() {
                size -= length;
                count -= 1;
            }
        }
        Ok(())
    }).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::lyrics::parse;

    #[tokio::test]
    async fn found_lyrics_survive_a_new_read_and_are_keyed_by_duration() {
        let directory = std::env::temp_dir().join(format!("tesify-lyrics-{}", Uuid::new_v4()));
        let selected = key(("spotify-id", "Song", "Artist", 16_000, None));
        let other = key(("spotify-id", "Song", "Artist", 22_000, None));
        let lyrics = parse::document(parse::lrc("[00:03]First line\n[00:08]Second line"), "test", "", 16.0);
        write(directory.clone(), &selected, LyricsResponse { status: "found".into(), lyrics, custom: false }).await;
        let saved = read(directory.clone(), &selected).await.unwrap().lyrics.unwrap();
        assert_eq!(saved.lines[1].text, "Second line");
        assert!(read(directory.clone(), &other).await.is_none());
        fs::remove_file(directory.join(format!("{selected}.json"))).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
