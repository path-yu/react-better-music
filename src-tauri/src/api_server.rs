use axum::{
    body::Body,
    extract::Query,
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::local_library::LocalLibrary;

const ALLOWED_ORIGINS: &str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:1420,http://tauri.localhost,https://tauri.localhost,tauri://localhost";

#[derive(Debug, Deserialize)]
struct AudioQuery {
    url: String,
}

pub async fn start(port: u16, library: LocalLibrary) -> Result<(), String> {
    // The NCM SDK supplies the 300+ official NetEase routes. The local library,
    // media proxy, health check and unblock matcher are desktop-specific.
    let ncm_config = ncm_api_rs::server::ServerConfig {
        cors_origin: Some(ALLOWED_ORIGINS.to_string()),
        ..Default::default()
    };
    // Some public endpoints (notably /simi/artist) require the anonymous
    // MUSIC_A cookie. Do not put that network round-trip in front of binding
    // the port: the homepage calls /banner, /personalized and friends as soon
    // as the WebView appears, and a slow proxy made the Tauri API look dead for
    // several seconds. The cloned client shares the cookie cell, so the worker
    // below can install the cookie after the server is already responding.
    let client = ncm_api_rs::create_client(None);
    let mut registration_client = client.clone();
    let ncm = ncm_api_rs::server::build_app_with_config(client, &ncm_config);

    let origins = ALLOWED_ORIGINS
        .split(',')
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect::<Vec<_>>();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::ACCEPT,
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ORIGIN,
        ]);

    let custom = Router::new()
        .route("/ping", get(ping))
        .route("/audio/proxy", get(audio_proxy))
        .route("/img/proxy", get(img_proxy))
        .route("/link/resolve", get(link_resolve))
        .route("/apple/playlist", get(apple_playlist))
        .merge(crate::unblock::router())
        .merge(crate::local_library::router(library))
        .layer(cors);

    let app = ncm
        .merge(custom)
        .layer(axum::middleware::from_fn_with_state(
            crate::api_cache::ApiCache::new(),
            crate::api_cache::middleware,
        ));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| format!("failed to bind API port {port}: {error}"))?;

    eprintln!("[tauri] Rust API listening on http://127.0.0.1:{port}");

    tokio::spawn(async move {
        for attempt in 0..3 {
            match registration_client
                .register_anonimous(&ncm_api_rs::Query::new())
                .await
            {
                Ok(response) if !response.cookie.is_empty() => {
                    registration_client.set_cookie(response.cookie.join("; "));
                    eprintln!("[tauri] anonymous cookie ready");
                    break;
                }
                Ok(response) => {
                    eprintln!(
                        "[tauri] anonymous registration attempt {} returned {} without cookies",
                        attempt + 1,
                        response.status
                    );
                }
                Err(error) => {
                    eprintln!(
                        "[tauri] anonymous registration attempt {} failed: {error}",
                        attempt + 1
                    );
                }
            }
        }
    });

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("API server stopped: {error}"))
}

async fn ping() -> Json<serde_json::Value> {
    Json(json!({ "code": 200, "msg": "pong" }))
}

async fn img_proxy(Query(query): Query<AudioQuery>) -> Response {
    let Ok(mut url) = url::Url::parse(&query.url) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Invalid image url" })),
        )
            .into_response();
    };
    let allowed = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| {
            host == "music.126.net"
                || host.ends_with(".music.126.net")
                || host == "mzstatic.com"
                || host.ends_with(".mzstatic.com")
        });
    if !allowed {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Invalid image url" })),
        )
            .into_response();
    }
    if url
        .host_str()
        .is_some_and(|host| host.ends_with("music.126.net"))
        && !url.query_pairs().any(|(key, _)| key == "param")
    {
        url.query_pairs_mut().append_pair("param", "64y64");
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    let response = match client
        .get(url)
        .header(header::USER_AGENT, "Mozilla/5.0")
        .header(header::REFERER, "https://music.163.com/")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        Ok(_) | Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": "Image fetch failed" })),
            )
                .into_response();
        }
    };
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Json(json!({
        "code": 200,
        "data": format!("data:{content_type};base64,{encoded}")
    }))
    .into_response()
}

fn apple_js_asset(html: &str) -> Option<String> {
    let start = html.find("/assets/index")?;
    let rest = &html[start..];
    let end = rest.find(|c| c == '"' || c == '\'')?;
    Some(rest[..end].to_string())
}

fn apple_developer_token(js: &str) -> Option<String> {
    let start = js.find("eyJ")?;
    let rest = &js[start..];
    let end = rest
        .find(|c: char| {
            !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        })
        .unwrap_or(rest.len());
    let token = &rest[..end];
    (token.len() > 100 && token.matches('.').count() == 2)
        .then(|| token.to_string())
}

