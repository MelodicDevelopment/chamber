//! Tauri commands. Thin: validate, look up the chamber, delegate.

use crate::auth::{self, Prompt};
use crate::chamber::{Chamber, Entry, Recipient};
use crate::config::ChamberRef;
use crate::error::{AppError, Result};
use crate::git::{Git, Keep, LogEntry, SyncStatus};
use crate::identity;
use crate::AppState;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub identity_exists: bool,
    pub public_key: Option<String>,
    pub recovery_saved: bool,
    pub device_name: String,
    pub git_available: bool,
    pub gcm_available: bool,
    pub gcm_install: auth::GcmInstall,
    /// Git author name; with `device_name` it forms this device's keeper label.
    pub author_name: String,
    pub chambers: Vec<ChamberSummary>,
    pub current: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChamberSummary {
    #[serde(flatten)]
    pub r#ref: ChamberRef,
    pub has_access: bool,
    pub keepers: usize,
    pub sync: Option<SyncStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretContent {
    pub path: String,
    pub is_text: bool,
    pub text: Option<String>,
    pub base64: String,
    pub size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SealResult {
    pub sealed: Vec<String>,
    pub unchanged: Vec<String>,
}

/// `prompt` says whether git may open a browser (GCM) during this call. Only
/// user-initiated network work should pass `Interactive`.
fn open_chamber(state: &State<AppState>, id: &str, prompt: Prompt) -> Result<(Chamber, ChamberRef)> {
    let cfg = state.config.lock().unwrap();
    let r = cfg.find(id).cloned().ok_or_else(|| AppError::msg("unknown chamber"))?;
    let (name, email) = cfg.author();
    drop(cfg);
    let mut chamber = Chamber::open(&r.path)?;
    chamber.git.ensure_author(&name, &email)?;
    if let Some(remote) = &r.remote {
        let info = auth::detect(remote);
        if !info.is_ssh {
            let env = auth::env_for(&info.host, &state.askpass_dir(), prompt)?;
            chamber.git = chamber.git.with_env(env);
        }
    }
    Ok((chamber, r))
}

fn summarize(state: &State<AppState>, r: &ChamberRef, public_key: Option<&str>) -> ChamberSummary {
    let (has_access, keepers, sync) = match open_chamber(state, &r.id, Prompt::Silent) {
        Ok((c, _)) => {
            let recipients = c.recipients().unwrap_or_default();
            let access = public_key.map(|pk| recipients.iter().any(|x| x.public_key == pk)).unwrap_or(false);
            (access, recipients.len(), c.git.status().ok())
        }
        Err(_) => (false, 0, None),
    };
    ChamberSummary { r#ref: r.clone(), has_access, keepers, sync }
}

#[tauri::command]
pub fn app_status(state: State<AppState>) -> Result<AppStatus> {
    let identity_exists = identity::exists()?;
    let public_key = if identity_exists { Some(identity::public_key()?) } else { None };
    let cfg = state.config.lock().unwrap().clone();
    let chambers = cfg.chambers.iter().map(|r| summarize(&state, r, public_key.as_deref())).collect();
    Ok(AppStatus {
        identity_exists,
        public_key,
        recovery_saved: cfg.recovery_saved,
        device_name: cfg.device_name(),
        git_available: Git::version().is_ok(),
        gcm_available: auth::gcm_available(),
        gcm_install: auth::gcm_install(),
        author_name: cfg.author().0,
        chambers,
        current: cfg.current.clone(),
    })
}

#[tauri::command]
pub fn identity_public_key() -> Result<String> {
    identity::public_key()
}

#[tauri::command]
pub async fn recovery_kit_export(passphrase: String, save_to: Option<String>) -> Result<String> {
    let kit = identity::export_recovery_kit(&passphrase)?;
    if let Some(p) = save_to {
        std::fs::write(p, &kit)?;
    }
    Ok(kit)
}

#[tauri::command]
pub fn recovery_kit_import(kit: String, passphrase: String) -> Result<String> {
    identity::import_recovery_kit(&kit, &passphrase)
}

#[tauri::command]
pub fn recovery_mark_saved(state: State<AppState>) -> Result<()> {
    let mut cfg = state.config.lock().unwrap();
    cfg.recovery_saved = true;
    cfg.save(&state.config_path)
}

fn register(state: &State<AppState>, name: &str, path: PathBuf, remote: Option<String>) -> Result<ChamberRef> {
    let r = ChamberRef { id: uuid::Uuid::new_v4().to_string(), name: name.to_string(), path, remote, created_at: chrono::Utc::now().to_rfc3339(), folders: Vec::new() };
    let mut cfg = state.config.lock().unwrap();
    cfg.chambers.push(r.clone());
    cfg.current = Some(r.id.clone());
    cfg.save(&state.config_path)?;
    Ok(r)
}

fn slug(s: &str) -> String {
    let s: String = s.trim().chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "chamber".into() } else { s }
}

#[tauri::command]
pub async fn chamber_create(state: State<'_, AppState>, name: String, remote: Option<String>) -> Result<ChamberSummary> {
    let pk = identity::public_key()?;
    let (author, email) = state.config.lock().unwrap().author();
    let device = state.config.lock().unwrap().device_name();
    let dir = state.chambers_dir().join(format!("{}-{}", slug(&name), &uuid::Uuid::new_v4().to_string()[..8]));
    let chamber = Chamber::create(&dir, &name, &pk, &format!("{author} ({device})"), (&author, &email))?;
    if let Some(url) = remote.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        chamber.git.set_remote(url)?;
        let info = auth::detect(url);
        let env = if info.is_ssh { vec![] } else { auth::env_for(&info.host, &state.askpass_dir(), Prompt::Interactive)? };
        let g = chamber.git.clone().with_env(env);
        g.fetch()?;
        g.merge_remote()?;
        g.push()?;
    }
    let r = register(&state, &name, dir, remote.filter(|s| !s.trim().is_empty()))?;
    Ok(summarize(&state, &r, Some(&pk)))
}

#[tauri::command]
pub async fn chamber_join(state: State<'_, AppState>, url: String, name: Option<String>) -> Result<ChamberSummary> {
    let url = url.trim().to_string();
    let info = auth::detect(&url);
    let env = if info.is_ssh { vec![] } else { auth::env_for(&info.host, &state.askpass_dir(), Prompt::Interactive)? };
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| url.trim_end_matches('/').trim_end_matches(".git").rsplit('/').next().unwrap_or("chamber").to_string());
    let dir = state.chambers_dir().join(format!("{}-{}", slug(&name), &uuid::Uuid::new_v4().to_string()[..8]));
    Git::clone(&url, &dir, &env)?;
    if !Chamber::is_chamber(&dir) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(AppError::msg("that repository is not a chamber"));
    }
    let r = register(&state, &name, dir, Some(url))?;
    let pk = identity::public_key().ok();
    Ok(summarize(&state, &r, pk.as_deref()))
}

