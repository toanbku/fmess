//! The last resort for Messenger's encrypted chats (19-recover.js): when a
//! reload of the page doesn't bring them back, fMess starts again, as quitting
//! and opening it did. Their worker can hang for good after a reload made
//! while it started ("WorkerHealthStatus: shared_exists_and_connected"), and
//! a reload reconnects to the same worker. At most once in RESTART_EVERY,
//! kept in a file, so fMess can't start again and again.
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, Runtime};

const RESTART_EVERY_SECS: u64 = 30 * 60;

/// Called by the Messenger page. Returns false when fMess started again for
/// this too recently (or can't tell when it last did).
#[tauri::command]
pub fn restart_for_stuck_chats<R: Runtime>(app: AppHandle<R>, reason: String) -> bool {
    let Some(file) = app.path().app_data_dir().ok().map(|dir| dir.join("last-chats-restart")) else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let last = fs::read_to_string(&file)
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .unwrap_or(0);
    if now.saturating_sub(last) < RESTART_EVERY_SECS {
        eprintln!("[fmess] not starting again so soon: {reason}");
        return false;
    }
    if fs::write(&file, now.to_string()).is_err() {
        return false;
    }
    eprintln!("[fmess] starting again: {reason}");
    app.restart()
}