async fn apple_playlist(Query(query): Query<AudioQuery>) -> Response {
    let Ok(url) = url::Url::parse(&query.url) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Invalid Apple Music link" })),
        )
            .into_response();
    };
    let allowed = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| {
            host == "music.apple.com" || host.ends_with(".music.apple.com")
        });
    if !allowed {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Unsupported Apple Music link" })),
        )
            .into_response();
    }
    let segments = url
        .path_segments()
        .map(|parts| parts.filter(|part| !part.is_empty()).collect::<Vec<_>>())
        .unwrap_or_default();
    let locale = segments
        .first()
        .filter(|value| value.len() == 2)
        .copied()
        .unwrap_or("cn");
    let language = if locale == "cn" { "zh-CN" } else { locale };
    let Some(playlist_id) = segments
        .iter()
        .find(|part| part.starts_with("pl."))
        .map(|value| value.to_string())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Apple Music playlist id not found" })),
        )
            .into_response();
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36";
    let html = match client
        .get("https://music.apple.com/cn")
        .header(header::USER_AGENT, ua)
        .send()
        .await
        .and_then(|response| response.error_for_status())
    {
        Ok(response) => match response.text().await {
            Ok(text) => text,
            Err(error) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({ "code": 502, "msg": error.to_string() })),
                )
                    .into_response();
            }
        },
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    let Some(asset) = apple_js_asset(&html) else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "code": 502, "msg": "Apple Music JS bundle not found" })),
        )
            .into_response();
    };
    let js = match client
        .get(format!("https://music.apple.com{asset}"))
        .header(header::USER_AGENT, ua)
        .send()
        .await
        .and_then(|response| response.error_for_status())
    {
        Ok(response) => response.text().await.unwrap_or_default(),
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    let Some(token) = apple_developer_token(&js) else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "code": 502, "msg": "Apple Music developer token not found" })),
        )
            .into_response();
    };

    let base = format!(
        "https://amp-api.music.apple.com/v1/catalog/{locale}/playlists/{playlist_id}"
    );
    let meta_response = match client
        .get(format!("{base}?l={language}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::USER_AGENT, ua)
        .header(header::ORIGIN, "https://music.apple.com")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    if !meta_response.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "code": 502,
                "msg": format!(
                    "Apple Music playlist request failed ({})",
                    meta_response.status()
                )
            })),
        )
            .into_response();
    }
    let meta: serde_json::Value = match meta_response.json().await {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    let resource = &meta["data"][0];
    let title = resource["attributes"]["name"]
        .as_str()
        .unwrap_or("Apple Music 歌单")
        .to_string();
    let cover_url = resource["attributes"]["artwork"]["url"]
        .as_str()
        .map(|artwork| artwork.replace("{w}x{h}", "300x300"))
        .unwrap_or_default();

    let mut tracks = Vec::new();
    let mut next = format!("{base}/tracks?l={language}&limit=100");
    while !next.is_empty() {
        let response = match client
            .get(&next)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::USER_AGENT, ua)
            .header(header::ORIGIN, "https://music.apple.com")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({ "code": 502, "msg": error.to_string() })),
                )
                    .into_response();
            }
        };
        if !response.status().is_success() {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "code": 502,
                    "msg": format!("Apple Music playlist request failed ({})", response.status())
                })),
            )
                .into_response();
        }
        let payload: serde_json::Value = match response.json().await {
            Ok(value) => value,
            Err(error) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({ "code": 502, "msg": error.to_string() })),
                )
                    .into_response();
            }
        };
        if let Some(items) = payload["data"].as_array() {
            for item in items {
                let attributes = &item["attributes"];
                let Some(id) = item["id"].as_str() else {
                    continue;
                };
                let Some(name) = attributes["name"].as_str() else {
                    continue;
                };
                tracks.push(json!({
                    "id": id,
                    "name": name,
                    "artist": attributes["artistName"].as_str().unwrap_or(""),
                    "album": attributes["albumName"].as_str().unwrap_or(""),
                    "duration": attributes["durationInMillis"].as_u64().unwrap_or(0),
                    "artwork": attributes["artwork"]["url"]
                        .as_str()
                        .map(|value| value.replace("{w}x{h}", "200x200"))
                        .unwrap_or_default(),
                }));
            }
        }
        next = payload["next"].as_str().unwrap_or("").to_string();
        if !next.is_empty() && next.starts_with('/') {
            next = format!("https://amp-api.music.apple.com{next}");
        }
    }

    Json(json!({
        "code": 200,
        "title": title,
        "coverUrl": cover_url,
        "tracks": tracks,
    }))
    .into_response()
}

async fn link_resolve(Query(query): Query<AudioQuery>) -> Response {
    let Ok(url) = url::Url::parse(&query.url) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Invalid link" })),
        )
            .into_response();
    };
    let allowed = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| {
            host == "163cn.tv" || host.ends_with(".163cn.tv")
        });
    if !allowed {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Unsupported link" })),
        )
            .into_response();
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    match client
        .get(url)
        .header(header::USER_AGENT, "Mozilla/5.0")
        .header(header::REFERER, "https://music.163.com/")
        .send()
        .await
    {
        Ok(response) => Json(json!({ "code": 200, "url": response.url().as_str() }))
            .into_response(),
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "code": 502, "msg": error.to_string() })),
        )
            .into_response(),
    }
}

async fn audio_proxy(Query(query): Query<AudioQuery>, headers: HeaderMap) -> Response {
    let Ok(url) = url::Url::parse(&query.url) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Invalid audio url" })),
        )
            .into_response();
    };
    let allowed = matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .is_some_and(|host| host == "music.126.net" || host.ends_with(".music.126.net"));
    if !allowed {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "Invalid audio url" })),
        )
            .into_response();
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };

    let mut request = client
        .get(url)
        .header(header::USER_AGENT, "Mozilla/5.0")
        .header(header::REFERER, "https://music.163.com/");
    if let Some(range) = headers.get(header::RANGE) {
        request = request.header(header::RANGE, range);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    let status = response.status();
    if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "code": 502, "msg": "Audio fetch failed" })),
        )
            .into_response();
    }

    let mut builder = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::ACCEPT_RANGES,
        header::CONTENT_RANGE,
    ] {
        if let Some(value) = response.headers().get(&name) {
            builder = builder.header(name, value);
        }
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "code": 502, "msg": error.to_string() })),
            )
                .into_response();
        }
    };
    builder
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, max-age=300"),
        )
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
