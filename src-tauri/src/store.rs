//! What the page keeps between launches for a theme (the Google Chat look's
//! nav: its folds, and its copies of every group's row). Facebook clears the
//! localStorage keys it doesn't know within seconds, so they live in a file
//! in the app data folder: the page gets them in its initialization script
//! (window.__fmessStore) and writes them back with set_page_store.
use std::{fs, path::PathBuf};

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, Runtime};

/// A store this size is a mistake (Facebook's row markup for every group is
/// well under a megabyte).
const MAX_BYTES: usize = 4 * 1024 * 1024;

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("page-store.json"))
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Map<String, Value> {
    path(app)
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// The store as a JSON object, for the page's initialization script.
pub fn page_store<R: Runtime>(app: &AppHandle<R>) -> String {
    Value::Object(load(app)).to_string()
}

/// Called by inject.js: keeps `value` under `key` (null removes it).
#[tauri::command]
pub fn set_page_store<R: Runtime>(app: AppHandle<R>, key: String, value: Value) -> Result<(), String> {
    let path = path(&app).ok_or("no app data folder")?;
    let mut store = load(&app);
    if value.is_null() {
        store.remove(&key);
    } else {
        store.insert(key, value);
    }
    let text = Value::Object(store).to_string();
    if text.len() > MAX_BYTES {
        return Err("too large".into());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    // Written aside, then moved over the old file, so a crash leaves one or
    // the other whole.
    let partial = path.with_extension("json.partial");
    fs::write(&partial, text).map_err(|err| err.to_string())?;
    fs::rename(&partial, &path).map_err(|err| err.to_string())
}
