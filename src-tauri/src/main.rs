#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sounds;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs, path::PathBuf, thread, time::Duration,
};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayIconDebugInfo {
    source: String,
    phase: Option<String>,
    attempt: Option<u32>,
    logical_size: u32,
    backing_size: u32,
    scale: f64,
    stage: u32,
    style: String,
    variant: String,
    render_state: String,
    template: bool,
    bytes: usize,
    device_pixel_ratio: Option<f64>,
    user_agent: Option<String>,
    runtime: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = settings_path(&app)?;
    let current = read_settings_value(&path)?;
    let legacy = best_legacy_settings(&path)?;

    if let Some(mut current) = current {
        if let Some(legacy) = legacy.as_ref() {
            merge_missing_settings(&mut current, legacy);
        }
        return Ok(current);
    }

    Ok(legacy.unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = settings_path(&app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let raw = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_tray_state(
    app: AppHandle,
    title: String,
    tooltip: String,
    icon_bytes: Vec<u8>,
    visible: bool,
    debug_info: Option<TrayIconDebugInfo>,
) -> Result<(), String> {
    let tray_diagnostics = tray_diagnostics_enabled();

    if app.tray_by_id("main").is_none() {
        if tray_diagnostics {
            eprintln!("Tray icon update: main tray missing; rebuilding tray before update");
        }
        build_main_tray(&app).map_err(|error| error.to_string())?;
    }

    let Some(tray) = app.tray_by_id("main") else {
        return Err("Main tray is unavailable after rebuild".to_string());
    };

    if !visible {
        if tray_diagnostics {
            eprintln!("Tray icon update: hiding main tray");
        }
        if let Err(error) = tray.set_visible(false) {
            if tray_diagnostics {
                eprintln!("Tray icon update: set_visible(false) failed: {error}");
            }
            return Err(error.to_string());
        }
        return Ok(());
    }

    tray.set_title(Some(title.clone()))
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(tooltip.clone()))
        .map_err(|error| error.to_string())?;

    let mut fallback_reason: Option<String> = None;
    let image = if icon_bytes.is_empty() {
        fallback_reason = Some("empty icon bytes".to_string());
        fallback_tray_icon().map_err(|error| error.to_string())?
    } else {
        match Image::from_bytes(&icon_bytes) {
            Ok(image) => image,
            Err(error) => {
                fallback_reason = Some(format!("frontend icon decode failed: {error}"));
                fallback_tray_icon().map_err(|fallback_error| fallback_error.to_string())?
            }
        }
    };

    if tray_diagnostics {
        let info = debug_info
            .as_ref()
            .map(|info| {
                format!(
                    "source={}, phase={}, attempt={}, state={}, style={}, variant={}, stage={}, logical={}px, backing={}px, scale={}, device_pixel_ratio={}, template={}, frontend_bytes={}, runtime={}, user_agent={:?}, error={}",
                    info.source,
                    info.phase.as_deref().unwrap_or("unknown"),
                    info.attempt
                        .map(|attempt| attempt.to_string())
                        .unwrap_or_else(|| "unknown".to_string()),
                    info.render_state,
                    info.style,
                    info.variant,
                    info.stage,
                    info.logical_size,
                    info.backing_size,
                    info.scale,
                    info.device_pixel_ratio
                        .map(|ratio| ratio.to_string())
                        .unwrap_or_else(|| "unknown".to_string()),
                    info.template,
                    info.bytes,
                    info.runtime.as_deref().unwrap_or("unknown"),
                    info.user_agent.as_deref().unwrap_or("unknown"),
                    info.error.as_deref().unwrap_or("none")
                )
            })
            .unwrap_or_else(|| "source=unknown".to_string());
        eprintln!(
            "Tray icon update: title={title:?}, tooltip={tooltip:?}, visible={visible}, {info}, rust_bytes={}, fallback={}, native_template={}",
            icon_bytes.len(),
            fallback_reason.as_deref().unwrap_or("none"),
            fallback_reason.is_none() && debug_info.as_ref().map(|info| info.template).unwrap_or(false)
        );
    }

    #[cfg(target_os = "macos")]
    let use_template = fallback_reason.is_none() && debug_info.as_ref().map(|info| info.template).unwrap_or(false);
    #[cfg(not(target_os = "macos"))]
    let use_template = false;
    if let Err(error) = tray.set_icon_with_as_template(Some(image), use_template) {
        if tray_diagnostics {
            eprintln!(
                "Tray icon update: set_icon failed; fallback={}, native_template={}, rust_bytes={}, error={error}",
                fallback_reason.as_deref().unwrap_or("none"),
                use_template,
                icon_bytes.len()
            );
        }
        return Err(error.to_string());
    }

    if let Err(error) = tray.set_visible(true) {
        if tray_diagnostics {
            eprintln!("Tray icon update: set_visible(true) failed: {error}");
        }
        return Err(error.to_string());
    }

    if tray_diagnostics {
        eprintln!(
            "Tray icon update: set_icon and set_visible(true) succeeded; fallback={}",
            fallback_reason.as_deref().unwrap_or("none")
        );
    }

    Ok(())
}

#[tauri::command]
fn minimize_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn show_reminder(
    app: AppHandle,
    placement: String,
    message: String,
    body: String,
    duration_seconds: u32,
    action_label: Option<String>,
    action_event: Option<String>,
    secondary_action_label: Option<String>,
    secondary_action_event: Option<String>,
    tertiary_action_label: Option<String>,
    tertiary_action_event: Option<String>,
    persistent: bool,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("reminder") {
        let _ = existing.close();
        thread::sleep(Duration::from_millis(80));
    }

    let encoded_message = urlencoding::encode(&message);
    let encoded_body = urlencoding::encode(&body);
    let encoded_placement = urlencoding::encode(&placement);
    let encoded_action_label = action_label
        .as_ref()
        .map(|label| urlencoding::encode(label).to_string());
    let encoded_action_event = action_event
        .as_ref()
        .map(|event| urlencoding::encode(event).to_string());
    let encoded_secondary_action_label = secondary_action_label
        .as_ref()
        .map(|label| urlencoding::encode(label).to_string());
    let encoded_secondary_action_event = secondary_action_event
        .as_ref()
        .map(|event| urlencoding::encode(event).to_string());
    let encoded_tertiary_action_label = tertiary_action_label
        .as_ref()
        .map(|label| urlencoding::encode(label).to_string());
    let encoded_tertiary_action_event = tertiary_action_event
        .as_ref()
        .map(|event| urlencoding::encode(event).to_string());
    let mut url = format!(
        "index.html#/reminder?message={encoded_message}&body={encoded_body}&placement={encoded_placement}&duration={duration_seconds}"
    );
    if let (Some(label), Some(event)) = (encoded_action_label, encoded_action_event) {
        url.push_str(&format!("&actionLabel={label}&actionEvent={event}"));
    }
    if let (Some(label), Some(event)) = (
        encoded_secondary_action_label,
        encoded_secondary_action_event,
    ) {
        url.push_str(&format!(
            "&secondaryActionLabel={label}&secondaryActionEvent={event}"
        ));
    }
    if let (Some(label), Some(event)) =
        (encoded_tertiary_action_label, encoded_tertiary_action_event)
    {
        url.push_str(&format!(
            "&tertiaryActionLabel={label}&tertiaryActionEvent={event}"
        ));
    }
    let has_action = (action_label.is_some() && action_event.is_some())
        || (secondary_action_label.is_some() && secondary_action_event.is_some())
        || (tertiary_action_label.is_some() && tertiary_action_event.is_some());
    let has_tertiary_action = tertiary_action_label.is_some() && tertiary_action_event.is_some();
    if persistent {
        url.push_str("&persistent=true");
    }

    let reminder_width = if has_tertiary_action {
        342
    } else if has_action {
        388
    } else {
        342
    };
    let reminder_height = if has_tertiary_action {
        132
    } else if has_action {
        132
    } else {
        88
    };
    let mut window_builder = WebviewWindowBuilder::new(&app, "reminder", WebviewUrl::App(url.into()))
        .title("贴纸提醒")
        .inner_size(reminder_width as f64, reminder_height as f64)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .focusable(false)
        .shadow(false)
        .skip_taskbar(true);

    #[cfg(target_os = "macos")]
    {
        window_builder = window_builder.visible_on_all_workspaces(true);
    }

    let window = match window_builder.build()
    {
        Ok(window) => window,
        Err(error) => {
            let _ = app
                .notification()
                .builder()
                .title("贴纸番茄钟")
                .body(&message)
                .show();
            return Err(error.to_string());
        }
    };

    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No primary monitor found".to_string())?;
    let size = monitor.size();
    let scale = monitor.scale_factor();
    let width = (size.width as f64 / scale).round() as i32;
    let margin = 18;
    let window_width = reminder_width;

    let monitor_position = monitor.position();
    let origin_x = (monitor_position.x as f64 / scale).round() as i32;
    let origin_y = (monitor_position.y as f64 / scale).round() as i32;

    let (raw_x, y) = match placement.as_str() {
        "top-left" => (origin_x + margin, origin_y + margin),
        "top-center" => (origin_x + (width - window_width) / 2, origin_y + margin),
        "top-right" => (origin_x + width - window_width - margin, origin_y + margin),
        _ => (origin_x + width - window_width - margin, origin_y + margin),
    };
    let min_x = origin_x + margin;
    let max_x = origin_x + width - window_width - margin;
    let x = if max_x >= min_x {
        raw_x.clamp(min_x, max_x)
    } else {
        origin_x + margin
    };

    window
        .set_position(LogicalPosition::new(x as f64, y as f64))
        .map_err(|error| error.to_string())?;
    let _ = window.show();
    let _ = window.set_ignore_cursor_events(!has_action);

    if !persistent {
        let app_for_close = app.clone();
        let close_after = u64::from(duration_seconds.clamp(3, 60)) * 1_000;
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(close_after));
            if let Some(window) = app_for_close.get_webview_window("reminder") {
                let _ = window.close();
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn register_start_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|error| error.to_string())?;

    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Ok(String::new());
    }

    let mut errors = Vec::new();
    for candidate in shortcut_candidates(shortcut) {
        let registered = manager.on_shortcut(candidate.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("pomodoro-shortcut-start", ());
                }
            }
        });

        match registered {
            Ok(_) => return Ok(candidate),
            Err(error) => errors.push(format!("{candidate}: {error}")),
        }
    }

    Err(if errors.is_empty() {
        "No shortcut candidates to register".to_string()
    } else {
        errors.join("; ")
    })
}

