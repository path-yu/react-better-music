use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

type ApiResult = (StatusCode, Json<Value>);

#[derive(Clone)]
pub struct LocalLibrary {
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl LocalLibrary {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    async fn read(&self) -> Value {
        let defaults = json!({
            "version": 2,
            "playlists": [],
            "subscribedPlaylists": [],
            "favorites": [],
            "recent": []
        });
        let Ok(text) = tokio::fs::read_to_string(self.path.as_ref()).await else {
            return defaults;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
            return defaults;
        };
        let Some(object) = value.as_object_mut() else {
            return defaults;
        };
        object.insert("version".into(), json!(2));
        for key in ["playlists", "subscribedPlaylists", "favorites", "recent"] {
            if !object.get(key).is_some_and(Value::is_array) {
                object.insert(key.into(), json!([]));
            }
        }
        value
    }

    async fn write(&self, value: &Value) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into());
        tokio::fs::write(self.path.as_ref(), text).await
    }
}

fn ok(data: Value) -> ApiResult {
    (StatusCode::OK, Json(json!({ "code": 200, "data": data })))
}

fn fail(status: StatusCode, message: &str) -> ApiResult {
    (
        status,
        Json(json!({ "code": status.as_u16(), "msg": message })),
    )
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn song_id(song: &Value) -> Option<i64> {
    song.get("id").and_then(Value::as_i64)
}

pub fn router(library: LocalLibrary) -> Router {
    Router::new()
        .route("/local/library", get(get_library))
        .route("/local/playlists", post(create_playlist))
        .route(
            "/local/playlists/{id}",
            patch(rename_playlist)
                .put(rename_playlist)
                .delete(delete_playlist),
        )
        .route("/local/playlists/{id}/songs", post(add_song))
        .route("/local/playlists/{id}/songs/{song_id}", delete(remove_song))
        .route("/local/subscribed-playlists", post(add_subscribed_playlist))
        .route(
            "/local/subscribed-playlists/{playlist_id}",
            delete(remove_subscribed_playlist),
        )
        .route("/local/favorites", post(add_favorite))
        .route("/local/favorites/{song_id}", delete(remove_favorite))
        .route("/local/recent", post(add_recent).delete(clear_recent))
        .route("/local/recent/{song_id}", delete(remove_recent))
        .with_state(library)
}

async fn get_library(State(library): State<LocalLibrary>) -> ApiResult {
    let _guard = library.lock.lock().await;
    ok(library.read().await)
}

async fn create_playlist(
    State(library): State<LocalLibrary>,
    Json(body): Json<Value>,
) -> ApiResult {
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "Playlist name is required");
    }
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let now = now_ms();
    let playlist = json!({
        "id": Uuid::new_v4().to_string(),
        "name": name,
        "songs": [],
        "createdAt": now,
        "updatedAt": now
    });
    value["playlists"]
        .as_array_mut()
        .expect("playlists is an array")
        .push(playlist.clone());
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(playlist)
}

async fn rename_playlist(
    State(library): State<LocalLibrary>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "Playlist name is required");
    }
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let Some(playlist) = value["playlists"].as_array_mut().and_then(|items| {
        items
            .iter_mut()
            .find(|item| item["id"].as_str() == Some(id.as_str()))
    }) else {
        return fail(StatusCode::NOT_FOUND, "Local playlist not found");
    };
    playlist["name"] = json!(name);
    playlist["updatedAt"] = json!(now_ms());
    let result = playlist.clone();
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(result)
}

async fn delete_playlist(State(library): State<LocalLibrary>, Path(id): Path<String>) -> ApiResult {
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let before = value["playlists"].as_array().map_or(0, Vec::len);
    if let Some(items) = value["playlists"].as_array_mut() {
        items.retain(|item| item["id"].as_str() != Some(id.as_str()));
    }
    if before == value["playlists"].as_array().map_or(0, Vec::len) {
        return fail(StatusCode::NOT_FOUND, "Local playlist not found");
    }
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(json!({ "id": id }))
}

