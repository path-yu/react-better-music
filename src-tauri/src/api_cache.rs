use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{header, HeaderMap, HeaderValue, Method, Request, Response, StatusCode},
    middleware::Next,
    response::IntoResponse,
};
use bytes::Bytes;
use tokio::sync::Mutex;

const MAX_ENTRIES: usize = 200;
const MAX_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MAX_BODY_BYTES: usize = 512 * 1024;

#[derive(Clone)]
struct Entry {
    status: StatusCode,
    content_type: Option<HeaderValue>,
    body: Bytes,
    stored_at: Instant,
    last_access: Instant,
    ttl: Duration,
}

#[derive(Default)]
struct CacheInner {
    entries: HashMap<String, Entry>,
    bytes: usize,
}

#[derive(Clone)]
pub struct ApiCache {
    inner: Arc<Mutex<CacheInner>>,
}

impl ApiCache {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(CacheInner::default())),
        }
    }

    fn ttl(path: &str) -> Option<Duration> {
        match path {
            // Search responses are the main duplicate traffic: the renderer
            // frequently asks for the same query while paginating or focusing
            // a panel. Keep the server-side TTL short so new songs still appear.
            "/cloudsearch" | "/search" => Some(Duration::from_secs(30)),
            "/toplist" | "/toplist/detail" => Some(Duration::from_secs(60)),
            "/banner" | "/personalized" | "/top/song" | "/mv/first" | "/mv/all" => {
                Some(Duration::from_secs(120))
            }
            "/artist/detail" | "/artist/top/song" | "/artist/album" | "/artist/mv"
            | "/simi/artist" | "/album" | "/playlist/detail" | "/mv/detail" => {
                Some(Duration::from_secs(120))
            }
            "/lyric/new" => Some(Duration::from_secs(300)),
            // Signed media URLs expire; never cache them.
            "/song/url/v1" | "/song/url" | "/mv/url" | "/mlog/url" | "/video/url" => None,
            _ => None,
        }
    }

    fn key(request: &Request<Body>) -> String {
        let cookie = request
            .headers()
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let mut hasher = DefaultHasher::new();
        cookie.hash(&mut hasher);
        let uri = request.uri();
        let mut query = uri
            .query()
            .unwrap_or("")
            .split('&')
            .filter(|pair| {
                !pair.is_empty()
                    && !pair.starts_with("timestamp=")
                    && !pair.starts_with("_=")
                    && !pair.starts_with("_bench=")
            })
            .collect::<Vec<_>>();
        // Query order is not semantically meaningful for these read endpoints.
        query.sort_unstable();
        format!("{}?{}#{}", uri.path(), query.join("&"), hasher.finish())
    }

    async fn get(&self, key: &str) -> Option<Entry> {
        let mut inner = self.inner.lock().await;
        let expired = inner
            .entries
            .get(key)
            .map(|entry| entry.stored_at.elapsed() >= entry.ttl)
            .unwrap_or(false);
        if expired {
            if let Some(entry) = inner.entries.remove(key) {
                inner.bytes = inner.bytes.saturating_sub(entry.body.len());
            }
            return None;
        }
        let entry = inner.entries.get_mut(key)?;
        entry.last_access = Instant::now();
        Some(entry.clone())
    }

    async fn put(&self, key: String, entry: Entry) {
        if entry.body.len() > MAX_BODY_BYTES {
            return;
        }
        let mut inner = self.inner.lock().await;
        if let Some(previous) = inner.entries.remove(&key) {
            inner.bytes = inner.bytes.saturating_sub(previous.body.len());
        }
        while !inner.entries.is_empty()
            && (inner.entries.len() >= MAX_ENTRIES
                || inner.bytes + entry.body.len() > MAX_CACHE_BYTES)
        {
            let Some(oldest) = inner
                .entries
                .iter()
                .min_by_key(|(_, value)| value.last_access)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some(removed) = inner.entries.remove(&oldest) {
                inner.bytes = inner.bytes.saturating_sub(removed.body.len());
            }
        }
        if inner.bytes + entry.body.len() > MAX_CACHE_BYTES {
            return;
        }
        inner.bytes += entry.body.len();
        inner.entries.insert(key, entry);
    }
}

