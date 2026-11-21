pub mod commands;
mod lastfm;
mod mix;
mod profile;
mod store;

use crate::shared::{
    playlists::{models::Track, store::LibraryStore},
    services::AppServices,
    spotify::{SpotifyClient, models::CatalogItem},
};
use futures_util::{StreamExt, stream};
use lastfm::{LastFm, MISSING_KEY, Song, Source, identity};
pub use mix::Options;
use mix::{Feed, Mode, SongKey};
pub use profile::Profile;
use profile::{Analysis, SessionStart};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use store::Store;
use uuid::Uuid;

const BATCH_SIZE: usize = 6;
const SCAN_RETRY: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Feedback {
    Skipped,
    Listened,
}

#[derive(Default)]
struct Scan {
    running: bool,
    refresh: bool,
    failed: Option<(Instant, String)>,
}

struct Snapshot {
    analysis: Analysis,
    pending_playlists: Vec<String>,
    scanned_playlists: usize,
    total_playlists: usize,
}

struct SavedPlaylist {
    tracks: Vec<Track>,
    expires: Instant,
    error: Option<String>,
}

#[derive(Default)]
struct RemoteLibrary {
    playlists: HashMap<String, SavedPlaylist>,
    initial: HashMap<String, Vec<Track>>,
}

type Feeds = HashMap<Source, (Instant, Vec<Song>)>;

pub struct WaveService {
    lastfm: LastFm,
    store: Store,
    scan: Mutex<Scan>,
    remote: Mutex<RemoteLibrary>,
    feeds: Mutex<Feeds>,
    session_start: SessionStart,
    initial_playlists: HashSet<String>,
    recommendation_tags: Mutex<HashMap<String, (Instant, Vec<String>)>>,
    tag_request: tokio::sync::Mutex<()>,
}

impl WaveService {
    pub fn new(
        http: reqwest::Client,
        key: Option<String>,
        data_dir: &Path,
        library: &LibraryStore,
    ) -> Arc<Self> {
        let (tracks, playlists) = library.wave_library().unwrap_or_default();
        let store = Store::new(data_dir);
        let session_start = SessionStart::capture(&store, tracks).unwrap_or_default();
        Arc::new(Self {
            lastfm: LastFm::new(http, store.lastfm_key().or(key)),
            store,
            scan: Mutex::default(),
            remote: Mutex::default(),
            feeds: Mutex::default(),
            session_start,
            initial_playlists: playlists.into_iter().collect(),
            recommendation_tags: Mutex::default(),
            tag_request: tokio::sync::Mutex::new(()),
        })
    }

    async fn analyze(services: &AppServices) -> Result<(Analysis, usize, usize), String> {
        let mut snapshot = services.wave.snapshot(services.library.clone()).await?;
        services.wave.start_scan(
            services.library.clone(),
            services.spotify.clone(),
            std::mem::take(&mut snapshot.analysis.pending),
            snapshot.pending_playlists,
        );
        Ok((
            snapshot.analysis,
            snapshot.scanned_playlists,
            snapshot.total_playlists,
        ))
    }

    async fn snapshot(self: &Arc<Self>, library: Arc<LibraryStore>) -> Result<Snapshot, String> {
        let wave = self.clone();
        tokio::task::spawn_blocking(move || {
            let (tracks, saved) = library.wave_library()?;
            let mut remote_tracks = Vec::new();
            let total = saved.len();
            let mut pending = Vec::new();
            let mut scanned = 0;
            let initial_remote = {
                let mut remote = wave.remote.lock().unwrap();
                remote.playlists.retain(|id, _| saved.contains(id));
                for id in saved {
                    if let Some(entry) = remote.playlists.get(&id) {
                        remote_tracks.extend(entry.tracks.iter().cloned());
                        if entry.error.is_none() {
                            scanned += 1;
                        }
                        if entry.expires > Instant::now() {
                            continue;
                        }
                    }
                    pending.push(id);
                }
                remote.initial.clone()
            };
            Ok(Snapshot {
                analysis: Analysis::collect(
                    &wave.store,
                    tracks,
                    remote_tracks,
                    &wave.session_start,
                    &initial_remote,
                )?,
                pending_playlists: pending,
                scanned_playlists: scanned,
                total_playlists: total,
            })
        })
        .await
        .map_err(|_| "Не удалось прочитать данные Моей волны.")?
    }

