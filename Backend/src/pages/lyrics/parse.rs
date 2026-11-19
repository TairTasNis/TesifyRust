use super::models::{Line, Lyrics, Word};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::read::ZlibDecoder;
use quick_xml::{Reader, events::Event};
use regex::Regex;
use serde_json::Value;
use std::io::Read;

const LIMIT: usize = 2 * 1024 * 1024;

pub fn clock(value: &str) -> Option<f64> {
    let value = value.trim();
    if let Some(ms) = value.strip_suffix("ms") {
        return ms.parse::<f64>().ok().map(|v| v / 1000.0);
    }
    if let Some(s) = value.strip_suffix('s') {
        return s.parse().ok();
    }
    let mut time = 0.0;
    for part in value.split(':') {
        time = time * 60.0 + part.parse::<f64>().ok()?;
    }
    time.is_finite().then_some(time)
}

pub fn lrc(input: &str) -> Vec<Line> {
    let tags = Regex::new(r"\[(\d+:\d+(?:\.\d+)?)\]").unwrap();
    let stamps = Regex::new(r"<(\d+:\d+(?:\.\d+)?)>").unwrap();
    let offset = Regex::new(r"(?i)\[offset:([+-]?\d+)\]")
        .unwrap()
        .captures(input)
        .and_then(|c| c[1].parse::<f64>().ok())
        .unwrap_or(0.0)
        / 1000.0;
    let mut lines = vec![];
    for raw in input.lines().take(2000) {
        let times: Vec<_> = tags
            .captures_iter(raw)
            .filter_map(|c| Some((c.get(0)?.end(), clock(&c[1])?)))
            .collect();
        let Some((end, first)) = times.last().copied() else {
            continue;
        };
        let body = &raw[end..];
        let markers: Vec<_> = stamps.captures_iter(body).collect();
        let mut words = vec![];
        for (i, m) in markers.iter().enumerate() {
            let from = m.get(0).unwrap().end();
            let to = markers
                .get(i + 1)
                .map_or(body.len(), |n| n.get(0).unwrap().start());
            let text = &body[from..to];
            if text.is_empty() {
                continue;
            }
            let start = clock(&m[1]).unwrap_or(first);
            let end = markers
                .get(i + 1)
                .and_then(|n| clock(&n[1]))
                .unwrap_or(start);
            words.push(Word {
                text: text.into(),
                start,
                end,
            });
        }
        let text = stamps.replace_all(body, "").to_string();
        for (_, start) in &times {
            let shift = start - first + offset;
            lines.push(Line {
                text: text.clone(),
                start: start + offset,
                end: 0.0,
                end_inferred: false,
                words: words
                    .iter()
                    .map(|w| Word {
                        text: w.text.clone(),
                        start: w.start + shift,
                        end: w.end + shift,
                    })
                    .collect(),
            });
        }
    }
    if lines.iter().any(|line| line.text.trim().is_empty()) {
        lines.sort_by(|a, b| a.start.total_cmp(&b.start));
        let mut previous: Option<&mut Line> = None;
        for line in &mut lines {
            if line.text.trim().is_empty() {
                if let Some(vocal) = previous.take().filter(|vocal| vocal.start < line.start) {
                    vocal.end = line.start;
                }
            } else {
                previous = Some(line);
            }
        }
    }
    lines
}

pub fn karaoke(input: &str, relative: bool) -> Vec<Line> {
    let line_re = Regex::new(r"^\[(\d+),(\d+)\](.*)$").unwrap();
    let word_re = if relative {
        r"<(\d+),(\d+),\d+>([^<]*)"
    } else {
        r"\((\d+),(\d+),\d+\)([^()]*)"
    };
    let word_re = Regex::new(word_re).unwrap();
    input
        .lines()
        .take(2000)
        .filter_map(|raw| {
            let c = line_re.captures(raw)?;
            let start = c[1].parse::<f64>().ok()? / 1000.0;
            let end = start + c[2].parse::<f64>().ok()? / 1000.0;
            let words: Vec<_> = word_re
                .captures_iter(&c[3])
                .filter_map(|w| {
                    let begin =
                        w[1].parse::<f64>().ok()? / 1000.0 + if relative { start } else { 0.0 };
                    Some(Word {
                        text: w[3].into(),
                        start: begin,
                        end: begin + w[2].parse::<f64>().ok()? / 1000.0,
                    })
                })
                .collect();
            (!words.is_empty()).then(|| Line {
                text: words.iter().map(|w| w.text.as_str()).collect(),
                start,
                end,
                end_inferred: false,
                words,
            })
        })
        .collect()
}

