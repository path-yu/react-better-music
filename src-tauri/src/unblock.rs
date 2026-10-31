use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use reqwest::redirect::Policy;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
struct MatchQuery {
    id: String,
    source: Option<String>,
}

pub fn router() -> Router {
    Router::new().route("/song/url/match", get(match_song))
}

async fn match_song(Query(query): Query<MatchQuery>) -> Response {
    if query.id.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": 400, "msg": "id is required", "data": [] })),
        )
            .into_response();
    }

    let requested = query
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto");
    let sources: Vec<&str> = match requested {
        Some(source) => vec![source],
        None => vec!["unm", "gdmusic", "byfuns", "ddyr", "msls", "oi", "qijieya"],
    };

    for source in sources {
        if let Some(url) = match_provider(source, &query.id).await {
            return Json(json!({
                "code": 200,
                "data": url,
                "source": source,
                "proxyUrl": ""
            }))
            .into_response();
        }
    }

    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "code": 404,
            "msg": "未找到可用音源",
            "data": []
        })),
    )
        .into_response()
}

async fn match_provider(source: &str, id: &str) -> Option<String> {
    match source {
        "gdmusic" => gdmusic(id).await,
        "byfuns" => byfuns(id).await,
        "ddyr" => ddyr(id).await,
        "msls" => {
            redirect_or_json(
                &format!("https://api.msls1441.com/?type=url&id={id}"),
                &["url"],
            )
            .await
        }
        "oi" => oi(id).await,
        "qijieya" => {
            redirect_or_json(
                &format!("https://api.qijieya.cn/meting/?type=url&id={id}"),
                &["url"],
            )
            .await
        }
        // The UNM package depends on @unblockneteasemusic/server, which has no
        // direct Rust equivalent. Other providers remain available; callers
        // selecting UNM explicitly get the normal "not found" response.
        "unm" => None,
        _ => None,
    }
}

async fn gdmusic(id: &str) -> Option<String> {
    let response = reqwest::get(format!(
        "https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id={id}&br=999"
    ))
    .await
    .ok()?;
    let value: Value = response.json().await.ok()?;
    value
        .get("url")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("http"))
        .map(str::to_string)
}

async fn byfuns(id: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .ok()?;
    let response = client
        .get(format!("https://api.byfuns.top/1/?id={id}&level=lossless"))
        .send()
        .await
        .ok()?;
    if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
        return location.to_str().ok().map(str::to_string);
    }
    let text = response.text().await.ok()?;
    let url = text.trim();
    url.starts_with("http").then(|| url.to_string())
}

async fn ddyr(id: &str) -> Option<String> {
    let response = reqwest::get(format!(
        "https://yy.zddyr.top/lx/api/?source=netease&songmid={id}&quality=hires"
    ))
    .await
    .ok()?;
    let value: Value = response.json().await.ok()?;
    value
        .get("url")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("http"))
        .map(str::to_string)
}

async fn oi(id: &str) -> Option<String> {
    let response = reqwest::get(format!("https://oiapi.net/api/Music_163?id={id}"))
        .await
        .ok()?;
    let value: Value = response.json().await.ok()?;
    value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("url"))
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("http"))
        .map(str::to_string)
}

async fn redirect_or_json(url: &str, keys: &[&str]) -> Option<String> {
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .ok()?;
    let response = client.get(url).send().await.ok()?;
    if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
        return location.to_str().ok().map(str::to_string);
    }
    let value: Value = response.json().await.ok()?;
    for key in keys {
        if let Some(found) = value.get(*key).and_then(Value::as_str) {
            if found.starts_with("http") {
                return Some(found.to_string());
            }
        }
    }
    None
}
