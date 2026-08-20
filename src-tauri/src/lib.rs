pub mod commands;
pub mod core;
pub mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            commands::init_store(app.handle())?;
            Ok(())
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
