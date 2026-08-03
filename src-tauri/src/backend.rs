use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Local, Utc};
use parking_lot::Mutex;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    env,
    error::Error,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{fs, net::TcpListener, process::Command, time::timeout};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use urlencoding::encode;

#[path = "search.rs"]
mod spotify_search;
use spotify_search::SpotifyGuestClient;

const DEFAULT_PORT: u16 = 8000;
const DEFAULT_DOWNLOAD_DIR: &str = "downloads";
const YT_DLP_TIMEOUT_SECS: u64 = 90;
const YT_DLP_DOWNLOAD_TIMEOUT_SECS: u64 = 600;
const SPOTIFY_PLAYLIST_HASH: &str =
    "9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f";

type BackendResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone)]
struct BackendState {
    inner: Arc<BackendInner>,
}

struct BackendInner {
    root_dir: PathBuf,
    data_dir: PathBuf,
    config_file: PathBuf,
    download_dir: Mutex<PathBuf>,
    start_time: Instant,
    last_ping_time: Mutex<Instant>,
    logs: Mutex<VecDeque<LogEntry>>,
    stream_url_cache: Mutex<HashMap<String, String>>,
    http: Client,
    yt_dlp: YtDlpRunner,
}

#[derive(Clone, Debug)]
enum YtDlpRunner {
    Program(PathBuf),
    ProgramName(String),
    PythonModule(PathBuf),
}

