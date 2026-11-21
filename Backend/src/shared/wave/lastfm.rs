use crate::shared::playlists::models::Track;
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    sync::{LazyLock, RwLock},
    time::Duration,
};
use tokio::{
    sync::Mutex,
    time::{Instant, sleep_until},
};
use unicode_normalization::UnicodeNormalization;

pub const MISSING_KEY: &str = "Для Моей волны нужен ключ LASTFM_API_KEY.";
const UNAVAILABLE: &str = "Last.fm недоступен. Попробуйте ещё раз.";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Song {
    pub artist: String,
    pub title: String,
}

impl Song {
    pub fn from_track(track: &Track) -> Self {
        let artist = track
            .artists
            .first()
            .map(|artist| artist.name.as_str())
            .unwrap_or_else(|| track.artist.split(',').next().unwrap_or(&track.artist));
        Self {
            artist: artist.trim().into(),
            title: track.title.trim().into(),
        }
    }

    pub fn identity(&self) -> (String, String) {
        (identity(&self.artist), identity(&self.title))
    }
}

pub fn identity(text: &str) -> String {
    text.nfkc()
        .flat_map(char::to_lowercase)
        .filter(|ch| ch.is_alphanumeric())
        .collect()
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum Source {
    Tag(String),
    Similar(Song),
    Chart { page: u8 },
}

pub struct LastFm {
    http: reqwest::Client,
    key: RwLock<Option<String>>,
    next_request: Mutex<Instant>,
}

impl LastFm {
    pub fn new(http: reqwest::Client, key: Option<String>) -> Self {
        Self {
            http,
            key: RwLock::new(key),
            next_request: Mutex::new(Instant::now()),
        }
    }

    pub fn configured(&self) -> bool {
        self.key.read().unwrap().is_some()
    }

    pub fn set_key(&self, key: String) {
        *self.key.write().unwrap() = Some(key);
    }

    async fn call(
        &self,
        method: &str,
        params: &[(&str, &str)],
    ) -> Result<Option<Value>, &'static str> {
        let key = self.key.read().unwrap().clone().ok_or(MISSING_KEY)?;
        {
            let mut next = self.next_request.lock().await;
            sleep_until(*next).await;
            *next = Instant::now() + Duration::from_millis(250);
        }
        let response = self
            .http
            .get("https://ws.audioscrobbler.com/2.0/")
            .timeout(Duration::from_secs(10))
            .query(&[
                ("method", method),
                ("api_key", key.as_str()),
                ("format", "json"),
            ])
            .query(params)
            .send()
            .await
            .map_err(|_| UNAVAILABLE)?;
        let status = response.status();
        let data = response.json::<Value>().await.map_err(|_| UNAVAILABLE)?;
        match data.get("error").and_then(Value::as_i64) {
            Some(6 | 7) => Ok(None),
            Some(10 | 26) => Err("Last.fm отклонил ключ API."),
            Some(29) => {
                let mut next = self.next_request.lock().await;
                *next = (*next).max(Instant::now() + Duration::from_secs(10));
                Err("Last.fm временно ограничил запросы.")
            }
            Some(_) => Err(UNAVAILABLE),
            None if status.is_success() => Ok(Some(data)),
            None => Err(UNAVAILABLE),
        }
    }

    pub async fn tags(&self, track: &Track) -> Result<Vec<String>, &'static str> {
        let song = Song::from_track(track);
        if song.artist.is_empty() || song.title.is_empty() {
            return Ok(vec![]);
        }
        let data = self
            .call(
                "track.getTopTags",
                &[
                    ("artist", &song.artist),
                    ("track", &song.title),
                    ("autocorrect", "1"),
                ],
            )
            .await?;
        let Some(data) = data else { return Ok(vec![]) };
        let tags = data.pointer("/toptags/tag").ok_or(UNAVAILABLE)?;
        let tags: Vec<RawTag> = serde_json::from_value(tags.clone()).map_err(|_| UNAVAILABLE)?;
        let artists = track
            .artists
            .iter()
            .map(|artist| artist.name.as_str())
            .chain([track.artist.as_str(), song.artist.as_str()])
            .chain(
                data.pointer("/toptags/@attr/artist")
                    .and_then(Value::as_str),
            );
        Ok(genre_tags(tags, artists))
    }

    pub async fn tracks(&self, source: &Source) -> Result<Vec<Song>, &'static str> {
        let (data, path) = match source {
            Source::Tag(tag) => (
                self.call("tag.getTopTracks", &[("tag", tag), ("limit", "40")])
                    .await?,
                "/tracks/track",
            ),
            Source::Similar(song) => (
                self.call(
                    "track.getSimilar",
                    &[
                        ("artist", &song.artist),
                        ("track", &song.title),
                        ("autocorrect", "1"),
                        ("limit", "40"),
                    ],
                )
                .await?,
                "/similartracks/track",
            ),
            Source::Chart { page } => (
                self.call(
                    "chart.getTopTracks",
                    &[("limit", "40"), ("page", &page.to_string())],
                )
                .await?,
                "/tracks/track",
            ),
        };
        Ok(data
            .as_ref()
            .and_then(|data| data.pointer(path))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let title = item.get("name")?.as_str()?.trim();
                let artist = item.pointer("/artist/name")?.as_str()?.trim();
                (!title.is_empty() && !artist.is_empty()).then(|| Song {
                    artist: artist.into(),
                    title: title.into(),
                })
            })
            .collect())
    }
}

