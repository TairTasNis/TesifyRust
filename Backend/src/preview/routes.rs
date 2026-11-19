use crate::{
    pages::{library::covers, playlist::commands::import_spotify},
    shared::{playlists::models::*, services::AppServices},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<Value>)>;
fn error(message: String) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({"error":message})))
}

pub fn router(services: AppServices) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(json!({"ready":true})) }))
        .route("/playlists", get(list).post(create))
        .route("/playlists/{id}", get(detail).put(update).delete(delete))
        .route("/playlists/{id}/import/spotify", post(import))
        .route("/covers", post(upload))
        .route("/search/spotify", get(search_spotify))
        .route("/spotify/artists/{id}", get(spotify_artist))
        .route("/spotify/artists/{id}/releases", get(spotify_releases))
        .route("/spotify/albums/{id}", get(spotify_album))
        .route("/spotify/playlists/{id}", get(spotify_playlist))
        .route("/playback/resolve", post(prepare_track))
        .route("/playback/prefetch", post(prefetch_track))
        .route("/lyrics", post(track_lyrics))
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(middleware::from_fn(loopback_only))
        .with_state(services)
}

async fn loopback_only(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok());
    if !matches!(host, Some("127.0.0.1:17830" | "localhost:17830")) {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

async fn list(State(services): State<AppServices>) -> ApiResult<Vec<PlaylistSummary>> {
    services.library.list().map(Json).map_err(error)
}
async fn create(
    State(services): State<AppServices>,
    Json(draft): Json<PlaylistDraft>,
) -> ApiResult<Playlist> {
    services.library.create(draft).map(Json).map_err(error)
}
async fn detail(
    State(services): State<AppServices>,
    Path(id): Path<String>,
) -> ApiResult<Playlist> {
    services.library.get(&id).map(Json).map_err(error)
}
async fn update(
    State(services): State<AppServices>,
    Path(id): Path<String>,
    Json(draft): Json<PlaylistDraft>,
) -> ApiResult<Playlist> {
    services.library.update(&id, draft).map(Json).map_err(error)
}
async fn delete(State(services): State<AppServices>, Path(id): Path<String>) -> ApiResult<()> {
    services.library.delete(&id).map(Json).map_err(error)
}
#[derive(Deserialize)]
struct ImportBody {
    url: String,
}
async fn import(
    State(services): State<AppServices>,
    Path(id): Path<String>,
    Json(body): Json<ImportBody>,
) -> ApiResult<ImportResult> {
    import_spotify(&services, &id, &body.url)
        .await
        .map(Json)
        .map_err(error)
}
async fn upload(
    State(services): State<AppServices>,
    Json(input): Json<CoverUpload>,
) -> ApiResult<UploadedCover> {
    covers::upload_cover(&services, input)
        .await
        .map(Json)
        .map_err(error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackInput {
    playlist_id: String,
    track_id: String,
    #[serde(default)]
    source: Option<String>,
}

async fn track_lyrics(State(services): State<AppServices>, Json(input): Json<PlaybackInput>) -> ApiResult<crate::pages::lyrics::models::LyricsResponse> {
    crate::pages::lyrics::commands::get(&services, &input.playlist_id, &input.track_id, input.source.as_deref()).await.map(Json).map_err(error)
}

async fn prepare_track(
    State(services): State<AppServices>,
    Json(input): Json<PlaybackInput>,
) -> ApiResult<crate::shared::playback::PlaybackSource> {
    crate::shared::playback::commands::prepare(&services, &input.playlist_id, &input.track_id)
        .await
        .map(Json)
        .map_err(error)
}

async fn prefetch_track(
    State(services): State<AppServices>,
    Json(input): Json<PlaybackInput>,
) -> ApiResult<crate::shared::playback::PlaybackSource> {
    crate::shared::playback::commands::prefetch(&services, &input.playlist_id, &input.track_id)
        .await
        .map(Json)
        .map_err(error)
}

#[derive(Deserialize)]
struct CatalogQuery {
    #[serde(default)] q: String,
    #[serde(default = "all")] category: String,
    #[serde(default = "all")] kind: String,
    #[serde(default)] offset: u64,
    #[serde(default = "page_limit")] limit: u64,
}
fn all() -> String { "all".into() }
fn page_limit() -> u64 { 50 }
async fn search_spotify(State(services): State<AppServices>, Query(query): Query<CatalogQuery>) -> ApiResult<crate::shared::spotify::models::SearchResults> {
    crate::pages::search::service::search(&services.spotify, &query.q, &query.category, query.offset, query.limit).await.map(Json).map_err(error)
}
async fn spotify_artist(State(services): State<AppServices>, Path(id): Path<String>) -> ApiResult<crate::shared::spotify::models::ArtistDetail> {
    crate::pages::artist::service::detail(&services.spotify, &id).await.map(Json).map_err(error)
}
async fn spotify_releases(State(services): State<AppServices>, Path(id): Path<String>, Query(query): Query<CatalogQuery>) -> ApiResult<crate::shared::spotify::models::CatalogPage> {
    crate::pages::artist::service::releases(&services.spotify, &id, &query.kind, query.offset, query.limit).await.map(Json).map_err(error)
}
async fn spotify_album(State(services): State<AppServices>, Path(id): Path<String>, Query(query): Query<CatalogQuery>) -> ApiResult<crate::shared::spotify::models::CollectionDetail> {
    crate::pages::album::service::detail(&services.spotify, &id, query.offset, query.limit).await.map(Json).map_err(error)
}
async fn spotify_playlist(State(services): State<AppServices>, Path(id): Path<String>, Query(query): Query<CatalogQuery>) -> ApiResult<crate::shared::spotify::models::CollectionDetail> {
    crate::pages::spotify_playlist::service::detail(&services.spotify, &id, query.offset, query.limit).await.map(Json).map_err(error)
}
