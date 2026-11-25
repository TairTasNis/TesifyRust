use super::{models::Lyrics, parse};
use crate::shared::playlists::models::Track;
use futures_util::{StreamExt, stream};
use reqwest::Client;
use serde_json::Value;
use regex::Regex;
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;

pub const MIRRORS: &[&str] = &[
    "https://lyricsplus.binimum.org",
    "https://lyricsplus.atomix.one",
    "https://lyricsplus-seven.vercel.app",
    "https://lyricsplus.prjktla.workers.dev",
    "https://lyrics-plus-backend.vercel.app",
];

#[derive(Clone)]
pub struct Settings {
    pub mirrors: Vec<String>,
    pub better_url: String,
    pub better_key: Option<String>,
    pub lrcapi_url: String,
}

pub enum Outcome {
    Found(Lyrics),
    Instrumental,
    Miss,
    Failed,
}
impl Outcome {
    fn with_duration(self, duration_ms: Option<f64>) -> Self {
        match self {
            Self::Found(mut doc) => {
                doc.source_duration_ms = duration_ms.or(doc.source_duration_ms);
                Self::Found(doc)
            }
            other => other,
        }
    }
}
type Fetch = Result<Option<String>, ()>;

async fn text(client: &Client, url: &str, query: &[(String, String)], key: Option<&str>) -> Fetch {
    let mut request = client
        .get(url)
        .query(query)
        .timeout(Duration::from_secs(7))
        .header("User-Agent", concat!("Tesify/", env!("CARGO_PKG_VERSION"), " (lyrics player)"))
        .header("X-Client-Package", "Tesify")
        .header("Referer", "https://music.163.com/");
    if let Some(key) = key {
        request = request.header("X-API-Key", key);
    }
    let response = request.send().await.map_err(|_| ())?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(());
    }
    if response
        .content_length()
        .is_some_and(|size| size > 2 * 1024 * 1024)
    {
        return Err(());
    }
    let mut bytes = vec![];
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| ())?;
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map(Some).map_err(|_| ())
}

fn query(track: &Track) -> Vec<(String, String)> {
    let mut q = vec![
        ("title".into(), track.title.clone()),
        ("artist".into(), track.artist.clone()),
    ];
    if let Some(duration) = track.duration_ms.filter(|d| *d > 0) {
        q.push(("duration".into(), (duration / 1000).to_string()));
    }
    q
}

fn result(body: Fetch, track: &Track, source: &str, url: &str) -> Outcome {
    let body = match body {
        Ok(Some(b)) => b,
        Ok(None) => return Outcome::Miss,
        Err(_) => return Outcome::Failed,
    };
    let value = serde_json::from_str::<Value>(&body).ok();
    if value.as_ref().is_some_and(|v| {
        v.get("instrumental")
            .or_else(|| v.get("pureMusic"))
            .or_else(|| v.pointer("/meta/instrumental"))
            .and_then(Value::as_bool)
            == Some(true)
    }) {
        return Outcome::Instrumental;
    }
    if value
        .as_ref()
        .and_then(|v| v.get("score"))
        .and_then(Value::as_f64)
        .is_some_and(|v| v < 0.7)
    {
        return Outcome::Miss;
    }

    // Extract artist, title, and duration from JSON or text
    let (json_artist, json_title, json_duration) = value
        .as_ref()
        .map(extract_json_metadata)
        .unwrap_or((None, None, None));
    let (text_artist, text_title) = parse::extract_metadata(&body);

    let resp_artist = json_artist.as_deref().or(text_artist.as_deref());
    let resp_title = json_title.as_deref().or(text_title.as_deref());

    // If the response explicitly identified the artist, ensure it matches track.artist!
    if let Some(artist) = resp_artist {
        if !artist.trim().is_empty() && !matches_artist(&track.artist, artist) {
            return Outcome::Miss;
        }
    }

    // If the response explicitly identified the title, ensure it matches track.title!
    if let Some(title) = resp_title {
        if !title.trim().is_empty() && !matches_title(&track.title, title) {
            return Outcome::Miss;
        }
    }

    // If the provider returned explicit duration metadata, ensure it matches track duration
    let duration_ms = json_duration.filter(|d| *d > 0.0 && d.is_finite())
        .map(|d| if d < 1000.0 { d * 1000.0 } else { d });
    if !matches_track(track, "", "", duration_ms) {
        return Outcome::Miss;
    }

    let lines = value
        .as_ref()
        .map(parse::json)
        .unwrap_or_else(|| parse::text_format(&body));
    parse::document(
        lines,
        source,
        url,
        track.duration_ms.unwrap_or(0) as f64 / 1000.0,
    )
    .map(Outcome::Found)
    .unwrap_or(Outcome::Miss)
    .with_duration(duration_ms)
}

pub fn precise_duration(lyrics: &Lyrics, target_duration: f64) -> bool {
    lyrics.exact_track || (target_duration > 0.0 && lyrics.source_duration_ms
        .is_some_and(|duration| (duration / 1000.0 - target_duration).abs() <= 1.5))
}