#[tauri::command]
fn tick_feedback() -> Result<(), String> {
    perform_haptic_tick();
    Ok(())
}

#[tauri::command]
fn play_system_sound(sound_name: String) -> Result<(), String> {
    if !is_allowed_system_sound(&sound_name) {
        return Err(format!("Unsupported system sound: {sound_name}"));
    }
    sounds::play_sound(&sound_name);
    Ok(())
}

fn is_allowed_system_sound(sound_name: &str) -> bool {
    matches!(
        sound_name,
        "Basso"
            | "Blow"
            | "Bottle"
            | "Frog"
            | "Funk"
            | "Glass"
            | "Hero"
            | "Morse"
            | "Ping"
            | "Pop"
            | "Purr"
            | "Sosumi"
            | "Submarine"
            | "Tink"
    )
}

#[cfg(target_os = "macos")]
fn perform_haptic_tick() {
    use objc2_app_kit::{
        NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
        NSHapticFeedbackPerformer,
    };

    let performer = NSHapticFeedbackManager::defaultPerformer();
    performer.performFeedbackPattern_performanceTime(
        NSHapticFeedbackPattern::LevelChange,
        NSHapticFeedbackPerformanceTime::Now,
    );
}

#[cfg(not(target_os = "macos"))]
fn perform_haptic_tick() {}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join("settings.json"))
}

