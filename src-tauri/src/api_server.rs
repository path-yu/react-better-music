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
    let ncm =
        ncm_api_rs::server::build_app_with_config(ncm_api_rs::create_client(None), &ncm_config);

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
        .merge(crate::unblock::router())
        .merge(crate::local_library::router(library))
        .layer(cors);

    let app = ncm.merge(custom);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| format!("failed to bind API port {port}: {error}"))?;

    eprintln!("[tauri] Rust API listening on http://127.0.0.1:{port}");
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