    fn start_scan(
        self: &Arc<Self>,
        library: Arc<LibraryStore>,
        spotify: Arc<SpotifyClient>,
        mut pending: Vec<Track>,
        mut playlists: Vec<String>,
    ) {
        if !self.lastfm.configured() || (pending.is_empty() && playlists.is_empty()) {
            return;
        }
        let mut scan = self.scan.lock().unwrap();
        if scan.running {
            scan.refresh = true;
            return;
        }
        if scan
            .failed
            .as_ref()
            .is_some_and(|(when, _)| when.elapsed() < SCAN_RETRY)
        {
            return;
        }
        scan.running = true;
        scan.failed = None;
        let wave = self.clone();
        tokio::spawn(async move {
            loop {
                let (local, remote) = tokio::join!(
                    wave.scan_tracks(pending),
                    wave.scan_playlists(&spotify, playlists)
                );
                let result = local.and(remote);
                {
                    let mut scan = wave.scan.lock().unwrap();
                    let refresh = std::mem::take(&mut scan.refresh);
                    if result.is_err() || !refresh {
                        scan.running = false;
                        scan.failed = result.err().map(|error| (Instant::now(), error));
                        return;
                    }
                }
                match wave.snapshot(library.clone()).await {
                    Ok(snapshot) => {
                        pending = snapshot.analysis.pending;
                        playlists = snapshot.pending_playlists;
                    }
                    Err(error) => {
                        let mut scan = wave.scan.lock().unwrap();
                        scan.running = false;
                        scan.failed = Some((Instant::now(), error));
                        return;
                    }
                }
            }
        });
    }

    async fn scan_tracks(&self, tracks: Vec<Track>) -> Result<(), String> {
        for track in tracks {
            self.scan_track(&track).await?;
        }
        Ok(())
    }

    async fn scan_track(&self, track: &Track) -> Result<(), String> {
        let _request = self.tag_request.lock().await;
        if self.store.tags(track).is_none() {
            let tags = self.lastfm.tags(track).await?;
            self.store.save_tags(track, &tags)?;
        }
        Ok(())
    }

    async fn scan_playlists(
        &self,
        spotify: &SpotifyClient,
        ids: Vec<String>,
    ) -> Result<(), String> {
        let mut error = None;
        for id in ids {
            let result = remote_tracks(spotify, &id).await;
            let tracks = match result {
                Ok(tracks) => {
                    let mut remote = self.remote.lock().unwrap();
                    if self.initial_playlists.contains(&id) {
                        remote
                            .initial
                            .entry(id.clone())
                            .or_insert_with(|| tracks.clone());
                    }
                    remote.playlists.insert(
                        id,
                        SavedPlaylist {
                            tracks: tracks.clone(),
                            expires: Instant::now() + Duration::from_secs(900),
                            error: None,
                        },
                    );
                    tracks
                }
                Err(message) => {
                    let mut remote = self.remote.lock().unwrap();
                    let entry = remote.playlists.entry(id).or_insert_with(|| SavedPlaylist {
                        tracks: vec![],
                        expires: Instant::now(),
                        error: None,
                    });
                    entry.expires = Instant::now() + SCAN_RETRY;
                    entry.error = Some(message.clone());
                    error = Some(message);
                    continue;
                }
            };
            self.scan_tracks(tracks).await?;
        }
        error.map_or(Ok(()), Err)
    }

