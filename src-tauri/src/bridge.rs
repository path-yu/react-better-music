use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    window::Color, AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub const BRIDGE_PORT: u16 = 13002;

const ALLOWED_ORIGINS: &str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:1420,http://tauri.localhost,https://tauri.localhost,tauri://localhost";

#[derive(Clone)]
struct BridgeState {
    app: AppHandle,
    lyrics_state: Arc<Mutex<Value>>,
    devtools_disabled: Arc<Mutex<bool>>,
    download_dir: Arc<Mutex<PathBuf>>,
    audio_cache_dir: Arc<Mutex<PathBuf>>,
}

#[derive(Deserialize)]
struct ActionQuery {
    action: Option<String>,
    value: Option<String>,
    disabled: Option<String>,
}

#[derive(Deserialize)]
struct FileQuery {
    name: Option<String>,
}

#[derive(Deserialize)]
struct AudioCacheQuery {
    id: Option<String>,
    meta: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct AudioCacheMeta {
    id: u64,
    name: String,
    size: u64,
    #[serde(rename = "createdAt")]
    created_at: u64,
    artists: Option<String>,
    duration: Option<u64>,
    bitrate: Option<u32>,
    #[serde(rename = "trialEnd")]
    trial_end: Option<u64>,
    #[serde(rename = "picUrl")]
    pic_url: Option<String>,
    file: Option<String>,
}

pub async fn start(app: AppHandle, port: u16) -> Result<(), String> {
    let download_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir().map(|dir| dir.join("downloads")))
        .unwrap_or_else(|_| std::env::temp_dir());

    let audio_cache_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("audio-cache"))
        .unwrap_or_else(|_| std::env::temp_dir().join("qimiao-audio-cache"));

    let state = BridgeState {
        app,
        lyrics_state: Arc::new(Mutex::new(json!({}))),
        devtools_disabled: Arc::new(Mutex::new(false)),
        download_dir: Arc::new(Mutex::new(download_dir)),
        audio_cache_dir: Arc::new(Mutex::new(audio_cache_dir)),
    };

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
            HeaderName::from_static("x-bridge-token"),
        ]);

    let router = Router::new()
        .route("/lyrics", get(lyrics_page))
        .route("/mini", get(mini_page))
        .route("/log", post(write_log))
        .route("/devtools-policy", get(get_devtools).post(set_devtools))
        .route("/window-state", get(window_state))
        .route("/window-action", post(window_action))
        .route(
            "/lyrics-window",
            get(lyrics_window).post(lyrics_window_action),
        )
        .route("/mini-window", get(mini_window).post(mini_window_action))
        .route("/aux-windows", get(aux_windows))
        .route(
            "/lyrics-state",
            get(get_lyrics_state).post(set_lyrics_state),
        )
        .route("/command", post(desktop_command))
        .route("/download-dir", get(get_download_dir))
        .route("/pick-dir", post(pick_dir))
        .route("/open-dir", post(open_dir))
        .route("/save-file", post(save_file))
        .route(
            "/audio-cache",
            get(list_audio_cache)
                .post(save_audio_cache)
                .delete(clear_audio_cache),
        )
        .route("/audio-cache/meta", get(get_audio_cache_meta))
        .route("/audio-cache/file", get(get_audio_cache_file))
        .route("/audio-cache/dir", get(get_audio_cache_dir))
        .route("/audio-cache/pick-dir", post(pick_audio_cache_dir))
        .route("/audio-cache/open-dir", post(open_audio_cache_dir))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| format!("failed to bind bridge port {port}: {error}"))?;
    eprintln!("[tauri] desktop bridge listening on http://127.0.0.1:{port}");
    axum::serve(listener, router)
        .await
        .map_err(|error| format!("bridge stopped: {error}"))
}

async fn lyrics_page() -> Html<&'static str> {
    Html(include_str!("../assets/lyrics.html"))
}

async fn mini_page() -> Html<&'static str> {
    Html(include_str!("../assets/mini.html"))
}

async fn write_log(body: String) -> StatusCode {
    if !body.is_empty() {
        eprintln!("[renderer] {}", body.chars().take(500).collect::<String>());
    }
    StatusCode::NO_CONTENT
}

async fn get_devtools(State(state): State<BridgeState>) -> Json<Value> {
    let disabled = *state.devtools_disabled.lock().await;
    Json(json!({ "disabled": disabled }))
}