pub fn decode_krc(content: &str) -> Option<String> {
    let raw = STANDARD.decode(content).ok()?;
    if !raw.starts_with(b"krc1") || raw.len() > LIMIT {
        return None;
    }
    let key = [
        64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105,
    ];
    let bytes: Vec<u8> = raw[4..]
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % 16])
        .collect();
    let mut text = String::new();
    ZlibDecoder::new(bytes.as_slice())
        .take((LIMIT + 1) as u64)
        .read_to_string(&mut text)
        .ok()?;
    (text.len() <= LIMIT).then_some(text)
}

#[derive(Default)]
struct Frame {
    start: Option<f64>,
    end: Option<f64>,
    skip: bool,
    word: Option<Word>,
}

pub fn ttml(input: &str) -> Vec<Line> {
    let mut reader = Reader::from_str(input);
    let mut frames: Vec<Frame> = vec![];
    let mut line: Option<Line> = None;
    let mut lines = vec![];
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.local_name();
                let mut frame = Frame::default();
                frame.skip = frames.last().is_some_and(|f| f.skip);
                for a in e.attributes().flatten() {
                    let Ok(value) = a.normalized_value(quick_xml::XmlVersion::Implicit1_0) else {
                        continue;
                    };
                    match a.key.local_name().as_ref() {
                        "begin" => frame.start = clock(&value),
                        "end" => frame.end = clock(&value),
                        "role" if value.contains("translation") || value.contains("roman") => {
                            frame.skip = true
                        }
                        _ => {}
                    }
                }
                if name.as_ref() == "p" && !frame.skip {
                    line = Some(Line {
                        text: String::new(),
                        start: frame.start.unwrap_or(f64::NAN),
                        end: frame.end.unwrap_or(0.0),
                        end_inferred: false,
                        words: vec![],
                    });
                } else if name.as_ref() == "span"
                    && frame.start.is_some()
                    && !frame.skip
                    && line.is_some()
                {
                    frame.word = Some(Word {
                        text: String::new(),
                        start: frame.start.unwrap(),
                        end: frame.end.unwrap_or(0.0),
                    });
                }
                frames.push(frame);
            }
            Ok(Event::Text(e)) => {
                if frames.last().is_some_and(|f| f.skip) {
                    continue;
                }
                append_text(&e, &mut line, &mut frames);
            }
            Ok(Event::GeneralRef(e)) => {
                if frames.last().is_some_and(|f| f.skip) {
                    continue;
                }
                let encoded = format!("&{};", &*e);
                if let Ok(text) = quick_xml::escape::unescape(&encoded) {
                    append_text(&text, &mut line, &mut frames);
                }
            }
            Ok(Event::End(e)) => {
                if let Some(frame) = frames.pop() {
                    if let Some(word) = frame.word.filter(|w| !w.text.trim().is_empty()) {
                        if let Some(l) = &mut line {
                            l.words.push(word);
                        }
                    }
                }
                if e.local_name().as_ref() == "p" {
                    if let Some(mut l) = line.take() {
                        if !l.start.is_finite() {
                            l.start = l.words.first().map_or(f64::NAN, |w| w.start);
                        }
                        lines.push(l);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return vec![],
            _ => {}
        }
        if lines.len() > 2000 || frames.len() > 128 {
            return vec![];
        }
    }
    lines
}