#[derive(Clone, Serialize)]
struct LogEntry {
    time: String,
    level: String,
    msg: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct AppConfig {
    #[serde(default = "default_download_dir")]
    download_dir: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(Deserialize)]
struct TranslateQuery {
    text: String,
    target: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyQuery {
    url: String,
}

#[derive(Deserialize)]
struct StreamQuery {
    id: String,
    mode: Option<String>,
}

#[derive(Deserialize)]
struct ProxyQuery {
    id: String,
    retry: Option<String>,
}

#[derive(Deserialize)]
struct DownloadQuery {
    url: String,
}

#[derive(Deserialize)]
struct LogsQuery {
    n: Option<usize>,
}

#[derive(Deserialize)]
struct DownloadDirReq {
    path: String,
}

#[derive(Serialize)]
struct SearchResult {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    duration: Option<i64>,
    thumbnail: Option<String>,
}

#[derive(Serialize)]
struct SpotifyTrack {
    id: String,
    title: String,
    artist: String,
    thumbnail: String,
    url: String,
    #[serde(rename = "spotifyId")]
    spotify_id: String,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    duration_ms: Option<i64>,
    #[serde(rename = "addedAt", skip_serializing_if = "Option::is_none")]
    added_at: Option<i64>,
}

impl BackendState {
    fn new() -> BackendResult<Self> {
        dotenvy::dotenv().ok();
        dotenvy::from_filename(".env.local").ok();

        let root_dir = env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .unwrap_or_else(|| env::current_dir().unwrap_or_default());
        let data_dir = env::var("TESIFY_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| default_data_dir());
        std::fs::create_dir_all(&data_dir)?;

        let config_file = env::var("TESIFY_CONFIG_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("tesify_config.json"));
        let config = load_config(&config_file);
        let download_dir = resolve_path(&data_dir, &config.download_dir);
        ensure_dir_or_fallback(&download_dir, &data_dir.join(DEFAULT_DOWNLOAD_DIR))?;

        let http = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tesify/1.2.3")
            .timeout(Duration::from_secs(45))
            .build()?;

        let state = Self {
            inner: Arc::new(BackendInner {
                yt_dlp: resolve_yt_dlp(&root_dir),
                root_dir,
                data_dir,
                config_file,
                download_dir: Mutex::new(download_dir),
                start_time: Instant::now(),
                last_ping_time: Mutex::new(Instant::now()),
                logs: Mutex::new(VecDeque::with_capacity(500)),
                stream_url_cache: Mutex::new(HashMap::new()),
                http,
            }),
        };
        state.log("INFO", "Rust backend initialized");
        state.log("INFO", format!("yt-dlp runner: {:?}", state.inner.yt_dlp));
        Ok(state)
    }

    fn log(&self, level: impl Into<String>, msg: impl Into<String>) {
        let mut logs = self.inner.logs.lock();
        if logs.len() >= 500 {
            logs.pop_front();
        }
        logs.push_back(LogEntry {
            time: Local::now().format("%H:%M:%S").to_string(),
            level: level.into(),
            msg: msg.into(),
        });
    }

    fn download_dir(&self) -> PathBuf {
        self.inner.download_dir.lock().clone()
    }
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(json!({ "detail": self.message }));
        (self.status, body).into_response()
    }
}

pub async fn run_backend() -> BackendResult<()> {
    let state = BackendState::new()?;
    let port = env::var("TESIFY_BACKEND_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;
    state.log(
        "INFO",
        format!(
            "Rust backend listening on http://{}",
            listener.local_addr()?
        ),
    );

    axum::serve(listener, router(state)).await?;
    Ok(())
}

fn router(state: BackendState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    Router::new()
        .route("/", get(root))
        .route("/api/health", get(health))
        .route("/api/shutdown", post(shutdown))
        .route("/api/server-status", get(server_status))
        .route("/api/logs", get(logs))
        .route("/search", get(search_youtube))
        .route("/api/search/spotify", get(search_spotify))
        .route("/api/translate", get(translate_text))
        .route("/api/spotify", get(extract_spotify))
        .route("/stream", get(stream_url))
        .route("/proxy_stream", get(proxy_stream))
        .route("/local_files/{filename}", get(serve_local_file))
        .route("/files/{filename}", get(serve_local_file))
        .route("/api/info", get(system_info))
        .route("/api/settings/download_dir", post(set_download_dir))
        .route("/api/settings/downloads", get(downloads_list))
        .route(
            "/api/settings/downloads/{filename}",
            delete(delete_download),
        )
        .route("/api/settings/downloads_all", delete(delete_all_downloads))
        .route("/download", get(download_audio))
        .with_state(state)
        .layer(cors)
}

async fn root() -> Json<Value> {
    Json(json!({ "message": "Tesify Rust backend is running" }))
}

async fn health(State(state): State<BackendState>) -> Json<Value> {
    *state.inner.last_ping_time.lock() = Instant::now();
    Json(json!({ "status": "ok" }))
}

async fn shutdown(State(state): State<BackendState>) -> Json<Value> {
    state.log(
        "INFO",
        "Shutdown request ignored: Tauri owns the app lifecycle",
    );
    Json(json!({ "status": "ignored" }))
}

async fn server_status(State(state): State<BackendState>) -> Json<Value> {
    let uptime = state.inner.start_time.elapsed().as_secs();
    let h = uptime / 3600;
    let m = (uptime % 3600) / 60;
    let s = uptime % 60;
    let last_ping_ago = {
        let elapsed = state.inner.last_ping_time.lock().elapsed().as_secs_f64();
        (elapsed * 10.0).round() / 10.0
    };

    Json(json!({
        "status": "online",
        "uptime_seconds": uptime,
        "uptime_str": format!("{h:02}:{m:02}:{s:02}"),
        "last_ping_ago": last_ping_ago,
        "pid": std::process::id()
    }))
}

async fn logs(State(state): State<BackendState>, Query(query): Query<LogsQuery>) -> Json<Value> {
    let n = query.n.unwrap_or(100);
    let logs = state.inner.logs.lock();
    let total = logs.len();
    let start = total.saturating_sub(n);
    let selected: Vec<LogEntry> = logs.iter().skip(start).cloned().collect();
    Json(json!({ "logs": selected, "total": total }))
}

async fn search_youtube(
    State(state): State<BackendState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    let q = query.q.trim();
    if q.is_empty() {
        return Err(ApiError::bad_request("Empty search query"));
    }

    let search_query = if is_url(q) {
        q.to_string()
    } else {
        format!("ytsearch10:{q}")
    };

    let info = ytdlp_json(
        &state,
        &[
            "--dump-single-json",
            "--skip-download",
            "--flat-playlist",
            "--no-warnings",
            "--quiet",
            &search_query,
        ],
        YT_DLP_TIMEOUT_SECS,
    )
    .await?;

    let entries: Vec<Value> = if is_url(q) && info.get("entries").is_none() {
        vec![info]
    } else {
        info.get("entries")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };

    let results: Vec<SearchResult> = entries
        .iter()
        .filter_map(search_result_from_value)
        .collect();
    Ok(Json(json!({ "results": results })))
}

async fn search_spotify(Query(query): Query<SearchQuery>) -> Result<Json<Value>, ApiError> {
    let q = query.q.trim();
    if q.is_empty() {
        return Err(ApiError::bad_request("Empty search query"));
    }

    let spotify = SpotifyGuestClient::new();
    let auth = spotify
        .fetch_guest_auth()
        .await
        .map_err(|e| ApiError::internal(format!("Spotify auth failed: {e}")))?;
    let results = spotify
        .search(&auth, q)
        .await
        .map_err(|e| ApiError::internal(format!("Spotify search failed: {e}")))?;

    Ok(Json(json!({ "results": results })))
}
async fn translate_text(
    State(state): State<BackendState>,
    Query(query): Query<TranslateQuery>,
) -> Result<Json<Value>, ApiError> {
    let text = query.text;
    let target = query.target.unwrap_or_else(|| "ru".to_string());
    let source = query.source.unwrap_or_else(|| "auto".to_string());
    let mut translated = Vec::new();

    for chunk in chunk_text(&text, 4_900) {
        translated.push(translate_chunk(&state.inner.http, &chunk, &source, &target).await?);
    }

    Ok(Json(
        json!({ "translatedText": translated.join(" ").trim() }),
    ))
}

async fn extract_spotify(
    State(state): State<BackendState>,
    Query(query): Query<SpotifyQuery>,
) -> Result<Json<Value>, ApiError> {
    let re = Regex::new(r"(playlist|album|track)/([a-zA-Z0-9]+)").expect("valid regex");
    let caps = re
        .captures(&query.url)
        .ok_or_else(|| ApiError::bad_request("Invalid Spotify URL"))?;
    let spotify_type = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
    let spotify_id = caps.get(2).map(|m| m.as_str()).unwrap_or_default();

    let tracks = if spotify_type == "playlist" {
        extract_spotify_playlist(&state, spotify_id).await?
    } else {
        extract_spotify_embed(&state, spotify_type, spotify_id).await?
    };

    Ok(Json(json!({ "tracks": tracks })))
}

async fn stream_url(
    State(state): State<BackendState>,
    Query(query): Query<StreamQuery>,
) -> Result<Json<Value>, ApiError> {
    let mode = query.mode.unwrap_or_else(|| "stream".to_string());
    let filename = format!("{}.mp3", query.id);
    let local_path = state.download_dir().join(&filename);

    if mode == "download" && local_path.exists() {
        return Ok(Json(json!({
            "url": format!("http://127.0.0.1:{DEFAULT_PORT}/local_files/{filename}")
        })));
    }

    let direct_url = extract_direct_stream_url(&state, &query.id).await?;
    state
        .inner
        .stream_url_cache
        .lock()
        .insert(query.id.clone(), direct_url);

    if mode == "download" {
        let id = query.id.clone();
        let state_clone = state.clone();
        tokio::spawn(async move {
            if let Err(err) = download_audio_to_dir(&state_clone, &id).await {
                state_clone.log(
                    "ERROR",
                    format!("Background download error: {}", err.message),
                );
            }
        });
    }

    Ok(Json(json!({
        "url": format!("http://127.0.0.1:{DEFAULT_PORT}/proxy_stream?id={}", query.id)
    })))
}

async fn proxy_stream(
    State(state): State<BackendState>,
    headers: HeaderMap,
    Query(query): Query<ProxyQuery>,
) -> Result<Response, ApiError> {
    let mut stream_url = state.inner.stream_url_cache.lock().get(&query.id).cloned();

    if stream_url.is_none() || query.retry.is_some() {
        stream_url = Some(refresh_stream_url(&state, &query.id).await?);
    }

    let mut resp =
        request_upstream_stream(&state, stream_url.as_deref().unwrap(), &headers).await?;
    if !resp.status().is_success() {
        let fresh_url = refresh_stream_url(&state, &query.id).await?;
        resp = request_upstream_stream(&state, &fresh_url, &headers).await?;
        if !resp.status().is_success() {
            return Err(ApiError::internal("Upstream returned error"));
        }
    }

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
    let upstream_headers = resp.headers().clone();
    let mut response = Response::new(Body::from_stream(resp.bytes_stream()));
    *response.status_mut() = status;

    copy_header(
        &upstream_headers,
        response.headers_mut(),
        "content-type",
        header::CONTENT_TYPE,
    );
    copy_header(
        &upstream_headers,
        response.headers_mut(),
        "content-length",
        header::CONTENT_LENGTH,
    );
    copy_header(
        &upstream_headers,
        response.headers_mut(),
        "content-range",
        header::CONTENT_RANGE,
    );
    copy_header(
        &upstream_headers,
        response.headers_mut(),
        "accept-ranges",
        header::ACCEPT_RANGES,
    );

    if !response.headers().contains_key(header::CONTENT_TYPE) {
        response
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
    }

    Ok(response)
}

async fn serve_local_file(
    State(state): State<BackendState>,
    AxumPath(filename): AxumPath<String>,
) -> Result<Response, ApiError> {
    let filename = safe_filename(&filename)?;
    let path = state.download_dir().join(filename);
    serve_file(path).await
}

async fn system_info(State(state): State<BackendState>) -> Json<Value> {
    let install_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| state.inner.root_dir.clone());

    Json(json!({
        "version": "Release 1.0",
        "install_dir": install_dir.to_string_lossy(),
        "data_dir": state.inner.data_dir.to_string_lossy(),
        "download_dir": state.download_dir().to_string_lossy()
    }))
}

async fn set_download_dir(
    State(state): State<BackendState>,
    Json(req): Json<DownloadDirReq>,
) -> Result<Json<Value>, ApiError> {
    let requested = req.path.trim();
    if requested.is_empty() {
        return Err(ApiError::bad_request("Download directory path is empty"));
    }

    let dir = resolve_path(&state.inner.data_dir, requested);
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| ApiError::internal(format!("Cannot create download directory: {e}")))?;

