// Bounded CDN range relay adapted from the user's original Tesify backend.rs (TFG License).
use super::{
    PlaybackService, SourceEntry,
    audio_range::{AudioRange, CHUNK_SIZE, ContentRange},
};
use axum::{
    Router,
    body::Body,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

type StreamResult = Result<Response, (StatusCode, &'static str)>;
const START_CHUNK_SIZE: u64 = 128 * 1024;

pub(super) fn router(service: Arc<PlaybackService>) -> Router {
    let expected_host = service.origin.trim_start_matches("http://").to_string();
    Router::new()
        .route("/audio/{token}", get(audio))
        .route("/offline/{token}/{id}", get(offline_audio))
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            let expected_host = expected_host.clone();
            async move {
                if request
                    .headers()
                    .get(header::HOST)
                    .and_then(|value| value.to_str().ok())
                    != Some(expected_host.as_str())
                {
                    return Response::builder()
                        .status(StatusCode::FORBIDDEN)
                        .body(Body::empty())
                        .expect("valid response");
                }
                next.run(request).await
            }
        }))
        .with_state(service)
}

async fn offline_audio(
    State(service): State<Arc<PlaybackService>>,
    Path((token, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> StreamResult {
    let not_found = (StatusCode::NOT_FOUND, "Скачанный трек недоступен.");
    if token != service.offline_token {
        return Err(not_found);
    }
    let item = service.downloads.get(&id).await.ok_or(not_found)?;
    let requested = AudioRange::parse(headers.get(header::RANGE).and_then(|value| value.to_str().ok()));
    let Some((start, end)) = requested.and_then(|range| range.bounds(item.bytes)) else {
        return Ok(Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{}", item.bytes))
            .body(Body::empty()).expect("valid response"));
    };
    let length = end - start + 1;
    let mut file = tokio::fs::File::open(service.downloads.audio_path(&id)).await.map_err(|_| not_found)?;
    file.seek(std::io::SeekFrom::Start(start)).await.map_err(|_| not_found)?;
    let stream = futures_util::stream::try_unfold((file, length), |(mut file, remaining)| async move {
        if remaining == 0 {
            return Ok::<_, std::io::Error>(None);
        }
        let mut buffer = vec![0; remaining.min(START_CHUNK_SIZE) as usize];
        file.read_exact(&mut buffer).await?;
        Ok(Some((buffer, (file, remaining - remaining.min(START_CHUNK_SIZE)))))
    });
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, item.content_type)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes");
    if requested != Some(AudioRange::Full) {
        response = response
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{}", item.bytes));
    }
    response.body(Body::from_stream(stream)).map_err(|_| not_found)
}

pub(super) async fn request_chunk(
    service: &PlaybackService,
    entry: &mut SourceEntry,
    start: u64,
    end: u64,
) -> Result<reqwest::Response, (StatusCode, &'static str)> {
    if entry.source.url.is_empty() {
        entry.source = service.refresh(entry).await.map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                "Не удалось обновить источник музыки.",
            )
        })?;
    }
    for attempt in 0..2 {
        let mut request = service
            .client
            .get(&entry.source.url)
            .header(header::RANGE, format!("bytes={start}-{end}"));
        for (name, value) in &entry.source.headers {
            if [
                "user-agent",
                "referer",
                "origin",
                "accept",
                "accept-language",
            ]
            .contains(&name.to_ascii_lowercase().as_str())
            {
                request = request.header(name, value);
            }
        }
        let response = request
            .send()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "Источник музыки недоступен."))?;
        if response.status().is_success() {
            return Ok(response);
        }
        if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            return Err((StatusCode::RANGE_NOT_SATISFIABLE, "Диапазон за пределами трека."));
        }
        eprintln!(
            "Audio upstream HTTP {} for bytes={start}-{end}",
            response.status().as_u16()
        );
        if attempt == 0 && matches!(response.status().as_u16(), 401 | 403 | 410) {
            entry.source = service.refresh(entry).await.map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    "Не удалось обновить источник музыки.",
                )
            })?;
        } else {
            break;
        }
    }
    Err((StatusCode::BAD_GATEWAY, "Источник музыки отклонил запрос."))
}

