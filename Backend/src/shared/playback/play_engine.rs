//! Рабочий PlayEngine: подбор YouTube по песне, исполнителю и длительности.
//! Общая реализация используется приложением и прототипом в test/.

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    fmt,
    io::{self, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering as AtomicOrdering}, mpsc},
    thread,
    time::{Duration, Instant},
};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

const CLOSE_DURATION: f64 = 1.5;

type Candidates = Vec<Option<Candidate>>;
type SearchSender = mpsc::Sender<((usize, usize), Result<Candidates, PlayEngineError>)>;

struct SearchRequest<'a> {
    title: &'a str,
    artist: &'a str,
    duration: Option<f64>,
    started: Instant,
    timeout: Duration,
    cancelled: AtomicBool,
}

impl SearchRequest<'_> {
    fn remaining(&self, limit: Duration) -> Duration {
        self.timeout.saturating_sub(self.started.elapsed()).min(limit)
    }

    fn stopped(&self) -> bool {
        self.cancelled.load(AtomicOrdering::Relaxed) || self.started.elapsed() >= self.timeout
    }
}

#[derive(Debug, Clone)]
pub struct PlayEngine {
    yt_dlp: PathBuf,
    search_limit: usize,
    timeout: Duration,
    js_runtime: String,
    #[cfg(target_os = "android")]
    android: Option<super::android::AndroidRuntime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMatch {
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_seconds: Option<f64>,
    pub duration_difference_seconds: Option<f64>,
}

#[derive(Clone)]
pub struct AudioSource {
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub content_type: String,
    pub duration_seconds: Option<f64>,
    pub format_id: Option<String>,
    pub filesize: Option<u64>,
}

fn is_audio_url(url: &str) -> bool {
    let Some(host) = url
        .strip_prefix("https://")
        .and_then(|url| url.split('/').next())
    else {
        return false;
    };
    host.bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
        && (host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
}

#[cfg(test)]
mod audio_source_tests {
    use super::is_audio_url;
    #[test]
    fn accepts_only_youtube_audio_cdn() {
        assert!(is_audio_url(
            "https://rr1---sn.example.googlevideo.com/videoplayback?x=1"
        ));
        for url in [
            "http://example.googlevideo.com/x",
            "https://googlevideo.com.evil.test/x",
            "https://127.0.0.1/x",
            "https://attacker@googlevideo.com/x",
            "file:///music.mp3",
        ] {
            assert!(!is_audio_url(url));
        }
    }
}

#[derive(Debug)]
pub enum PlayEngineError {
    InvalidInput(&'static str),
    ToolNotFound(PathBuf),
    Io(io::Error),
    Timeout(Duration),
    SearchFailed(String),
    InvalidResponse(serde_json::Error),
    NoMatch,
}

impl fmt::Display for PlayEngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(f, "{message}"),
            Self::ToolNotFound(path) => write!(
                f,
                "Не найден {}. Установите yt-dlp или укажите YT_DLP_PATH.",
                path.display()
            ),
            Self::Io(error) => write!(f, "Не удалось выполнить поиск: {error}"),
            Self::Timeout(timeout) => write!(f, "Поиск превысил {} секунд.", timeout.as_secs_f64()),
            Self::SearchFailed(message) => write!(f, "Ошибка поиска YouTube: {message}"),
            Self::InvalidResponse(error) => write!(f, "Некорректный ответ yt-dlp: {error}"),
            Self::NoMatch => write!(
                f,
                "Подходящее видео с совпадающей песней и исполнителем не найдено."
            ),
        }
    }
}

impl Error for PlayEngineError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::InvalidResponse(error) => Some(error),
            _ => None,
        }
    }
}

impl Default for PlayEngine {
    fn default() -> Self {
        Self {
            yt_dlp: default_tool(),
            search_limit: 40,
            timeout: Duration::from_secs(45),
            js_runtime: default_js_runtime(),
            #[cfg(target_os = "android")]
            android: None,
        }
    }
}

fn default_tool() -> PathBuf {
    if let Some(path) = std::env::var_os("YT_DLP_PATH") {
        return path.into();
    }
    let file = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    let mut paths = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths.push(parent.join("tools").join(file));
        }
    }
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tools")
            .join(file),
    );
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../Backend/tools")
            .join(file),
    );
    paths
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("yt-dlp"))
}

fn default_js_runtime() -> String {
    if let Ok(runtime) = std::env::var("YT_DLP_JS_RUNTIME") {
        return runtime;
    }
    #[cfg(windows)]
    {
        let path = PathBuf::from("C:/Program Files/nodejs/node.exe");
        if path.is_file() {
            return format!("node:{}", path.display());
        }
    }
    "node".into()
}