    *state.inner.download_dir.lock() = dir.clone();
    save_config(
        &state.inner.config_file,
        &AppConfig {
            download_dir: requested.to_string(),
        },
    )
    .await?;

    Ok(Json(json!({
        "status": "success",
        "download_dir": requested
    })))
}

async fn downloads_list(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let dir = state.download_dir();
    let mut files = Vec::new();
    let mut total_size = 0_u64;

    if dir.exists() {
        let mut entries = fs::read_dir(&dir)
            .await
            .map_err(|e| ApiError::internal(format!("Cannot read downloads directory: {e}")))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| ApiError::internal(format!("Cannot read downloads entry: {e}")))?
        {
            let meta = entry
                .metadata()
                .await
                .map_err(|e| ApiError::internal(format!("Cannot read file metadata: {e}")))?;
            if meta.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                let size = meta.len();
                total_size += size;
                files.push(json!({ "name": name, "size": size }));
            }
        }
    }

    files.sort_by(|a, b| {
        a.get("name")
            .and_then(Value::as_str)
            .cmp(&b.get("name").and_then(Value::as_str))
    });

    Ok(Json(json!({
        "files": files,
        "total_size_bytes": total_size,
        "dir": dir.to_string_lossy()
    })))
}

async fn delete_download(
    State(state): State<BackendState>,
    AxumPath(filename): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    let filename = safe_filename(&filename)?;
    let path = state.download_dir().join(filename);
    if path.exists() {
        fs::remove_file(path)
            .await
            .map_err(|e| ApiError::internal(format!("Cannot delete file: {e}")))?;
        Ok(Json(json!({ "status": "success" })))
    } else {
        Err(ApiError::not_found("File not found"))
    }
}

