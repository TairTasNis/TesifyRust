use serde::{Deserialize, Serialize};
use crate::shared::spotify::models::ArtistRef;

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