impl PlayEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_yt_dlp(mut self, path: impl Into<PathBuf>) -> Self {
        self.yt_dlp = path.into();
        self
    }

    pub fn with_js_runtime(mut self, runtime: String) -> Self {
        self.js_runtime = runtime;
        self
    }

    #[cfg(target_os = "android")]
    pub(super) fn with_android_runtime(mut self, runtime: super::android::AndroidRuntime) -> Self {
        self.js_runtime = format!("quickjs:{}", runtime.quick_js.display());
        self.android = Some(runtime);
        self
    }

    fn command(&self) -> Command {
        #[cfg(target_os = "android")]
        let mut command = match &self.android {
            Some(runtime) => {
                let mut command = Command::new(&runtime.python);
                command.arg(&runtime.yt_dlp)
                    .env("LD_LIBRARY_PATH", runtime.python_home.join("lib"))
                    .env("SSL_CERT_FILE", runtime.python_home.join("etc/tls/cert.pem"))
                    .env("PYTHONHOME", &runtime.python_home)
                    .env("HOME", &runtime.cache_dir)
                    .env("TMPDIR", &runtime.cache_dir)
                    .arg("--cache-dir").arg(runtime.cache_dir.join("yt-dlp"));
                command
            }
            None => Command::new(&self.yt_dlp),
        };
        #[cfg(not(target_os = "android"))]
        let mut command = Command::new(&self.yt_dlp);
        // HTTPS audio is streamed as-is. Do not look for FFmpeg or implicit JS runtimes.
        command.args(["--ignore-config", "--no-plugin-dirs", "--ffmpeg-location", "", "--no-js-runtimes"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        command
    }

    /// Получает адрес аудиофайла и необходимые заголовки без скачивания файла.
    pub fn audio_source(&self, video: &VideoMatch) -> Result<AudioSource, PlayEngineError> {
        let mut command = self.command();
        command.args([
            "--dump-single-json", "--skip-download",
            "--no-playlist", "--no-warnings", "--no-color", "--socket-timeout", "15",
            "--retries", "1", "--extractor-retries", "1", "--js-runtimes", &self.js_runtime,
            "--remote-components", "ejs:github", "--format",
            "bestaudio[ext=m4a][protocol=https]/bestaudio[ext=webm][protocol=https]/bestaudio[protocol=https]",
            "--", &video.url,
        ]);
        let bytes = run_command(&mut command, self.timeout)?;
        let info: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(PlayEngineError::InvalidResponse)?;
        let url = info["url"]
            .as_str()
            .ok_or(PlayEngineError::NoMatch)?
            .to_string();
        if !is_audio_url(&url) {
            return Err(PlayEngineError::NoMatch);
        }
        let headers = info["http_headers"]
            .as_object()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let content_type = if info["ext"].as_str() == Some("webm") {
            "audio/webm"
        } else {
            "audio/mp4"
        };
        Ok(AudioSource {
            url,
            headers,
            content_type: content_type.into(),
            duration_seconds: info["duration"].as_f64(),
            format_id: info["format_id"].as_str().map(str::to_owned),
            filesize: info["filesize"].as_u64(),
        })
    }

    /// Размер каждой выборки ограничивается диапазоном 1..=50; по умолчанию 40.
    pub fn with_search_limit(mut self, limit: usize) -> Self {
        self.search_limit = limit.clamp(1, 50);
        self
    }

    /// Общий таймаут процесса. По умолчанию 45 секунд.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Возвращает обычную ссылку `https://www.youtube.com/watch?v=...`.
    /// `duration_seconds` — желаемая длительность в секундах, например Some(200).
    /// Блокирующий метод: в async-приложении вызывать через spawn_blocking.
    pub fn find_url(
        &self,
        title: &str,
        artist: &str,
        duration_seconds: Option<u64>,
    ) -> Result<String, PlayEngineError> {
        self.find(title, artist, duration_seconds)
            .map(|video| video.url)
    }

    /// Возвращает ссылку вместе с названием, каналом и разницей длительности.
    /// При заданной длительности видео без известной длительности исключаются.
    /// Без неё предпочтение отдаётся official audio и каналам Topic.
    pub fn find(
        &self,
        title: &str,
        artist: &str,
        duration_seconds: Option<u64>,
    ) -> Result<VideoMatch, PlayEngineError> {
        self.find_with_duration(title, artist, duration_seconds.map(Duration::from_secs))
    }

    pub fn find_with_duration(
        &self,
        title: &str,
        artist: &str,
        duration: Option<Duration>,
    ) -> Result<VideoMatch, PlayEngineError> {
        validate_input(title, artist, duration)?;
        let queries = search_queries(title, artist);
        let request = &SearchRequest {
            title,
            artist,
            duration: duration.map(|value| value.as_secs_f64()),
            started: Instant::now(),
            timeout: self.timeout,
            cancelled: AtomicBool::new(false),
        };
        thread::scope(|scope| {
            let (send, received) = mpsc::channel();
            let video_send = send.clone();
            let queries = &queries;
            scope.spawn(move || self.search_videos(queries, request, video_send));
            scope.spawn(move || self.search_music(&queries[1], request, send));

            let mut batches = BTreeMap::new();
            let mut best = None;
            let mut last_error = None;
            for (order, result) in received {
                match result {
                    Ok(entries) => {
                        batches.insert(order, entries);
                    }
                    Err(error @ PlayEngineError::ToolNotFound(_)) => {
                        request.cancelled.store(true, AtomicOrdering::Relaxed);
                        return Err(error);
                    }
                    Err(error) => {
                        last_error = Some(error);
                        continue;
                    }
                }
                best = best_video(title, artist, request.duration, batches.values().flatten().flatten());
                if best.as_ref().is_some_and(RankedVideo::confirmed) {
                    request.cancelled.store(true, AtomicOrdering::Relaxed);
                    break;
                }
            }
            best.map(|ranked| ranked.video).ok_or_else(|| {
                if batches.is_empty() {
                    last_error.unwrap_or(PlayEngineError::Timeout(self.timeout))
                } else {
                    PlayEngineError::NoMatch
                }
            })
        })
    }

    fn search_videos(&self, queries: &[String], request: &SearchRequest<'_>, send: SearchSender) {
        for (index, query) in queries.iter().enumerate() {
            if index == 1 {
                continue;
            }
            if request.stopped() {
                break;
            }
            let source = format!("ytsearch{}:{query}", self.search_limit);
            let result = self.search(&source, request);
            let confirmed = result.as_ref().is_ok_and(|entries| {
                best_video(request.title, request.artist, request.duration, entries.iter().flatten())
                    .is_some_and(|best| best.confirmed())
            });
            if send.send(((index, 0), result)).is_err() || confirmed {
                break;
            }
        }
    }

    fn search_music(&self, query: &str, request: &SearchRequest<'_>, send: SearchSender) {
        let source = format!("https://music.youtube.com/search?q={}#songs", encode_query(query));
        let result = self.search(&source, request);
        let mut seen = HashSet::new();
        let ids = result.as_ref().into_iter().flatten().flatten()
            .filter(|entry| entry.title.as_deref().is_some_and(|title| title_matches(title, request.title)))
            .filter(|entry| entry.duration.is_none() || (entry.channel.is_none() && entry.artist.is_none() && entry.uploader.is_none()))
            .filter_map(|entry| entry.id.as_deref().filter(|id| valid_video_id(id)))
            .filter(|id| seen.insert(*id))
            .take(6)
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if send.send(((1, 0), result)).is_err() || ids.is_empty() {
            return;
        }
        // Inspect at most two Music results at a time, alongside the video search.
        let inspect = |start| {
            for (index, id) in ids.iter().enumerate().skip(start).step_by(2) {
                if request.stopped() {
                    break;
                }
                if let Ok(candidate) = self.inspect(id, request) {
                    if send.send(((1, index + 1), Ok(vec![Some(candidate)]))).is_err() {
                        break;
                    }
                }
            }
        };
        thread::scope(|scope| {
            if ids.len() > 1 {
                scope.spawn(|| inspect(1));
            }
            inspect(0);
        });
    }

    fn search(&self, query: &str, request: &SearchRequest<'_>) -> Result<Candidates, PlayEngineError> {
        let mut command = self.command();
        let limit = self.search_limit.to_string();
        command.args([
            "--flat-playlist",
            "--skip-download",
            "--dump-single-json",
            "--no-warnings",
            "--no-color",
            "--socket-timeout",
            "8",
            "--retries",
            "0",
            "--extractor-retries",
            "0",
            "--playlist-end",
            &limit,
            "--",
            query,
        ]);
        let timeout = request.remaining(Duration::from_secs(15));
        let output = run_search_command(&mut command, timeout, Some(&request.cancelled)).map_err(|error| match error {
            PlayEngineError::Io(ref source) if source.kind() == io::ErrorKind::NotFound => {
                PlayEngineError::ToolNotFound(self.yt_dlp.clone())
            }
            other => other,
        })?;

        let response: SearchResponse =
            serde_json::from_slice(&output).map_err(PlayEngineError::InvalidResponse)?;
        Ok(response.entries.unwrap_or_default())
    }

    fn inspect(&self, id: &str, request: &SearchRequest<'_>) -> Result<Candidate, PlayEngineError> {
        let started = Instant::now();
        let limit = Duration::from_secs(12);
        let rapid = self.inspect_video(id, request, request.remaining(Duration::from_secs(5)), true);
        if rapid.as_ref().is_ok_and(|candidate| {
            candidate.title.is_some() && candidate.duration.is_some() &&
                (candidate.channel.is_some() || candidate.artist.is_some() || candidate.uploader.is_some())
        }) || request.stopped() {
            return rapid;
        }
        self.inspect_video(id, request, request.remaining(limit.saturating_sub(started.elapsed())), false)
    }

    fn inspect_video(
        &self,
        id: &str,
        request: &SearchRequest<'_>,
        timeout: Duration,
        metadata_only: bool,
    ) -> Result<Candidate, PlayEngineError> {
        let mut command = self.command();
        let url = format!("https://www.youtube.com/watch?v={id}");
        command.args([
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            "--no-color",
            "--socket-timeout",
            "8",
            "--retries",
            "0",
            "--extractor-retries",
            "0",
            "--ignore-no-formats-error",
        ]);
        if metadata_only {
            command.args(["--extractor-args", "youtube:player_skip=js,configs;skip=hls,dash,translated_subs"]);
        } else {
            command.args(["--js-runtimes", &self.js_runtime, "--remote-components", "ejs:github"]);
        }
        command.args(["--", &url]);
        let output = run_search_command(&mut command, timeout, Some(&request.cancelled))?;
        serde_json::from_slice(&output).map_err(PlayEngineError::InvalidResponse)
    }
}

fn encode_query(query: &str) -> String {
    query
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn search_queries(title: &str, artist: &str) -> Vec<String> {
    let base = matching_title(title);
    let artist = artist.trim();
    let title = title.trim();
    let alias = artist_alias(artist);
    let first_artist = alias
        .filter(|name| has_cyrillic(name) == has_cyrillic(title))
        .unwrap_or(artist);
    let first = format!("{first_artist} {title}");
    // Второй запрос всегда предназначен для YouTube Music.
    let mut queries = vec![first.clone(), first];
    let mut seen = HashSet::from([normalize(&queries[0])]);
    for query in [
        format!("{artist} {title}"),
        format!("{} {title}", alias.unwrap_or(artist)),
        format!("{artist} {base}"),
        format!("{base} {first_artist} audio"),
        format!(
            "{artist} {base} {}",
            language_version(title).unwrap_or("official audio")
        ),
    ] {
        if seen.insert(normalize(&query)) {
            queries.push(query);
        }
    }
    queries
}

fn artist_alias(artist: &str) -> Option<&'static str> {
    match normalize(artist).as_str() {
        "poshlaya molly" => Some("Пошлая Молли"),
        "пошлая молли" => Some("Poshlaya Molly"),
        _ => None,
    }
}

fn has_cyrillic(value: &str) -> bool {
    value.chars().any(|character| matches!(character, '\u{0400}'..='\u{052f}'))
}

fn validate_input(title: &str, artist: &str, duration: Option<Duration>) -> Result<(), PlayEngineError> {
    if normalize(title).is_empty() {
        return Err(PlayEngineError::InvalidInput("Укажите название песни."));
    }
    if normalize(artist).is_empty() {
        return Err(PlayEngineError::InvalidInput("Укажите исполнителя."));
    }
    if title.chars().count() > 512 || artist.chars().count() > 512 {
        return Err(PlayEngineError::InvalidInput(
            "Название и исполнитель должны быть не длиннее 512 символов.",
        ));
    }
    if duration.is_some_and(|value| value.is_zero()) {
        return Err(PlayEngineError::InvalidInput(
            "Длительность должна быть больше нуля.",
        ));
    }
    Ok(())
}

fn run_command(command: &mut Command, timeout: Duration) -> Result<Vec<u8>, PlayEngineError> {
    run_search_command(command, timeout, None)
}

fn run_search_command(
    command: &mut Command,
    timeout: Duration,
    cancelled: Option<&AtomicBool>,
) -> Result<Vec<u8>, PlayEngineError> {
    let interrupted = || cancelled.is_some_and(|flag| flag.load(AtomicOrdering::Relaxed));
    let cancellation_error = || PlayEngineError::Io(io::Error::from(io::ErrorKind::Interrupted));
    if interrupted() {
        return Err(cancellation_error());
    }
    if timeout.is_zero() {
        return Err(PlayEngineError::Timeout(timeout));
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(PlayEngineError::Io)?;
    let stdout = child.stdout.take().expect("stdout configured as piped");
    let stderr = child.stderr.take().expect("stderr configured as piped");
    // Читаем оба потока одновременно: заполненный stderr не должен блокировать процесс.
    let stdout_reader = thread::spawn(move || read_pipe(stdout));
    let stderr_reader = thread::spawn(move || read_pipe(stderr));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if !interrupted() && start.elapsed() < timeout => thread::sleep(Duration::from_millis(25)),
            result => {
                terminate_process(&mut child);
                break Err(match result {
                    Err(error) => PlayEngineError::Io(error),
                    Ok(None) if interrupted() => cancellation_error(),
                    _ => PlayEngineError::Timeout(timeout),
                });
            }
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| PlayEngineError::Io(io::Error::other("stdout reader failed")))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| PlayEngineError::Io(io::Error::other("stderr reader failed")))?;
    let status = status?;
    let stdout = stdout.map_err(PlayEngineError::Io)?;
    let stderr = stderr.map_err(PlayEngineError::Io)?;
    if !status.success() {
        let message: String = String::from_utf8_lossy(&stderr)
            .trim()
            .chars()
            .take(2048)
            .collect();
        return Err(PlayEngineError::SearchFailed(if message.is_empty() {
            format!("yt-dlp завершился со статусом {status}")
        } else {
            message
        }));
    }
    Ok(stdout)
}