    pub async fn profile(services: &AppServices) -> Result<Profile, String> {
        let (analysis, scanned_playlists, total_playlists) = Self::analyze(services).await?;
        let wave = &services.wave;
        let scan = wave.scan.lock().unwrap();
        Ok(Profile {
            configured: wave.lastfm.configured(),
            scanning: scan.running,
            scanned_tracks: analysis.scanned,
            total_tracks: analysis.total,
            scanned_playlists,
            total_playlists,
            scan_error: scan.failed.as_ref().map(|(_, error)| error.clone()),
            tags: analysis.tags,
        })
    }

    pub async fn set_api_key(self: &Arc<Self>, key: String) -> Result<(), String> {
        let key = key.trim();
        if key.len() != 32 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Введите 32-символьный ключ API Last.fm.".into());
        }
        let _request = self.tag_request.lock().await;
        let key = key.to_owned();
        let wave = self.clone();
        tokio::task::spawn_blocking(move || {
            wave.store.save_lastfm_key(&key)?;
            wave.lastfm.set_key(key);
            wave.scan.lock().unwrap().failed = None;
            Ok(())
        })
        .await
        .map_err(|_| "Не удалось сохранить данные Моей волны.")?
    }

    pub async fn feedback(
        services: &AppServices,
        track_id: &str,
        feedback: Feedback,
    ) -> Result<(), String> {
        let track = services.spotify.playback_track(track_id)?;
        let points = match feedback {
            Feedback::Skipped => -8,
            Feedback::Listened => 1,
        };
        let wave = services.wave.clone();
        let copy = track.clone();
        let tags = wave.source_tags(track_id);
        tokio::task::spawn_blocking(move || wave.store.add_signal(copy, points, tags))
            .await
            .map_err(|_| "Не удалось сохранить данные Моей волны.")??;
        let wave = services.wave.clone();
        tokio::spawn(async move {
            let _ = wave.scan_track(&track).await;
        });
        Ok(())
    }

    fn source_tags(&self, track_id: &str) -> Vec<String> {
        self.recommendation_tags
            .lock()
            .unwrap()
            .get(track_id)
            .map(|(_, tags)| tags.clone())
            .unwrap_or_default()
    }

    pub fn remember_saved_tags(&self, track: &Track) {
        let tags = self.source_tags(&track.spotify_id);
        if !tags.is_empty() && self.store.tags(track).is_none_or(|tags| tags.is_empty()) {
            let _ = self.store.add_signal(track.clone(), 0, tags);
        }
    }

    pub async fn recommend(
        services: &AppServices,
        recent: Vec<String>,
        options: Options,
    ) -> Result<Vec<Track>, String> {
        let wave = &services.wave;
        if !wave.lastfm.configured() {
            return Err(MISSING_KEY.into());
        }
        if options.mode == Mode::Popular {
            let mut picker = Picker {
                known_artists: HashSet::new(),
                seen: recent
                    .iter()
                    .take(200)
                    .filter_map(|id| services.spotify.playback_track(id).ok())
                    .map(|track| Song::from_track(&track).identity())
                    .collect(),
                recent: recent.into_iter().take(200).collect(),
                artists: HashSet::new(),
                mood: None,
                mode: Mode::Popular,
                last_error: None,
            };
            let charts: Vec<_> = (1..=6)
                .map(|page| Feed {
                    source: Source::Chart { page },
                    tags: vec![],
                })
                .collect();
            let tracks = picker.collect(services, &charts, BATCH_SIZE).await;
            return wave.remember_recommendations(tracks, picker.last_error);
        }
        let (analysis, _, _) = Self::analyze(services).await?;
        let (similar, tagged) = mix::personalized(&analysis, options.mode);
        let moods: Vec<_> = options
            .mood
            .tags()
            .iter()
            .map(|tag| Feed::tag(tag))
            .collect();
        let mut mood_matches = HashSet::new();
        let mut last_error = None;
        for feed in &moods {
            match wave.feed(&feed.source).await {
                Ok(songs) => mood_matches.extend(songs.into_iter().map(|song| song.identity())),
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        let slots: Vec<_> = (0..BATCH_SIZE)
            .map(|_| options.mode.similar(random()))
            .collect();
        let similar_count = slots.iter().filter(|&&similar| similar).count();
        let mut picker = Picker {
            known_artists: if options.mode == Mode::Discovery {
                analysis
                    .library
                    .iter()
                    .map(|(artist, _)| artist.clone())
                    .collect()
            } else {
                HashSet::new()
            },
            seen: analysis
                .library
                .into_iter()
                .chain(analysis.disliked)
                .collect(),
            recent: recent.into_iter().take(200).collect(),
            artists: HashSet::new(),
            mood: (!moods.is_empty()).then_some(mood_matches),
            mode: options.mode,
            last_error,
        };
        let mut similar_tracks = picker.collect(services, &similar, similar_count).await;
        let tagged_count = BATCH_SIZE - similar_tracks.len();
        let mut tag_tracks = picker.collect(services, &tagged, tagged_count).await;
        if similar_tracks.len() + tag_tracks.len() < BATCH_SIZE {
            let remaining = BATCH_SIZE - similar_tracks.len() - tag_tracks.len();
            similar_tracks.extend(picker.collect(services, &similar, remaining).await);
        }
        if similar_tracks.len() + tag_tracks.len() < BATCH_SIZE {
            let remaining = BATCH_SIZE - similar_tracks.len() - tag_tracks.len();
            let fallback = if moods.is_empty() {
                vec![Feed {
                    source: Source::Chart { page: 1 },
                    tags: vec![],
                }]
            } else {
                moods
            };
            tag_tracks.extend(picker.collect(services, &fallback, remaining).await);
        }
        let picks = mix::interleave(&slots, similar_tracks, tag_tracks);
        wave.remember_recommendations(picks, picker.last_error)
    }

    fn remember_recommendations(
        self: &Arc<Self>,
        picks: Vec<(Track, Vec<String>)>,
        last_error: Option<String>,
    ) -> Result<Vec<Track>, String> {
        if picks.is_empty() {
            return Err(last_error.unwrap_or_else(|| {
                "Не нашлось новых треков для Моей волны. Попробуйте ещё раз.".into()
            }));
        }
        let mut tracks = Vec::new();
        {
            let mut evidence = self.recommendation_tags.lock().unwrap();
            evidence.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(7200));
            for (track, tags) in picks {
                if !tags.is_empty() {
                    evidence.insert(track.spotify_id.clone(), (Instant::now(), tags));
                }
                tracks.push(track);
            }
        }
        let tagged = tracks.clone();
        let wave = self.clone();
        tokio::spawn(async move {
            let _ = wave.scan_tracks(tagged).await;
        });
        Ok(tracks)
    }

    async fn feed(&self, source: &Source) -> Result<Vec<Song>, &'static str> {
        if let Some((_, songs)) = self
            .feeds
            .lock()
            .unwrap()
            .get(source)
            .filter(|(expires, _)| *expires > Instant::now())
        {
            return Ok(songs.clone());
        }
        let songs = self.lastfm.tracks(source).await?;
        let mut feeds = self.feeds.lock().unwrap();
        feeds.retain(|_, (expires, _)| *expires > Instant::now());
        feeds.insert(
            source.clone(),
            (Instant::now() + Duration::from_secs(600), songs.clone()),
        );
        Ok(songs)
    }
}