#[derive(Deserialize)]
struct RawTag {
    name: String,
    count: Value,
}

fn genre_tags(
    mut tags: Vec<RawTag>,
    artists: impl IntoIterator<Item = impl AsRef<str>>,
) -> Vec<String> {
    static NOISE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
        r"^(?:(?:the )?\d[\d\s.'’]*s?|.*\b(?:listeners?|scrobbles?|last\.?fm|",
        r"favorites?|favourites?|favs?|awesome|amazing|best|playlist|my music|seen[ -]live|",
        r"favorite|favourite|masterpiece|all[- ]time|recommended|top \d+)\b.*|",
        r"seen|live|albums?|saw live|great|good|cool|nice|love[d]?|unknown|misc|other|seen in concert|",
        r"guilty pleasure|on repeat|repeat|check out|to listen|need to listen|check later|discovered|",
        r"soundtrack of my life|beautiful|epic|perfect|overrated|underrated|male vocalists?|female vocalists?)$"
    )).unwrap()
    });
    let count = |tag: &RawTag| {
        tag.count
            .as_u64()
            .or_else(|| tag.count.as_str()?.parse().ok())
            .unwrap_or(0)
    };
    tags.sort_by_key(|tag| std::cmp::Reverse(count(tag)));
    let artists: HashSet<_> = artists
        .into_iter()
        .map(|artist| identity(artist.as_ref()))
        .collect();
    let mut seen = HashSet::new();
    tags.into_iter()
        .filter(|tag| count(tag) >= 20)
        .filter_map(|tag| {
            let name = tag
                .name
                .trim()
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let key = identity(&name);
            (!key.is_empty()
                && !artists.contains(&key)
                && !NOISE.is_match(&name)
                && seen.insert(key))
            .then_some(name)
        })
        .take(5)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn filters_noise_artist_and_weak_tags_before_applying_limit() {
        let tags = [
            ("seen live", 100),
            ("Radiohead", 97),
            ("under 2000 listeners", 95),
            ("2020s", 90),
            ("my favorite", 88),
            ("awesome", 87),
            ("Rock", 80),
            ("rock", 78),
            ("Alternative Rock", 76),
            ("indie", 50),
            ("art rock", 30),
            ("britpop", 20),
            ("alternative", 20),
            ("progressive rock", 19),
        ]
        .map(|(name, count)| RawTag {
            name: name.into(),
            count: json!(count.to_string()),
        });
        assert_eq!(
            genre_tags(tags.into(), ["RADIOHEAD"]),
            ["rock", "alternative rock", "indie", "art rock", "britpop"]
        );
        let weak = vec![RawTag {
            name: "rock".into(),
            count: json!(19),
        }];
        assert!(genre_tags(weak, ["Radiohead"]).is_empty());
    }
}