fn read_pipe(reader: impl Read) -> io::Result<Vec<u8>> {
    const LIMIT: u64 = 8 * 1024 * 1024;
    let mut bytes = Vec::new();
    reader.take(LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        return Err(io::Error::other("Ответ yt-dlp превышает 8 МБ."));
    }
    Ok(bytes)
}

fn terminate_process(child: &mut Child) {
    // Python-лаунчер yt-dlp.exe может запускать дочерний Python-процесс.
    // Завершаем всё его дерево, чтобы у читателей stdout/stderr закрылся канал.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Deserialize, Default)]
struct SearchResponse {
    entries: Option<Vec<Option<Candidate>>>,
}

#[derive(Clone, Deserialize, Default)]
struct Candidate {
    id: Option<String>,
    title: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    artist: Option<String>,
    track: Option<String>,
    duration: Option<f64>,
    is_live: Option<bool>,
    live_status: Option<String>,
    availability: Option<String>,
    channel_is_verified: Option<bool>,
}

#[cfg(any(target_os = "android", test))]
pub(super) fn confirmed_catalog_song(
    title: &str,
    artist: &str,
    duration: Duration,
    songs: impl IntoIterator<Item = (String, String, String, u64)>,
) -> Option<VideoMatch> {
    let candidates: Vec<_> = songs.into_iter().map(|(id, title, artist, seconds)| Candidate {
        id: Some(id),
        track: Some(title.clone()),
        title: Some(title),
        channel: Some(artist),
        duration: Some(seconds as f64),
        ..Candidate::default()
    }).collect();
    best_video(title, artist, Some(duration.as_secs_f64()), candidates.iter())
        .filter(RankedVideo::confirmed)
        .map(|ranked| ranked.video)
}

struct RankedVideo {
    video: VideoMatch,
    quality: u32,
    position: usize,
    confirmed_recording: bool,
}

impl RankedVideo {
    fn confirmed(&self) -> bool {
        self.confirmed_recording && self.video.duration_difference_seconds.is_none_or(|delta| delta <= CLOSE_DURATION)
    }
}

fn best_video<'a>(
    title: &str,
    artist: &str,
    desired_duration: Option<f64>,
    candidates: impl IntoIterator<Item = &'a Candidate>,
) -> Option<RankedVideo> {
    let requested_language = language_version(title);
    let title = matching_title(title);
    let alias = artist_alias(artist).map(normalize);
    let artist = normalize(artist);
    let artist_names = std::iter::once(artist.as_str()).chain(alias.as_deref()).collect::<Vec<_>>();
    let request = format!("{artist} {title}");
    candidates
        .into_iter()
        .enumerate()
        .filter_map(|(position, candidate)| {
            let id = candidate.id.as_deref()?;
            if !valid_video_id(id) {
                return None;
            }
            if candidate.is_live == Some(true)
                || matches!(
                    candidate.live_status.as_deref(),
                    Some("is_live" | "is_upcoming" | "post_live")
                )
                || matches!(
                    candidate.availability.as_deref(),
                    Some("private" | "premium_only" | "subscriber_only" | "needs_auth")
                )
            {
                return None;
            }
            let video_title = candidate.title.as_deref()?;
            let normalized_title = normalize(video_title);
            let credits = [
                candidate.channel.as_deref(),
                candidate.uploader.as_deref(),
                candidate.artist.as_deref(),
            ];
            let own_channel = credits.into_iter().flatten()
                .any(|channel| artist_names.iter().any(|name| artist_channel_matches(channel, name)));
            let matches_artist = own_channel || credits.into_iter().flatten().chain([video_title])
                .any(|credit| {
                    let credit = normalize(credit);
                    artist_names.iter().any(|name| name_matches(&credit, name))
                });
            let credited_cover = artist_names.iter().any(|name| {
                has_phrase(&normalized_title, &format!("cover by {name}"))
                    || has_phrase(&normalized_title, &format!("кавер {name}"))
            });
            let language = language_version(video_title);
            let candidate_title = matching_title(video_title);
            if !name_matches(&candidate_title, &title)
                || !matches_artist
                || (requested_language.is_some()
                    && language.is_some()
                    && requested_language != language)
                || (requested_language.is_some() && language.is_none() && !own_channel)
                || unwanted_version(&normalized_title, &request, own_channel || credited_cover)
            {
                return None;
            }
            let duration = candidate
                .duration
                .filter(|seconds| seconds.is_finite() && *seconds > 0.0);
            let difference = match desired_duration {
                Some(target) => Some((duration? - target).abs()),
                None => None,
            };
            let channel = candidate.channel.as_ref().or(candidate.uploader.as_ref());
            let track_credit = candidate.track.as_deref().is_some_and(|track| matching_title(track) == title);
            let quality = music_quality(
                &normalized_title,
                channel.map(String::as_str),
                candidate.channel_is_verified,
            ) + u32::from(own_channel) * 20 + u32::from(track_credit && own_channel) * 30;
            let confirmed_recording = own_channel
                && (track_credit
                    || channel.is_some_and(|channel| normalize(channel).ends_with(" topic"))
                    || has_phrase(&normalized_title, "official audio")
                    || (candidate.channel_is_verified == Some(true) && candidate_title == title));
            Some(RankedVideo {
                quality,
                position,
                confirmed_recording,
                video: VideoMatch {
                    url: format!("https://www.youtube.com/watch?v={id}"),
                    title: video_title.to_owned(),
                    channel: channel.cloned(),
                    duration_seconds: duration,
                    duration_difference_seconds: difference,
                },
            })
        })
        .min_by(|a, b| {
            let distance = |ranked: &RankedVideo| ranked.video.duration_difference_seconds.unwrap_or_default();
            let distance_rank = |ranked| {
                let delta = distance(ranked);
                if delta <= CLOSE_DURATION { 0.0 } else { delta }
            };
            distance_rank(a)
                .total_cmp(&distance_rank(b))
                .then_with(|| b.confirmed_recording.cmp(&a.confirmed_recording))
                .then_with(|| b.quality.cmp(&a.quality))
                .then_with(|| distance(a).total_cmp(&distance(b)))
                .then_with(|| a.position.cmp(&b.position))
        })
}

