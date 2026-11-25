use crate::{
    pages::{
        library::covers,
        lyrics::{
            fonts::{CustomLyricsFont, UploadLyricsFontInput},
            models::LyricsCandidate,
        },
        playlist::commands::{import_spotify, sync_linked_playlists},
    },
    shared::{
        playback::MediaStateInput,
        playlists::models::*,
        services::AppServices,
        wave::{Feedback, Options, Profile, WaveService},
    },
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete as delete_route, get, post},
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
        .route("/playlists/import/spotify", post(create_with_import))
        .route("/library", get(library_index))
        .route("/library/memberships", post(track_memberships))
        .route("/library/memberships/bulk", post(bulk_track_memberships))
        .route("/library/collections", post(saved_collection))
        .route("/settings/storage", get(storage_usage).delete(clear_song_previews))
        .route("/playlists/{id}", get(detail).put(update).delete(delete))
        .route("/playlists/{id}/import/spotify", post(import))
        .route("/playlists/sync/spotify", post(sync_spotify))
        .route("/covers", post(upload))
        .route("/search/spotify", get(search_spotify))
        .route("/spotify/artists/{id}", get(spotify_artist))
        .route("/spotify/artists/{id}/releases", get(spotify_releases))
        .route("/spotify/albums/{id}", get(spotify_album))
        .route("/spotify/playlists/{id}", get(spotify_playlist))
        .route("/playback/resolve", post(prepare_track))
        .route("/playback/prefetch", post(prefetch_track))
        .route("/playback/background", post(background_playback))
        .route("/playback/media-state", post(media_state))
        .route("/wave/profile", get(wave_profile))
        .route("/wave/key", post(wave_key))
        .route("/wave/tracks", post(wave_tracks))
        .route("/wave/feedback", post(wave_feedback))
        .route("/lyrics", post(track_lyrics))
        .route("/lyrics/search", post(search_lyrics))
        .route("/lyrics/override", post(apply_lyrics_candidate).delete(clear_lyrics_override))
        .route("/lyrics/override/spotify", post(apply_spotify_lyrics))
        .route("/lyrics/fonts", get(list_lyrics_fonts).post(upload_lyrics_font))
        .route("/lyrics/fonts/{id}", delete_route(delete_lyrics_font))
        .layer(DefaultBodyLimit::max(24 * 1024 * 1024))
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
async fn library_index(State(services): State<AppServices>) -> ApiResult<LibraryIndex> {
    tokio::task::spawn_blocking(move || services.library.index()).await
        .map_err(|_| error("Не удалось прочитать библиотеку.".into()))?
        .map(Json).map_err(error)
}
async fn track_memberships(State(services): State<AppServices>, Json(edit): Json<TrackMembershipEdit>) -> ApiResult<LibraryIndex> {
    crate::pages::library::commands::edit_memberships(&services, edit).await.map(Json).map_err(error)
}
async fn bulk_track_memberships(State(services): State<AppServices>, Json(edit): Json<BulkMembershipEdit>) -> ApiResult<LibraryIndex> {
    crate::pages::library::commands::edit_bulk_memberships(&services, edit).await.map(Json).map_err(error)
}
async fn saved_collection(State(services): State<AppServices>, Json(edit): Json<CollectionEdit>) -> ApiResult<LibraryIndex> {
    crate::pages::library::commands::edit_collection(&services, edit).await.map(Json).map_err(error)
}
async fn storage_usage(State(services): State<AppServices>) -> ApiResult<crate::pages::settings::commands::StorageUsage> {
    crate::pages::settings::commands::storage_usage(&services, false).await.map(Json).map_err(error)
}
async fn clear_song_previews(State(services): State<AppServices>) -> ApiResult<crate::pages::settings::commands::StorageUsage> {
    crate::pages::settings::commands::storage_usage(&services, true).await.map(Json).map_err(error)
}