#[tauri::command]
pub fn chamber_select(state: State<AppState>, id: String) -> Result<()> {
    let mut cfg = state.config.lock().unwrap();
    if cfg.find(&id).is_none() {
        return Err(AppError::msg("unknown chamber"));
    }
    cfg.current = Some(id);
    cfg.save(&state.config_path)
}

/// Save the sidebar folder order (and any empty folders) for a chamber. App-local, never committed.
#[tauri::command]
pub fn chamber_set_folders(state: State<AppState>, id: String, folders: Vec<String>) -> Result<()> {
    let mut cfg = state.config.lock().unwrap();
    let r = cfg.chambers.iter_mut().find(|c| c.id == id).ok_or_else(|| AppError::msg("unknown chamber"))?;
    r.folders = folders.into_iter().map(|f| f.trim_matches('/').to_string()).filter(|f| !f.is_empty()).collect();
    cfg.save(&state.config_path)
}

/// Remove from the app. The local clone is deleted; the remote is untouched.
#[tauri::command]
pub fn chamber_forget(state: State<AppState>, id: String) -> Result<()> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(r) = cfg.find(&id).cloned() {
        if r.path.starts_with(state.chambers_dir()) {
            let _ = std::fs::remove_dir_all(&r.path);
        }
    }
    cfg.chambers.retain(|c| c.id != id);
    if cfg.current.as_deref() == Some(&id) {
        cfg.current = cfg.chambers.first().map(|c| c.id.clone());
    }
    cfg.save(&state.config_path)
}

