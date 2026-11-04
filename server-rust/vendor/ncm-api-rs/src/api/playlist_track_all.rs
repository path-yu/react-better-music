use super::Query;
use crate::error::Result;
/// 歌单所有歌曲
/// 对应 Node.js module/playlist_track_all.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_CACHED_PLAYLISTS: usize = 8;

#[derive(Clone)]
struct CachedPlaylist {
    track_ids: Vec<Value>,
    tracks: HashMap<i64, Value>,
    cookie: Vec<String>,
    expires_at: Instant,
}

static PLAYLIST_CACHE: LazyLock<Mutex<HashMap<String, CachedPlaylist>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

impl ApiClient {
    /// 歌单所有歌曲（两步请求：先获取 trackIds，再获取歌曲详情）
    /// 对应 /playlist/track/all
    pub async fn playlist_track_all(&self, query: &Query) -> Result<ApiResponse> {
        let id = query.get_or("id", "0");
        let limit = query.get_or("limit", "1000").parse::<i64>().unwrap_or(1000);
        let offset = query.get_or("offset", "0").parse::<i64>().unwrap_or(0);
        let key = id.to_string();

        let cached = {
            let cache = PLAYLIST_CACHE.lock().ok();
            cache.and_then(|cache| {
                cache
                    .get(&key)
                    .filter(|entry| entry.expires_at > Instant::now())
                    .cloned()
            })
        };

        let (track_ids, mut tracks, cookie) = if let Some(entry) = cached {
            (entry.track_ids, entry.tracks, entry.cookie)
        } else {
            // Step 1: 获取歌单详情（含 trackIds）。The response also contains up
            // to 1000 full songs; keep them so a small page does not need the
            // second upstream request.
            let data1 = json!({
                "id": id,
                "n": 100000,
                "s": query.get_or("s", "8").parse::<i64>().unwrap_or(8)
            });
            let res = self
                .request(
                    "/api/v6/playlist/detail",
                    data1,
                    query.to_option(CryptoType::default()),
                )
                .await?;

            let track_ids = res.body["playlist"]["trackIds"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut tracks = HashMap::new();
            if let Some(items) = res.body["playlist"]["tracks"].as_array() {
                for song in items {
                    if let Some(song_id) = song["id"].as_i64() {
                        tracks.insert(song_id, song.clone());
                    }
                }
            }
            let cookie = res.cookie.clone();
            if !track_ids.is_empty() {
                if let Ok(mut cache) = PLAYLIST_CACHE.lock() {
                    cache.insert(
                        key.clone(),
                        CachedPlaylist {
                            track_ids: track_ids.clone(),
                            tracks: tracks.clone(),
                            cookie: cookie.clone(),
                            expires_at: Instant::now() + CACHE_TTL,
                        },
                    );
                    if cache.len() > MAX_CACHED_PLAYLISTS {
                        if let Some(oldest) = cache.keys().next().cloned() {
                            cache.remove(&oldest);
                        }
                    }
                }
            }
            (track_ids, tracks, cookie)
        };

        // Step 2: 从 trackIds 中截取分页范围
        if track_ids.is_empty() {
            return Ok(ApiResponse {
                status: 200,
                body: json!({ "songs": [] }),
                cookie,
            });
        }

        let start = offset.max(0) as usize;
        let end = std::cmp::min(start + limit.max(1) as usize, track_ids.len());
        let sliced = &track_ids[start..end];
        let mut missing = Vec::new();
        for item in sliced {
            if let Some(song_id) = item["id"].as_i64() {
                if !tracks.contains_key(&song_id) {
                    missing.push(song_id);
                }
            }
        }

        if missing.is_empty() {
            let songs: Vec<Value> = sliced
                .iter()
                .filter_map(|item| item["id"].as_i64())
                .filter_map(|song_id| tracks.get(&song_id).cloned())
                .collect();
            return Ok(ApiResponse {
                status: 200,
                body: json!({ "songs": songs }),
                cookie,
            });
        }

        let c: Vec<String> = missing
            .iter()
            .map(|song_id| format!(r#"{{"id":{}}}"#, song_id))
            .collect();
        let data2 = json!({
            "c": format!("[{}]", c.join(","))
        });
        let response = self
            .request(
                "/api/v3/song/detail",
                data2,
                query.to_option(CryptoType::default()),
            )
            .await?;
        if let Some(fetched) = response.body["songs"].as_array() {
            for song in fetched {
                if let Some(song_id) = song["id"].as_i64() {
                    tracks.insert(song_id, song.clone());
                }
            }
        }
        let songs: Vec<Value> = sliced
            .iter()
            .filter_map(|item| item["id"].as_i64())
            .filter_map(|song_id| tracks.get(&song_id).cloned())
            .collect();
        Ok(ApiResponse {
            status: 200,
            body: json!({ "songs": songs }),
            cookie: response.cookie,
        })
    }
}