async fn delete_all_downloads(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let dir = state.download_dir();
    if dir.exists() {
        let mut entries = fs::read_dir(&dir)
            .await
            .map_err(|e| ApiError::internal(format!("Cannot read downloads directory: {e}")))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| ApiError::internal(format!("Cannot read downloads entry: {e}")))?
        {
            let path = entry.path();
            let is_mp3 = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("mp3"))
                .unwrap_or(false);
            if is_mp3 {
                let _ = fs::remove_file(path).await;
            }
        }
    }

    Ok(Json(json!({ "status": "success" })))
}

async fn download_audio(
    State(state): State<BackendState>,
    Query(query): Query<DownloadQuery>,
) -> Result<Json<Value>, ApiError> {
    let info = ytdlp_info(&state, &query.url).await?;
    let title = string_at(&info, &["title"]).unwrap_or_else(|| "Unknown".to_string());
    let video_id =
        string_at(&info, &["id"]).ok_or_else(|| ApiError::internal("Missing media id"))?;

    download_audio_to_dir(&state, &query.url).await?;

    Ok(Json(json!({
        "status": "success",
        "title": title,
        "filename": format!("{video_id}.mp3")
    })))
}

async fn extract_spotify_playlist(
    state: &BackendState,
    spotify_id: &str,
) -> Result<Vec<SpotifyTrack>, ApiError> {
    let html = state
        .inner
        .http
        .get("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M")
        .send()
        .await
        .map_err(|e| ApiError::internal(format!("Spotify token request failed: {e}")))?
        .text()
        .await
        .map_err(|e| ApiError::internal(format!("Spotify token HTML failed: {e}")))?;

    let token_re = Regex::new(r#""accessToken":"([^"]+)""#).expect("valid regex");
    let token = token_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| ApiError::internal("Could not retrieve Spotify token"))?;

    let mut tracks = Vec::new();
    let mut offset = 0_i64;
    let limit = 100_i64;

    loop {
        let vars_json = json!({
            "uri": format!("spotify:playlist:{spotify_id}"),
            "offset": offset,
            "limit": limit,
            "enableWatchFeedEntrypoint": false
        })
        .to_string();
        let exts_json = json!({
            "persistedQuery": {
                "version": 1,
                "sha256Hash": SPOTIFY_PLAYLIST_HASH
            }
        })
        .to_string();
        let api_url = format!(
            "https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylist&variables={}&extensions={}",
            encode(&vars_json),
            encode(&exts_json)
        );

        let resp = state
            .inner
            .http
            .get(api_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| ApiError::internal(format!("Spotify playlist request failed: {e}")))?;

        if !resp.status().is_success() {
            break;
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| ApiError::internal(format!("Spotify playlist JSON failed: {e}")))?;
        let items = data
            .pointer("/data/playlistV2/content/items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if items.is_empty() {
            break;
        }

        for track_wrapper in items {
            if let Some(track) = spotify_playlist_track_from_item(&track_wrapper) {
                tracks.push(track);
            }
        }

        let total = data
            .pointer("/data/playlistV2/content/totalCount")
            .and_then(as_i64)
            .unwrap_or(0);
        offset += limit;
        if offset >= total {
            break;
        }
    }

    Ok(tracks)
}

