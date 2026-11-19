use crate::shared::spotify::{
    SpotifyClient,
    client::{ARTIST_HASH, DISCOGRAPHY_HASH},
    mapping::{self, image_at, item, text},
    models::*,
};
use serde_json::{Value, json};

pub async fn detail(client: &SpotifyClient, id: &str) -> Result<ArtistDetail, String> {
    if !mapping::valid_id(id) {
        return Err("Некорректный исполнитель Spotify.".into());
    }
    let data = client
        .query(
            "queryArtistOverview",
            ARTIST_HASH,
            json!({"uri":format!("spotify:artist:{id}"),"locale":"","preReleaseV2":false}),
        )
        .await?;
    let artist = data
        .pointer("/data/artistUnion")
        .ok_or("Исполнитель не найден.")?;
    let entity = item(artist, Some("artist"))
        .ok_or("Исполнитель недоступен в гостевом каталоге Spotify.")?;
    let page = |path: &str| {
        artist
            .pointer(path)
            .map(|v| mapping::page(v, 0, true))
            .unwrap_or_else(CatalogPage::empty)
    };
    let top_tracks = artist
        .pointer("/discography/topTracks/items")
        .map(mapping::items)
        .unwrap_or_default();
    client.remember(&top_tracks);
    let mut playlists = artist
        .pointer("/relatedContent/featuringV2/items")
        .map(mapping::items)
        .unwrap_or_default();
    for playlist in artist
        .pointer("/profile/playlistsV2/items")
        .map(mapping::items)
        .unwrap_or_default()
    {
        if !playlists.iter().any(|entry| entry.id == playlist.id) {
            playlists.push(playlist);
        }
    }
    let gallery = artist
        .pointer("/visuals/gallery/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| image_at(v, "/sources"))
        .collect();
    let top_cities = artist
        .pointer("/stats/topCities/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| {
            Some(ListenerCity {
                name: text(v, "/city").into(),
                country: text(v, "/country").into(),
                listeners: v.get("numberOfListeners").and_then(mapping::number)?,
            })
        })
        .collect();
    let biography = mapping::plain_text(text(artist, "/profile/biography/text"));
    Ok(ArtistDetail {
        artist: entity,
        header_url: image_at(artist, "/headerImage/data/sources"),
        biography: if biography == "." {
            String::new()
        } else {
            biography
        },
        monthly_listeners: artist
            .pointer("/stats/monthlyListeners")
            .and_then(mapping::number),
        followers: artist.pointer("/stats/followers").and_then(mapping::number),
        world_rank: artist.pointer("/stats/worldRank").and_then(mapping::number),
        top_tracks,
        popular_releases: page("/discography/popularReleasesAlbums").items,
        albums: page("/discography/albums"),
        singles: page("/discography/singles"),
        compilations: page("/discography/compilations"),
        playlists,
        appears_on: page("/relatedContent/appearsOn").items,
        related_artists: artist
            .pointer("/relatedContent/relatedArtists/items")
            .map(mapping::items)
            .unwrap_or_default(),
        gallery,
        top_cities,
    })
}

pub async fn releases(
    client: &SpotifyClient,
    id: &str,
    kind: &str,
    offset: u64,
    limit: u64,
) -> Result<CatalogPage, String> {
    if !mapping::valid_id(id) || offset > 10000 {
        return Err("Некорректная страница дискографии.".into());
    }
    let (operation, field) = match kind {
        "all" => ("queryArtistDiscographyAll", "all"),
        "albums" => ("queryArtistDiscographyAlbums", "albums"),
        "singles" => ("queryArtistDiscographySingles", "singles"),
        "compilations" => ("queryArtistDiscographyCompilations", "compilations"),
        _ => return Err("Неизвестная категория релизов.".into()),
    };
    let data = client.query(operation, DISCOGRAPHY_HASH, json!({"uri":format!("spotify:artist:{id}"),"offset":offset,"limit":limit.clamp(1,50),"order":"DATE_DESC"})).await?;
    let page = data
        .pointer(&format!("/data/artistUnion/discography/{field}"))
        .ok_or("Не удалось получить дискографию.")?;
    Ok(mapping::page(page, offset, true))
}
