use super::{
    lastfm::Song,
    store::{Signal, Store},
};
use crate::shared::playlists::models::Track;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagWeight {
    pub tag: String,
    pub playlist_tracks: usize,
    pub feedback: f64,
    pub weight: f64,
    pub session_change: f64,
}

pub fn genre_factor(tag: &str) -> f64 {
    if matches!(tag, "pop" | "rock" | "electronic" | "indie" | "alternative") {
        0.5
    } else {
        1.0
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub configured: bool,
    pub scanning: bool,
    pub scanned_tracks: usize,
    pub total_tracks: usize,
    pub scanned_playlists: usize,
    pub total_playlists: usize,
    pub scan_error: Option<String>,
    pub tags: Vec<TagWeight>,
}

#[derive(Default)]
struct Contribution {
    memberships: usize,
    remote_memberships: usize,
    signal: i32,
    source_tags: Vec<String>,
}

impl Contribution {
    fn session_points(&self) -> i64 {
        self.memberships as i64 * 4 + i64::from(self.signal)
    }
}

type Contributions = HashMap<String, (Track, Contribution)>;

fn contributions(tracks: Vec<Track>, signals: HashMap<String, Signal>) -> Contributions {
    let mut entries = HashMap::<_, (_, Contribution)>::new();
    for track in tracks {
        let entry = entries
            .entry(track.spotify_id.clone())
            .or_insert((track, Contribution::default()));
        entry.1.memberships += 1;
    }
    for (id, signal) in signals {
        let entry = entries
            .entry(id)
            .or_insert((signal.track, Contribution::default()));
        entry.1.signal = signal.points;
        entry.1.source_tags = signal.source_tags;
    }
    entries
}

#[derive(Default)]
pub struct SessionStart(Contributions);

impl SessionStart {
    pub fn capture(store: &Store, tracks: Vec<Track>) -> Result<Self, String> {
        Ok(Self(contributions(tracks, store.signals()?)))
    }
}

pub struct Favorite {
    pub song: Song,
    pub weight: f64,
    pub tags: Vec<String>,
}

pub struct Analysis {
    pub tags: Vec<TagWeight>,
    pub favorites: Vec<Favorite>,
    pub disliked: HashSet<(String, String)>,
    pub library: HashSet<(String, String)>,
    pub total: usize,
    pub scanned: usize,
    pub pending: Vec<Track>,
}

#[derive(Default)]
struct TagTotal {
    count: usize,
    signal: i64,
    session_change: i64,
}

impl Analysis {
    pub fn collect(
        store: &Store,
        tracks: Vec<Track>,
        remote: Vec<Track>,
        session: &SessionStart,
        initial_remote: &HashMap<String, Vec<Track>>,
    ) -> Result<Self, String> {
        let mut entries = contributions(tracks, store.signals()?);
        for track in remote {
            entries
                .entry(track.spotify_id.clone())
                .or_insert((track, Contribution::default()))
                .1
                .remote_memberships += 1;
        }
        let mut before = session
            .0
            .iter()
            .map(|(id, (track, data))| {
                (
                    id.as_str(),
                    (track, data.session_points(), data.source_tags.as_slice()),
                )
            })
            .collect::<HashMap<_, _>>();
        for track in initial_remote.values().flatten() {
            before.entry(&track.spotify_id).or_insert((track, 0, &[])).1 += 4;
        }
        let mut analysis = Self {
            tags: vec![],
            favorites: vec![],
            disliked: HashSet::new(),
            library: HashSet::new(),
            total: 0,
            scanned: 0,
            pending: vec![],
        };
        let mut totals = HashMap::<String, TagTotal>::new();
        for (id, (track, data)) in &entries {
            let count = data.memberships + data.remote_memberships;
            let song = Song::from_track(track);
            let cached = store.tags(track);
            let tags = cached
                .as_ref()
                .filter(|tags| !tags.is_empty())
                .unwrap_or(&data.source_tags);
            let previous = before.get(id.as_str()).map_or(0, |(_, points, _)| *points);
            if count > 0 {
                analysis.total += 1;
                analysis.scanned += usize::from(cached.is_some());
                analysis.library.insert(song.identity());
                let weight = count as f64 + f64::from(data.signal) / 4.0;
                if weight > 0.0 {
                    analysis.favorites.push(Favorite {
                        song,
                        weight,
                        tags: tags.clone(),
                    });
                }
            } else if data.signal <= -8 {
                analysis.disliked.insert(song.identity());
            }
            if cached.is_none() {
                analysis.pending.push(track.clone());
            }
            for tag in tags {
                let total = totals.entry(tag.clone()).or_default();
                total.count += count;
                total.signal += i64::from(data.signal);
                total.session_change +=
                    data.session_points() + data.remote_memberships as i64 * 4 - previous;
            }
        }
        for (id, (track, points, source_tags)) in before {
            if entries.contains_key(id) {
                continue;
            }
            let tags = store
                .tags(track)
                .filter(|tags| !tags.is_empty())
                .unwrap_or_else(|| source_tags.to_vec());
            for tag in tags {
                totals.entry(tag).or_default().session_change -= points;
            }
        }
        analysis.tags = totals
            .into_iter()
            .map(|(tag, total)| {
                let coefficient = genre_factor(&tag);
                let feedback = total.signal as f64 / 4.0;
                TagWeight {
                    tag,
                    playlist_tracks: total.count,
                    feedback,
                    weight: (total.count as f64 + feedback) * coefficient,
                    session_change: total.session_change as f64 / 4.0 * coefficient,
                }
            })
            .collect();
        analysis
            .tags
            .sort_by(|a, b| b.weight.total_cmp(&a.weight).then(a.tag.cmp(&b.tag)));
        Ok(analysis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn session_delta_tracks_reactions_memberships_and_macro_genres() {
        let directory = std::env::temp_dir().join(format!("tesify-wave-{}", Uuid::new_v4()));
        let track = Track {
            id: "song".into(),
            spotify_id: "song".into(),
            artist: "Artist".into(),
            title: "Song".into(),
            artists: vec![],
            cover_url: None,
            duration_ms: None,
            added_at: 0,
            source_added_at: None,
            source_url: String::new(),
        };
        let store = Store::new(&directory);
        let start = SessionStart::capture(&store, vec![track.clone()]).unwrap();
        store
            .save_tags(&track, &["rock".into(), "indie rock".into()])
            .unwrap();
        let read = |tracks| {
            Analysis::collect(&store, tracks, vec![], &start, &HashMap::new())
                .unwrap()
                .tags
        };
        assert!(
            read(vec![track.clone()])
                .iter()
                .all(|tag| tag.session_change == 0.0)
        );
        assert!(
            read(vec![])
                .iter()
                .any(|tag| tag.tag == "indie rock" && tag.session_change == -1.0)
        );
        store.add_signal(track.clone(), -8, vec![]).unwrap();
        store.add_signal(track.clone(), 1, vec![]).unwrap();
        let rows = read(vec![track.clone(), track.clone()]);
        assert_eq!(
            (rows[0].tag.as_str(), rows[0].weight, rows[0].session_change),
            ("indie rock", 0.25, -0.75)
        );
        assert_eq!(
            (rows[1].tag.as_str(), rows[1].weight, rows[1].session_change),
            ("rock", 0.125, -0.375)
        );
        let restarted = SessionStart::capture(&store, vec![track.clone()]).unwrap();
        assert!(
            Analysis::collect(&store, vec![track], vec![], &restarted, &HashMap::new())
                .unwrap()
                .tags
                .iter()
                .all(|tag| tag.session_change == 0.0)
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