#[tauri::command]
pub async fn secrets_list(state: State<'_, AppState>, chamber_id: String) -> Result<Vec<Entry>> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    c.list()
}

fn to_content(path: &str, bytes: Vec<u8>) -> SecretContent {
    let is_text = std::str::from_utf8(&bytes).map(|s| !s.chars().any(|ch| ch == '\0')).unwrap_or(false);
    SecretContent {
        path: path.to_string(),
        is_text,
        text: if is_text { Some(String::from_utf8_lossy(&bytes).to_string()) } else { None },
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        size: bytes.len(),
    }
}

#[tauri::command]
pub async fn secret_open(state: State<'_, AppState>, chamber_id: String, path: String) -> Result<SecretContent> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let id = identity::load_or_create()?;
    Ok(to_content(&path, c.decrypt_path(&id, &path)?))
}

#[tauri::command]
pub async fn secret_open_at(state: State<'_, AppState>, chamber_id: String, path: String, rev: String) -> Result<SecretContent> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let id = identity::load_or_create()?;
    Ok(to_content(&path, c.decrypt_at(&id, &rev, &path)?))
}

/// Seal files dropped from the desktop. `folder` is the room inside the vault.
#[tauri::command]
pub async fn secret_seal_files(state: State<'_, AppState>, chamber_id: String, files: Vec<String>, folder: Option<String>) -> Result<SealResult> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let id = identity::load_or_create()?;
    let folder = folder.map(|f| f.trim_matches('/').to_string()).filter(|f| !f.is_empty());
    let mut result = SealResult { sealed: vec![], unchanged: vec![] };
    for f in files {
        let src = PathBuf::from(&f);
        let mut items: Vec<(String, PathBuf)> = vec![];
        if src.is_dir() {
            let base = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            for e in walkdir::WalkDir::new(&src).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
                let rel = e.path().strip_prefix(&src).unwrap().to_string_lossy().replace('\\', "/");
                if rel.split('/').any(|s| s == ".git" || s == ".DS_Store") {
                    continue;
                }
                items.push((format!("{base}/{rel}"), e.path().to_path_buf()));
            }
        } else {
            let name = src.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| AppError::msg("bad file path"))?;
            items.push((name, src.clone()));
        }
        for (rel, p) in items {
            let rel = match &folder {
                Some(f) => format!("{f}/{rel}"),
                None => rel,
            };
            let bytes = std::fs::read(&p)?;
            if c.seal(&id, &rel, &bytes)? {
                result.sealed.push(rel);
            } else {
                result.unchanged.push(rel);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn secret_seal_text(state: State<'_, AppState>, chamber_id: String, path: String, text: String) -> Result<bool> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let id = identity::load_or_create()?;
    c.seal(&id, &path, text.as_bytes())
}

#[tauri::command]
pub async fn secret_remove(state: State<'_, AppState>, chamber_id: String, path: String) -> Result<()> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    c.remove(&path)
}

/// Remove several secrets in one commit (deleting a folder with its contents).
#[tauri::command]
pub async fn secrets_remove(state: State<'_, AppState>, chamber_id: String, paths: Vec<String>) -> Result<usize> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    c.remove_many(&paths)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretMove {
    pub from: String,
    pub to: String,
}

/// Rename or re-folder secrets in one commit. Used for "Move to folder",
/// folder rename, and drag-and-drop between folders.
#[tauri::command]
pub async fn secrets_move(state: State<'_, AppState>, chamber_id: String, moves: Vec<SecretMove>) -> Result<usize> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let pairs: Vec<(String, String)> = moves.into_iter().map(|m| (m.from, m.to)).collect();
    c.move_secrets(&pairs)
}

#[tauri::command]
pub async fn secret_history(state: State<'_, AppState>, chamber_id: String, path: String) -> Result<Vec<LogEntry>> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    c.git.log(Some(&format!("vault/{path}.age")), 50)
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>, chamber_id: String) -> Result<SyncStatus> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let _ = c.git.fetch();
    c.git.status()
}

/// Fetch, merge what others sealed, push what we sealed.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>, chamber_id: String) -> Result<SyncStatus> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Interactive)?;
    if c.git.merge_in_progress() {
        c.git.finish_merge()?;
    }
    c.git.fetch()?;
    c.git.merge_remote()?;
    c.reconcile_index()?;
    c.git.commit_paths(&[".chamber"], "Reconcile index")?;
    c.git.push()?;
    c.git.status()
}