async fn add_song(
    State(library): State<LocalLibrary>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let Some(song) = body.get("song").cloned().filter(|value| value.is_object()) else {
        return fail(StatusCode::BAD_REQUEST, "song is required");
    };
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let Some(playlist) = value["playlists"].as_array_mut().and_then(|items| {
        items
            .iter_mut()
            .find(|item| item["id"].as_str() == Some(id.as_str()))
    }) else {
        return fail(StatusCode::NOT_FOUND, "Local playlist not found");
    };
    let id = song_id(&song);
    if let Some(songs) = playlist["songs"].as_array_mut() {
        if !songs.iter().any(|entry| song_id(entry) == id) {
            songs.push(song);
        }
    }
    playlist["updatedAt"] = json!(now_ms());
    let result = playlist.clone();
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(result)
}

async fn remove_song(
    State(library): State<LocalLibrary>,
    Path((id, target_id)): Path<(String, i64)>,
) -> ApiResult {
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let Some(playlist) = value["playlists"].as_array_mut().and_then(|items| {
        items
            .iter_mut()
            .find(|item| item["id"].as_str() == Some(id.as_str()))
    }) else {
        return fail(StatusCode::NOT_FOUND, "Local playlist not found");
    };
    if let Some(songs) = playlist["songs"].as_array_mut() {
        songs.retain(|entry| song_id(entry) != Some(target_id));
    }
    playlist["updatedAt"] = json!(now_ms());
    let result = playlist.clone();
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(result)
}

async fn add_subscribed_playlist(
    State(library): State<LocalLibrary>,
    Json(body): Json<Value>,
) -> ApiResult {
    let Some(playlist) = body
        .get("playlist")
        .cloned()
        .filter(|value| value.is_object())
    else {
        return fail(StatusCode::BAD_REQUEST, "playlist is required");
    };
    let Some(playlist_id) = playlist.get("id").and_then(Value::as_i64) else {
        return fail(StatusCode::BAD_REQUEST, "playlist.id is required");
    };
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let items = value["subscribedPlaylists"]
        .as_array_mut()
        .expect("subscribedPlaylists is an array");
    if !items
        .iter()
        .any(|item| item.get("id").and_then(Value::as_i64) == Some(playlist_id))
    {
        items.insert(0, playlist);
    }
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(value["subscribedPlaylists"].clone())
}

async fn remove_subscribed_playlist(
    State(library): State<LocalLibrary>,
    Path(playlist_id): Path<i64>,
) -> ApiResult {
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    if let Some(items) = value["subscribedPlaylists"].as_array_mut() {
        items.retain(|item| item.get("id").and_then(Value::as_i64) != Some(playlist_id));
    }
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(value["subscribedPlaylists"].clone())
}

async fn add_favorite(State(library): State<LocalLibrary>, Json(body): Json<Value>) -> ApiResult {
    let Some(song) = body.get("song").cloned().filter(|value| value.is_object()) else {
        return fail(StatusCode::BAD_REQUEST, "song is required");
    };
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let items = value["favorites"]
        .as_array_mut()
        .expect("favorites is an array");
    let id = song_id(&song);
    if !items.iter().any(|entry| song_id(entry) == id) {
        items.insert(0, song);
    }
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(value["favorites"].clone())
}

async fn remove_favorite(
    State(library): State<LocalLibrary>,
    Path(target_id): Path<i64>,
) -> ApiResult {
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    if let Some(items) = value["favorites"].as_array_mut() {
        items.retain(|entry| song_id(entry) != Some(target_id));
    }
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(value["favorites"].clone())
}

async fn add_recent(State(library): State<LocalLibrary>, Json(body): Json<Value>) -> ApiResult {
    let Some(song) = body.get("song").cloned().filter(|value| value.is_object()) else {
        return fail(StatusCode::BAD_REQUEST, "song is required");
    };
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    let items = value["recent"].as_array_mut().expect("recent is an array");
    items.retain(|entry| song_id(&entry["song"]) != song_id(&song));
    items.insert(0, json!({ "song": song, "playedAt": now_ms() }));
    items.truncate(100);
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(value["recent"].clone())
}

async fn remove_recent(
    State(library): State<LocalLibrary>,
    Path(target_id): Path<i64>,
) -> ApiResult {
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    if let Some(items) = value["recent"].as_array_mut() {
        items.retain(|entry| song_id(&entry["song"]) != Some(target_id));
    }
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(value["recent"].clone())
}

async fn clear_recent(State(library): State<LocalLibrary>) -> ApiResult {
    let _guard = library.lock.lock().await;
    let mut value = library.read().await;
    value["recent"] = json!([]);
    if let Err(error) = library.write(&value).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    ok(json!([]))
}