fn duration_score(lyrics: &Lyrics, target_duration: f64) -> u32 {
    if target_duration <= 0.0 || lyrics.sync == "none" || lyrics.lines.is_empty() {
        return 50;
    }
    // The parser fills a missing last end with the song duration. That is not evidence of a match.
    let lyrics_end = lyrics.lines.iter().map(|line| {
        if line.end_inferred {
            line.words.last().map_or(line.start, |word| word.start.max(line.start))
        } else {
            line.end.max(line.start)
        }
    }).fold(0.0, f64::max);
    if lyrics_end > target_duration + 2.0 {
        return 0;
    }
    let ratio = lyrics_end / target_duration;
    (ratio.min(0.85) * 100.0).round() as u32
}

pub fn quality(lyrics: &Lyrics, target_duration: f64) -> (bool, u8, u32, u32, usize) {
    let level = match lyrics.sync.as_str() {
        "word" => 2,
        "line" => 1,
        _ => 0,
    };
    let score = duration_score(lyrics, target_duration);
    let metadata = if lyrics.exact_track { 110 } else if target_duration > 0.0 {
        lyrics.source_duration_ms.map_or(0, |duration| {
            (100.0 - (duration / 1000.0 - target_duration).abs() * 12.0).max(1.0) as u32
        })
    } else { 0 };
    let chars = lyrics
        .lines
        .iter()
        .filter(|l| !l.words.is_empty())
        .map(|l| l.text.len())
        .sum();
    (metadata >= 80 || score >= 45, level, metadata, score, chars)
}

pub async fn lyricsplus(client: &Client, track: &Track, settings: &Settings) -> Outcome {
    let track_dur = track.duration_ms.unwrap_or(0) as f64 / 1000.0;
    let mut requests = stream::iter(settings.mirrors.clone().into_iter().map(|base| async move {
        let mut q = query(track);
        // All upstreams supported by KPOE, including word-level Musixmatch.
        q.push((
            "source".into(),
            "apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word".into(),
        ));
        result(
            text(client, &format!("{base}/v2/lyrics/get"), &q, None).await,
            track,
            "LyricsPlus",
            "https://github.com/ibratabian17/lyricsplus",
        )
    }))
    .buffer_unordered(2);
    let mut best: Option<Lyrics> = None;
    let mut failed = false;
    while let Some(outcome) = requests.next().await {
        match outcome {
            Outcome::Found(lyrics) => {
                if lyrics.sync == "word" && precise_duration(&lyrics, track_dur) {
                    return Outcome::Found(lyrics);
                }
                if best.as_ref().is_none_or(|b| quality(&lyrics, track_dur) > quality(b, track_dur)) {
                    best = Some(lyrics);
                }
            }
            Outcome::Failed => failed = true,
            _ => {}
        }
    }
    best.map(Outcome::Found).unwrap_or(if failed {
        Outcome::Failed
    } else {
        Outcome::Miss
    })
}

pub async fn better(client: &Client, track: &Track, settings: &Settings) -> Outcome {
    let mut q = vec![
        ("s".into(), track.title.clone()),
        ("a".into(), track.artist.clone()),
    ];
    if let Some(duration) = track.duration_ms.filter(|d| *d > 0) {
        q.push(("d".into(), (duration / 1000).to_string()));
        q.push(("duration".into(), (duration / 1000).to_string()));
    }
    result(
        text(
            client,
            &format!("{}/getLyrics", settings.better_url),
            &q,
            settings.better_key.as_deref(),
        )
        .await,
        track,
        "Better Lyrics",
        "https://betterlyrics.org",
    )
}

pub async fn binimum(client: &Client, track: &Track) -> Outcome {
    let mut q = query(track);
    q.retain(|(key, _)| key != "title");
    q.push(("track".into(), track.title.clone()));
    let body = match text(client, "https://lyrics-api.binimum.org/", &q, None).await {
        Ok(Some(body)) => body,
        Ok(None) => return Outcome::Miss,
        Err(_) => return Outcome::Failed,
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Outcome::Failed;
    };
    let Some(results) = value["results"].as_array() else {
        return Outcome::Miss;
    };
    let mut items: Vec<_> = results
        .iter()
        .filter(|item| {
            matches_track(
                track,
                item["track_name"].as_str().unwrap_or(""),
                item["artist_name"].as_str().unwrap_or(""),
                item["duration"].as_f64().map(|d| d * 1000.0),
            )
        })
        .collect();
    if let Some(target) = track.duration_ms.filter(|d| *d > 0) {
        items.sort_by(|a, b| {
            let diff_a = (a["duration"].as_f64().unwrap_or(0.0) * 1000.0 - target as f64).abs();
            let diff_b = (b["duration"].as_f64().unwrap_or(0.0) * 1000.0 - target as f64).abs();
            diff_a.total_cmp(&diff_b)
        });
    }
    for item in items.into_iter().take(8) {
        let Some(url) = item["lyricsUrl"]
            .as_str()
            .and_then(|u| reqwest::Url::parse(u).ok())
        else {
            continue;
        };
        // The index returns download URLs. Restrict them to documented lyric hosts.
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
            || !matches!(url.host_str(), Some("lrc.red" | "lyrics-api.binimum.org"))
        {
            continue;
        }
        let outcome = result(
            text(client, url.as_str(), &[], None).await,
            track,
            "LyricsPlus / BiniLyrics",
            "https://lyrics-api.binimum.org",
        ).with_duration(item["duration"].as_f64().map(|seconds| seconds * 1000.0));
        if matches!(outcome, Outcome::Found(_)) {
            return outcome;
        }
    }
    Outcome::Miss
}