fn read_settings_value(path: &PathBuf) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))
}

fn best_legacy_settings(current_path: &PathBuf) -> Result<Option<Value>, String> {
    let mut best: Option<(Value, u64, u64)> = None;

    for path in legacy_settings_paths()
        .into_iter()
        .filter(|path| path != current_path && path.exists())
    {
        let value = match read_settings_value(&path)? {
            Some(value) => value,
            None => continue,
        };
        let score = settings_migration_score(&value);
        let modified = path
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        let should_replace = best
            .as_ref()
            .map(|(_, best_score, best_modified)| score > *best_score || (score == *best_score && modified > *best_modified))
            .unwrap_or(true);

        if should_replace {
            best = Some((value, score, modified));
        }
    }

    Ok(best.map(|(value, _, _)| value))
}

fn merge_missing_settings(current: &mut Value, legacy: &Value) {
    let (Some(current), Some(legacy)) = (current.as_object_mut(), legacy.as_object()) else {
        return;
    };

    copy_field_if_missing_or_empty(current, legacy, "background");
    copy_field_if_missing_or_empty(current, legacy, "todos");
    copy_field_if_missing_or_empty(current, legacy, "activeTodoId");
    copy_field_if_missing_or_empty(current, legacy, "quickStartPresets");
    copy_field_if_missing_or_empty(current, legacy, "projects");
    copy_field_if_missing_or_empty(current, legacy, "activeProjectId");
    copy_field_if_missing_or_empty(current, legacy, "forestStats");
    copy_field_if_missing_or_empty(current, legacy, "stickers");
    copy_field_if_missing_or_empty(current, legacy, "avatar");
    copy_array_if_legacy_has_more(current, legacy, "projects");
    copy_active_project_if_default(current, legacy);
}

