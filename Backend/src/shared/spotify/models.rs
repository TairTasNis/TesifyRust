use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistRef {
    pub id: String,
    pub name: String,
    pub image_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub subtitle: String,
    pub image_url: Option<String>,
    pub color: Option<String>,
    pub artists: Vec<ArtistRef>,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    pub duration_ms: Option<i64>,
    pub year: Option<i64>,
    pub release_type: Option<String>,
    pub play_count: Option<u64>,
    pub added_at: Option<i64>,
    pub disc_number: Option<u64>,
    pub track_number: Option<u64>,
    pub verified: bool,
    pub playable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub items: Vec<CatalogItem>,
    pub total: u64,
    pub offset: u64,
    pub next_offset: Option<u64>,
}
impl CatalogPage {
    pub fn empty() -> Self {
        Self {
            items: vec![],
            total: 0,
            offset: 0,
            next_offset: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub query: String,
    pub top_result: Option<CatalogItem>,
    pub tracks: CatalogPage,
    pub artists: CatalogPage,
    pub albums: CatalogPage,
    pub playlists: CatalogPage,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub artist: CatalogItem,
    pub header_url: Option<String>,
    pub biography: String,
    pub monthly_listeners: Option<u64>,
    pub followers: Option<u64>,
    pub world_rank: Option<u64>,
    pub top_tracks: Vec<CatalogItem>,
    pub popular_releases: Vec<CatalogItem>,
    pub albums: CatalogPage,
    pub singles: CatalogPage,
    pub compilations: CatalogPage,
    pub playlists: Vec<CatalogItem>,
    pub appears_on: Vec<CatalogItem>,
    pub related_artists: Vec<CatalogItem>,
    pub gallery: Vec<String>,
    pub top_cities: Vec<ListenerCity>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerCity {
    pub name: String,
    pub country: String,
    pub listeners: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDetail {
    pub item: CatalogItem,
    pub description: String,
    pub owner: String,
    pub followers: Option<u64>,
    pub release_date: Option<String>,
    pub label: Option<String>,
    pub copyrights: Vec<String>,
    pub tracks: CatalogPage,
    pub more_albums: Vec<CatalogItem>,
}