async fn extract_spotify_embed(
    state: &BackendState,
    spotify_type: &str,
    spotify_id: &str,
) -> Result<Vec<SpotifyTrack>, ApiError> {
    let embed_url = format!("https://open.spotify.com/embed/{spotify_type}/{spotify_id}");
    let resp = state
        .inner
        .http
        .get(embed_url)
        .send()
        .await
        .map_err(|e| ApiError::internal(format!("Spotify embed request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(ApiError::new(
            StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            "Spotify block / Not Found",
        ));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| ApiError::internal(format!("Spotify embed HTML failed: {e}")))?;
    let script_re =
        Regex::new(r#"(?s)<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#)
            .expect("valid regex");
    let json_text = script_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .ok_or_else(|| ApiError::internal("No data found in embed"))?;
    let data: Value = serde_json::from_str(json_text)
        .map_err(|e| ApiError::internal(format!("Spotify JSON failed: {e}")))?;
    let entity = data
        .pointer("/props/pageProps/state/data/entity")
        .ok_or_else(|| ApiError::internal("Spotify entity missing"))?;

    if spotify_type == "album" {
        let fallback_cover = spotify_cover_from_entity(entity);
        let mut tracks = Vec::new();
        let track_list = entity
            .get("trackList")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for track in track_list {
            let uri = string_at(&track, &["uri"]).unwrap_or_default();
            let track_id = spotify_id_from_uri(&uri);
            let cover = fetch_track_cover(&state.inner.http, &track_id, &fallback_cover).await;
            tracks.push(SpotifyTrack {
                id: format!("spotify-{track_id}"),
                title: string_at(&track, &["title"]).unwrap_or_default(),
                artist: string_at(&track, &["subtitle"]).unwrap_or_default(),
                thumbnail: cover,
                url: String::new(),
                spotify_id: track_id,
                duration_ms: track.get("duration").and_then(as_i64),
                added_at: None,
            });
        }
        Ok(tracks)
    } else {
        let id = string_at(entity, &["id"]).unwrap_or_else(|| spotify_id.to_string());
        let artist = entity
            .get("artists")
            .and_then(Value::as_array)
            .map(|artists| {
                artists
                    .iter()
                    .filter_map(|a| string_at(a, &["name"]))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|s| !s.is_empty())
            .or_else(|| string_at(entity, &["subtitle"]))
            .unwrap_or_default();

        Ok(vec![SpotifyTrack {
            id: format!("spotify-{id}"),
            title: string_at(entity, &["title"]).unwrap_or_default(),
            artist,
            thumbnail: spotify_cover_from_entity(entity),
            url: String::new(),
            spotify_id: id,
            duration_ms: entity.get("duration").and_then(as_i64),
            added_at: None,
        }])
    }
}

fn spotify_playlist_track_from_item(track_wrapper: &Value) -> Option<SpotifyTrack> {
    let t_data = track_wrapper.pointer("/itemV2/data")?;
    if t_data.get("__typename").and_then(Value::as_str) != Some("Track") {
        return None;
    }

    let uri = string_at(t_data, &["uri"]).unwrap_or_default();
    let track_id = spotify_id_from_uri(&uri);
    let artists = t_data
        .pointer("/artists/items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|a| a.pointer("/profile/name").and_then(Value::as_str))
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let cover = t_data
        .pointer("/albumOfTrack/coverArt/sources")
        .and_then(Value::as_array)
        .and_then(|sources| sources.first())
        .and_then(|v| v.get("url"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let added_at = track_wrapper
        .pointer("/addedAt/isoString")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc).timestamp_millis());
    let duration_ms = t_data
        .pointer("/playcast/durationMs")
        .and_then(as_i64)
        .or_else(|| {
            t_data
                .pointer("/duration/totalMilliseconds")
                .and_then(as_i64)
        })
        .or_else(|| {
            t_data
                .pointer("/trackDuration/totalMilliseconds")
                .and_then(as_i64)
        });

    Some(SpotifyTrack {
        id: format!("spotify-{track_id}"),
        title: string_at(t_data, &["name"]).unwrap_or_default(),
        artist: artists.join(", "),
        thumbnail: cover,
        url: String::new(),
        spotify_id: track_id,
        duration_ms,
        added_at,
    })
}

async fn fetch_track_cover(client: &Client, track_id: &str, fallback: &str) -> String {
    let url = format!("https://open.spotify.com/oembed?url=spotify:track:{track_id}");
    match client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(data) => data
                .get("thumbnail_url")
                .and_then(Value::as_str)
                .unwrap_or(fallback)
                .to_string(),
            Err(_) => fallback.to_string(),
        },
        _ => fallback.to_string(),
    }
}

async fn translate_chunk(
    client: &Client,
    text: &str,
    source: &str,
    target: &str,
) -> Result<String, ApiError> {
    let data: Value = client
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&[
            ("client", "gtx"),
            ("sl", source),
            ("tl", target),
            ("dt", "t"),
            ("q", text),
        ])
        .send()
        .await
        .map_err(|e| ApiError::internal(format!("Translation request failed: {e}")))?
        .error_for_status()
        .map_err(|e| ApiError::internal(format!("Translation service returned error: {e}")))?
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("Translation JSON failed: {e}")))?;

    let translated = data
        .get(0)
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get(0).and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default();

    if translated.is_empty() {
        Err(ApiError::internal("Translation response was empty"))
    } else {
        Ok(translated)
    }
}

