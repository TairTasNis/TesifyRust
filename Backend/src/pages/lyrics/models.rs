use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub end_inferred: bool,
    pub words: Vec<Word>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub source: String,
    pub source_url: String,
    pub sync: String,
    pub lines: Vec<Line>,
    #[serde(skip)]
    pub source_duration_ms: Option<f64>,
    #[serde(skip)]
    pub exact_track: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResponse {
    pub status: String,
    pub lyrics: Option<Lyrics>,
    #[serde(default)]
    pub custom: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsCandidate {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub source: String,
    pub sync: String,
    pub preview: Option<String>,
}
