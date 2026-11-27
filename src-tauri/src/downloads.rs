//! Downloads: the photo viewer's Download button, files sent in chats. WebKit
//! and WebView2 save them to the Downloads folder without showing anything,
//! so the button looked like it did nothing. fMess tells the page when one
//! is done (19-downloads.js shows it), and can show the file in its folder.

use std::{path::PathBuf, sync::Mutex};

use tauri::{webview::DownloadEvent, AppHandle, Runtime, Webview};
use tauri_plugin_opener::OpenerExt;

use crate::services::Service;

/// Where each download in progress is saved, by its URL: macOS doesn't say
/// where when one finishes.
static SAVING: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());

/// The files downloaded so far. The page knows each by its index here, so it
/// can't ask fMess to show any other file.
static SAVED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// The webviews' download handler: lets every download go to the Downloads
/// folder (without a handler, macOS cancels them) and reports each one done.
pub fn handle<R: Runtime>(webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            #[cfg(debug_assertions)]
            eprintln!("[download] started, to {}", destination.display());
            SAVING.lock().unwrap().push((url.to_string(), destination.clone()));
        }
        DownloadEvent::Finished { url, path, success } => {
            // Two downloads of one URL at once may be told apart wrongly
            // here, but both hold the same file.
            let url = url.to_string();
            let saving = {
                let mut saving = SAVING.lock().unwrap();
                let index = saving.iter().position(|(started, _)| *started == url);
                index.map(|index| saving.remove(index).1)
            };
            finished(&webview, path.or(saving), success);
        }
        _ => {}
    }
    true
}

fn finished<R: Runtime>(webview: &Webview<R>, path: Option<PathBuf>, success: bool) {
    #[cfg(debug_assertions)]
    eprintln!("[download] {}: {path:?}", if success { "done" } else { "failed" });
    let name = path
        .as_deref()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().into_owned());
    let id = match path {
        Some(path) if success => {
            #[cfg(target_os = "macos")]
            bounce_downloads_stack(&path);
            let mut saved = SAVED.lock().unwrap();
            saved.push(path);
            // Only Messenger's web view may call show_download (see
            // capabilities/messenger-web.json): a popup gets no button.
            (webview.label() == Service::Messenger.label()).then(|| saved.len() - 1)
        }
        _ => None,
    };
    let report = serde_json::json!({ "ok": success, "name": name, "id": id });
    let _ = webview.eval(format!("window.__fmessDownloaded?.({report})"));
}

/// Called by inject.js when "Show in Finder" is clicked on a finished download.
#[tauri::command]
pub fn show_download<R: Runtime>(app: AppHandle<R>, id: usize) {
    let Some(path) = SAVED.lock().unwrap().get(id).cloned() else {
        return;
    };
    if let Err(err) = app.opener().reveal_item_in_dir(&path) {
        eprintln!("could not show {}: {err}", path.display());
    }
}

/// Bounces the Downloads stack in the Dock, as Safari does when a download ends.
#[cfg(target_os = "macos")]
fn bounce_downloads_stack(path: &std::path::Path) {
    use objc2_foundation::{NSDistributedNotificationCenter, NSString};
    let name = NSString::from_str("com.apple.DownloadFileFinished");
    let path = NSString::from_str(&path.to_string_lossy());
    unsafe {
        NSDistributedNotificationCenter::defaultCenter().postNotificationName_object(&name, Some(&path));
    }
}