async fn extract_direct_stream_url(
    state: &BackendState,
    id_or_url: &str,
) -> Result<String, ApiError> {
    let input = normalize_media_input(id_or_url);
    let info = ytdlp_json(
        state,
        &[
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            "--format",
            "bestaudio/best",
            "--no-warnings",
            "--quiet",
            &input,
        ],
        YT_DLP_TIMEOUT_SECS,
    )
    .await?;

    direct_url_from_info(&info).ok_or_else(|| ApiError::internal("Stream URL not found"))
}

async fn refresh_stream_url(state: &BackendState, id: &str) -> Result<String, ApiError> {
    let fresh = extract_direct_stream_url(state, id).await?;
    state
        .inner
        .stream_url_cache
        .lock()
        .insert(id.to_string(), fresh.clone());
    Ok(fresh)
}

async fn request_upstream_stream(
    state: &BackendState,
    url: &str,
    incoming_headers: &HeaderMap,
) -> Result<reqwest::Response, ApiError> {
    let mut request = state.inner.http.get(url);
    if let Some(range) = incoming_headers.get(header::RANGE) {
        request = request.header(reqwest::header::RANGE, range.clone());
    }
    request
        .send()
        .await
        .map_err(|_| ApiError::internal("Cannot connect to stream"))
}

async fn ytdlp_info(state: &BackendState, input: &str) -> Result<Value, ApiError> {
    let input = normalize_media_input(input);
    ytdlp_json(
        state,
        &[
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            "--format",
            "bestaudio/best",
            "--no-warnings",
            "--quiet",
            &input,
        ],
        YT_DLP_TIMEOUT_SECS,
    )
    .await
}

async fn download_audio_to_dir(state: &BackendState, input: &str) -> Result<(), ApiError> {
    let input = normalize_media_input(input);
    let outtmpl = state.download_dir().join("%(id)s.%(ext)s");
    let outtmpl = outtmpl.to_string_lossy().to_string();

    ytdlp_status(
        state,
        &[
            "--no-playlist",
            "--format",
            "bestaudio/best",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "192K",
            "--no-warnings",
            "--output",
            &outtmpl,
            &input,
        ],
        YT_DLP_DOWNLOAD_TIMEOUT_SECS,
    )
    .await
}

async fn ytdlp_json(
    state: &BackendState,
    args: &[&str],
    timeout_secs: u64,
) -> Result<Value, ApiError> {
    let output = ytdlp_output(state, args, timeout_secs).await?;
    parse_json_output(&output.stdout)
}

async fn ytdlp_status(
    state: &BackendState,
    args: &[&str],
    timeout_secs: u64,
) -> Result<(), ApiError> {
    let _ = ytdlp_output(state, args, timeout_secs).await?;
    Ok(())
}

async fn ytdlp_output(
    state: &BackendState,
    args: &[&str],
    timeout_secs: u64,
) -> Result<std::process::Output, ApiError> {
    let mut cmd = make_ytdlp_command(&state.inner.yt_dlp);
    cmd.current_dir(&state.inner.data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    add_tool_env(&mut cmd, &state.inner.root_dir, &state.inner.yt_dlp);
    hide_console_window(&mut cmd);
    for arg in args {
        cmd.arg(arg);
    }

    let output = timeout(Duration::from_secs(timeout_secs), cmd.output())
        .await
        .map_err(|_| ApiError::internal("yt-dlp timed out"))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ApiError::internal(
                    "yt-dlp was not found. Set YT_DLP_PATH or keep .venv\\Scripts\\yt-dlp.exe.",
                )
            } else {
                ApiError::internal(format!("yt-dlp failed to start: {e}"))
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let details = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(ApiError::internal(format!("yt-dlp error: {details}")));
    }

    Ok(output)
}

fn make_ytdlp_command(runner: &YtDlpRunner) -> Command {
    match runner {
        YtDlpRunner::Program(path) => Command::new(path),
        YtDlpRunner::ProgramName(name) => Command::new(name),
        YtDlpRunner::PythonModule(python) => {
            let mut cmd = Command::new(python);
            cmd.arg("-m").arg("yt_dlp");
            cmd
        }
    }
}