pub async fn lrcmux(client: &Client, track: &Track) -> Outcome {
    let mut q = query(track);
    q.extend([
        ("level".into(), "word".into()),
        ("format".into(), "json".into()),
    ]);
    result(
        text(client, "https://api.lrcmux.dev/get", &q, None).await,
        track,
        "lrcmux",
        "https://lrcmux.dev",
    )
}

pub async fn lrcapi(client: &Client, track: &Track, settings: &Settings) -> Outcome {
    let q = query(track);
    // 1. First try /jsonapi which returns rich candidate metadata (artist, title, score, duration).
    let json_url = format!("{}/jsonapi", settings.lrcapi_url);
    if let Ok(Some(body)) = text(client, &json_url, &q, None).await {
        if let Ok(value) = serde_json::from_str::<Value>(&body) {
            if let Some(candidates) = value.as_array() {
                let mut candidates: Vec<_> = candidates
                    .iter()
                    .filter(|item| {
                        matches_track(
                            track,
                            item["title"].as_str().unwrap_or(""),
                            item["artist"].as_str().unwrap_or(""),
                            item["duration"].as_f64().map(|d| d * 1000.0),
                        )
                    })
                    .collect();
                if let Some(target) = track.duration_ms.filter(|d| *d > 0) {
                    candidates.sort_by(|a, b| {
                        let dur_a = a["duration"]
                            .as_f64()
                            .map(|d| (d * 1000.0 - target as f64).abs())
                            .unwrap_or(f64::MAX);
                        let dur_b = b["duration"]
                            .as_f64()
                            .map(|d| (d * 1000.0 - target as f64).abs())
                            .unwrap_or(f64::MAX);
                        dur_a.total_cmp(&dur_b)
                    });
                }
                let track_dur = track.duration_ms.unwrap_or(0) as f64 / 1000.0;
                for item in candidates.into_iter().take(5) {
                    let lines = item["lrc_ttml"]
                        .as_str()
                        .map(parse::text_format)
                        .filter(|l| !l.is_empty())
                        .or_else(|| item["lrc"].as_str().map(parse::text_format))
                        .unwrap_or_default();
                    if let Some(doc) = parse::document(
                        lines,
                        "LrcApi",
                        "https://github.com/HisAtri/LrcApi",
                        track_dur,
                    ) {
                        return Outcome::Found(doc).with_duration(item["duration"].as_f64().map(|seconds| seconds * 1000.0));
                    }
                }
                // Candidates were returned by jsonapi but none matched the track/artist: reject!
                return Outcome::Miss;
            }
        }
    }

    // 2. Fallback to /lyrics only if /jsonapi endpoint wasn't available (e.g. older self-hosted server)
    result(
        text(
            client,
            &format!("{}/lyrics", settings.lrcapi_url),
            &q,
            None,
        )
        .await,
        track,
        "LrcApi",
        "https://github.com/HisAtri/LrcApi",
    )
}

pub async fn amll(client: &Client, track: &Track) -> Outcome {
    let track_dur = track.duration_ms.unwrap_or(0) as f64 / 1000.0;
    if track.spotify_id.len() == 22 && track.spotify_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        let url = format!(
            "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/spotify-lyrics/{}.ttml",
            track.spotify_id
        );
        let mut outcome = result(
            text(client, &url, &[], None).await,
            track,
            "AMLL TTML Database",
            "https://github.com/amll-dev/amll-ttml-db",
        );
        if let Outcome::Found(doc) = &mut outcome {
            doc.exact_track = true;
        }
        if matches!(&outcome, Outcome::Found(l) if l.sync == "word") {
            return outcome;
        }
        let fallback = lrclib_at(
            client,
            track,
            "https://api.amll.dev/v1/lrclib",
            "AMLL TTML Database",
            "https://github.com/amll-dev/amll-ttml-db",
        )
        .await;
        return match (outcome, fallback) {
            (Outcome::Found(a), Outcome::Found(b)) => {
                Outcome::Found(if quality(&a, track_dur) >= quality(&b, track_dur) { a } else { b })
            }
            (_, Outcome::Found(b)) => Outcome::Found(b),
            (Outcome::Found(a), _) => Outcome::Found(a),
            (_, other) => other,
        };
    }
    lrclib_at(
        client,
        track,
        "https://api.amll.dev/v1/lrclib",
        "AMLL TTML Database",
        "https://github.com/amll-dev/amll-ttml-db",
    )
    .await
}

pub async fn lrclib(client: &Client, track: &Track) -> Outcome {
    lrclib_at(
        client,
        track,
        "https://lrclib.net/api",
        "LRCLIB",
        "https://lrclib.net",
    )
    .await
}