fn append_text(text: &str, line: &mut Option<Line>, frames: &mut [Frame]) {
    let Some(line) = line else { return };
    line.text.push_str(text);
    if let Some(word) = frames.iter_mut().rev().find_map(|f| f.word.as_mut()) {
        word.text.push_str(text);
    } else if text.chars().all(char::is_whitespace) {
        if let Some(last) = line.words.last_mut() {
            last.text.push_str(text);
        }
    }
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str()?.parse().ok())
}
fn ms(v: &Value) -> Option<f64> {
    number(v).map(|v| v / 1000.0)
}

pub fn json(value: &Value) -> Vec<Line> {
    for key in [
        "ttml",
        "syncedLyrics",
        "yrc",
        "krc",
        "lrc",
        "lyric",
        "lyrics",
    ] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let parsed = text_format(text);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }
    let array = value
        .as_array()
        .or_else(|| value.get("lyrics")?.as_array())
        .or_else(|| value.get("lines")?.as_array());
    if let Some(array) = array {
        let mut lines = vec![];
        for item in array.iter().take(2000) {
            if let Some(text) = item.get("lyrics").and_then(Value::as_str) {
                lines.extend(text_format(text));
                continue;
            }
            let Some(text) = item.get("text").and_then(Value::as_str) else {
                continue;
            };
            let Some(start) = item.get("time").or_else(|| item.get("start")).and_then(ms) else {
                continue;
            };
            let end = item
                .get("end")
                .and_then(ms)
                .or_else(|| item.get("duration").and_then(ms).map(|d| start + d))
                .unwrap_or(0.0);
            let words = item
                .get("syllabus")
                .or_else(|| item.get("words"))
                .and_then(Value::as_array)
                .map(|words| {
                    words
                        .iter()
                        .filter_map(|word| {
                            let text = word.get("text")?.as_str()?.to_string();
                            let start = word
                                .get("time")
                                .or_else(|| word.get("start"))
                                .and_then(ms)?;
                            let end = word
                                .get("end")
                                .and_then(ms)
                                .or_else(|| word.get("duration").and_then(ms).map(|d| start + d))
                                .unwrap_or(0.0);
                            Some(Word { text, start, end })
                        })
                        .collect()
                })
                .unwrap_or_default();
            lines.push(Line {
                text: text.into(),
                start,
                end,
                end_inferred: false,
                words,
            });
        }
        if !lines.is_empty() {
            return lines;
        }
    }
    for key in ["data", "result", "lrc", "yrc"] {
        if let Some(child) = value.get(key) {
            if child.is_object() {
                let lines = json(child);
                if !lines.is_empty() {
                    return lines;
                }
            }
        }
    }
    if let Some(text) = value.get("plainLyrics").and_then(Value::as_str) {
        return plain(text);
    }
    vec![]
}

fn plain(text: &str) -> Vec<Line> {
    text.lines()
        .take(2000)
        .filter(|s| !s.trim().is_empty())
        .map(|s| Line {
            text: s.trim().into(),
            start: 0.0,
            end: 0.0,
            end_inferred: false,
            words: vec![],
        })
        .collect()
}

pub fn text_format(text: &str) -> Vec<Line> {
    let text = text.trim_start_matches('\u{feff}').trim();
    if text.len() > LIMIT {
        return vec![];
    }
    if text.starts_with('<') {
        return ttml(text);
    }
    let yrc = karaoke(text, false);
    if !yrc.is_empty() {
        return yrc;
    }
    let krc = karaoke(text, true);
    if !krc.is_empty() {
        return krc;
    }
    lrc(text)
}

