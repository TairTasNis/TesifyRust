/**
 * @fileoverview Main application backend module
 * @copyright Copyright (c) 2026 Tair Tasmukhambetov (@ttfotg)
 * @license TFG License
 * @see {@link ../LICENSE} for full terms and commercial requirement (10% gross royalty).
 * Commercial contact: Telegram @ttfotg | tasmuhambetovtair@gmail.com
 */

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::error::Error;
type SearchResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SearchResultItem {
    Artist {
        id: String,
        url: String,
        name: String,
        avatar_url: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_top_result: bool,
    },
    Track {
        id: String,
        url: String,
        title: String,
        artist: String,
        cover_url: String,
        duration_ms: u64,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_top_result: bool,
    },
    Album {
        id: String,
        url: String,
        name: String,
        artist: String,
        cover_url: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_top_result: bool,
    },
    Playlist {
        id: String,
        url: String,
        name: String,
        owner: String,
        cover_url: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_top_result: bool,
    },
}

pub struct GuestAuth {
    pub access_token: String,
    pub client_token: String,
}

pub struct SpotifyGuestClient {
    client: reqwest::Client,
}

impl SpotifyGuestClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0",
            )
            .build()
            .unwrap();

        Self { client }
    }

    async fn fetch_access_token(&self) -> SearchResult<String> {
        let embed_url = "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M";
        let html = self.client.get(embed_url).send().await?.text().await?;

        let re = Regex::new(r#""accessToken":"([^"]+)""#)?;
        if let Some(captures) = re.captures(&html) {
            if let Some(token_match) = captures.get(1) {
                return Ok(token_match.as_str().to_string());
            }
        }
        Err("Could not extract Spotify accessToken from HTML".into())
    }

    async fn fetch_client_token(&self) -> SearchResult<String> {
        let payload = serde_json::json!({
            "client_data": {
                "client_version": "1.2.96.301.g6a125c73",
                "client_id": "d8a5ba54d237449a160db1266d1656f",
                "js_sdk_data": {
                    "device_brand": "Unknown",
                    "device_model": "desktop",
                    "os": "Windows",
                    "os_version": "NT 10.0"
                }
            }
        });

        let res: serde_json::Value = self
            .client
            .post("https://clienttoken.spotify.com/v1/clienttoken")
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?
            .json()
            .await?;

        if let Some(token) = res["granted_token"]["token"].as_str() {
            Ok(token.to_string())
        } else {
            Err("Could not generate Spotify client-token".into())
        }
    }

    pub async fn fetch_guest_auth(&self) -> SearchResult<GuestAuth> {
        let access_token = self.fetch_access_token().await?;
        let client_token = self.fetch_client_token().await.unwrap_or_default();

        Ok(GuestAuth {
            access_token,
            client_token,
        })
    }

    pub async fn search(
        &self,
        auth: &GuestAuth,
        query: &str,
    ) -> SearchResult<Vec<SearchResultItem>> {
        let url = "https://api-partner.spotify.com/pathfinder/v2/query";

        let payload = serde_json::json!({
            "variables": {
                "searchTerm": query,
                "offset": 0,
                "limit": 10,
                "numberOfTopResults": 5,
                "includeAudiobooks": true,
                "includeArtistHasConcertsField": false,
                "includePreReleases": true,
                "includeAlbumPreReleases": false,
                "includeAuthors": false,
                "includeEpisodeContentRatingsV2": true,
                "isPrefix": null,
                "sectionFilters": ["GENERIC"]
            },
            "operationName": "searchDesktop",
            "extensions": {
                "persistedQuery": {
                    "version": 1,
                    "sha256Hash": "db61238974d27839a136c9dc02bfdbe3fab7635f21cf85976ebff9a1ee281345"
                }
            }
        });

        let mut req = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .header("app-platform", "WebPlayer")
            .header("spotify-app-version", "1.2.96.301.g6a125c73")
            .header("Content-Type", "application/json;charset=UTF-8")
            .header("Referer", "https://open.spotify.com/");

        if !auth.client_token.is_empty() {
            req = req.header("client-token", &auth.client_token);
        }

        let response: serde_json::Value = req.json(&payload).send().await?.json().await?;
        let mut results = Vec::new();

        let search_res = &response["data"]["searchV2"];

        // 1. Извлекаем плашку "Лучший результат" (featured)
        if let Some(featured) = search_res["topResultsV2"]["featured"].as_array() {
            for it in featured {
                Self::parse_node(&it["data"], &mut results, true);
            }
        }

        // 2. Извлекаем остальные топ-результаты (itemsV2)
        if let Some(top_items) = search_res["topResultsV2"]["itemsV2"].as_array() {
            for it in top_items {
                let node = if !it["item"]["data"].is_null() {
                    &it["item"]["data"]
                } else {
                    &it["data"]
                };
                Self::parse_node(node, &mut results, true);
            }
        }

        // 3. Проверяем Треки
        if let Some(tracks) = search_res["tracksV2"]["items"].as_array() {
            for it in tracks {
                let node = if !it["item"]["data"].is_null() {
                    &it["item"]["data"]
                } else {
                    &it["data"]
                };
                Self::parse_node(node, &mut results, false);
            }
        }

        // 4. Проверяем Исполнителей
        if let Some(artists) = search_res["artists"]["items"].as_array() {
            for it in artists {
                let node = if !it["data"].is_null() {
                    &it["data"]
                } else {
                    &it["item"]["data"]
                };
                Self::parse_node(node, &mut results, false);
            }
        }

        // 5. Проверяем Альбомы
        if let Some(albums) = search_res["albumsV2"]["items"].as_array() {
            for it in albums {
                let node = if !it["data"].is_null() {
                    &it["data"]
                } else {
                    &it["item"]["data"]
                };
                Self::parse_node(node, &mut results, false);
            }
        }

        // 6. Проверяем Плейлисты
        if let Some(playlists) = search_res["playlists"]["items"].as_array() {
            for it in playlists {
                let node = if !it["data"].is_null() {
                    &it["data"]
                } else {
                    &it["item"]["data"]
                };
                Self::parse_node(node, &mut results, false);
            }
        }

        results.sort_by_key(search_order);
        Ok(results)
    }

    fn parse_node(item: &serde_json::Value, results: &mut Vec<SearchResultItem>, is_top: bool) {
        if item.is_null() {
            return;
        }

        let typename = item["__typename"].as_str().unwrap_or("");
        let uri = item["uri"].as_str().unwrap_or("");
        let id = uri.split(':').last().unwrap_or("").to_string();

        if id.is_empty() {
            return;
        }

        let exists = results.iter().any(|r| match r {
            SearchResultItem::Artist { id: i, .. } => i == &id,
            SearchResultItem::Track { id: i, .. } => i == &id,
            SearchResultItem::Album { id: i, .. } => i == &id,
            SearchResultItem::Playlist { id: i, .. } => i == &id,
        });

        if exists {
            return;
        }

        match typename {
            "Artist" => {
                let name = item["profile"]["name"].as_str().unwrap_or("").to_string();
                let avatar_url = item["visuals"]["avatarImage"]["sources"]
                    .as_array()
                    .and_then(|s| s.first())
                    .and_then(|s| s["url"].as_str())
                    .unwrap_or("")
                    .to_string();

                if !name.is_empty() {
                    results.push(SearchResultItem::Artist {
                        url: format!("https://open.spotify.com/artist/{id}"),
                        id,
                        name,
                        avatar_url,
                        is_top_result: is_top,
                    });
                }
            }
            "Track" => {
                let title = item["name"].as_str().unwrap_or("").to_string();
                let artists: Vec<String> = item["artists"]["items"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|a| a["profile"]["name"].as_str().map(|s| s.to_string()))
                    .collect();

                let cover_url = item["albumOfTrack"]["coverArt"]["sources"]
                    .as_array()
                    .and_then(|s| s.first())
                    .and_then(|s| s["url"].as_str())
                    .unwrap_or("")
                    .to_string();

                let duration_ms = item["duration"]["totalMilliseconds"].as_u64().unwrap_or(0);

                if !title.is_empty() {
                    results.push(SearchResultItem::Track {
                        url: format!("https://open.spotify.com/track/{id}"),
                        id,
                        title,
                        artist: artists.join(", "),
                        cover_url,
                        duration_ms,
                        is_top_result: is_top,
                    });
                }
            }
            "Album" => {
                let name = item["name"].as_str().unwrap_or("").to_string();
                let artists: Vec<String> = item["artists"]["items"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|a| a["profile"]["name"].as_str().map(|s| s.to_string()))
                    .collect();

                let cover_url = item["coverArt"]["sources"]
                    .as_array()
                    .and_then(|s| s.first())
                    .and_then(|s| s["url"].as_str())
                    .unwrap_or("")
                    .to_string();

                if !name.is_empty() {
                    results.push(SearchResultItem::Album {
                        url: format!("https://open.spotify.com/album/{id}"),
                        id,
                        name,
                        artist: artists.join(", "),
                        cover_url,
                        is_top_result: is_top,
                    });
                }
            }
            "Playlist" => {
                let name = item["name"].as_str().unwrap_or("").to_string();
                let owner = item["ownerV2"]["data"]["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let cover_url = item["images"]["items"]
                    .as_array()
                    .and_then(|i| i.first())
                    .and_then(|img| img["sources"].as_array())
                    .and_then(|s| s.first())
                    .and_then(|s| s["url"].as_str())
                    .unwrap_or("")
                    .to_string();

                if !name.is_empty() {
                    results.push(SearchResultItem::Playlist {
                        url: format!("https://open.spotify.com/playlist/{id}"),
                        id,
                        name,
                        owner,
                        cover_url,
                        is_top_result: is_top,
                    });
                }
            }
            _ => {}
        }
    }
}

fn search_order(item: &SearchResultItem) -> u8 {
    match item {
        SearchResultItem::Artist {
            is_top_result: true,
            ..
        } => 0,
        SearchResultItem::Track {
            is_top_result: true,
            ..
        } => 1,
        SearchResultItem::Track { .. } => 2,
        SearchResultItem::Artist { .. } => 3,
        SearchResultItem::Album { .. } => 4,
        SearchResultItem::Playlist { .. } => 5,
    }
}
