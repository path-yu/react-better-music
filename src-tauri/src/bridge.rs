use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
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

pub async fn start(app: AppHandle, port: u16) -> Result<(), String> {
    let download_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir().map(|dir| dir.join("downloads")))
        .unwrap_or_else(|_| std::env::temp_dir());

    let state = BridgeState {
        app,
        lyrics_state: Arc::new(Mutex::new(json!({}))),
        devtools_disabled: Arc::new(Mutex::new(false)),
        download_dir: Arc::new(Mutex::new(download_dir)),
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
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    // Keep the WebView surface transparent so the lyrics HUD does not gain a
    // white rectangle on Windows.
    let _ = window.set_background_color(None);
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
