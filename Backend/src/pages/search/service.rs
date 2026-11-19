use crate::shared::spotify::{SpotifyClient, client::SEARCH_HASH, mapping, models::*};
use serde_json::{Value, json};

pub async fn search(
    client: &SpotifyClient,
    query: &str,
    category: &str,
    offset: u64,
    limit: u64,
) -> Result<SearchResults, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 180 {
        return Err("Введите запрос длиной от 1 до 180 символов.".into());
    }
    if offset > 10000 {
        return Err("Уточните запрос, чтобы увидеть больше подходящих результатов.".into());
    }
    let (operation, hash) = match category {
        "all" => ("searchDesktop", SEARCH_HASH),
        "tracks" => (
            "searchTracks",
            "b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751",
        ),
        "artists" => (
            "searchArtists",
            "7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d",
        ),
        "albums" => (
            "searchAlbums",
            "202cb3305e31e5a0767ba7925f28bd728cf8f8b0217e6da43909056071cd70e9",
        ),
        "playlists" => (
            "searchPlaylists",
            "d520014e748f9ea44f7707d8df1819867ac1205e8b7f3e28f22fe5fc858921b1",
        ),
        _ => return Err("Неизвестная категория поиска.".into()),
    };
    let limit = limit.clamp(1, 50);
    let variables = json!({"searchTerm":query,"offset":offset,"limit":limit,"numberOfTopResults":5,
        "includeAudiobooks":false,"includeArtistHasConcertsField":false,"includePreReleases":true,
        "includeAlbumPreReleases":false,"includeAuthors":false,"includeEpisodeContentRatingsV2":true,
        "isPrefix":null,"sectionFilters":["GENERIC"]});
    let data = client.query(operation, hash, variables).await?;
    let result = data
        .pointer("/data/searchV2")
        .filter(|v| !v.is_null())
        .ok_or("Spotify не вернул результаты поиска.")?;
    let get_page = |key: &str| {
        result
            .get(key)
            .map(|v| mapping::page(v, offset, false))
            .unwrap_or_else(CatalogPage::empty)
    };
    let top_result = result
        .pointer("/topResultsV2/itemsV2")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|v| mapping::item(v, None));
    let results = SearchResults {
        query: query.into(),
        top_result,
        tracks: get_page("tracksV2"),
        artists: get_page("artists"),
        albums: get_page("albumsV2"),
        playlists: get_page("playlists"),
    };
    client.remember(&results.tracks.items);
    if let Some(top) = &results.top_result {
        client.remember(std::slice::from_ref(top));
    }
    Ok(results)
}