pub(super) fn content_range(
    response: &reqwest::Response,
) -> Result<ContentRange, (StatusCode, &'static str)> {
    response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(ContentRange::parse)
        .ok_or((
            StatusCode::BAD_GATEWAY,
            "Некорректный диапазон аудиоданных.",
        ))
}

async fn audio(
    State(service): State<Arc<PlaybackService>>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> StreamResult {
    let mut entry = service.source(&token).ok_or((
        StatusCode::NOT_FOUND,
        "Источник трека истёк. Включите трек снова.",
    ))?;
    let requested = AudioRange::parse(
        headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok()),
    )
    .ok_or((StatusCode::RANGE_NOT_SATISFIABLE, "Некорректный диапазон."))?;
    if entry.intro.get().is_some() {
        return cached_audio(service, entry, requested);
    }
    // Ask for playable bytes immediately. A strict CDN may require a probe if the size is unknown or stale.
    let known_size = entry.source.filesize;
    let initial = if matches!(requested, AudioRange::Suffix(_)) && known_size.is_none() {
        (0, 0)
    } else {
        requested.bounds(known_size.unwrap_or(u64::MAX)).map_or((0, 0), |(start, end)| {
            (start, first_chunk_end(start, end))
        })
    };
    let (mut upstream, fetched) = match request_chunk(&service, &mut entry, initial.0, initial.1).await {
        Err((StatusCode::RANGE_NOT_SATISFIABLE, _)) if initial != (0, 0) => {
            (request_chunk(&service, &mut entry, 0, 0).await?, (0, 0))
        }
        response => (response?, initial),
    };
    let content_type = entry.source.content_type.clone();
    if upstream.status() == StatusCode::OK {
        let length = upstream.headers().get(header::CONTENT_LENGTH).cloned();
        let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&content_type).expect("static content type"),
        );
        if let Some(length) = length {
            response
                .headers_mut()
                .insert(header::CONTENT_LENGTH, length);
        }
        return Ok(response);
    }
    let total = content_range(&upstream)?.total;
    let (start, end) = requested.bounds(total).ok_or((
        StatusCode::RANGE_NOT_SATISFIABLE,
        "Диапазон за пределами трека.",
    ))?;
    let first_end = first_chunk_end(start, end);
    if fetched != (start, first_end) {
        drop(upstream);
        upstream = request_chunk(&service, &mut entry, start, first_end).await?;
    }
    let chunks = futures_util::stream::try_unfold(
        (Some(upstream), entry, service, start, end, total),
        |(first, mut entry, service, next, end, total)| async move {
            if next > end {
                return Ok::<_, std::io::Error>(None);
            }
            let first_chunk = first.is_some();
            let chunk_end = if first_chunk { first_chunk_end(next, end) } else { next + (end - next).min(CHUNK_SIZE - 1) };
            let upstream = match first {
                Some(upstream) => upstream,
                None => request_chunk(&service, &mut entry, next, chunk_end)
                    .await
                    .map_err(|(_, error)| std::io::Error::other(error))?,
            };
            let range =
                content_range(&upstream).map_err(|(_, error)| std::io::Error::other(error))?;
            if range.start != next || range.end > chunk_end || range.total != total {
                return Err(std::io::Error::other("Несогласованный диапазон аудио."));
            }
            let bytes = upstream.bytes().await.map_err(std::io::Error::other)?;
            if bytes.len() as u64 != range.end - range.start + 1 {
                return Err(std::io::Error::other("Неполный фрагмент аудио."));
            }
            if first_chunk && next == 0 {
                service.background(entry.clone());
            }
            Ok(Some((
                bytes,
                (None, entry, service, range.end + 1, end, total),
            )))
        },
    );
    let mut response = Response::new(Body::from_stream(chunks));
    *response.status_mut() = if requested == AudioRange::Full {
        StatusCode::OK
    } else {
        StatusCode::PARTIAL_CONTENT
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type).expect("static content type"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&(end - start + 1).to_string()).expect("valid length"),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if requested != AudioRange::Full {
        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}")).expect("valid range"),
        );
    }
    Ok(response)
}

fn first_chunk_end(start: u64, end: u64) -> u64 {
    let limit = if start == 0 { START_CHUNK_SIZE } else { CHUNK_SIZE };
    start + (end - start).min(limit - 1)
}