async fn lrclib_at(client: &Client, track: &Track, base: &str, source: &str, url: &str) -> Outcome {
    let mut q = vec![
        ("track_name".into(), track.title.clone()),
        ("artist_name".into(), track.artist.clone()),
    ];
    if let Some(duration) = track.duration_ms.filter(|d| *d > 0) {
        q.push(("duration".into(), (duration / 1000).to_string()));
    }
    let exact = result(
        text(client, &format!("{base}/get"), &q, None).await,
        track,
        source,
        url,
    );
    if matches!(&exact, Outcome::Found(_) | Outcome::Instrumental) {
        return exact;
    }
    q.retain(|(key, _)| key != "duration");
    let body = match text(client, &format!("{base}/search"), &q, None).await {
        Ok(Some(body)) => body,
        Ok(None) => return exact,
        Err(_) => return Outcome::Failed,
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Outcome::Failed;
    };
    let Some(candidates) = value.as_array() else {
        return Outcome::Miss;
    };
    let mut candidates: Vec<_> = candidates
        .iter()
        .filter(|item| {
            matches_track(
                track,
                item["trackName"].as_str().unwrap_or(""),
                item["artistName"].as_str().unwrap_or(""),
                item["duration"].as_f64().map(|v| v * 1000.0),
            ) && item["instrumental"].as_bool() != Some(true)
        })
        .collect();
    if let Some(target) = track.duration_ms.filter(|d| *d > 0) {
        candidates.sort_by(|a, b| {
            let diff_a = (a["duration"].as_f64().unwrap_or(0.0) * 1000.0 - target as f64).abs();
            let diff_b = (b["duration"].as_f64().unwrap_or(0.0) * 1000.0 - target as f64).abs();
            diff_a.total_cmp(&diff_b)
        });
    }
    let track_dur = track.duration_ms.unwrap_or(0) as f64 / 1000.0;
    let mut best = None;
    for item in candidates.into_iter().take(15) {
        if let Some(mut doc) = parse::document(
            parse::json(item),
            source,
            url,
            track_dur,
        ) {
            doc.source_duration_ms = item["duration"].as_f64().map(|seconds| seconds * 1000.0);
            if best.as_ref().is_none_or(|b| quality(&doc, track_dur) > quality(b, track_dur)) {
                best = Some(doc);
            }
        }
    }
    best.map(Outcome::Found).unwrap_or(Outcome::Miss)
}