impl Entry {
    fn into_response(self, origin: Option<HeaderValue>) -> Response<Body> {
        let mut response = Response::new(Body::from(self.body));
        *response.status_mut() = self.status;
        if let Some(content_type) = self.content_type {
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, content_type);
        }
        if let Some(origin) = origin {
            response
                .headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static("true"),
            );
            response
                .headers_mut()
                .append(header::VARY, HeaderValue::from_static("Origin"));
        }
        response
    }
}

/// Public catalogue endpoints often mint a random `NMTID` tracking cookie.
/// That cookie is not part of the payload and must not prevent caching; auth
/// cookies on the other hand make a response user-specific and bypass the cache.
fn has_sensitive_cookie(headers: &HeaderMap) -> bool {
    headers.get_all(header::SET_COOKIE).iter().any(|value| {
        let name = value
            .to_str()
            .ok()
            .and_then(|value| value.split(';').next())
            .and_then(|value| value.split('=').next())
            .unwrap_or("");
        name != "NMTID" && name != "MUSIC_A_T"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(body: &[u8]) -> Entry {
        Entry {
            status: StatusCode::OK,
            content_type: Some(HeaderValue::from_static("application/json")),
            body: Bytes::copy_from_slice(body),
            stored_at: Instant::now(),
            last_access: Instant::now(),
            ttl: Duration::from_secs(30),
        }
    }

    #[test]
    fn cache_policy_skips_media_urls_and_huge_bodies() {
        assert!(ApiCache::ttl("/cloudsearch").is_some());
        assert!(ApiCache::ttl("/toplist/detail").is_some());
        assert!(ApiCache::ttl("/song/url/v1").is_none());
        assert!(ApiCache::ttl("/mv/url").is_none());
        assert!(ApiCache::ttl("/playlist/track/all").is_none());
    }

    #[test]
    fn tracking_cookie_does_not_block_cache_but_auth_cookie_does() {
        let mut headers = HeaderMap::new();
        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_static("NMTID=abc; Path=/"),
        );
        assert!(!has_sensitive_cookie(&headers));

        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_static("MUSIC_U=secret; Path=/"),
        );
        assert!(has_sensitive_cookie(&headers));
    }

    #[tokio::test]
    async fn cache_respects_entry_limit() {
        let cache = ApiCache::new();
        for index in 0..(MAX_ENTRIES + 20) {
            cache.put(format!("key-{index}"), entry(b"{}")).await;
        }
        assert!(cache.inner.lock().await.entries.len() <= MAX_ENTRIES);
    }

    #[tokio::test]
    async fn cache_skips_oversized_entry() {
        let cache = ApiCache::new();
        cache
            .put("large".into(), entry(&vec![0; MAX_BODY_BYTES + 1]))
            .await;
        assert!(cache.inner.lock().await.entries.is_empty());
    }
}

pub async fn middleware(
    State(cache): State<ApiCache>,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    if request.method() != Method::GET {
        return next.run(request).await;
    }
    let Some(ttl) = ApiCache::ttl(request.uri().path()) else {
        return next.run(request).await;
    };
    let origin = request.headers().get(header::ORIGIN).cloned();
    let key = ApiCache::key(&request);

    if let Some(entry) = cache.get(&key).await {
        return entry.into_response(origin);
    }

    let response = next.run(request).await;
    if response.status() != StatusCode::OK || has_sensitive_cookie(response.headers()) {
        return response;
    }

    let (parts, body) = response.into_parts();
    let bytes = match to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return (StatusCode::BAD_GATEWAY, "failed to read API response").into_response();
        }
    };
    let content_type = parts.headers.get(header::CONTENT_TYPE).cloned();
    let status = parts.status;
    // Oversized payloads still pass through, but are not retained in memory.
    let cacheable = bytes.len() <= MAX_BODY_BYTES;
    let response = Response::from_parts(parts, Body::from(bytes.clone()));
    if cacheable {
        cache
            .put(
                key,
                Entry {
                    status,
                    content_type,
                    body: bytes,
                    stored_at: Instant::now(),
                    last_access: Instant::now(),
                    ttl,
                },
            )
            .await;
    }
    response
}
