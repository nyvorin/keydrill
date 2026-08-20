pub mod commands;
pub mod core;
pub mod reminder;
pub mod store;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};

fn show_main(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn snooze(app: &tauri::AppHandle, minutes: i64) {
    let state = app.state::<commands::AppState>();
    if let Ok(mut store) = state.lock() {
        // Always `crate::core::…` — the crate-local `core` module shadows the built-in crate.
        let _ = reminder::snooze_minutes(&mut store, &crate::core::clock::SystemClock, minutes);
    };
    // The trailing `;` is load-bearing: it ends the statement so the `Result<MutexGuard>`
    // temporary drops before `state`, which borrows from `app` (E0597 without it).
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Spec §8: autostart at login HIDDEN in the menu bar. The registered LaunchAgent
            // passes `--hidden`; a normal (user-initiated) launch has no such arg and shows.
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            commands::init_store(app.handle())?;

            let hidden = std::env::args().any(|a| a == "--hidden");
            if hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
                #[cfg(target_os = "macos")]
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            let start =
                MenuItemBuilder::with_id("start_session", "Start Today's Session").build(app)?;
            let open = MenuItemBuilder::with_id("open", "Open keydrill").build(app)?;
            let s30 = MenuItemBuilder::with_id("snooze_30", "30 min").build(app)?;
            let s60 = MenuItemBuilder::with_id("snooze_60", "1 hr").build(app)?;
            let s360 = MenuItemBuilder::with_id("snooze_360", "6 hrs").build(app)?;
            let remind = SubmenuBuilder::new(app, "Remind me later")
                .items(&[&s30, &s60, &s360])
                .build()?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&start, &open])
                .separator()
                .item(&remind)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "start_session" => {
                        show_main(app);
                        let _ = app.emit("keydrill://navigate", "/session");
                    }
                    "open" => show_main(app),
                    "snooze_30" => snooze(app, 30),
                    "snooze_60" => snooze(app, 60),
                    "snooze_360" => snooze(app, 360),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            reminder::spawn_reminder_loop(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close = hide to tray; the app stays resident (spec §8).
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
                #[cfg(target_os = "macos")]
                let _ = window
                    .app_handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::ingest_keystrokes,
            commands::end_session,
            commands::get_skill_stats,
            commands::get_trends,
            commands::get_heatmap,
            commands::get_day_state,
            commands::get_setting,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running keydrill");
}