struct Picker {
    known_artists: HashSet<String>,
    seen: HashSet<SongKey>,
    recent: HashSet<String>,
    artists: HashSet<String>,
    mood: Option<HashSet<SongKey>>,
    mode: Mode,
    last_error: Option<String>,
}

impl Picker {
    async fn collect(
        &mut self,
        services: &AppServices,
        feeds: &[Feed],
        limit: usize,
    ) -> Vec<(Track, Vec<String>)> {
        let mut tracks = Vec::new();
        for feed in feeds {
            if tracks.len() >= limit {
                break;
            }
            let songs = match services.wave.feed(&feed.source).await {
                Ok(songs) => songs,
                Err(error) => {
                    self.last_error = Some(error.into());
                    continue;
                }
            };
            let mut candidates = songs
                .into_iter()
                .enumerate()
                .filter_map(|(rank, song)| {
                    let key = song.identity();
                    (!self.known_artists.contains(&key.0)
                        && !self.artists.contains(&key.0)
                        && !self.seen.contains(&key)
                        && self.mood.as_ref().is_none_or(|mood| mood.contains(&key)))
                    .then_some((
                        if self.mode == Mode::Popular {
                            -(rank as f64)
                        } else {
                            mix::rank(rank, self.mode)
                        },
                        song,
                    ))
                })
                .collect::<Vec<_>>();
            candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
            let mut results = stream::iter(
                candidates
                    .into_iter()
                    .take(if self.mode == Mode::Popular { 40 } else { 14 })
                    .map(|(_, song)| find_track(&services.spotify, song)),
            )
            .buffered(4);
            while let Some(result) = results.next().await {
                match result {
                    Ok(Some((song, track))) if !self.recent.contains(&track.spotify_id) => {
                        let artist = song.identity().0;
                        if self.mode != Mode::Popular && !self.artists.insert(artist) {
                            continue;
                        }
                        self.seen.insert(song.identity());
                        self.recent.insert(track.spotify_id.clone());
                        tracks.push((track, feed.tags.clone()));
                        if tracks.len() == limit {
                            break;
                        }
                    }
                    Err(error) => self.last_error = Some(error),
                    _ => {}
                }
            }
        }
        tracks
    }
}