pub async fn netease(client: &Client, track: &Track) -> Outcome {
    let q = vec![
        ("s".into(), format!("{} {}", track.title, track.artist)),
        ("type".into(), "1".into()),
        ("limit".into(), "10".into()),
    ];
    let body = match text(client, "https://music.163.com/api/search/pc", &q, None).await {
        Ok(Some(b)) => b,
        Ok(None) => return Outcome::Miss,
        _ => return Outcome::Failed,
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Outcome::Failed;
    };
    let Some(songs) = value.pointer("/result/songs").and_then(Value::as_array) else {
        return Outcome::Miss;
    };
    let mut songs: Vec<_> = songs
        .iter()
        .filter(|song| {
            let artist = song["artists"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|a| a["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            matches_track(
                track,
                song["name"].as_str().unwrap_or(""),
                &artist,
                song["duration"].as_f64(),
            )
        })
        .collect();
    if let Some(target) = track.duration_ms.filter(|d| *d > 0) {
        songs.sort_by(|a, b| {
            let diff_a = (a["duration"].as_f64().unwrap_or(0.0) - target as f64).abs();
            let diff_b = (b["duration"].as_f64().unwrap_or(0.0) - target as f64).abs();
            diff_a.total_cmp(&diff_b)
        });
    }
    for song in songs.into_iter().take(6) {
        let artist = song["artists"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|a| a["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        if !matches_track(
            track,
            song["name"].as_str().unwrap_or(""),
            &artist,
            song["duration"].as_f64(),
        ) {
            continue;
        }
        let Some(id) = song["id"].as_u64() else {
            continue;
        };
        let q = vec![
            ("id".into(), id.to_string()),
            ("lv".into(), "-1".into()),
            ("yv".into(), "-1".into()),
            ("kv".into(), "-1".into()),
        ];
        let body = text(client, "https://music.163.com/api/song/lyric", &q, None).await;
        // Parse YRC before ordinary LRC whenever both exist.
        if let Ok(Some(raw)) = &body {
            if let Ok(v) = serde_json::from_str::<Value>(raw) {
                if let Some(yrc) = v.pointer("/yrc/lyric").and_then(Value::as_str) {
                    if let Some(doc) = parse::document(
                        parse::karaoke(yrc, false),
                        "NetEase Cloud Music",
                        "https://music.163.com",
                        track.duration_ms.unwrap_or(0) as f64 / 1000.0,
                    ) {
                        return Outcome::Found(doc).with_duration(song["duration"].as_f64());
                    }
                }
            }
        }
        let outcome = result(body, track, "NetEase Cloud Music", "https://music.163.com");
        if matches!(outcome, Outcome::Found(_)) {
            return outcome.with_duration(song["duration"].as_f64());
        }
    }
    Outcome::Miss
}

pub async fn kugou(client: &Client, track: &Track) -> Outcome {
    let q = vec![
        ("ver".into(), "1".into()),
        ("man".into(), "yes".into()),
        ("client".into(), "mobi".into()),
        (
            "keyword".into(),
            format!("{} - {}", track.artist, track.title),
        ),
        (
            "duration".into(),
            track.duration_ms.unwrap_or(0).to_string(),
        ),
    ];
    let body = match text(client, "https://lyrics.kugou.com/search", &q, None).await {
        Ok(Some(b)) => b,
        Ok(None) => return Outcome::Miss,
        _ => return Outcome::Failed,
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Outcome::Failed;
    };
    let Some(candidates) = value["candidates"].as_array() else {
        return Outcome::Miss;
    };
    let mut candidates: Vec<_> = candidates
        .iter()
        .filter(|c| {
            c["product_from"] != "ugc"
                && matches_track(
                    track,
                    c["song"].as_str().unwrap_or(""),
                    c["singer"].as_str().unwrap_or(""),
                    c["duration"].as_f64(),
                )
        })
        .collect();
    candidates.sort_by_key(|c| {
        (c["duration"].as_i64().unwrap_or(0) - track.duration_ms.unwrap_or(0)).abs()
    });
    for candidate in candidates.into_iter().take(3) {
        let Some(id) = candidate["id"]
            .as_str()
            .map(str::to_string)
            .or_else(|| candidate["id"].as_u64().map(|n| n.to_string()))
        else {
            continue;
        };
        let Some(key) = candidate["accesskey"].as_str() else {
            continue;
        };
        let q = vec![
            ("ver".into(), "1".into()),
            ("client".into(), "pc".into()),
            ("id".into(), id),
            ("accesskey".into(), key.into()),
            ("fmt".into(), "krc".into()),
            ("charset".into(), "utf8".into()),
        ];
        let Ok(Some(body)) = text(client, "https://lyrics.kugou.com/download", &q, None).await
        else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&body) else {
            continue;
        };
        let Some(raw) = v["content"].as_str().and_then(parse::decode_krc) else {
            continue;
        };
        if let Some(doc) = parse::document(
            parse::karaoke(&raw, true),
            "Kugou Music",
            "https://www.kugou.com",
            track.duration_ms.unwrap_or(0) as f64 / 1000.0,
        ) {
            return Outcome::Found(doc).with_duration(candidate["duration"].as_f64());
        }
    }
    Outcome::Miss
}

fn normalized(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn split_artists(raw: &str) -> Vec<String> {
    let lower = raw.to_lowercase();
    let re = Regex::new(r"(?i)\s*(?:feat\.?|ft\.?|featuring|with|vs\.?|and|&|\+|,|;|/|\\)\s*").unwrap();
    let parts: Vec<String> = re
        .split(&lower)
        .map(normalized)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        let n = normalized(raw);
        if !n.is_empty() {
            return vec![n];
        }
    }
    parts
}

pub fn matches_artist(wanted: &str, candidate: &str) -> bool {
    let norm_wanted = normalized(wanted);
    let norm_candidate = normalized(candidate);
    if norm_wanted.is_empty() || norm_candidate.is_empty() {
        return false;
    }
    if norm_wanted == norm_candidate {
        return true;
    }
    let wanted_parts = split_artists(wanted);
    let candidate_parts = split_artists(candidate);

    for w in &wanted_parts {
        for c in &candidate_parts {
            if w == c {
                return true;
            }
            if (w.len() >= 4 && c.contains(w.as_str())) || (c.len() >= 4 && w.contains(c.as_str())) {
                return true;
            }
        }
    }

    if (norm_wanted.len() >= 4 && norm_candidate.contains(&norm_wanted))
        || (norm_candidate.len() >= 4 && norm_wanted.contains(&norm_candidate))
    {
        return true;
    }

    false
}

fn clean_title_str(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let re_noise = Regex::new(r"(?i)\s*[\(\[\{](?:feat\.?|ft\.?|featuring|with|official|remaster|bonus|radio edit|original mix|single version|deluxe).*?[\)\]\}]").unwrap();
    let cleaned = re_noise.replace_all(&lower, "");
    let re_dash = Regex::new(r"(?i)\s*-\s*(?:remaster|bonus|radio edit|original mix|single version|deluxe).*$").unwrap();
    let cleaned = re_dash.replace_all(&cleaned, "");
    normalized(&cleaned)
}

pub fn matches_title(wanted: &str, candidate: &str) -> bool {
    let norm_wanted = normalized(wanted);
    let norm_candidate = normalized(candidate);
    if norm_wanted.is_empty() || norm_candidate.is_empty() {
        return false;
    }
    if norm_wanted == norm_candidate {
        return true;
    }
    let clean_w = clean_title_str(wanted);
    let clean_c = clean_title_str(candidate);
    if !clean_w.is_empty() && clean_w == clean_c {
        return true;
    }
    false
}

pub fn matches_track(track: &Track, title: &str, artist: &str, duration_ms: Option<f64>) -> bool {
    if !title.is_empty() && !matches_title(&track.title, title) {
        return false;
    }
    if !artist.is_empty() && !matches_artist(&track.artist, artist) {
        return false;
    }
    match (track.duration_ms, duration_ms) {
        (Some(wanted), Some(actual)) if wanted > 0 && actual > 0.0 => {
            (wanted as f64 - actual).abs() <= (wanted as f64 * 0.02).clamp(3000.0, 6000.0)
        }
        _ => true,
    }
}

fn extract_json_metadata(value: &Value) -> (Option<String>, Option<String>, Option<f64>) {
    let artist = value
        .get("artist")
        .or_else(|| value.get("artist_name"))
        .or_else(|| value.get("artistName"))
        .or_else(|| value.get("singer"))
        .or_else(|| value.get("author"))
        .or_else(|| value.pointer("/track/artist"))
        .or_else(|| value.pointer("/track/artist_name"))
        .or_else(|| value.pointer("/data/artist"))
        .or_else(|| value.pointer("/result/artist"))
        .or_else(|| value.pointer("/meta/artist"))
        .or_else(|| value.pointer("/metadata/agents/v1/name"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("artists")
                .or_else(|| value.pointer("/track/artists"))
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            item.as_str()
                                .or_else(|| item.get("name").and_then(Value::as_str))
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|s| !s.is_empty())
        });

    let title = value
        .get("title")
        .or_else(|| value.get("track_name"))
        .or_else(|| value.get("trackName"))
        .or_else(|| value.get("song"))
        .or_else(|| value.get("name"))
        .or_else(|| value.pointer("/track/title"))
        .or_else(|| value.pointer("/track/name"))
        .or_else(|| value.pointer("/data/title"))
        .or_else(|| value.pointer("/result/title"))
        .or_else(|| value.pointer("/meta/title"))
        .or_else(|| value.pointer("/metadata/title"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let duration = value
        .get("duration")
        .or_else(|| value.get("length"))
        .or_else(|| value.pointer("/track/duration"))
        .or_else(|| value.pointer("/data/duration"))
        .or_else(|| value.pointer("/data/length"))
        .and_then(|d| d.as_f64().or_else(|| d.as_str().and_then(|s| s.parse().ok())));

    (artist, title, duration)
}

#[derive(Clone)]
pub enum CandidatePayload {
    Ready(Lyrics),
    NetEase { id: u64, duration_ms: Option<f64> },
    Kugou { id: String, accesskey: String, duration_ms: Option<f64> },
}

#[derive(Clone)]
pub struct SearchCandidate {
    pub info: super::models::LyricsCandidate,
    pub payload: CandidatePayload,
}

fn preview_lines(lyrics: &Lyrics) -> Option<String> {
    let lines: Vec<&str> = lyrics
        .lines
        .iter()
        .map(|l| l.text.trim())
        .filter(|t| !t.is_empty())
        .take(2)
        .collect();
    (!lines.is_empty()).then(|| lines.join(" / "))
}

async fn search_lrclib_candidates(
    client: &Client,
    query_str: &str,
    base: &str,
    source: &str,
    url: &str,
) -> Vec<SearchCandidate> {
    let q = vec![("q".into(), query_str.to_string())];
    let Ok(Some(body)) = text(client, &format!("{base}/search"), &q, None).await else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items.iter().take(15) {
        if item["instrumental"].as_bool() == Some(true) {
            continue;
        }
        let title = item["trackName"].as_str().unwrap_or("").trim();
        let artist = item["artistName"].as_str().unwrap_or("").trim();
        if title.is_empty() {
            continue;
        }
        let duration_sec = item["duration"].as_f64().filter(|d| *d > 0.0 && d.is_finite());
        let Some(doc) = parse::document(
            parse::json(item),
            source,
            url,
            duration_sec.unwrap_or(0.0),
        ) else {
            continue;
        };
        let album = item["albumName"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let duration_ms = duration_sec.map(|d| (d * 1000.0).round() as i64);
        out.push(SearchCandidate {
            info: super::models::LyricsCandidate {
                id: uuid::Uuid::new_v4().to_string(),
                title: title.to_string(),
                artist: artist.to_string(),
                album,
                duration_ms,
                source: source.to_string(),
                sync: doc.sync.clone(),
                preview: preview_lines(&doc),
            },
            payload: CandidatePayload::Ready(doc),
        });
    }
    out
}

async fn search_netease_candidates(client: &Client, query_str: &str) -> Vec<SearchCandidate> {
    let q = vec![
        ("s".into(), query_str.to_string()),
        ("type".into(), "1".into()),
        ("limit".into(), "10".into()),
    ];
    let Ok(Some(body)) = text(client, "https://music.163.com/api/search/pc", &q, None).await else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Vec::new();
    };
    let Some(songs) = value.pointer("/result/songs").and_then(Value::as_array) else {
        return Vec::new();
    };
    songs
        .iter()
        .take(10)
        .filter_map(|song| {
            let id = song["id"].as_u64()?;
            let title = song["name"].as_str()?.trim();
            if title.is_empty() {
                return None;
            }
            let artist = song["artists"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|item| item["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let album = song
                .pointer("/album/name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let duration_ms = song["duration"].as_f64().filter(|d| *d > 0.0 && d.is_finite());
            Some(SearchCandidate {
                info: super::models::LyricsCandidate {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: title.to_string(),
                    artist,
                    album,
                    duration_ms: duration_ms.map(|d| d.round() as i64),
                    source: "NetEase Cloud Music".to_string(),
                    sync: "auto".to_string(),
                    preview: None,
                },
                payload: CandidatePayload::NetEase { id, duration_ms },
            })
        })
        .collect()
}

async fn search_kugou_candidates(client: &Client, query_str: &str) -> Vec<SearchCandidate> {
    let q = vec![
        ("ver".into(), "1".into()),
        ("man".into(), "yes".into()),
        ("client".into(), "mobi".into()),
        ("keyword".into(), query_str.to_string()),
    ];
    let Ok(Some(body)) = text(client, "https://lyrics.kugou.com/search", &q, None).await else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return Vec::new();
    };
    let Some(candidates) = value["candidates"].as_array() else {
        return Vec::new();
    };
    candidates
        .iter()
        .filter(|c| c["product_from"] != "ugc")
        .take(8)
        .filter_map(|c| {
            let id = c["id"]
                .as_str()
                .map(str::to_string)
                .or_else(|| c["id"].as_u64().map(|n| n.to_string()))?;
            let accesskey = c["accesskey"].as_str()?.to_string();
            let title = c["song"].as_str().unwrap_or("").trim();
            let artist = c["singer"].as_str().unwrap_or("").trim();
            if title.is_empty() {
                return None;
            }
            let duration_ms = c["duration"].as_f64().filter(|d| *d > 0.0 && d.is_finite());
            Some(SearchCandidate {
                info: super::models::LyricsCandidate {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: title.to_string(),
                    artist: artist.to_string(),
                    album: None,
                    duration_ms: duration_ms.map(|d| d.round() as i64),
                    source: "Kugou Music".to_string(),
                    sync: "word".to_string(),
                    preview: None,
                },
                payload: CandidatePayload::Kugou {
                    id,
                    accesskey,
                    duration_ms,
                },
            })
        })
        .collect()
}

pub async fn search_candidates(client: &Client, query_str: &str) -> Vec<SearchCandidate> {
    let query_str = query_str.trim();
    if query_str.is_empty() {
        return Vec::new();
    }
    let (lrclib_res, amll_res, netease_res, kugou_res) = tokio::join!(
        search_lrclib_candidates(
            client,
            query_str,
            "https://lrclib.net/api",
            "LRCLIB",
            "https://lrclib.net"
        ),
        search_lrclib_candidates(
            client,
            query_str,
            "https://api.amll.dev/v1/lrclib",
            "AMLL TTML Database",
            "https://github.com/amll-dev/amll-ttml-db"
        ),
        search_netease_candidates(client, query_str),
        search_kugou_candidates(client, query_str),
    );
    let mut all = Vec::new();
    all.extend(lrclib_res);
    all.extend(amll_res);
    all.extend(netease_res);
    all.extend(kugou_res);
    all.sort_by_key(|c| match c.info.sync.as_str() {
        "word" => 0_u8,
        "line" => 1,
        "auto" => 2,
        _ => 3,
    });
    all.truncate(40);
    all
}

pub async fn resolve_candidate(client: &Client, payload: CandidatePayload) -> Result<Lyrics, String> {
    match payload {
        CandidatePayload::Ready(lyrics) => Ok(lyrics),
        CandidatePayload::NetEase { id, duration_ms } => {
            let q = vec![
                ("id".into(), id.to_string()),
                ("lv".into(), "-1".into()),
                ("yv".into(), "-1".into()),
                ("kv".into(), "-1".into()),
            ];
            let body = text(client, "https://music.163.com/api/song/lyric", &q, None)
                .await
                .map_err(|_| "Не удалось загрузить текст с NetEase.".to_string())?
                .ok_or_else(|| "У выбранной записи NetEase нет текста.".to_string())?;
            let v: Value = serde_json::from_str(&body)
                .map_err(|_| "Не удалось разобрать ответ NetEase.".to_string())?;
            let dur = duration_ms.unwrap_or(0.0) / 1000.0;
            if let Some(yrc) = v.pointer("/yrc/lyric").and_then(Value::as_str) {
                if let Some(doc) = parse::document(
                    parse::karaoke(yrc, false),
                    "NetEase Cloud Music",
                    "https://music.163.com",
                    dur,
                ) {
                    return Ok(doc);
                }
            }
            let lines = parse::json(&v);
            parse::document(lines, "NetEase Cloud Music", "https://music.163.com", dur)
                .ok_or_else(|| "У выбранной записи NetEase нет текста.".to_string())
        }
        CandidatePayload::Kugou {
            id,
            accesskey,
            duration_ms,
        } => {
            let q = vec![
                ("ver".into(), "1".into()),
                ("client".into(), "pc".into()),
                ("id".into(), id),
                ("accesskey".into(), accesskey),
                ("fmt".into(), "krc".into()),
                ("charset".into(), "utf8".into()),
            ];
            let body = text(client, "https://lyrics.kugou.com/download", &q, None)
                .await
                .map_err(|_| "Не удалось загрузить текст с Kugou.".to_string())?
                .ok_or_else(|| "У выбранной записи Kugou нет текста.".to_string())?;
            let v: Value = serde_json::from_str(&body)
                .map_err(|_| "Не удалось разобрать ответ Kugou.".to_string())?;
            let raw = v["content"]
                .as_str()
                .and_then(parse::decode_krc)
                .ok_or_else(|| "У выбранной записи Kugou нет текста.".to_string())?;
            let dur = duration_ms.unwrap_or(0.0) / 1000.0;
            parse::document(
                parse::karaoke(&raw, true),
                "Kugou Music",
                "https://www.kugou.com",
                dur,
            )
            .ok_or_else(|| "У выбранной записи Kugou нет текста.".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inferred_last_line_end_does_not_count_as_duration_evidence() {
        let mut doc = parse::document(
            parse::lrc("[00:05]First\n[00:14]Second\n[00:34]Last"),
            "test", "", 80.0,
        ).unwrap();
        assert_eq!(doc.lines.last().unwrap().end, 80.0);
        assert_eq!(duration_score(&doc, 80.0), 43);
        assert!(!precise_duration(&doc, 80.0));
        doc.source_duration_ms = Some(80_300.0);
        assert!(precise_duration(&doc, 80.0));
    }
    #[test]
    fn matching_rejects_wrong_version_artist_and_duration() {
        let track = Track {
            id: "id".into(),
            spotify_id: "".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            artists: vec![],
            cover_url: None,
            duration_ms: Some(180000),
            added_at: 0,
            source_added_at: None,
            source_url: "".into(),
        };
        assert!(matches_track(&track, "SONG", "Artist", Some(181000.0)));
        assert!(!matches_track(
            &track,
            "Song (Live)",
            "Artist",
            Some(180000.0)
        ));
        assert!(!matches_track(&track, "Song", "Cover Band", Some(180000.0)));
        assert!(!matches_track(&track, "Song", "Artist", Some(240000.0)));
    }

    #[test]
    fn artist_and_title_matching_rules() {
        assert!(matches_artist("Camila Cabello", "Camila Cabello feat. DaBaby"));
        assert!(matches_artist("Camila Cabello, Young Thug", "Camila Cabello"));
        assert!(matches_artist("camila", "Camila"));
        assert!(!matches_artist("camila", "JAMIE"));
        assert!(!matches_artist("Billie Eilish", "Taylor Swift"));

        assert!(matches_title("Pity Party", "Pity Party (Remastered)"));
        assert!(matches_title("Pity Party", "Pity Party - Radio Edit"));
        assert!(matches_title("Pity Party", "Pity Party (feat. Someone)"));
        assert!(!matches_title("Pity Party", "Different Song"));
    }

    #[test]
    fn result_rejects_mismatched_artist_in_json_and_lrc() {
        let track = Track {
            id: "1".into(),
            spotify_id: "".into(),
            title: "pity party".into(),
            artist: "camila".into(),
            artists: vec![],
            cover_url: None,
            duration_ms: Some(185000),
            added_at: 0,
            source_added_at: None,
            source_url: "".into(),
        };

        // LRC text with mismatched artist tag [ar:JAMIE] must be rejected
        let lrc_wrong = Ok(Some("[ar:JAMIE]\n[ti:Pity Party]\n[00:01.00]My mascara\n[00:05.00]Running down".into()));
        assert!(matches!(result(lrc_wrong, &track, "Test", ""), Outcome::Miss));

        // JSON with mismatched artist must be rejected
        let json_wrong = Ok(Some(serde_json::json!({
            "artist": "JAMIE",
            "title": "Pity Party",
            "lyrics": "[00:01.00]Line 1\n[00:05.00]Line 2\n[00:10.00]Line 3\n[00:15.00]Line 4"
        }).to_string()));
        assert!(matches!(result(json_wrong, &track, "Test", ""), Outcome::Miss));

        // JSON with matching artist should be accepted
        let json_correct = Ok(Some(serde_json::json!({
            "artist": "Camila",
            "title": "pity party",
            "plainLyrics": "Line 1\nLine 2\nLine 3\nLine 4"
        }).to_string()));
        assert!(matches!(result(json_correct, &track, "Test", ""), Outcome::Found(_)));
    }


    #[tokio::test]
    #[ignore = "calls public lyrics providers; run manually with network access"]
    async fn live_providers() {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .build()
            .unwrap();
        let track = Track {
            id: "test".into(),
            spotify_id: "4PTG3Z6ehGkBFwjybzWkR8".into(),
            title: "Never Gonna Give You Up".into(),
            artist: "Rick Astley".into(),
            artists: vec![],
            cover_url: None,
            duration_ms: Some(213573),
            added_at: 0,
            source_added_at: None,
            source_url: "".into(),
        };
        let settings = Settings::from_values(&|_| None);
        let describe = |name: &str, outcome: Outcome| {
            let description = match outcome {
                Outcome::Found(d) => format!(
                    "{} / {} lines / {} words",
                    d.sync,
                    d.lines.len(),
                    d.lines.iter().map(|l| l.words.len()).sum::<usize>()
                ),
                Outcome::Miss => "not found".into(),
                Outcome::Failed => "unavailable".into(),
                Outcome::Instrumental => "instrumental".into(),
            };
            println!("{name}: {description}");
        };
        let (a, b, c, d, e, f, g, h, i) = tokio::join!(
            lyricsplus(&client, &track, &settings),
            better(&client, &track, &settings),
            lrcmux(&client, &track),
            amll(&client, &track),
            kugou(&client, &track),
            netease(&client, &track),
            lrclib(&client, &track),
            lrcapi(&client, &track, &settings),
            binimum(&client, &track)
        );
        let outcomes = [
            ("LyricsPlus", a),
            ("BetterLyrics", b),
            ("lrcmux", c),
            ("AMLL", d),
            ("Kugou", e),
            ("NetEase", f),
            ("LRCLIB", g),
            ("LrcApi", h),
            ("BiniLyrics", i),
        ];
        assert!(
            outcomes
                .iter()
                .any(|(_, o)| matches!(o, Outcome::Found(d) if d.sync == "word")),
            "No word-timed source is reachable"
        );
        for (name, outcome) in outcomes {
            describe(name, outcome);
        }
    }
}
