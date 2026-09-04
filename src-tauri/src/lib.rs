mod auth;
mod chamber;
mod commands;
mod config;
mod error;
mod git;
mod identity;
mod paths;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub config: Mutex<config::AppConfig>,
}

impl AppState {
    pub fn askpass_dir(&self) -> PathBuf {
        self.data_dir.join("bin")
    }
    pub fn chambers_dir(&self) -> PathBuf {
        self.data_dir.join("chambers")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    paths::fix_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            std::fs::create_dir_all(&data_dir)?;
            let config_path = config_dir.join("chambers.json");
            let config = config::AppConfig::load(&config_path).unwrap_or_default();
            app.manage(AppState { config_path, data_dir, config: Mutex::new(config) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::identity_public_key,
            commands::recovery_kit_export,
            commands::recovery_kit_import,
            commands::recovery_mark_saved,
            commands::chamber_create,
            commands::chamber_join,
            commands::chamber_select,
            commands::chamber_forget,
            commands::secrets_list,
            commands::secret_open,
            commands::secret_open_at,
            commands::secret_seal_files,
            commands::secret_seal_text,
            commands::secret_remove,
            commands::secrets_move,
            commands::secrets_remove,
            commands::secret_history,
            commands::sync_status,
            commands::sync_now,
            commands::sync_resolve,
            commands::keepers_list,
            commands::keeper_add,
            commands::keeper_remove,
            commands::auth_detect,
            commands::auth_check,
            commands::auth_store_token,
            commands::auth_forget_token,
            commands::pick_files,
            commands::pick_folder,
            commands::pick_save_path,
            commands::write_file,
            commands::write_file_base64,
            commands::open_url,
            commands::copy_text,
            commands::clear_clipboard,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chamber");
}