async fn remote_tracks(spotify: &SpotifyClient, id: &str) -> Result<Vec<Track>, String> {
    let mut offset = 0;
    let mut tracks = Vec::new();
    let mut seen = HashSet::new();
    loop {
        let page = crate::pages::spotify_playlist::service::detail(spotify, id, offset, 100)
            .await?
            .tracks;
        tracks.extend(
            page.items
                .iter()
                .filter(|item| seen.insert(item.id.clone()))
                .filter_map(|item| spotify.playback_track(&item.id).ok()),
        );
        let Some(next) = page.next_offset else {
            return Ok(tracks);
        };
        if next <= offset {
            return Ok(tracks);
        }
        offset = next;
    }
}

async fn find_track(spotify: &SpotifyClient, song: Song) -> Result<Option<(Song, Track)>, String> {
    let query: String = format!("{} {}", song.title, song.artist)
        .chars()
        .take(180)
        .collect();
    let result = crate::pages::search::service::search(spotify, &query, "tracks", 0, 14).await?;
    let Some(item) = result
        .tracks
        .items
        .iter()
        .find(|item| matches_song(item, &song))
    else {
        return Ok(None);
    };
    Ok(Some((song, spotify.playback_track(&item.id)?)))
}

fn matches_song(item: &CatalogItem, song: &Song) -> bool {
    let (artist, title) = song.identity();
    item.kind == "track"
        && item.playable
        && identity(&item.name) == title
        && (item
            .artists
            .iter()
            .any(|item| identity(&item.name) == artist)
            || identity(&item.subtitle) == artist)
}

fn random() -> f64 {
    let bits = (Uuid::new_v4().as_u128() >> 76) as u64;
    (bits as f64 + 1.0) / (1_u64 << 52) as f64
}

fn weighted<T>(choices: impl IntoIterator<Item = (T, f64)>) -> Option<T> {
    choices
        .into_iter()
        .map(|(value, weight)| (random().ln() / weight, value))
        .max_by(|(a, _), (b, _)| a.total_cmp(b))
        .map(|(_, value)| value)
}
