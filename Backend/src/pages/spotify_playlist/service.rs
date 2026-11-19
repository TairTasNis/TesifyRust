use crate::shared::spotify::{
    SpotifyClient,
    client::PLAYLIST_HASH,
    mapping::{self, item, text},
    models::*,
};
use serde_json::{Value, json};
pub async fn detail(
    client: &SpotifyClient,
    id: &str,
    offset: u64,
    limit: u64,
) -> Result<CollectionDetail, String> {
    if !mapping::valid_id(id) || offset > 10000 {
        return Err("Некорректный плейлист Spotify.".into());
    }
    let data = client.query("fetchPlaylist", PLAYLIST_HASH, json!({"uri":format!("spotify:playlist:{id}"),"offset":offset,"limit":limit.clamp(1,100),"enableWatchFeedEntrypoint":false,"includeEpisodeContentRatingsV2":true})).await?;
    let playlist = data
        .pointer("/data/playlistV2")
        .ok_or("Плейлист не найден.")?;
    let entity = item(playlist, Some("playlist"))
        .ok_or("Плейлист закрыт или недоступен в гостевом каталоге Spotify.")?;
    let content = playlist.get("content").unwrap_or(&Value::Null);
    let mut tracks = mapping::page(content, offset, false);
    let raw = content.get("items").and_then(Value::as_array);
    for track in &mut tracks.items {
        track.added_at = raw
            .into_iter()
            .flatten()
            .find(|entry| text(mapping::node(entry), "/uri").ends_with(&track.id))
            .and_then(|entry| {
                chrono::DateTime::parse_from_rfc3339(text(entry, "/addedAt/isoString")).ok()
            })
            .map(|date| date.timestamp_millis());
    }
    client.remember(&tracks.items);
    Ok(CollectionDetail {
        owner: entity.subtitle.clone(),
        item: entity,
        description: mapping::plain_text(text(playlist, "/description")),
        followers: playlist.get("followers").and_then(mapping::number),
        release_date: None,
        label: None,
        copyrights: vec![],
        tracks,
        more_albums: vec![],
    })
}