pub fn document(
    mut lines: Vec<Line>,
    source: &str,
    source_url: &str,
    duration: f64,
) -> Option<Lyrics> {
    lines.retain(|l| l.start.is_finite() && l.end.is_finite() && !l.text.trim().is_empty());
    if lines.is_empty() {
        return None;
    }
    // Reject accidental probes and empty snippets uploaded for full-length tracks.
    if duration > 45.0
        && lines.len() < 3
        && lines.iter().map(|l| l.text.chars().count()).sum::<usize>() < 60
    {
        return None;
    }
    let timed = lines.iter().any(|l| l.start > 0.0 || l.end > 0.0);
    if timed && duration > 15.0 {
        let last_time = lines.iter().map(|l| l.end.max(l.start)).fold(0.0, f64::max);
        let first_time = lines.iter().map(|l| l.start).fold(f64::INFINITY, f64::min);

        // Reject lyrics whose timestamps extend beyond the song duration (+ 5 seconds or +3%).
        // A song cannot have vocal lines after it ends; this eliminates live, extended, and wrong mixes.
        let max_allowed_end = duration + 5.0_f64.max(duration * 0.03);
        if last_time > max_allowed_end {
            return None;
        }

        // Reject incomplete fragments (e.g. only 30% of a full-length track with few lines).
        if duration > 45.0 && last_time < duration * 0.35 && lines.len() < 8 {
            return None;
        }

        // Reject lyrics starting abnormally late in the track.
        if duration > 45.0 && first_time > duration * 0.65 {
            return None;
        }
    }
    if timed {
        lines.sort_by(|a, b| a.start.total_cmp(&b.start));
        for i in 0..lines.len() {
            let next = lines
                .get(i + 1)
                .map(|l| l.start)
                .unwrap_or(duration.max(lines[i].start + 5.0));
            let line = &mut lines[i];
            line.start = line.start.max(0.0);
            if line.end <= line.start {
                line.end = next.max(line.start + 0.1);
                line.end_inferred = true;
            }
            line.words
                .retain(|w| w.start.is_finite() && w.end.is_finite() && !w.text.is_empty());
            line.words.sort_by(|a, b| a.start.total_cmp(&b.start));
            for j in 0..line.words.len() {
                let end = line.words.get(j + 1).map(|w| w.start).unwrap_or(line.end);
                if line.words[j].end <= line.words[j].start {
                    line.words[j].end = end;
                }
                line.words[j].start = line.words[j].start.max(0.0);
            }
            line.words.retain(|w| {
                w.end > w.start && w.start >= line.start - 0.1 && w.end <= line.end + 0.5
            });
            // Keep the complete line when a provider only timed part of its text.
            let actual: String = line.text.chars().filter(|c| !c.is_whitespace()).collect();
            let words: String = line
                .words
                .iter()
                .flat_map(|w| w.text.chars())
                .filter(|c| !c.is_whitespace())
                .collect();
            if actual != words {
                line.words.clear();
            }
        }
    }
    let word_chars: usize = lines
        .iter()
        .filter(|l| !l.words.is_empty())
        .map(|l| l.text.len())
        .sum();
    let all_chars: usize = lines.iter().map(|l| l.text.len()).sum();
    let sync = if word_chars > 0 && word_chars * 2 >= all_chars {
        "word"
    } else if timed {
        "line"
    } else {
        "none"
    };
    Some(Lyrics {
        source: source.into(),
        source_url: source_url.into(),
        sync: sync.into(),
        lines,
        source_duration_ms: None,
        exact_track: false,
    })
}

