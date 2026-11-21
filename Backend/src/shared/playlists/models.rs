use crate::shared::spotify::models::ArtistRef;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CollectionKind {
    Album,
    Playlist,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCollection {
    pub kind: CollectionKind,
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub owner: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    pub playlists: Vec<PlaylistSummary>,
    pub collections: Vec<SavedCollection>,
    pub memberships: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMembershipEdit {
    pub spotify_id: String,
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkMembershipEdit {
    pub spotify_ids: Vec<String>,
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

impl From<TrackMembershipEdit> for BulkMembershipEdit {
    fn from(edit: TrackMembershipEdit) -> Self {
        Self {
            spotify_ids: vec![edit.spotify_id],
            add: edit.add,
            remove: edit.remove,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionEdit {
    pub kind: CollectionKind,
    pub id: String,
    pub saved: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub spotify_id: String,
    pub title: String,
    pub artist: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artists: Vec<ArtistRef>,
    pub cover_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub added_at: i64,
    pub source_added_at: Option<i64>,
    pub source_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub cover_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub tracks: Vec<Track>,
    #[serde(default, skip_serializing_if = "SpotifySync::is_empty")]
    pub spotify_sync: SpotifySync,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifySync {
    pub sources: BTreeMap<String, Vec<String>>,
    pub managed_tracks: HashSet<String>,
}

impl SpotifySync {
    fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

pub struct SpotifyImport {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub tracks: Vec<Track>,
    pub track_ids: Vec<String>,
    pub unavailable_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub cover_url: Option<String>,
    pub updated_at: i64,
    pub track_count: usize,
}

impl From<&Playlist> for PlaylistSummary {
    fn from(playlist: &Playlist) -> Self {
        Self {
            id: playlist.id.clone(),
            name: playlist.name.clone(),
            description: playlist.description.clone(),
            cover_url: playlist.cover_url.clone(),
            updated_at: playlist.updated_at,
            track_count: playlist.tracks.len(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDraft {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub cover_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverUpload {
    pub file_name: String,
    pub image_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedCover {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub playlist: Playlist,
    pub added_count: usize,
    pub duplicate_count: usize,
    pub unavailable_count: usize,
    pub source_name: String,
}