#[cfg(test)]
fn choose_video(
    title: &str,
    artist: &str,
    desired_duration: Option<u64>,
    candidates: Candidates,
) -> Result<VideoMatch, PlayEngineError> {
    best_video(title, artist, desired_duration.map(|seconds| seconds as f64), candidates.iter().flatten())
        .map(|ranked| ranked.video)
        .ok_or(PlayEngineError::NoMatch)
}

fn normalize(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn language_version(value: &str) -> Option<&'static str> {
    let value = normalize(value);
    for (language, aliases) in [
        (
            "russian",
            &[
                "russian ver",
                "russian version",
                "russian cover",
                "rus cover",
                "vocaloid rus",
                "на русском",
                "русская версия",
                "русскии кавер",
            ][..],
        ),
        (
            "english",
            &[
                "english ver",
                "english version",
                "english cover",
                "eng cover",
                "на англииском",
            ][..],
        ),
        (
            "japanese",
            &[
                "japanese ver",
                "japanese version",
                "japanese cover",
                "на японском",
            ][..],
        ),
        (
            "korean",
            &[
                "korean ver",
                "korean version",
                "korean cover",
                "на кореиском",
            ][..],
        ),
    ] {
        if aliases.iter().any(|alias| has_phrase(&value, alias)) {
            return Some(language);
        }
    }
    None
}