#[tauri::command]
pub async fn sync_resolve(state: State<'_, AppState>, chamber_id: String, path: String, keep: Keep) -> Result<SyncStatus> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Interactive)?;
    c.git.resolve(&path, keep)?;
    if c.git.conflicted_paths().is_empty() {
        c.git.finish_merge()?;
        c.reconcile_index()?;
        c.git.commit_paths(&[".chamber"], "Reconcile index")?;
        c.git.push()?;
    }
    c.git.status()
}

#[tauri::command]
pub fn keepers_list(state: State<AppState>, chamber_id: String) -> Result<Vec<Recipient>> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    c.recipients()
}

#[tauri::command]
pub async fn keeper_add(state: State<'_, AppState>, chamber_id: String, public_key: String, label: String) -> Result<Vec<Recipient>> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let id = identity::load_or_create()?;
    c.add_recipient(&id, public_key.trim(), label.trim())?;
    c.recipients()
}

/// Returns the secrets the removed key could read, so the UI can suggest rotation.
#[tauri::command]
pub async fn keeper_remove(state: State<'_, AppState>, chamber_id: String, public_key: String) -> Result<Vec<String>> {
    let (c, _) = open_chamber(&state, &chamber_id, Prompt::Silent)?;
    let id = identity::load_or_create()?;
    c.remove_recipient(&id, public_key.trim())
}

#[tauri::command]
pub fn auth_detect(url: String) -> auth::HostInfo {
    auth::detect(&url)
}

#[tauri::command]
pub async fn auth_check(state: State<'_, AppState>, url: String) -> Result<()> {
    auth::check(&url, &state.askpass_dir(), Prompt::Interactive)
}

/// Verify the token against the repo before keeping it.
#[tauri::command]
pub async fn auth_store_token(state: State<'_, AppState>, url: String, username: Option<String>, token: String) -> Result<()> {
    let info = auth::detect(&url);
    let user = username.filter(|u| !u.trim().is_empty()).unwrap_or(info.token_username.clone());
    auth::store_token(&info.host, user.trim(), token.trim())?;
    if let Err(e) = auth::check(&url, &state.askpass_dir(), Prompt::Silent) {
        let _ = auth::forget_token(&info.host);
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn auth_forget_token(host: String) -> Result<()> {
    auth::forget_token(&host)
}

// ---- native helpers ---------------------------------------------------------
// Pickers stay async: a blocking dialog on the main thread wedges the app.

#[tauri::command]
pub async fn pick_files(app: tauri::AppHandle) -> Option<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_files().map(|v| v.into_iter().map(|p| p.to_string()).collect())
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().map(|p| p.to_string())
}

#[tauri::command]
pub async fn pick_save_path(app: tauri::AppHandle, suggested: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().set_file_name(&suggested).blocking_save_file().map(|p| p.to_string())
}

#[tauri::command]
pub fn write_file(path: String, text: String) -> Result<()> {
    std::fs::write(path, text)?;
    Ok(())
}

#[tauri::command]
pub fn write_file_base64(path: String, base64_data: String) -> Result<()> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_data).map_err(|e| AppError::msg(e.to_string()))?;
    std::fs::write(path, bytes)?;
    Ok(())
}

#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn copy_text(app: tauri::AppHandle, text: String) -> Result<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn clear_clipboard(app: tauri::AppHandle) -> Result<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().clear().map_err(|e| AppError::msg(e.to_string()))
}