fn copy_field_if_missing_or_empty(current: &mut serde_json::Map<String, Value>, legacy: &serde_json::Map<String, Value>, key: &str) {
    let Some(legacy_value) = legacy.get(key).filter(|value| setting_value_has_data(value)) else {
        return;
    };

    if current.get(key).map(setting_value_has_data).unwrap_or(false) {
        return;
    }

    current.insert(key.to_string(), legacy_value.clone());
}

fn copy_array_if_legacy_has_more(current: &mut serde_json::Map<String, Value>, legacy: &serde_json::Map<String, Value>, key: &str) {
    let current_len = array_len(current.get(key));
    let legacy_len = array_len(legacy.get(key));

    if legacy_len > current_len {
        if let Some(legacy_value) = legacy.get(key) {
            current.insert(key.to_string(), legacy_value.clone());
        }
    }
}

fn copy_active_project_if_default(current: &mut serde_json::Map<String, Value>, legacy: &serde_json::Map<String, Value>) {
    let current_project = current.get("activeProjectId").and_then(Value::as_str);
    let legacy_project = legacy.get("activeProjectId").and_then(Value::as_str);

    if matches!(current_project, None | Some("unclassified")) {
        if let Some(project_id) = legacy_project.filter(|project_id| *project_id != "unclassified") {
            current.insert("activeProjectId".to_string(), Value::String(project_id.to_string()));
        }
    }
}

fn settings_migration_score(value: &Value) -> u64 {
    let Some(settings) = value.as_object() else {
        return 0;
    };

    1 + array_len(settings.get("todos")) * 1_000
        + object_len(settings.get("forestStats").and_then(|stats| stats.get("days"))) * 80
        + array_len(settings.get("projects")) * 40
        + array_len(settings.get("quickStartPresets")) * 30
        + array_len(settings.get("stickers")) * 10
        + u64::from(setting_value_has_data(settings.get("background").unwrap_or(&Value::Null))) * 5
        + u64::from(setting_value_has_data(settings.get("avatar").unwrap_or(&Value::Null))) * 5
}

