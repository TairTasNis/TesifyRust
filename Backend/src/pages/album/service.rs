use crate::shared::spotify::{
    SpotifyClient,
    client::ALBUM_HASH,
    mapping::{self, item},
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
        return Err("Некорректный альбом Spotify.".into());
    }
    let data = client.query("getAlbum", ALBUM_HASH, json!({"uri":format!("spotify:album:{id}"),"locale":"","offset":offset,"limit":limit.clamp(1,100)})).await?;
    let album = data
        .pointer("/data/albumUnion")
        .ok_or("Альбом не найден.")?;
    let mut entity =
        item(album, Some("album")).ok_or("Альбом недоступен в гостевом каталоге Spotify.")?;
    let release_date = album
        .pointer("/date/isoString")
        .and_then(Value::as_str)
        .map(str::to_owned);
    entity.year = release_date
        .as_deref()
        .and_then(|date| date.get(..4))
        .and_then(|year| year.parse().ok());
    let mut tracks = album
        .get("tracksV2")
        .map(|v| mapping::page(v, offset, false))
        .unwrap_or_else(CatalogPage::empty);
    for track in &mut tracks.items {
        track.image_url = track.image_url.take().or_else(|| entity.image_url.clone());
        track.album_id = Some(id.into());
        track.album_name = Some(entity.name.clone());
    }
    client.remember(&tracks.items);
    let copyrights = album
        .pointer("/copyright/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.get("text").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let mut more_albums: Vec<CatalogItem> = album
        .pointer("/moreAlbumsByArtist/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|v| {
            v.pointer("/discography/popularReleasesAlbums/items")
                .map(mapping::items)
                .unwrap_or_default()
        })
        .collect();
    for release in &mut more_albums {
        if release.artists.is_empty() {
            release.artists = entity.artists.clone();
            release.subtitle = entity.subtitle.clone();
        }
    }
    Ok(CollectionDetail {
        owner: entity.subtitle.clone(),
        item: entity,
        description: String::new(),
        followers: None,
        release_date,
        label: album
            .get("label")
            .and_then(Value::as_str)
            .map(str::to_owned),
        copyrights,
        tracks,
        more_albums,
    })
}