fn cached_audio(
    service: Arc<PlaybackService>,
    entry: SourceEntry,
    requested: AudioRange,
) -> StreamResult {
    let intro = entry.intro.get().expect("cached intro");
    let total = intro.total;
    let content_type = intro.content_type.clone();
    let (start, end) = requested.bounds(total).ok_or((
        StatusCode::RANGE_NOT_SATISFIABLE,
        "Диапазон за пределами трека.",
    ))?;
    let chunks = futures_util::stream::try_unfold(
        (service, entry, start, end, total),
        |(service, mut entry, next, end, total)| async move {
            if next > end {
                return Ok::<_, std::io::Error>(None);
            }
            let chunk_end = end.min(next.saturating_add(CHUNK_SIZE - 1));
            if let Some(bytes) = entry
                .intro
                .get()
                .and_then(|intro| intro.chunk(next, chunk_end))
            {
                let after = next + bytes.len() as u64;
                return Ok(Some((bytes, (service, entry, after, end, total))));
            }
            let upstream = request_chunk(&service, &mut entry, next, chunk_end)
                .await
                .map_err(|(_, error)| std::io::Error::other(error))?;
            let range =
                content_range(&upstream).map_err(|(_, error)| std::io::Error::other(error))?;
            if range.start != next || range.end > chunk_end || range.total != total {
                return Err(std::io::Error::other("Источник записи изменился."));
            }
            let bytes = upstream.bytes().await.map_err(std::io::Error::other)?;
            if bytes.len() as u64 != range.end - range.start + 1 {
                return Err(std::io::Error::other("Неполный фрагмент записи."));
            }
            Ok(Some((bytes, (service, entry, range.end + 1, end, total))))
        },
    );
    let mut response = Response::new(Body::from_stream(chunks));
    *response.status_mut() = if requested == AudioRange::Full {
        StatusCode::OK
    } else {
        StatusCode::PARTIAL_CONTENT
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type).expect("valid content type"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&(end - start + 1).to_string()).expect("valid length"),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if requested != AudioRange::Full {
        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}")).expect("valid range"),
        );
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::playback::play_engine::{AudioSource, PlayEngine, VideoMatch};
    use std::{collections::HashMap, time::Instant};

    async fn strict_cdn(State(data): State<Arc<Vec<u8>>>, headers: HeaderMap) -> Response {
        let range = headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok())
            .unwrap();
        let (start, end) = range
            .strip_prefix("bytes=")
            .unwrap()
            .split_once('-')
            .unwrap();
        let start: usize = start.parse().unwrap();
        let end: usize = end.parse().unwrap();
        // Reproduce CDNs which reject an end beyond EOF instead of silently clamping it.
        if start > end || end >= data.len() {
            return Response::builder().status(416).body(Body::empty()).unwrap();
        }
        Response::builder()
            .status(206)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{}", data.len()),
            )
            .header(header::CONTENT_LENGTH, end - start + 1)
            .body(Body::from(data[start..=end].to_vec()))
            .unwrap()
    }

    #[tokio::test]
    async fn downloads_audio_and_lyrics_then_seeks_after_restart_without_upstream() {
        use crate::pages::lyrics::models::{Line, Lyrics, LyricsResponse, Word};
        use crate::shared::{playback::intro_cache::tests::TemporaryCache, playlists::models::Track};

        let directory = TemporaryCache::new();
        let previews = directory.0.join("previews");
        let data = Arc::new(vec![5; 200_019]);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = format!("http://{}/file", listener.local_addr().unwrap());
        let app = Router::new().route("/file", get(strict_cdn)).with_state(data.clone());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        let engine = PlayEngine::new().with_yt_dlp(directory.0.join("missing-tool.exe"));
        let service = PlaybackService::new(client.clone(), engine.clone(), previews.clone()).unwrap();
        let track = Track {
            id: "playlist-entry".into(),
            spotify_id: "1234567890abcdefghijkl".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            artists: Vec::new(),
            cover_url: None,
            duration_ms: Some(10_000),
            added_at: 0,
            source_added_at: None,
            source_url: String::new(),
        };
        let key = super::super::IntroCache::key(&track);
        service.sources.lock().unwrap().insert(key.clone(), SourceEntry {
            key,
            token: "download-source".into(),
            video: super::super::intro_cache::tests::sample().video,
            source: AudioSource {
                url: upstream,
                headers: HashMap::new(),
                content_type: "audio/mp4".into(),
                duration_seconds: Some(10.),
                format_id: Some("140".into()),
                filesize: Some(data.len() as u64),
            },
            created: Instant::now(),
            intro: Arc::new(std::sync::OnceLock::new()),
            source_lock: Arc::default(),
            warm_lock: Arc::default(),
            warming: Arc::default(),
        });
        service.save_audio(track.clone(), async {
            LyricsResponse {
                status: "found".into(),
                lyrics: Some(Lyrics {
                    source: "test".into(), source_url: String::new(), sync: "word".into(),
                    source_duration_ms: None, exact_track: false,
                    lines: vec![Line { text: "Hello".into(), start: 1.0, end: 1.7, end_inferred: false,
                        words: vec![Word { text: "Hello".into(), start: 1.0, end: 1.7 }],
                    }],
                }),
                custom: false,
            }
        }, |_, _| {}).await.unwrap();
        task.abort();

        let restarted = PlaybackService::new(client.clone(), engine, previews).unwrap();
        let downloaded = restarted.downloads.list().await.unwrap();
        assert_eq!(downloaded.len(), 1);
        assert_eq!(restarted.downloads.audio_bytes().unwrap(), data.len() as u64);
        assert_eq!(restarted.downloads.directory(), directory.0.join("downloads-v1"));
        assert_eq!(downloaded[0].id, track.spotify_id);
        let lyrics = restarted.downloads.lyrics(&track.spotify_id).await.unwrap().lyrics.unwrap();
        assert_eq!(lyrics.lines[0].words[0].text, "Hello");
        let prepared = restarted.resolve(track).await.unwrap();
        assert!(prepared.audio_url.contains("/offline/"));
        let full = client.get(&prepared.audio_url).send().await.unwrap();
        assert_eq!(full.status(), 200);
        assert_eq!(full.bytes().await.unwrap().as_ref(), data.as_slice());
        let tail = client.get(&prepared.audio_url).header(header::RANGE, "bytes=-16").send().await.unwrap();
        assert_eq!(tail.status(), 206);
        assert_eq!(tail.headers()[header::CONTENT_RANGE], "bytes 200003-200018/200019");
        assert_eq!(tail.bytes().await.unwrap().as_ref(), &[5; 16]);
    }

    #[tokio::test]
    async fn warms_intro_once_and_serves_it_after_restart_without_upstream() {
        use crate::shared::playback::intro_cache::tests::TemporaryCache;
        use crate::shared::playlists::models::Track;
        use std::sync::{
            OnceLock,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        };
        let directory = TemporaryCache::new();
        let data = Arc::new(vec![3; 2_000_000]);
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = format!("http://{}/file", listener.local_addr().unwrap());
        let app = Router::new()
            .route(
                "/file",
                get(move |state: State<Arc<Vec<u8>>>, headers: HeaderMap| {
                    let calls = calls.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        strict_cdn(state, headers).await
                    }
                }),
            )
            .with_state(data.clone());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        let engine = PlayEngine::new().with_yt_dlp(directory.0.join("missing-tool.exe"));
        let service =
            PlaybackService::new(client.clone(), engine.clone(), directory.0.clone()).unwrap();
        let track = Track {
            id: "local-id".into(),
            spotify_id: "spotify-id".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            artists: vec![],
            duration_ms: Some(100_000),
            cover_url: None,
            added_at: 0,
            source_added_at: None,
            source_url: "https://open.spotify.com/track/test".into(),
        };
        let key = super::super::IntroCache::key(&track);
        let entry = SourceEntry {
            key: key.clone(),
            token: "warm-token".into(),
            video: super::super::intro_cache::tests::sample().video,
            source: AudioSource {
                url: upstream,
                headers: HashMap::new(),
                content_type: "audio/mp4".into(),
                duration_seconds: Some(100.),
                format_id: Some("140".into()),
                filesize: Some(data.len() as u64),
            },
            created: Instant::now(),
            intro: Arc::new(OnceLock::new()),
            source_lock: Arc::new(tokio::sync::Mutex::new(())),
            warm_lock: Arc::new(tokio::sync::Mutex::new(())),
            warming: Arc::new(AtomicBool::new(false)),
        };
        service
            .sources
            .lock()
            .unwrap()
            .insert(key.clone(), entry.clone());
        let (first, second) = tokio::join!(
            service.prefetch(track.clone()),
            service.prefetch(track.clone())
        );
        assert!(first.unwrap().intro_cached && second.unwrap().intro_cached);
        assert_eq!(
            count.load(Ordering::SeqCst),
            3,
            "Concurrent warmups must share probe, head, and tail requests"
        );
        assert!(entry.intro.get().unwrap().head.len() >= 256 * 1024);
        task.abort();
        let restarted = PlaybackService::new(client.clone(), engine, directory.0.clone()).unwrap();
        let source = restarted
            .resolve(track)
            .await
            .expect("Disk cache must avoid search and URL extraction before playback");
        assert!(source.intro_cached);
        let response = client
            .get(&source.audio_url)
            .header(header::RANGE, "bytes=0-127")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.bytes().await.unwrap().as_ref(), &[3; 128]);
        let suffix = client
            .get(&source.audio_url)
            .header(header::RANGE, "bytes=-64")
            .send()
            .await
            .unwrap();
        assert_eq!(suffix.bytes().await.unwrap().as_ref(), &[3; 64]);
        assert_eq!(count.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn relays_complete_audio_and_tail_seeks_without_requesting_past_eof() {
        let data = Arc::new(
            (0..CHUNK_SIZE * 2 + 19)
                .map(|offset| (offset % 251) as u8)
                .collect::<Vec<_>>(),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = format!("http://{}/file", listener.local_addr().unwrap());
        let app = Router::new()
            .route("/file", get(strict_cdn))
            .with_state(data.clone());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        let service = PlaybackService::new(
            client.clone(),
            PlayEngine::new(),
            std::env::temp_dir().join(format!("tesify-intro-{}", uuid::Uuid::new_v4())),
        )
        .unwrap();
        service.sources.lock().unwrap().insert(
            "track".into(),
            SourceEntry {
                key: "track".into(),
                intro: Arc::new(std::sync::OnceLock::new()),
                source_lock: Arc::new(tokio::sync::Mutex::new(())),
                warm_lock: Arc::new(tokio::sync::Mutex::new(())),
                warming: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                token: "test-token".into(),
                created: Instant::now(),
                video: VideoMatch {
                    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa".into(),
                    title: "Test".into(),
                    channel: None,
                    duration_seconds: Some(100.),
                    duration_difference_seconds: None,
                },
                source: AudioSource {
                    url: upstream,
                    headers: HashMap::new(),
                    content_type: "audio/mp4".into(),
                    duration_seconds: Some(100.),
                    format_id: Some("140".into()),
                    filesize: Some(data.len() as u64),
                },
            },
        );
        let url = format!("{}/audio/test-token", service.origin);
        let complete = client.get(&url).send().await.unwrap();
        assert_eq!(complete.status(), 200);
        assert_eq!(complete.bytes().await.unwrap().as_ref(), data.as_slice());
        let start = data.len() - 11;
        let tail = client
            .get(&url)
            .header(header::RANGE, format!("bytes={start}-"))
            .send()
            .await
            .unwrap();
        assert_eq!(tail.status(), 206);
        assert_eq!(
            tail.headers()[header::CONTENT_RANGE],
            format!("bytes {start}-{}/{}", data.len() - 1, data.len())
        );
        assert_eq!(tail.bytes().await.unwrap().as_ref(), &data[start..]);
        let suffix = client
            .get(&url)
            .header(header::RANGE, "bytes=-128")
            .send()
            .await
            .unwrap();
        assert_eq!(suffix.status(), 206);
        assert_eq!(
            suffix.bytes().await.unwrap().as_ref(),
            &data[data.len() - 128..]
        );
        assert_eq!(
            client
                .get(&url)
                .header(header::RANGE, "bytes=5-1")
                .send()
                .await
                .unwrap()
                .status(),
            416
        );
        assert_eq!(
            client
                .get(&url)
                .header(header::HOST, "example.com")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        task.abort();
    }
}