async fn wave_profile(State(services): State<AppServices>) -> ApiResult<Profile> {
    WaveService::profile(&services).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
struct WaveKey {
    key: String,
}

async fn wave_key(State(services): State<AppServices>, Json(input): Json<WaveKey>) -> ApiResult<()> {
    services.wave.set_api_key(input.key).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
struct WaveTracks {
    recent: Vec<String>,
    #[serde(default)]
    options: Options,
}

async fn wave_tracks(State(services): State<AppServices>, Json(input): Json<WaveTracks>) -> ApiResult<Vec<Track>> {
    WaveService::recommend(&services, input.recent, input.options).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaveFeedback {
    track_id: String,
    feedback: Feedback,
}

async fn wave_feedback(State(services): State<AppServices>, Json(input): Json<WaveFeedback>) -> ApiResult<()> {
    WaveService::feedback(&services, &input.track_id, input.feedback).await.map(Json).map_err(error)
}
async fn create(
    State(services): State<AppServices>,
    Json(draft): Json<PlaylistDraft>,
) -> ApiResult<Playlist> {
    services.library.create(draft).map(Json).map_err(error)
}
async fn create_with_import(State(services): State<AppServices>, Json(input): Json<crate::pages::playlist::commands::CreateSpotifyImport>) -> ApiResult<Playlist> {
    crate::pages::playlist::commands::create_with_spotify(&services, input).await.map(Json).map_err(error)
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
#[serde(rename_all = "camelCase")]
struct ImportBody {
    url: String,
    #[serde(default)]
    auto_sync: bool,
}
async fn import(
    State(services): State<AppServices>,
    Path(id): Path<String>,
    Json(body): Json<ImportBody>,
) -> ApiResult<ImportResult> {
    import_spotify(&services, &id, &body.url, body.auto_sync)
        .await
        .map(Json)
        .map_err(error)
}
async fn sync_spotify(State(services): State<AppServices>) -> ApiResult<bool> {
    sync_linked_playlists(&services).await.map(Json).map_err(error)
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

#[derive(Deserialize)]
struct LyricsSearchInput {
    query: String,
}

async fn search_lyrics(State(services): State<AppServices>, Json(input): Json<LyricsSearchInput>) -> ApiResult<Vec<LyricsCandidate>> {
    crate::pages::lyrics::commands::search_candidates(&services, &input.query).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyCandidateInput {
    playlist_id: String,
    track_id: String,
    candidate_id: String,
}

async fn apply_lyrics_candidate(State(services): State<AppServices>, Json(input): Json<ApplyCandidateInput>) -> ApiResult<crate::pages::lyrics::models::LyricsResponse> {
    crate::pages::lyrics::commands::apply_candidate(&services, &input.playlist_id, &input.track_id, &input.candidate_id).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplySpotifyLyricsInput {
    playlist_id: String,
    track_id: String,
    spotify_track_id: String,
}

async fn apply_spotify_lyrics(State(services): State<AppServices>, Json(input): Json<ApplySpotifyLyricsInput>) -> ApiResult<crate::pages::lyrics::models::LyricsResponse> {
    crate::pages::lyrics::commands::apply_spotify_track(&services, &input.playlist_id, &input.track_id, &input.spotify_track_id).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearOverrideInput {
    playlist_id: String,
    track_id: String,
}

async fn clear_lyrics_override(State(services): State<AppServices>, Json(input): Json<ClearOverrideInput>) -> ApiResult<crate::pages::lyrics::models::LyricsResponse> {
    crate::pages::lyrics::commands::clear_override(&services, &input.playlist_id, &input.track_id).await.map(Json).map_err(error)
}

async fn list_lyrics_fonts(State(services): State<AppServices>) -> ApiResult<Vec<CustomLyricsFont>> {
    crate::pages::lyrics::commands::list_fonts(&services).await.map(Json).map_err(error)
}

async fn upload_lyrics_font(State(services): State<AppServices>, Json(input): Json<UploadLyricsFontInput>) -> ApiResult<CustomLyricsFont> {
    crate::pages::lyrics::commands::upload_font(&services, input).await.map(Json).map_err(error)
}

async fn delete_lyrics_font(State(services): State<AppServices>, Path(id): Path<String>) -> ApiResult<()> {
    crate::pages::lyrics::commands::delete_font(&services, id).await.map(Json).map_err(error)
}

#[derive(Deserialize)]
struct BackgroundPlaybackBody {
    enabled: bool,
}

async fn background_playback(State(services): State<AppServices>, Json(input): Json<BackgroundPlaybackBody>) -> ApiResult<()> {
    services.playback.set_background_playback(input.enabled).await;
    Ok(Json(()))
}

async fn media_state(State(services): State<AppServices>, Json(input): Json<MediaStateInput>) -> ApiResult<()> {
    services.playback.sync_media_state(input).await;
    Ok(Json(()))
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