fn matching_title(value: &str) -> String {
    let normalized = normalize(value);
    if language_version(value).is_none() {
        return normalized;
    }
    normalized
        .split_whitespace()
        .filter(|word| {
            !matches!(
                *word,
                "russian"
                    | "rus"
                    | "english"
                    | "eng"
                    | "japanese"
                    | "korean"
                    | "ver"
                    | "version"
                    | "русская"
                    | "версия"
                    | "русскии"
                    | "на"
                    | "русском"
                    | "англииском"
                    | "японском"
                    | "кореиском"
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_matches(video: &str, requested: &str) -> bool {
    name_matches(&matching_title(video), &matching_title(requested))
}

fn artist_channel_matches(channel: &str, artist: &str) -> bool {
    let channel = normalize(channel);
    let channel = channel
        .strip_suffix(" topic")
        .or_else(|| channel.strip_suffix(" official"))
        .or_else(|| channel.strip_suffix("vevo"))
        .unwrap_or(&channel)
        .trim();
    channel == artist
        || channel.split_whitespace().collect::<String>()
            == artist.split_whitespace().collect::<String>()
}

fn name_matches(haystack: &str, name: &str) -> bool {
    let words: Vec<_> = haystack.split_whitespace().collect();
    let compact: String = name.split_whitespace().collect();
    name.split_whitespace().all(|word| words.contains(&word))
        || words
            .iter()
            .any(|word| *word == compact || word.strip_suffix("vevo") == Some(compact.as_str()))
}

fn has_phrase(text: &str, phrase: &str) -> bool {
    format!(" {text} ").contains(&format!(" {phrase} "))
}

fn unwanted_version(title: &str, request: &str, own_cover: bool) -> bool {
    const VERSIONS: &[&str] = &[
        "cover",
        "karaoke",
        "instrumental",
        "remix",
        "slowed",
        "reverb",
        "nightcore",
        "live",
        "concert",
        "reaction",
        "tutorial",
        "mashup",
        "sped up",
        "speed up",
        "8d",
        "bass boosted",
        "full album",
        "greatest hits",
        "playlist",
        "1 hour",
        "кавер",
        "караоке",
        "ремикс",
        "инструментал",
        "реакция",
        "урок",
        "концерт",
        "сборник",
        "плейлист",
        "полныи альбом",
        "ускоренная",
        "замедленная",
    ];
    VERSIONS.iter().any(|version| {
        has_phrase(title, version)
            && !has_phrase(request, version)
            && !(own_cover && matches!(*version, "cover" | "кавер"))
    })
}

fn music_quality(title: &str, channel: Option<&str>, verified: Option<bool>) -> u32 {
    let mut score = 0;
    if has_phrase(title, "official audio") {
        score += 50;
    }
    if channel.is_some_and(|channel| normalize(channel).ends_with(" topic")) {
        score += 45;
    }
    if has_phrase(title, "official lyric video") || has_phrase(title, "lyric video") || has_phrase(title, "lyrics") {
        score += 25;
    }
    if has_phrase(title, "official music video") || has_phrase(title, "official video") {
        score += 15;
    }
    if verified == Some(true) {
        score += 5;
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[cfg(windows)]
    fn fixture_name() -> String {
        format!(
            "{}::subprocess_fixture",
            module_path!().split_once("::").expect("module path").1
        )
    }

    #[cfg(windows)]
    #[test]
    fn subprocess_fixture() {
        match std::env::var("PLAY_ENGINE_PROCESS_FIXTURE").as_deref() {
            Ok("sleep") => thread::sleep(Duration::from_secs(15)),
            Ok("spawn-child") => {
                Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", &fixture_name()])
                    .env("PLAY_ENGINE_PROCESS_FIXTURE", "sleep")
                    .status()
                    .unwrap();
            }
            _ => {}
        }
    }

    #[cfg(windows)]
    #[test]
    fn timeout_terminates_descendants_and_closes_pipes() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", &fixture_name()])
            .env("PLAY_ENGINE_PROCESS_FIXTURE", "spawn-child");
        let start = Instant::now();
        let result = run_command(&mut command, Duration::from_millis(250));
        assert!(matches!(result, Err(PlayEngineError::Timeout(_))));
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "Дочерний процесс удерживает канал после таймаута"
        );
    }

    fn choose(
        data: serde_json::Value,
        duration: Option<u64>,
    ) -> Result<VideoMatch, PlayEngineError> {
        let response: SearchResponse = serde_json::from_value(data).unwrap();
        choose_video(
            "Blinding Lights",
            "The Weeknd",
            duration,
            response.entries.unwrap_or_default(),
        )
    }

    #[test]
    fn nearest_duration_wins_over_official_label() {
        let result = choose(json!({"entries": [
            {"id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights (Official Video)","duration":262},
            {"id":"bbbbbbbbbbb","title":"The Weeknd - Blinding Lights","duration":200.5},
            {"id":"ccccccccccc","title":"The Weeknd - Blinding Lights (Official Audio)","duration":205}
        ]}), Some(200)).unwrap();
        assert!(result.url.ends_with("bbbbbbbbbbb"));
        assert_eq!(result.duration_difference_seconds, Some(0.5));
    }

    #[test]
    fn matching_duration_is_not_enough_for_wrong_song_or_artist() {
        let result = choose(
            json!({"entries": [
                {"id":"aaaaaaaaaaa","title":"Other Artist - Blinding Lights","duration":200},
                {"id":"bbbbbbbbbbb","title":"The Weeknd - Starboy","duration":200},
                {"id":"ccccccccccc","title":"The Weeknd - Blinding Lights","duration":204}
            ]}),
            Some(200),
        )
        .unwrap();
        assert!(result.url.ends_with("ccccccccccc"));
    }

    #[test]
    fn excludes_cover_remix_and_live_even_if_duration_is_exact() {
        let result = choose(
            json!({"entries": [
                {"id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights (Cover)","duration":200},
                {"id":"bbbbbbbbbbb","title":"The Weeknd - Blinding Lights (Remix)","duration":200},
                {"id":"ccccccccccc","title":"The Weeknd - Blinding Lights (Live)","duration":200},
                {"id":"ddddddddddd","title":"The Weeknd - Blinding Lights","duration":201}
            ]}),
            Some(200),
        )
        .unwrap();
        assert!(result.url.ends_with("ddddddddddd"));
    }

    #[test]
    fn no_duration_prefers_official_audio() {
        let result = choose(json!({"entries": [
            {"id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights (Lyrics)","duration":200},
            {"id":"bbbbbbbbbbb","title":"The Weeknd - Blinding Lights (Official Audio)","duration":202}
        ]}), None).unwrap();
        assert!(result.url.ends_with("bbbbbbbbbbb"));
        assert_eq!(result.duration_difference_seconds, None);
    }

    #[test]
    fn official_audio_breaks_duration_ties() {
        let result = choose(json!({"entries": [
            {"id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights","duration":199},
            {"id":"bbbbbbbbbbb","title":"The Weeknd - Blinding Lights (Official Audio)","duration":201}
        ]}), Some(200)).unwrap();
        assert!(result.url.ends_with("bbbbbbbbbbb"));
    }

    #[test]
    fn accepts_artist_from_topic_channel() {
        let result = choose(json!({"entries": [
            {"id":"aaaaaaaaaaa","title":"Blinding Lights","channel":"The Weeknd - Topic","duration":200}
        ]}), Some(200)).unwrap();
        assert_eq!(result.channel.as_deref(), Some("The Weeknd - Topic"));
    }

    #[test]
    fn skips_live_missing_duration_and_null_entries() {
        let result = choose(json!({"entries": [null,
            {"id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights","is_live":true,"duration":200},
            {"id":"bbbbbbbbbbb","title":"The Weeknd - Blinding Lights","duration":null},
            {"id":"ccccccccccc","title":"The Weeknd - Blinding Lights","duration":201}
        ]}), Some(200)).unwrap();
        assert!(result.url.ends_with("ccccccccccc"));
    }

    #[test]
    fn explicit_remix_is_allowed() {
        let candidate: Candidate = serde_json::from_value(json!({
            "id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights (Remix)","duration":200
        }))
        .unwrap();
        assert!(
            choose_video(
                "Blinding Lights Remix",
                "The Weeknd",
                Some(200),
                vec![Some(candidate)]
            )
            .is_ok()
        );
    }

    #[test]
    fn normalizes_unicode_punctuation_and_vevo_names() {
        assert_eq!(normalize("БЕЙОНСЕ́ — Déjà Vu!"), "беионсе deja vu");
        assert!(name_matches(
            &normalize("BeyoncéVEVO"),
            &normalize("Beyonce")
        ));
        assert!(name_matches(&normalize("ACDC"), &normalize("AC/DC")));
        assert!(!name_matches(
            &normalize("Black Sabbath"),
            &normalize("ABBA")
        ));
    }

    #[test]
    fn handles_cyrillic_song_and_artist() {
        let candidate: Candidate = serde_json::from_value(json!({
            "id":"aaaaaaaaaaa","title":"КИНО — Группа крови (Official Audio)","duration":285
        }))
        .unwrap();
        assert!(choose_video("Группа крови", "Кино", Some(285), vec![Some(candidate)]).is_ok());
    }

    #[test]
    fn matches_contract_with_cyrillic_artist_credits() {
        let response: SearchResponse = serde_json::from_value(json!({"entries": [
            {"id":"aaaaaaaaaaa","title":"Контракт","channel":"Другой исполнитель","duration":204},
            {"id":"bbbbbbbbbbb","title":"ПОШЛАЯ МОЛЛИ — Контракт (Ремикс)","duration":204},
            {"id":"cGmkwjw5oF0","title":"Контракт","channel":"ПОШЛАЯ МОЛЛИ","duration":204}
        ]})).unwrap();
        let result = choose_video("Контракт", "Poshlaya Molly", Some(204), response.entries.unwrap()).unwrap();
        assert!(result.url.ends_with("cGmkwjw5oF0"));
        let queries = search_queries("Контракт", "Poshlaya Molly");
        assert_eq!(queries[0], "Пошлая Молли Контракт");
        assert!(queries.iter().any(|query| query == "Poshlaya Molly Контракт"));
    }

    #[test]
    fn matches_language_alias_and_cover_by_the_requested_performer() {
        let entries = serde_json::from_value::<SearchResponse>(json!({"entries": [
            {"id":"7-yYskdg_aw","title":"[VOCALOID на русском] Monitoring (Cover by Sati Akura)","channel":"Sati Akura","duration":218}
        ]})).unwrap().entries.unwrap();
        let result = choose_video(
            "Monitoring - Russian Ver.",
            "Sati Akura",
            Some(176),
            entries,
        )
        .unwrap();
        assert!(result.url.ends_with("7-yYskdg_aw"));
    }

    #[test]
    fn music_studio_recording_wins_over_longer_music_video() {
        let entries = serde_json::from_value::<SearchResponse>(json!({"entries": [
            {"id":"7-yYskdg_aw","title":"[VOCALOID на русском] Monitoring (Cover by Sati Akura)","channel":"Sati Akura","duration":218},
            {"id":"BF7hRVab23w","title":"Monitoring (Russian Ver.)","channel":"Sati Akura - Topic","duration":176}
        ]})).unwrap().entries.unwrap();
        let result = choose_video(
            "Monitoring - Russian Ver.",
            "Sati Akura",
            Some(176),
            entries,
        )
        .unwrap();
        assert!(result.url.ends_with("BF7hRVab23w"));
    }

    #[test]
    fn language_fallback_keeps_artist_language_and_remix_checks() {
        for candidate in [
            json!({"id":"aaaaaaaaaaa","title":"Monitoring (Russian Ver.)","channel":"Other Singer - Topic","duration":176}),
            json!({"id":"aaaaaaaaaaa","title":"Monitoring (English Cover)","channel":"Sati Akura","duration":176}),
            json!({"id":"aaaaaaaaaaa","title":"Monitoring (Russian Ver.) (Remix)","channel":"Sati Akura","duration":176}),
            json!({"id":"aaaaaaaaaaa","title":"Sati Akura - Monitoring (Russian Cover)","channel":"Other Singer","duration":176}),
            json!({"id":"aaaaaaaaaaa","title":"Monitoring (Russian Ver.)","duration":176}),
        ] {
            let candidate = serde_json::from_value(candidate).unwrap();
            assert!(matches!(
                choose_video(
                    "Monitoring - Russian Ver.",
                    "Sati Akura",
                    Some(176),
                    vec![Some(candidate)]
                ),
                Err(PlayEngineError::NoMatch)
            ));
        }
    }

    #[test]
    fn fallback_queries_preserve_named_remixes_and_encode_input_as_data() {
        let queries = search_queries("Monitoring - Russian Ver.", "Sati Akura");
        assert_eq!(queries[0], "Sati Akura Monitoring - Russian Ver.");
        assert!(queries.contains(&"Sati Akura monitoring".to_string()));
        assert!(
            search_queries("Song (Remix)", "Artist")
                .iter()
                .all(|query| normalize(query).contains("remix"))
        );
        assert_eq!(encode_query("A & Б#songs"), "A%20%26%20%D0%91%23songs");
        assert!(!title_matches("Monitoring", "Monitoring Remix"));
        assert_eq!(matching_title("Russian Roulette"), "russian roulette");
    }

    #[test]
    fn invalid_or_unavailable_results_are_not_returned() {
        let result = choose(
            json!({"entries": [
                {"id":"../../file","title":"The Weeknd - Blinding Lights","duration":200},
                {"id":"aaaaaaaaaaa","title":"The Weeknd - Blinding Lights","availability":"private","duration":200}
            ]}),
            Some(200),
        );
        assert!(matches!(result, Err(PlayEngineError::NoMatch)));
        assert!(matches!(
            choose(json!({"entries":[]}), None),
            Err(PlayEngineError::NoMatch)
        ));
    }

    #[test]
    fn invalid_inputs_fail_before_starting_a_process() {
        let engine = PlayEngine::new().with_yt_dlp("missing-yt-dlp");
        for (title, artist, duration) in [
            ("", "Artist", None),
            ("Song", " ", None),
            ("Song", "Artist", Some(0)),
        ] {
            assert!(matches!(
                engine.find(title, artist, duration),
                Err(PlayEngineError::InvalidInput(_))
            ));
        }
    }

    #[test]
    fn missing_tool_is_reported() {
        let result = PlayEngine::new()
            .with_yt_dlp("definitely-nonexistent-yt-dlp-81732")
            .find("Blinding Lights", "The Weeknd", Some(200));
        assert!(matches!(result, Err(PlayEngineError::ToolNotFound(_))));
    }
}