pub fn extract_metadata(input: &str) -> (Option<String>, Option<String>) {
    let mut artist = None;
    let mut title = None;
    let ar_tag = Regex::new(r"(?i)^\[ar:\s*(.+?)\s*\]").unwrap();
    let ti_tag = Regex::new(r"(?i)^\[ti:\s*(.+?)\s*\]").unwrap();
    let line_artist_tag = Regex::new(
        r"(?i)^(?:\[\d+:\d+(?:\.\d+)?\]\s*)?(?:歌手|演唱|Artist|Singer)\s*[:：]\s*(.+?)\s*$",
    )
    .unwrap();
    let line_title_tag = Regex::new(
        r"(?i)^(?:\[\d+:\d+(?:\.\d+)?\]\s*)?(?:歌名|歌曲|Title|Track)\s*[:：]\s*(.+?)\s*$",
    )
    .unwrap();

    for line in input.lines().take(50) {
        let line = line.trim();
        if artist.is_none() {
            if let Some(c) = ar_tag.captures(line) {
                artist = Some(c[1].trim().to_string());
            } else if let Some(c) = line_artist_tag.captures(line) {
                artist = Some(c[1].trim().to_string());
            }
        }
        if title.is_none() {
            if let Some(c) = ti_tag.captures(line) {
                title = Some(c[1].trim().to_string());
            } else if let Some(c) = line_title_tag.captures(line) {
                title = Some(c[1].trim().to_string());
            }
        }
        if artist.is_some() && title.is_some() {
            break;
        }
    }
    (artist, title)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_lrc_and_offset() {
        let d = document(
            lrc("[offset:-500]\n[00:02.00][00:08.00]Hello\n[00:10.00]World"),
            "test",
            "",
            12.0,
        )
        .unwrap();
        assert_eq!(
            d.lines.iter().map(|l| l.start).collect::<Vec<_>>(),
            [1.5, 7.5, 9.5]
        );
        assert_eq!(d.lines[0].end, 7.5);
        assert_eq!(d.sync, "line");
    }
    #[test]
    fn enhanced_lrc_keeps_word_timing() {
        let d = document(
            lrc("[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.00>"),
            "test",
            "",
            3.0,
        )
        .unwrap();
        assert_eq!(d.sync, "word");
        assert_eq!(d.lines[0].words[1].end, 2.0);
    }
    #[test]
    fn lrc_empty_timestamp_marks_the_end_of_the_vocal_line() {
        let d = document(lrc("[00:02]Hello\n[00:06]\n[00:18]World"), "test", "", 22.0).unwrap();
        assert_eq!(d.lines.len(), 2);
        assert_eq!(d.lines[0].end, 6.0);
        assert!(!d.lines[0].end_inferred);
        assert_eq!(d.lines[1].start, 18.0);
    }
    #[test]
    fn yrc_absolute_krc_relative() {
        let y = karaoke("[10000,2000](10000,500,0)Hello (10500,1500,0)world", false);
        let k = karaoke("[10000,2000]<0,500,0>Hello <500,1500,0>world", true);
        assert_eq!(y[0].words[1].start, 10.5);
        assert_eq!(k[0].words[1].start, 10.5);
    }
    #[test]
    fn ttml_entities_spaces_and_translation() {
        let raw = r#"<tt xmlns:ttm="urn:test"><body><div><p begin="00:01.000" end="3s"><span begin="1s" end="2s">You &amp; I</span> <span begin="2s" end="3s">sing</span><span ttm:role="x-translation">перевод</span></p></div></body></tt>"#;
        let d = document(ttml(raw), "test", "", 4.0).unwrap();
        assert_eq!(d.lines[0].text, "You & I sing");
        assert_eq!(d.sync, "word");
    }
    #[test]
    fn malformed_or_partial_words_do_not_fake_sync() {
        assert!(ttml("<tt><p begin='1s'>broken</tt>").is_empty());
        let d = document(json(&serde_json::json!({"lyrics":[{"time":1000,"duration":2000,"text":"Full line","syllabus":[{"time":1000,"duration":1000,"text":"Full"}]}]})), "test", "", 4.0).unwrap();
        assert_eq!(d.sync, "line");
        assert!(d.lines[0].words.is_empty());
        assert!(decode_krc("aW52YWxpZA==").is_none());
        assert!(document(lrc("[00:00.00]probe"), "test", "", 214.0).is_none());
        assert!(document(lrc("[01:00.00]First line\n[03:50.00]Last line"), "test", "", 180.0).is_none());
    }
    #[test]
    fn extract_metadata_detects_tags_and_lines() {
        let (artist, title) = extract_metadata("[ar:JAMIE]\n[ti:Pity Party]\n[00:01.00]Hello");
        assert_eq!(artist.as_deref(), Some("JAMIE"));
        assert_eq!(title.as_deref(), Some("Pity Party"));

        let (artist, title) = extract_metadata("[00:00.00] 歌手 : Camila Cabello\n[00:00.00] 歌名 : Havana\n[00:01.00]Havana ooh na na");
        assert_eq!(artist.as_deref(), Some("Camila Cabello"));
        assert_eq!(title.as_deref(), Some("Havana"));

        let (artist, title) = extract_metadata("[00:00.00] 作词 : Someone\n[00:01.00]Just lyrics");
        assert_eq!(artist, None);
        assert_eq!(title, None);
    }
}

