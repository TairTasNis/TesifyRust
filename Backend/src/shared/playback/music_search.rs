use super::play_engine::{VideoMatch, confirmed_catalog_song};
use serde_json::Value;
use std::time::Duration;

#[cfg(target_os = "android")]
pub(super) async fn find(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    duration: Option<Duration>,
) -> Option<VideoMatch> {
    let duration = duration?;
    if title.is_empty() || artist.is_empty() {
        return None;
    }
    let version = "1.20261118.01.00";
    let response = client
        .post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false")
        .header("Origin", "https://music.youtube.com")
        .header("X-YouTube-Client-Name", "67")
        .header("X-YouTube-Client-Version", version)
        .timeout(Duration::from_secs(2))
        .json(&serde_json::json!({
            "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": version, "hl": "en" } },
            "query": format!("{artist} {title}"),
            "params": "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"
        }))
        .send().await.ok()?.error_for_status().ok()?;
    let response = response.json().await.ok()?;
    choose(&response, title, artist, duration)
}

fn choose(response: &Value, title: &str, artist: &str, duration: Duration) -> Option<VideoMatch> {
    let shelves = response.pointer("/contents/tabbedSearchResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents")?.as_array()?;
    let songs = shelves.iter()
        .filter_map(|section| section.pointer("/musicShelfRenderer/contents")?.as_array())
        .flatten()
        .take(16)
        .filter_map(|row| {
            let row = row.get("musicResponsiveListItemRenderer")?;
            let endpoint = row.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint")?;
            if endpoint.pointer("/watchEndpointMusicSupportedConfigs/watchEndpointMusicConfig/musicVideoType")?.as_str()? != "MUSIC_VIDEO_TYPE_ATV" {
                return None;
            }
            let id = row.pointer("/playlistItemData/videoId")?.as_str()?;
            let title = row.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/text")?.as_str()?;
            let credits = row.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")?.as_array()?;
            let seconds = credits.iter().find_map(seconds).or_else(|| {
                row.pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text/runs")?
                    .as_array()?.iter().find_map(seconds)
            })?;
            Some(credits.iter()
                .filter(|run| run.pointer("/navigationEndpoint/browseEndpoint/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
                    .and_then(Value::as_str) == Some("MUSIC_PAGE_TYPE_ARTIST"))
                .filter_map(move |run| Some((id.to_owned(), title.to_owned(), run.get("text")?.as_str()?.to_owned(), seconds))))
        }).flatten();
    confirmed_catalog_song(title, artist, duration, songs)
}

fn seconds(run: &Value) -> Option<u64> {
    let time = run.get("text")?.as_str()?;
    if time.len() > 8 || !time.contains(':') {
        return None;
    }
    time.split(':').try_fold(0u64, |total, part| {
        let field = part.parse::<u64>().ok()?;
        (field < 60).then_some(total * 60 + field)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_matching_catalog_recording_and_falls_back_on_unconfirmed_results() {
        let row = |ty: &str, artist: &str, duration: &str| json!({
            "musicResponsiveListItemRenderer": {
                "playlistItemData": { "videoId": "a1234567890" },
                "overlay": { "musicItemThumbnailOverlayRenderer": { "content": { "musicPlayButtonRenderer": {
                    "playNavigationEndpoint": { "watchEndpoint": {
                        "watchEndpointMusicSupportedConfigs": { "watchEndpointMusicConfig": { "musicVideoType": ty } }
                    } }
                } } } },
                "flexColumns": [
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Night Drive" }] } } },
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                        { "text": artist, "navigationEndpoint": { "browseEndpoint": {
                            "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ARTIST" } }
                        } } },
                        { "text": duration }
                    ] } } }
                ]
            }
        });
        let search = |row: Value| json!({
            "contents": { "tabbedSearchResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                "sectionListRenderer": { "contents": [{ "musicShelfRenderer": { "contents": [row] } }] }
            } } }] } }
        });
        let pick = |row| choose(&search(row), "Night Drive", "Silver Coast", Duration::from_secs(192));
        assert_eq!(pick(row("MUSIC_VIDEO_TYPE_ATV", "Silver Coast", "3:13")).unwrap().duration_seconds, Some(193.));
        assert!(pick(row("MUSIC_VIDEO_TYPE_ATV", "Other Artist", "3:13")).is_none());
        assert!(pick(row("MUSIC_VIDEO_TYPE_ATV", "Silver Coast", "3:19")).is_none());
        assert!(pick(row("MUSIC_VIDEO_TYPE_OMV", "Silver Coast", "3:13")).is_none());
    }
}