fn setting_value_has_data(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(_) => true,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => {
            if let Some(kind) = value.get("kind").and_then(Value::as_str) {
                if kind == "none" {
                    return false;
                }
            }

            if let Some(days) = value.get("days").and_then(Value::as_object) {
                return !days.is_empty();
            }

            !value.is_empty()
        }
    }
}

fn array_len(value: Option<&Value>) -> u64 {
    value
        .and_then(Value::as_array)
        .map(|items| items.len() as u64)
        .unwrap_or(0)
}

fn object_len(value: Option<&Value>) -> u64 {
    value
        .and_then(Value::as_object)
        .map(|items| items.len() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn legacy_settings_paths() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME") else {
        return Vec::new();
    };
    let support = PathBuf::from(home).join("Library").join("Application Support");
    [
        "com.liuyuhang.stickerpomodoro.finaltest",
        "com.liuyuhang.stickerpomodoro.todoquickstart",
        "com.liuyuhang.stickerpomodoro.mac",
        "com.stickerpomodoro.app",
        "com.liuyuhang.stickerpomodoro",
        "com.liuyuhang.stickerpomodoro.backgroundtest.mac",
    ]
    .into_iter()
    .map(|dir| support.join(dir).join("settings.json"))
    .collect()
}

#[cfg(not(target_os = "macos"))]
fn legacy_settings_paths() -> Vec<PathBuf> {
    Vec::new()
}

fn shortcut_candidates(shortcut: &str) -> Vec<String> {
    let normalized = shortcut
        .split('+')
        .map(|part| match part.trim() {
            "Option" => "Alt".to_string(),
            "Control" => "Ctrl".to_string(),
            "CmdOrCtrl" => "CommandOrControl".to_string(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+");
    let mut candidates = Vec::new();

    for candidate in [
        normalized.clone(),
        shortcut.to_string(),
        normalized.replace("Command", "Cmd"),
    ] {
        if !candidate.trim().is_empty() && !candidates.iter().any(|item| item == &candidate) {
            candidates.push(candidate);
        }
    }

    candidates
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_diagnostics_enabled() -> bool {
    cfg!(debug_assertions)
        || env::var("STICKER_POMODORO_TRAY_DIAG")
            .map(|value| {
                let value = value.trim().to_ascii_lowercase();
                value == "1" || value == "true" || value == "yes"
            })
            .unwrap_or(false)
}

fn fallback_tray_icon() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/icon.png"))
}

fn build_main_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id("main").is_some() {
        return Ok(());
    }

    let tray_icon = fallback_tray_icon()?;
    let show = MenuItemBuilder::with_id("show", "打开贴纸番茄钟").build(app)?;
    let pause = MenuItemBuilder::with_id("toggle", "开始 / 暂停").build(app)?;
    let reset = MenuItemBuilder::with_id("reset", "重置").build(app)?;
    let stats = MenuItemBuilder::with_id("stats", "查看森林统计").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &pause, &reset, &stats, &quit])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main")
        .title("25:00 · 0棵")
        .tooltip("贴纸番茄钟")
        .menu(&menu)
        .icon_as_template(false)
        .icon(tray_icon);

    #[cfg(target_os = "macos")]
    {
        builder = builder.show_menu_on_left_click(true);
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.on_tray_icon_event(|tray, event| {
            use tauri::tray::MouseButton;
            if let tauri::tray::TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    }

    builder.on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                show_main_window(app);
            }
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-toggle", ());
                }
            }
            "reset" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-reset", ());
                }
            }
            "stats" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-stats", ());
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if let Err(error) = build_main_tray(app.handle()) {
                eprintln!("Could not build menu bar tray: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            show_reminder,
            update_tray_state,
            register_start_shortcut,
            minimize_main_window,
            tick_feedback,
            play_system_sound
        ])
        .build(tauri::generate_context!())
        .expect("error while building sticker pomodoro")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
        })
}