#[cfg(windows)]
fn hide_console_window(cmd: &mut Command) {
    cmd.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console_window(_cmd: &mut Command) {}

fn resolve_yt_dlp(root_dir: &Path) -> YtDlpRunner {
    if let Ok(path) = env::var("YT_DLP_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return YtDlpRunner::Program(path);
        }
    }

    for candidate in yt_dlp_candidates(root_dir) {
        if candidate.exists() {
            return YtDlpRunner::Program(candidate);
        }
    }

    if let Ok(path) = env::var("YT_DLP_PYTHON") {
        let path = PathBuf::from(path);
        if path.exists() {
            return YtDlpRunner::PythonModule(path);
        }
    }

    let venv_python = root_dir
        .join(".venv")
        .join(if cfg!(windows) { "Scripts" } else { "bin" })
        .join(exe_name("python"));
    if venv_python.exists() {
        return YtDlpRunner::PythonModule(venv_python);
    }

    YtDlpRunner::ProgramName("yt-dlp".to_string())
}

fn yt_dlp_candidates(root_dir: &Path) -> Vec<PathBuf> {
    let exe = exe_name("yt-dlp");
    let script_dir = if cfg!(windows) { "Scripts" } else { "bin" };
    let mut candidates = vec![
        root_dir.join(&exe),
        root_dir.join("_up_").join("tools").join(&exe),
        root_dir
            .join("resources")
            .join("_up_")
            .join("tools")
            .join(&exe),
        root_dir.join("resources").join("tools").join(&exe),
        root_dir.join("tools").join(&exe),
        root_dir.join("bin").join(&exe),
        root_dir
            .join("_up_")
            .join(".venv")
            .join(script_dir)
            .join(&exe),
        root_dir.join(".venv").join(script_dir).join(&exe),
    ];

    for ancestor in root_dir.ancestors().take(5) {
        candidates.push(ancestor.join("tools").join(&exe));
        candidates.push(ancestor.join(".venv").join(script_dir).join(&exe));
    }

    candidates
}

fn add_tool_env(cmd: &mut Command, root_dir: &Path, runner: &YtDlpRunner) {
    let tool_dirs = tool_env_dirs(root_dir, runner);
    if tool_dirs.is_empty() {
        return;
    }

    let mut paths = tool_dirs.clone();
    if let Some(existing) = env::var_os("PATH") {
        paths.extend(env::split_paths(&existing));
    }
    if let Ok(joined) = env::join_paths(paths) {
        cmd.env("PATH", joined);
    }

    let ffmpeg = exe_name("ffmpeg");
    let ffmpeg_dir = tool_dirs
        .iter()
        .find(|dir| dir.join(&ffmpeg).exists())
        .or_else(|| tool_dirs.first());
    if let Some(dir) = ffmpeg_dir {
        cmd.env("FFMPEG_LOCATION", dir);
    }
}

fn tool_env_dirs(root_dir: &Path, runner: &YtDlpRunner) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = runner_tool_dir(runner) {
        dirs.push(dir);
    }
    dirs.push(root_dir.join("_up_").join("tools"));
    dirs.push(root_dir.join("resources").join("_up_").join("tools"));
    dirs.push(root_dir.join("resources").join("tools"));
    dirs.push(root_dir.join("tools"));

    for ancestor in root_dir.ancestors().take(5) {
        dirs.push(ancestor.join("tools"));
    }

    let mut existing = Vec::new();
    for dir in dirs {
        if dir.exists() && !existing.iter().any(|seen| seen == &dir) {
            existing.push(dir);
        }
    }
    existing
}

fn runner_tool_dir(runner: &YtDlpRunner) -> Option<PathBuf> {
    match runner {
        YtDlpRunner::Program(path) | YtDlpRunner::PythonModule(path) => {
            path.parent().map(Path::to_path_buf)
        }
        YtDlpRunner::ProgramName(_) => None,
    }
}

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn parse_json_output(stdout: &[u8]) -> Result<Value, ApiError> {
    let text = String::from_utf8_lossy(stdout);
    let trimmed = text.trim();
    serde_json::from_str(trimmed).or_else(|_| {
        let start = trimmed
            .find('{')
            .ok_or_else(|| ApiError::internal("yt-dlp produced no JSON"))?;
        serde_json::from_str(&trimmed[start..])
            .map_err(|e| ApiError::internal(format!("Cannot parse yt-dlp JSON: {e}")))
    })
}

