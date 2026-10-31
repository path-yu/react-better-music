#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_server;
mod bridge;
mod local_library;
mod unblock;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let lyrics = MenuItem::with_id(app, "lyrics", "桌面歌词", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "迷你播放器", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &lyrics, &mini, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "lyrics" => {
                if let Err(error) = bridge::toggle_lyrics(app, None) {
                    eprintln!("[tauri] failed to toggle lyrics: {error}");
                }
            }
            "mini" => {
                if let Err(error) = bridge::toggle_mini(app, None) {
                    eprintln!("[tauri] failed to toggle mini player: {error}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn setup_window_lifecycle(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = handle.hide();
            }
        });
    }
}

fn main() {
    // Useful for exercising the Rust API without opening a WebView window and
    // for running it as a sidecar during integration tests.
    if std::env::var("QIMIAO_API_ONLY").as_deref() == Ok("1") {
        let data_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .unwrap_or_else(std::env::temp_dir);
        let library = local_library::LocalLibrary::new(data_dir.join("local-data/library.json"));
        let port = std::env::var("QIMIAO_API_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(13000);
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        if let Err(error) = runtime.block_on(api_server::start(port, library)) {
            eprintln!("[api] {error}");
        }
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
                    .unwrap_or_else(|| std::env::temp_dir())
            });
            let library = local_library::LocalLibrary::new(data_dir.join("library.json"));
            let port = std::env::var("QIMIAO_API_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(13000);

            tauri::async_runtime::spawn(async move {
                if let Err(error) = api_server::start(port, library).await {
                    eprintln!("[tauri] API server failed: {error}");
                }
            });

            let bridge_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = bridge::start(bridge_app, bridge::BRIDGE_PORT).await {
                    eprintln!("[tauri] bridge failed: {error}");
                }
            });

            setup_tray(app)?;
            setup_window_lifecycle(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running 声屿");
}