async fn set_devtools(
    State(state): State<BridgeState>,
    Query(query): Query<ActionQuery>,
) -> Json<Value> {
    let disabled = query.disabled.as_deref() == Some("1")
        || query.value.as_deref() == Some("1")
        || query.action.as_deref() == Some("1");
    *state.devtools_disabled.lock().await = disabled;
    Json(json!({ "disabled": disabled }))
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn window_state_json(window: &WebviewWindow) -> Value {
    json!({
        "maximized": window.is_maximized().unwrap_or(false),
        "minimized": window.is_minimized().unwrap_or(false),
        "fullScreen": window.is_fullscreen().unwrap_or(false),
    })
}

async fn window_state(State(state): State<BridgeState>) -> Json<Value> {
    let Some(window) = main_window(&state.app) else {
        return Json(json!({ "maximized": false, "minimized": false, "fullScreen": false }));
    };
    Json(window_state_json(&window))
}

async fn window_action(
    State(state): State<BridgeState>,
    Query(query): Query<ActionQuery>,
) -> Response {
    let Some(window) = main_window(&state.app) else {
        return (StatusCode::SERVICE_UNAVAILABLE, "main window missing").into_response();
    };
    let result = match query.action.as_deref() {
        Some("minimize") => window.minimize(),
        Some("toggle-maximize") => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        Some("close") => window.hide(),
        _ => Ok(()),
    };
    if let Err(error) = result {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    Json(window_state_json(&window)).into_response()
}

fn ensure_window(
    app: &AppHandle,
    label: &str,
    page: &str,
    title: &str,
    width: f64,
    height: f64,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    let url: url::Url = format!("http://127.0.0.1:{BRIDGE_PORT}/{page}")
        .parse()
        .map_err(|error| format!("invalid aux window url: {error}"))?;
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        // A decorated/shadowed transparent window gets a white 1px Windows
        // frame and a white WebView2 controller background. Both aux windows
        // paint their own rounded card, so the native surface must stay clear.
        .shadow(false)
        .background_color(Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    // `None` means "use the platform default" (white on Windows), not clear.
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    Ok(window)
}

fn toggle_window(
    app: &AppHandle,
    label: &str,
    page: &str,
    title: &str,
    width: f64,
    height: f64,
    action: Option<&str>,
) -> Result<bool, String> {
    let window = ensure_window(app, label, page, title, width, height)?;
    let visible = window.is_visible().unwrap_or(false);
    let show = match action {
        Some("show") => true,
        Some("hide") => false,
        _ => !visible,
    };
    if show {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_focus();
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }
    broadcast_aux_windows(app);
    Ok(show)
}

fn broadcast_aux_windows(app: &AppHandle) {
    let detail = json!({
        "lyrics": aux_visible(app, "lyrics"),
        "mini": aux_visible(app, "mini"),
    });
    let script = format!(
        "window.dispatchEvent(new CustomEvent('qimiao:aux-windows',{{detail:{}}}))",
        detail
    );
    if let Some(main) = main_window(app) {
        let _ = main.eval(script);
    }
}

pub fn toggle_lyrics(app: &AppHandle, action: Option<&str>) -> Result<bool, String> {
    toggle_window(app, "lyrics", "lyrics", "桌面歌词", 960.0, 200.0, action)
}

pub fn toggle_mini(app: &AppHandle, action: Option<&str>) -> Result<bool, String> {
    toggle_window(app, "mini", "mini", "迷你播放器", 380.0, 140.0, action)
}

fn aux_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

async fn lyrics_window(State(state): State<BridgeState>) -> Json<Value> {
    Json(json!({ "visible": aux_visible(&state.app, "lyrics") }))
}

async fn lyrics_window_action(
    State(state): State<BridgeState>,
    Query(query): Query<ActionQuery>,
) -> Response {
    match toggle_lyrics(&state.app, query.action.as_deref()) {
        Ok(visible) => Json(json!({ "visible": visible })).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    }
}

async fn mini_window(State(state): State<BridgeState>) -> Json<Value> {
    Json(json!({ "visible": aux_visible(&state.app, "mini") }))
}

async fn mini_window_action(
    State(state): State<BridgeState>,
    Query(query): Query<ActionQuery>,
) -> Response {
    match toggle_mini(&state.app, query.action.as_deref()) {
        Ok(visible) => Json(json!({ "visible": visible })).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    }
}

async fn aux_windows(State(state): State<BridgeState>) -> Json<Value> {
    Json(json!({
        "lyrics": aux_visible(&state.app, "lyrics"),
        "mini": aux_visible(&state.app, "mini"),
    }))
}

async fn get_lyrics_state(State(state): State<BridgeState>) -> Json<Value> {
    Json(state.lyrics_state.lock().await.clone())
}

async fn set_lyrics_state(State(state): State<BridgeState>, body: Bytes) -> StatusCode {
    // The renderer posts JSON without an explicit content-type header; Axum's
    // `Json` extractor would reject that, so parse the raw body.
    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let mut current = state.lyrics_state.lock().await;
    if body.get("type").and_then(Value::as_str) == Some("time") {
        if let Some(object) = current.as_object_mut() {
            if let Some(time) = body.get("time") {
                object.insert("time".into(), time.clone());
            }
            if let Some(playing) = body.get("playing") {
                object.insert("playing".into(), playing.clone());
            }
        }
    } else {
        *current = body;
    }
    StatusCode::NO_CONTENT
}

async fn desktop_command(
    State(state): State<BridgeState>,
    Query(query): Query<ActionQuery>,
) -> StatusCode {
    let Some(window) = main_window(&state.app) else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(action) = query.action else {
        return StatusCode::BAD_REQUEST;
    };
    let value = query
        .value
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| format!(",{value}"))
        .unwrap_or_default();
    let script = format!(
        "window.__qimiaoDesktopCommand&&window.__qimiaoDesktopCommand({}{})",
        serde_json::to_string(&action).unwrap_or_else(|_| "\"\"".into()),
        value
    );
    match window.eval(&script) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

const AUDIO_CACHE_INDEX: &str = "index.json";
// The renderer enforces the user-configured MB limit after each write. This is
// only a safety ceiling so custom limits are not pre-empted.
const AUDIO_CACHE_MAX_ENTRIES: usize = usize::MAX;
const AUDIO_CACHE_MAX_BYTES: u64 = 1024 * 1024 * 1024 * 1024;

fn audio_cache_stem(name: &str, id: u64) -> String {
    let safe: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = safe.trim().trim_end_matches(|ch| ch == '.' || ch == ' ');
    if trimmed.is_empty() {
        format!("cached-song-{id}")
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn audio_cache_file(dir: &Path, item: &AudioCacheMeta) -> PathBuf {
    if let Some(file) = item.file.as_deref() {
        if !file.contains('/') && !file.contains('\\') && !file.contains("..") {
            return dir.join(file);
        }
    }
    dir.join(format!("{}.opus", item.id))
}

fn audio_cache_file_for(
    dir: &Path,
    items: &[AudioCacheMeta],
    id: u64,
    name: &str,
    keep: Option<&str>,
) -> String {
    if let Some(file) = keep {
        if !file.contains('/') && !file.contains('\\') && !file.contains("..") {
            return file.to_string();
        }
    }
    let base = audio_cache_stem(name, id);
    let used: Vec<&str> = items
        .iter()
        .filter(|item| item.id != id)
        .filter_map(|item| item.file.as_deref())
        .collect();
    let legacy = format!("{id}.opus");
    let mut candidate = format!("{base}.opus");
    let mut index = 1;
    while used.contains(&candidate.as_str())
        || (dir.join(&candidate).exists() && candidate != legacy)
    {
        candidate = format!("{base} ({index}).opus");
        index += 1;
    }
    candidate
}

async fn sync_audio_cache_files(dir: &Path, items: &mut [AudioCacheMeta]) -> bool {
    let snapshot = items.to_vec();
    let mut changed = false;
    for index in 0..items.len() {
        let item = items[index].clone();
        if item
            .file
            .as_deref()
            .map(|file| audio_cache_file(dir, &item).exists() && !file.is_empty())
            .unwrap_or(false)
        {
            continue;
        }
        let legacy = dir.join(format!("{}.opus", item.id));
        let file = audio_cache_file_for(
            dir,
            &snapshot,
            item.id,
            &item.name,
            item.file.as_deref(),
        );
        let target = dir.join(&file);
        if legacy.exists() && legacy != target {
            let _ = tokio::fs::rename(&legacy, &target).await;
        }
        items[index].file = Some(file);
        changed = true;
    }
    changed
}

fn audio_cache_index_file(dir: &Path) -> PathBuf {
    dir.join(AUDIO_CACHE_INDEX)
}

fn parse_cache_id(raw: Option<&str>) -> Option<u64> {
    raw.and_then(|value| value.parse::<u64>().ok()).filter(|id| *id > 0)
}

async fn read_audio_cache_index(dir: &Path) -> Vec<AudioCacheMeta> {
    let raw = match tokio::fs::read_to_string(audio_cache_index_file(dir)).await {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str::<Vec<AudioCacheMeta>>(&raw).unwrap_or_default()
}

async fn write_audio_cache_index(dir: &Path, items: &[AudioCacheMeta]) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    let raw = serde_json::to_vec(items).unwrap_or_else(|_| b"[]".to_vec());
    tokio::fs::write(audio_cache_index_file(dir), raw).await
}

async fn prune_audio_cache(dir: &Path, items: Vec<AudioCacheMeta>) -> Vec<AudioCacheMeta> {
    let mut sorted = items;
    sorted.sort_by_key(|item| item.created_at);
    let mut count = sorted.len();
    let mut bytes: u64 = sorted.iter().map(|item| item.size).sum();
    let mut keep = Vec::new();
    for item in sorted {
        if count <= AUDIO_CACHE_MAX_ENTRIES && bytes <= AUDIO_CACHE_MAX_BYTES {
            keep.push(item);
            continue;
        }
        let _ = tokio::fs::remove_file(audio_cache_file(dir, &item)).await;
        count = count.saturating_sub(1);
        bytes = bytes.saturating_sub(item.size);
    }
    keep
}

async fn list_audio_cache(State(state): State<BridgeState>) -> Json<Value> {
    let dir = state.audio_cache_dir.lock().await.clone();
    let mut items = read_audio_cache_index(&dir).await;
    if sync_audio_cache_files(&dir, &mut items).await {
        let _ = write_audio_cache_index(&dir, &items).await;
    }
    let mut live = Vec::new();
    for item in items.drain(..) {
        if tokio::fs::try_exists(audio_cache_file(&dir, &item))
            .await
            .unwrap_or(false)
        {
            live.push(item);
        }
    }
    live.sort_by_key(|item| std::cmp::Reverse(item.created_at));
    Json(json!({ "dir": dir.display().to_string(), "items": live }))
}

async fn get_audio_cache_meta(
    State(state): State<BridgeState>,
    Query(query): Query<AudioCacheQuery>,
) -> Response {
    let Some(id) = parse_cache_id(query.id.as_deref()) else {
        return (StatusCode::BAD_REQUEST, "invalid id").into_response();
    };
    let dir = state.audio_cache_dir.lock().await.clone();
    let items = read_audio_cache_index(&dir).await;
    match items.into_iter().find(|item| item.id == id) {
        Some(item)
            if tokio::fs::try_exists(audio_cache_file(&dir, &item))
                .await
                .unwrap_or(false) =>
        {
            Json(item).into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_audio_cache_file(
    State(state): State<BridgeState>,
    Query(query): Query<AudioCacheQuery>,
) -> Response {
    let Some(id) = parse_cache_id(query.id.as_deref()) else {
        return (StatusCode::BAD_REQUEST, "invalid id").into_response();
    };
    let dir = state.audio_cache_dir.lock().await.clone();
    let items = read_audio_cache_index(&dir).await;
    let path = items
        .iter()
        .find(|item| item.id == id)
        .map(|item| audio_cache_file(&dir, item))
        .unwrap_or_else(|| dir.join(format!("{id}.opus")));
    match tokio::fs::read(path).await {
        Ok(bytes) => (
            [(header::CONTENT_TYPE, "audio/ogg"), (header::CACHE_CONTROL, "no-store")],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn save_audio_cache(
    State(state): State<BridgeState>,
    Query(query): Query<AudioCacheQuery>,
    body: Bytes,
) -> Response {
    let Some(meta) = query.meta else {
        return (StatusCode::BAD_REQUEST, "missing meta").into_response();
    };
    let mut item = match serde_json::from_str::<AudioCacheMeta>(&meta) {
        Ok(item) if item.id > 0 && !body.is_empty() => item,
        _ => return (StatusCode::BAD_REQUEST, "invalid meta").into_response(),
    };
    item.name = item.name.chars().take(300).collect();
    item.size = body.len() as u64;
    if item.created_at == 0 {
        item.created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or_default();
    }
    let dir = state.audio_cache_dir.lock().await.clone();
    if let Err(error) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    let mut items = read_audio_cache_index(&dir).await;
    let previous = items.iter().find(|entry| entry.id == item.id).cloned();
    let file = audio_cache_file_for(
        &dir,
        &items,
        item.id,
        &item.name,
        previous.as_ref().and_then(|entry| entry.file.as_deref()),
    );
    item.file = Some(file.clone());
    let target = dir.join(&file);
    if let Err(error) = tokio::fs::write(&target, &body).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    let legacy = dir.join(format!("{}.opus", item.id));
    if legacy != target && legacy.exists() {
        let _ = tokio::fs::remove_file(&legacy).await;
    }
    items.retain(|entry| entry.id != item.id);
    items.push(item.clone());
    let items = prune_audio_cache(&dir, items).await;
    if let Err(error) = write_audio_cache_index(&dir, &items).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    Json(item).into_response()
}

async fn clear_audio_cache(
    State(state): State<BridgeState>,
    Query(query): Query<AudioCacheQuery>,
) -> Response {
    let dir = state.audio_cache_dir.lock().await.clone();
    let items = read_audio_cache_index(&dir).await;
    if let Some(id) = parse_cache_id(query.id.as_deref()) {
        let item = items.iter().find(|entry| entry.id == id);
        let path = item
            .map(|entry| audio_cache_file(&dir, entry))
            .unwrap_or_else(|| dir.join(format!("{id}.opus")));
        let _ = tokio::fs::remove_file(path).await;
        let remaining: Vec<_> = items.into_iter().filter(|item| item.id != id).collect();
        if let Err(error) = write_audio_cache_index(&dir, &remaining).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
    } else {
        for item in items {
            let _ = tokio::fs::remove_file(audio_cache_file(&dir, &item)).await;
        }
        if let Err(error) = write_audio_cache_index(&dir, &[]).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
    }
    Json(json!({ "ok": true })).into_response()
}

async fn get_audio_cache_dir(State(state): State<BridgeState>) -> Json<Value> {
    let dir = state.audio_cache_dir.lock().await.clone();
    Json(json!({ "dir": dir.display().to_string(), "canPick": false }))
}

async fn pick_audio_cache_dir(State(state): State<BridgeState>) -> Json<Value> {
    let dir = state.audio_cache_dir.lock().await.clone();
    Json(json!({ "dir": dir.display().to_string(), "cancelled": true }))
}

async fn open_audio_cache_dir(State(state): State<BridgeState>) -> Response {
    let dir = state.audio_cache_dir.lock().await.clone();
    if let Err(error) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    match open_path(&dir) {
        Ok(()) => Json(json!({ "dir": dir.display().to_string() })).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn get_download_dir(State(state): State<BridgeState>) -> Json<Value> {
    let dir = state.download_dir.lock().await.clone();
    Json(json!({ "dir": dir.display().to_string() }))
}

async fn pick_dir(State(state): State<BridgeState>) -> Json<Value> {
    let dir = state.download_dir.lock().await.clone();
    Json(json!({ "dir": dir.display().to_string(), "cancelled": false }))
}

fn open_path(path: &PathBuf) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(path).spawn().map(|_| ())
}

async fn open_dir(State(state): State<BridgeState>) -> Response {
    let dir = state.download_dir.lock().await.clone();
    if let Err(error) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    match open_path(&dir) {
        Ok(()) => Json(json!({ "dir": dir.display().to_string() })).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn save_file(
    State(state): State<BridgeState>,
    Query(query): Query<FileQuery>,
    body: Bytes,
) -> Response {
    let dir = state.download_dir.lock().await.clone();
    if let Err(error) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    let raw_name = query.name.unwrap_or_else(|| "download.opus".into());
    let name = raw_name
        .chars()
        .map(|ch| {
            if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>();
    let safe_name = if name.trim().is_empty() {
        "download.opus".into()
    } else {
        name
    };
    let mut target = dir.join(&safe_name);
    if target.exists() {
        let stem = target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("download");
        let extension = target
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        for index in 1..1000 {
            let candidate = if extension.is_empty() {
                format!("{stem} ({index})")
            } else {
                format!("{stem} ({index}).{extension}")
            };
            let path = dir.join(candidate);
            if !path.exists() {
                target = path;
                break;
            }
        }
    }
    if let Err(error) = tokio::fs::write(&target, &body).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    Json(json!({ "path": target.display().to_string() })).into_response()
}