fn search_result_from_value(value: &Value) -> Option<SearchResult> {
    if value.is_null() {
        return None;
    }
    let thumbnail = value
        .get("thumbnails")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|v| v.get("url"))
        .and_then(Value::as_str)
        .or_else(|| value.get("thumbnail").and_then(Value::as_str))
        .map(ToString::to_string);

    Some(SearchResult {
        id: string_at(value, &["id"]),
        title: string_at(value, &["title"]),
        uploader: string_at(value, &["uploader"]).or_else(|| string_at(value, &["channel"])),
        duration: value.get("duration").and_then(as_i64),
        thumbnail,
    })
}

fn direct_url_from_info(info: &Value) -> Option<String> {
    string_at(info, &["url"])
        .or_else(|| {
            info.get("requested_downloads")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|v| string_at(v, &["url"]))
        })
        .or_else(|| {
            info.get("formats")
                .and_then(Value::as_array)
                .and_then(|formats| {
                    formats.iter().rev().find_map(|format| {
                        let has_audio = format
                            .get("acodec")
                            .and_then(Value::as_str)
                            .map(|codec| codec != "none")
                            .unwrap_or(true);
                        if has_audio {
                            string_at(format, &["url"])
                        } else {
                            None
                        }
                    })
                })
        })
}

fn normalize_media_input(input: &str) -> String {
    let trimmed = input.trim();
    if is_url(trimmed) || trimmed.starts_with("ytsearch") {
        trimmed.to_string()
    } else {
        format!("https://www.youtube.com/watch?v={trimmed}")
    }
}

fn is_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn spotify_id_from_uri(uri: &str) -> String {
    uri.rsplit(':').next().unwrap_or(uri).to_string()
}

fn spotify_cover_from_entity(entity: &Value) -> String {
    entity
        .pointer("/coverArt/sources")
        .and_then(Value::as_array)
        .and_then(|sources| sources.first())
        .and_then(|v| v.get("url"))
        .and_then(Value::as_str)
        .or_else(|| {
            entity
                .pointer("/visualIdentity/image")
                .and_then(Value::as_array)
                .and_then(|images| images.first())
                .and_then(|v| v.get("url"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_string()
}

fn as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|v| i64::try_from(v).ok()))
        .or_else(|| value.as_str().and_then(|v| v.parse::<i64>().ok()))
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToString::to_string)
}

fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if current.chars().count() >= max_chars {
            chunks.push(current);
            current = String::new();
        }
        current.push(ch);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn copy_header(
    from: &reqwest::header::HeaderMap,
    to: &mut HeaderMap,
    source_name: &'static str,
    target_name: header::HeaderName,
) {
    if let Some(value) = from.get(source_name) {
        if let Ok(value) = HeaderValue::from_bytes(value.as_bytes()) {
            to.insert(target_name, value);
        }
    }
}

async fn serve_file(path: PathBuf) -> Result<Response, ApiError> {
    if !path.exists() {
        return Err(ApiError::not_found("File not found"));
    }

    let file = fs::File::open(&path)
        .await
        .map_err(|_| ApiError::not_found("File not found"))?;
    let meta = file
        .metadata()
        .await
        .map_err(|e| ApiError::internal(format!("Cannot read file metadata: {e}")))?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let stream = ReaderStream::new(file);
    let mut response = Response::new(Body::from_stream(stream));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref())
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&meta.len().to_string()).unwrap_or(HeaderValue::from_static("0")),
    );
    Ok(response)
}

fn safe_filename(filename: &str) -> Result<&str, ApiError> {
    if filename.is_empty()
        || filename.contains("..")
        || filename.contains('/')
        || filename.contains('\\')
    {
        Err(ApiError::bad_request("Invalid filename"))
    } else {
        Ok(filename)
    }
}

fn default_download_dir() -> String {
    DEFAULT_DOWNLOAD_DIR.to_string()
}

fn default_data_dir() -> PathBuf {
    env::var_os("APPDATA")
        .or_else(|| env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| env::current_dir().unwrap_or_default())
        .join("Tesify")
}

fn load_config(path: &Path) -> AppConfig {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<AppConfig>(&text).ok())
        .unwrap_or_else(|| AppConfig {
            download_dir: DEFAULT_DOWNLOAD_DIR.to_string(),
        })
}

async fn save_config(path: &Path, config: &AppConfig) -> Result<(), ApiError> {
    let text = serde_json::to_string_pretty(config)
        .map_err(|e| ApiError::internal(format!("Cannot serialize config: {e}")))?;
    fs::write(path, text)
        .await
        .map_err(|e| ApiError::internal(format!("Cannot save config: {e}")))
}

fn resolve_path(root_dir: &Path, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        candidate
    } else {
        root_dir.join(candidate)
    }
}

fn ensure_dir_or_fallback(primary: &Path, fallback: &Path) -> BackendResult<()> {
    match std::fs::create_dir_all(primary) {
        Ok(_) => Ok(()),
        Err(_) => {
            std::fs::create_dir_all(fallback)?;
            Ok(())
        }
    }
}
