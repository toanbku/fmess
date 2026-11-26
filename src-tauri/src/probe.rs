// Debug builds only, for checking the live page while developing:
// FMESS_PROBE=<file.js> runs that file in the main window once the page has
// loaded (after FMESS_PROBE_DELAY seconds, 15 by default) and prints what it
// returns. The file is a function body: it may `await` and must `return`.
// FMESS_PROBE_WAIT=<seconds> waits that long for it (60 by default), for a
// probe that waits for something only a person does, like someone typing.
// FMESS_PROBE_NO_FOCUS=1 runs it without bringing the window forward. A
// probe that returns "again" (and reloads the page) runs again after the
// reload, FMESS_PROBE_DELAY seconds later.
// FMESS_PROXY=<http://host:port> (webview.rs; on macOS a build with the
// test-proxy feature) sends the page's traffic through a proxy, for
// tests/app/live-check.sh, which cuts the network there.
// FMESS_NO_INJECT=1 (webview.rs) leaves fMess's page script out, to measure
// what it costs.
// FMESS_WINDOW_SIZE=<width>x<height> sizes the window first, and
// FMESS_SNAPSHOT=<file.png> (macOS, Windows) then saves a picture of the page
// as the probe left it, through WebKit/WebView2, which needs no
// screen-recording permission.
// Always, on stderr: each navigation of every window ([nav]), each popup
// ([popup]) and the page's JS errors ([page]), URLs without query values
// (see loggable).
use std::{thread, time::Duration};

use tauri::{AppHandle, LogicalSize, Manager, Runtime, Url};

/// A URL as it may be printed: query keys only (values can be tokens), no
/// fragment. Off Facebook only the host, as a path can say what was shared,
/// and only the scheme of mailto:, tel: or data: (an address, a number, a file).
pub fn loggable(url: &Url) -> String {
    let host = match (url.scheme(), url.host_str()) {
        ("about", _) => return url.as_str().to_owned(),
        ("http" | "https", Some(host)) => host,
        (scheme, _) => return format!("{scheme}:…"),
    };
    let on_facebook = ["facebook.com", "messenger.com", "fbcdn.net", "fbsbx.com", "facebook.net"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    let mut out = format!("{}://{host}", url.scheme());
    if !on_facebook {
        return out + "/…";
    }
    out += url.path();
    let keys: Vec<_> = url.query_pairs().map(|(key, _)| key.into_owned()).collect();
    if !keys.is_empty() {
        let keys = keys.join(",");
        let keys: String = keys.chars().take(80).collect();
        out += &format!("?{keys}");
    }
    out
}

pub fn log_navigation(label: &str, url: &Url, allowed: bool) {
    let verdict = if allowed {
        "allowed"
    } else if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        "opened externally"
    } else {
        "blocked"
    };
    eprintln!("[nav] {label} {verdict} {}", loggable(url));
}

/// Prints what inject.js collected in window.__fmessErrors, from every window.
fn watch_page_errors<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        for (label, window) in app.webview_windows() {
            let _ = window.eval_with_callback(
                "JSON.stringify((window.__fmessErrors || []).splice(0))",
                move |result| {
                    let entries = serde_json::from_str::<String>(&result)
                        .ok()
                        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
                        .unwrap_or_default();
                    for entry in entries {
                        eprintln!("[page] {label} {entry}");
                    }
                },
            );
        }
    });
}

pub fn run<R: Runtime>(app: AppHandle<R>) {
    watch_page_errors(app.clone());
    let Some(path) = std::env::var_os("FMESS_PROBE") else {
        return;
    };
    let delay = std::env::var("FMESS_PROBE_DELAY")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(15);
    let wait: u64 = std::env::var("FMESS_PROBE_WAIT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(60);
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(delay));
        let script = match std::fs::read_to_string(&path) {
            Ok(script) => script,
            Err(err) => return eprintln!("[probe] cannot read {path:?}: {err}"),
        };
        let Some(window) = app.get_webview_window(crate::MAIN_WINDOW) else {
            return;
        };
        if let Some((width, height)) = std::env::var("FMESS_WINDOW_SIZE").ok().and_then(|size| {
            let (width, height) = size.split_once('x')?;
            Some((width.parse::<f64>().ok()?, height.parse::<f64>().ok()?))
        }) {
            let _ = window.set_size(LogicalSize::new(width, height));
            thread::sleep(Duration::from_secs(2));
        }
        // Focused, as when someone uses it: WebKit matches :focus and fires
        // focus events only in the key window. FMESS_PROBE_NO_FOCUS=1 leaves
        // the focus where it is, for checks that run while someone works.
        if std::env::var_os("FMESS_PROBE_NO_FOCUS").is_none() {
            let _ = window.set_focus();
            thread::sleep(Duration::from_millis(500));
        }
        let start = format!(
            "window.__fmessProbe = undefined; (async () => {{ {script}\n}})().then(\
             (result) => {{ window.__fmessProbe = JSON.stringify(result ?? null); }},\
             (error) => {{ window.__fmessProbe = JSON.stringify('error: ' + error); }});"
        );
        let _ = window.eval(&start);
        for _ in 0..wait * 2 {
            thread::sleep(Duration::from_millis(500));
            #[cfg(any(target_os = "macos", windows))]
            serve_snapshot_request(&window);
            #[cfg(any(target_os = "macos", windows))]
            serve_input_request(&window);
            let (tx, rx) = std::sync::mpsc::channel();
            let _ = window.eval_with_callback("window.__fmessProbe ?? null", move |result| {
                let _ = tx.send(result);
            });
            match rx.recv_timeout(Duration::from_secs(5)) {
                // A probe that reloads the page returns "again" first: it
                // runs again once the page has loaded (sessionStorage tells
                // it where it was), to check what a reload leaves.
                Ok(result) if result == r#""\"again\"""# => {
                    eprintln!("[probe] again after a reload");
                    // The page that asked is marked, and the probe runs again
                    // only in a new one, once loaded: run sooner, it ran in the
                    // old page and died with it.
                    let _ = window.eval("window.__fmessProbe = undefined; window.__fmessProbeOldPage = true;");
                    for _ in 0..240 {
                        thread::sleep(Duration::from_millis(500));
                        let (tx, rx) = std::sync::mpsc::channel();
                        let _ = window.eval_with_callback(
                            "window.__fmessProbeOldPage !== true && document.readyState === 'complete'",
                            move |result| {
                                let _ = tx.send(result);
                            },
                        );
                        if rx.recv_timeout(Duration::from_secs(5)).is_ok_and(|result| result == "true") {
                            break;
                        }
                    }
                    thread::sleep(Duration::from_secs(delay));
                    let _ = window.eval(&start);
                }
                Ok(result) if result != "null" => {
                    eprintln!("[probe] {result}");
                    #[cfg(any(target_os = "macos", windows))]
                    if let Ok(path) = std::env::var("FMESS_SNAPSHOT") {
                        snapshot(&window, path);
                    }
                    return;
                }
                _ => {}
            }
        }
        eprintln!("[probe] no result after {wait} s");
    });
}

/// A probe can click, drag, scroll and type as a person does (macOS, Windows):
/// real mouse and key events go through WebKit/WebView2 like the hand's, which
/// a dispatchEvent() or focus() in the page doesn't (the search box that lost
/// its focus to the message box, #51, kept it under a scripted click). It
/// sets window.__fmessInputRequest to a list of steps, in the page's CSS
/// pixels; once they are sent, window.__fmessInputDone counts up by one:
///   {"click": [x, y]}, {"click": [x, y], "count": 2}  (a double click)
///   {"rightClick": [x, y]}                             (the context menu)
///   {"drag": [x1, y1, x2, y2]}                         (selects text)
///   {"wheel": [x, y], "deltaX": 0, "deltaY": -120}     (Windows; or [x, y, dx, dy])
///   {"type": "text"}, {"key": "Escape"} (also Enter, Tab, Backspace, etc.)
///   optional "modifiers": ["Control", "Shift", "Alt", "Meta"] (Windows)
/// Posted to the web view, not the system, so it needs no Accessibility
/// permission, doesn't move the pointer, and leaves a background window where
/// it is: a test never takes the screen from whoever works on it.
#[cfg(any(target_os = "macos", windows))]
fn serve_input_request<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = window.eval_with_callback("JSON.stringify(window.__fmessInputRequest ?? null)", move |result| {
        let _ = tx.send(result);
    });
    let Ok(result) = rx.recv_timeout(Duration::from_secs(5)) else {
        return;
    };
    let Some(steps) = serde_json::from_str::<String>(&result)
        .ok()
        .and_then(|json| serde_json::from_str::<Option<Vec<serde_json::Value>>>(&json).ok())
        .flatten()
    else {
        return;
    };
    let _ = window.eval("window.__fmessInputRequest = null;");
    dispatch_input(window, steps);
}

#[cfg(target_os = "macos")]
fn dispatch_input<R: Runtime>(window: &tauri::WebviewWindow<R>, steps: Vec<serde_json::Value>) {
    let page = window.clone();
    let _ = window.with_webview(move |webview| {
        // SAFETY: Tauri gives the live WKWebView and NSWindow, on the main thread.
        unsafe { send_input(webview.inner().cast(), webview.ns_window().cast(), &steps) };
        let _ = page.eval("window.__fmessInputDone = (window.__fmessInputDone || 0) + 1;");
    });
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
// SAFETY: laid out as CGPoint (NSPoint), two doubles.
unsafe impl objc2::Encode for Point {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

/// # Safety
/// `view` is a live WKWebView and `ns_window` its NSWindow; on the main thread.
#[cfg(target_os = "macos")]
unsafe fn send_input(view: *mut objc2::runtime::AnyObject, ns_window: *mut objc2::runtime::AnyObject, steps: &[serde_json::Value]) {
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_foundation::NSString;

    // NSEventType
    const MOUSE_DOWN: usize = 1;
    const MOUSE_UP: usize = 2;
    const RIGHT_MOUSE_DOWN: usize = 3;
    const RIGHT_MOUSE_UP: usize = 4;
    const MOUSE_DRAGGED: usize = 6;
    const KEY_DOWN: usize = 10;
    const KEY_UP: usize = 11;

    let zoom: f64 = msg_send![view, pageZoom];
    let flipped: bool = msg_send![view, isFlipped];
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        origin: Point,
        size: Point,
    }
    // SAFETY: laid out as CGRect.
    unsafe impl objc2::Encode for Rect {
        const ENCODING: objc2::Encoding = objc2::Encoding::Struct("CGRect", &[Point::ENCODING, Point::ENCODING]);
    }
    let bounds: Rect = msg_send![view, bounds];
    let number: isize = msg_send![ns_window, windowNumber];
    // CSS pixels in the page to the window's coordinates.
    let at = |x: f64, y: f64| -> Point {
        let (x, y) = (x * zoom, y * zoom);
        let in_view = Point { x, y: if flipped { y } else { bounds.size.y - y } };
        let nil: *mut AnyObject = std::ptr::null_mut();
        msg_send![view, convertPoint: in_view, toView: nil]
    };
    // Through the window when it is the key one, as the hand's; otherwise
    // (another app in front, which macOS doesn't let fMess take the place
    // of) straight to the web view, which then handles them all the same.
    let key_window: bool = msg_send![ns_window, isKeyWindow];
    let deliver = |kind: usize, event: *mut AnyObject| unsafe {
        if key_window {
            let _: () = msg_send![ns_window, sendEvent: event];
            return;
        }
        match kind {
            MOUSE_DOWN => msg_send![view, mouseDown: event],
            MOUSE_UP => msg_send![view, mouseUp: event],
            MOUSE_DRAGGED => msg_send![view, mouseDragged: event],
            RIGHT_MOUSE_DOWN => msg_send![view, rightMouseDown: event],
            RIGHT_MOUSE_UP => msg_send![view, rightMouseUp: event],
            KEY_DOWN => msg_send![view, keyDown: event],
            _ => msg_send![view, keyUp: event],
        }
    };
    let now = || -> f64 {
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        msg_send![info, systemUptime]
    };
    let mouse = |kind: usize, point: Point, count: isize| {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let event: *mut AnyObject = msg_send![class!(NSEvent),
            mouseEventWithType: kind, location: point, modifierFlags: 0usize, timestamp: now(),
            windowNumber: number, context: nil, eventNumber: 0isize, clickCount: count, pressure: 1.0f32];
        deliver(kind, event);
    };
    let key = |characters: &str, code: u16| {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let text = NSString::from_str(characters);
        for kind in [KEY_DOWN, KEY_UP] {
            let event: *mut AnyObject = msg_send![class!(NSEvent),
                keyEventWithType: kind, location: Point { x: 0.0, y: 0.0 }, modifierFlags: 0usize, timestamp: now(),
                windowNumber: number, context: nil, characters: &*text, charactersIgnoringModifiers: &*text,
                isARepeat: false, keyCode: code];
            deliver(kind, event);
        }
    };
    let numbers = |value: &serde_json::Value| -> Vec<f64> {
        value.as_array().map(|list| list.iter().filter_map(|n| n.as_f64()).collect()).unwrap_or_default()
    };
    for step in steps {
        if let [x, y] = numbers(&step["click"])[..] {
            let count = step["count"].as_i64().unwrap_or(1) as isize;
            for n in 1..=count {
                mouse(MOUSE_DOWN, at(x, y), n);
                mouse(MOUSE_UP, at(x, y), n);
            }
        } else if let [x, y] = numbers(&step["rightClick"])[..] {
            mouse(RIGHT_MOUSE_DOWN, at(x, y), 1);
            mouse(RIGHT_MOUSE_UP, at(x, y), 1);
        } else if let [x1, y1, x2, y2] = numbers(&step["drag"])[..] {
            mouse(MOUSE_DOWN, at(x1, y1), 1);
            for i in 1..=10 {
                let f = f64::from(i) / 10.0;
                mouse(MOUSE_DRAGGED, at(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f), 1);
            }
            mouse(MOUSE_UP, at(x2, y2), 1);
        } else if let Some(text) = step["type"].as_str() {
            for c in text.chars() {
                key(&c.to_string(), 0);
            }
        } else if let Some(name) = step["key"].as_str() {
            let (characters, code) = match name {
                "Enter" => ("\r", 36),
                "Tab" => ("\t", 48),
                "Backspace" => ("\u{7f}", 51),
                _ => ("\u{1b}", 53),
            };
            key(characters, code);
        }
    }
}

/// A probe can take pictures while it runs (tests/app/chat-check.js does,
/// one per chat, look and mode): it sets window.__fmessSnapshotRequest to a
/// file path, and once the picture is saved, window.__fmessSnapshotDone is
/// that path.
#[cfg(any(target_os = "macos", windows))]
fn serve_snapshot_request<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = window.eval_with_callback("window.__fmessSnapshotRequest ?? null", move |result| {
        let _ = tx.send(result);
    });
    let Ok(result) = rx.recv_timeout(Duration::from_secs(5)) else {
        return;
    };
    let Ok(Some(path)) = serde_json::from_str::<Option<String>>(&result) else {
        return;
    };
    let _ = window.eval("window.__fmessSnapshotRequest = null;");
    snapshot(window, path);
}

/// Saves a picture of the page as a PNG, at the screen's scale, then sets
/// window.__fmessSnapshotDone to its path.
#[cfg(target_os = "macos")]
fn snapshot<R: Runtime>(window: &tauri::WebviewWindow<R>, path: String) {
    use block2::RcBlock;
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::NSString;

    let page = window.clone();
    let _ = window.with_webview(move |webview| {
        let view = webview.inner().cast::<AnyObject>();
        let done = RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            if image.is_null() {
                return eprintln!("[snapshot] failed");
            }
            // SAFETY: an NSImage from WebKit; NSBitmapImageFileTypePNG is 4.
            let saved: bool = unsafe {
                let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
                let bitmap: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
                let options: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
                let png: *mut AnyObject = msg_send![bitmap, representationUsingType: 4usize, properties: options];
                msg_send![png, writeToFile: &*NSString::from_str(&path), atomically: true]
            };
            eprintln!("[snapshot] {} {path}", if saved { "saved" } else { "not saved" });
            let _ = page.eval(format!("window.__fmessSnapshotDone = {};", serde_json::json!(path)));
        });
        // SAFETY: the platform web view is a WKWebView, on the main thread.
        unsafe {
            let config: Retained<AnyObject> = msg_send![class!(WKSnapshotConfiguration), new];
            // With the selection drawn (left out by default), to check how it looks.
            let yes: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: true];
            let _: () = msg_send![&*config, setValue: yes, forKey: &*NSString::from_str("includesSelectionHighlighting")];
            let _: () = msg_send![view, takeSnapshotWithConfiguration: &*config, completionHandler: &*done];
        }
    });
}

#[cfg(windows)]
fn dispatch_input<R: Runtime>(window: &tauri::WebviewWindow<R>, steps: Vec<serde_json::Value>) {
    let commands = cdp_commands_for_steps(&steps);
    let page = window.clone();
    let _ = window.with_webview(move |webview| {
        // SAFETY: Tauri gives the live WebView2 controller on the UI thread.
        let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
            let _ = page.eval("window.__fmessInputDone = (window.__fmessInputDone || 0) + 1;");
            return;
        };
        run_cdp_sequence(core, commands, page);
    });
}

#[cfg(windows)]
fn run_cdp_sequence<R: Runtime>(
    core: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    mut commands: std::collections::VecDeque<(&'static str, String)>,
    page: tauri::WebviewWindow<R>,
) {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;

    let Some((method, params)) = commands.pop_front() else {
        let _ = page.eval("window.__fmessInputDone = (window.__fmessInputDone || 0) + 1;");
        return;
    };
    let next_core = core.clone();
    let done_page = page.clone();
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |err, _result| {
        if let Err(err) = err {
            eprintln!("[input] {method} failed: {err}");
        }
        run_cdp_sequence(next_core, commands, done_page);
        Ok(())
    }));
    let method_h = HSTRING::from(method);
    let params_h = HSTRING::from(params);
    // SAFETY: COM call on the UI thread with valid HSTRINGs and handler.
    if let Err(err) = unsafe { core.CallDevToolsProtocolMethod(&method_h, &params_h, &handler) } {
        eprintln!("[input] {method} dispatch failed: {err}");
        let _ = page.eval("window.__fmessInputDone = (window.__fmessInputDone || 0) + 1;");
    }
}

#[cfg(any(windows, test))]
fn cdp_modifiers(step: &serde_json::Value) -> i32 {
    if let Some(mask) = step["modifiers"].as_i64() {
        return mask as i32;
    }
    let Some(list) = step["modifiers"].as_array() else {
        return 0;
    };
    list.iter().filter_map(|v| v.as_str()).fold(0, |mask, name| {
        mask | match name.to_ascii_lowercase().as_str() {
            "alt" => 1,
            "control" | "ctrl" => 2,
            "meta" | "cmd" | "command" => 4,
            "shift" => 8,
            _ => 0,
        }
    })
}

#[cfg(any(windows, test))]
fn cdp_key_spec(name: &str) -> (String, String, i32, Option<String>) {
    match name {
        "Enter" => ("Enter".into(), "Enter".into(), 13, Some("\r".into())),
        "Tab" => ("Tab".into(), "Tab".into(), 9, None),
        "Backspace" => ("Backspace".into(), "Backspace".into(), 8, None),
        "Escape" => ("Escape".into(), "Escape".into(), 27, None),
        "Delete" => ("Delete".into(), "Delete".into(), 46, None),
        "ArrowUp" => ("ArrowUp".into(), "ArrowUp".into(), 38, None),
        "ArrowDown" => ("ArrowDown".into(), "ArrowDown".into(), 40, None),
        "ArrowLeft" => ("ArrowLeft".into(), "ArrowLeft".into(), 37, None),
        "ArrowRight" => ("ArrowRight".into(), "ArrowRight".into(), 39, None),
        "Home" => ("Home".into(), "Home".into(), 36, None),
        "End" => ("End".into(), "End".into(), 35, None),
        "PageUp" => ("PageUp".into(), "PageUp".into(), 33, None),
        "PageDown" => ("PageDown".into(), "PageDown".into(), 34, None),
        "Space" | " " => (" ".into(), "Space".into(), 32, Some(" ".into())),
        _ => {
            if let Some(num) = name.strip_prefix('F').and_then(|s| s.parse::<i32>().ok()) {
                if (1..=12).contains(&num) {
                    return (name.into(), name.into(), 111 + num, None);
                }
            }
            let mut chars = name.chars();
            if let (Some(c), None) = (chars.next(), chars.next()) {
                if c.is_ascii_alphabetic() {
                    let upper = c.to_ascii_uppercase();
                    return (name.into(), format!("Key{upper}"), upper as i32, Some(name.into()));
                }
                if c.is_ascii_digit() {
                    return (name.into(), format!("Digit{c}"), c as i32, Some(name.into()));
                }
                return (name.into(), String::new(), 0, Some(name.into()));
            }
            (name.into(), name.into(), 0, None)
        }
    }
}

#[cfg(any(windows, test))]
fn cdp_commands_for_steps(steps: &[serde_json::Value]) -> std::collections::VecDeque<(&'static str, String)> {
    use serde_json::json;

    let mut out = std::collections::VecDeque::new();
    let numbers = |value: &serde_json::Value| -> Vec<f64> {
        value.as_array().map(|list| list.iter().filter_map(|n| n.as_f64()).collect()).unwrap_or_default()
    };
    let push_mouse = |out: &mut std::collections::VecDeque<(&'static str, String)>, payload: serde_json::Value| {
        out.push_back(("Input.dispatchMouseEvent", payload.to_string()));
    };
    let push_key = |out: &mut std::collections::VecDeque<(&'static str, String)>,
                    key: &str,
                    code: &str,
                    vk: i32,
                    text: Option<&str>,
                    modifiers: i32| {
        let mut down = json!({
            "type": if text.is_some() && (modifiers & 7) == 0 { "keyDown" } else { "rawKeyDown" },
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk,
            "modifiers": modifiers,
        });
        if let Some(t) = text.filter(|_| (modifiers & 7) == 0) {
            down["text"] = json!(t);
            down["unmodifiedText"] = json!(t);
        }
        out.push_back(("Input.dispatchKeyEvent", down.to_string()));
        out.push_back((
            "Input.dispatchKeyEvent",
            json!({
                "type": "keyUp",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
                "modifiers": modifiers,
            })
            .to_string(),
        ));
    };

    for step in steps {
        let modifiers = cdp_modifiers(step);
        if let [x, y] = numbers(&step["click"])[..] {
            let count = step["count"].as_i64().unwrap_or(1).max(1);
            push_mouse(&mut out, json!({ "type": "mouseMoved", "x": x, "y": y, "modifiers": modifiers }));
            for n in 1..=count {
                push_mouse(
                    &mut out,
                    json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": n, "modifiers": modifiers }),
                );
                push_mouse(
                    &mut out,
                    json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": n, "modifiers": modifiers }),
                );
            }
        } else if let [x, y] = numbers(&step["rightClick"])[..] {
            push_mouse(&mut out, json!({ "type": "mouseMoved", "x": x, "y": y, "modifiers": modifiers }));
            push_mouse(
                &mut out,
                json!({ "type": "mousePressed", "x": x, "y": y, "button": "right", "buttons": 2, "clickCount": 1, "modifiers": modifiers }),
            );
            push_mouse(
                &mut out,
                json!({ "type": "mouseReleased", "x": x, "y": y, "button": "right", "buttons": 0, "clickCount": 1, "modifiers": modifiers }),
            );
        } else if let [x1, y1, x2, y2] = numbers(&step["drag"])[..] {
            push_mouse(&mut out, json!({ "type": "mouseMoved", "x": x1, "y": y1, "modifiers": modifiers }));
            push_mouse(
                &mut out,
                json!({ "type": "mousePressed", "x": x1, "y": y1, "button": "left", "buttons": 1, "clickCount": 1, "modifiers": modifiers }),
            );
            for i in 1..=10 {
                let f = f64::from(i) / 10.0;
                push_mouse(
                    &mut out,
                    json!({
                        "type": "mouseMoved",
                        "x": x1 + (x2 - x1) * f,
                        "y": y1 + (y2 - y1) * f,
                        "button": "left",
                        "buttons": 1,
                        "modifiers": modifiers,
                    }),
                );
            }
            push_mouse(
                &mut out,
                json!({ "type": "mouseReleased", "x": x2, "y": y2, "button": "left", "buttons": 0, "clickCount": 1, "modifiers": modifiers }),
            );
        } else if let Some(wheel) = step.get("wheel") {
            let nums = numbers(wheel);
            let (x, y, dx, dy) = match nums[..] {
                [x, y] => (
                    x,
                    y,
                    step["deltaX"].as_f64().unwrap_or(0.0),
                    step["deltaY"].as_f64().unwrap_or(0.0),
                ),
                [x, y, dx, dy] => (x, y, dx, dy),
                _ => continue,
            };
            push_mouse(&mut out, json!({ "type": "mouseMoved", "x": x, "y": y, "modifiers": modifiers }));
            push_mouse(
                &mut out,
                json!({ "type": "mouseWheel", "x": x, "y": y, "deltaX": dx, "deltaY": dy, "modifiers": modifiers }),
            );
        } else if let Some(text) = step["type"].as_str() {
            for c in text.chars() {
                if c == '\n' {
                    push_key(&mut out, "Enter", "Enter", 13, Some("\r"), modifiers);
                } else if c.is_ascii_graphic() || c == ' ' {
                    let s = c.to_string();
                    let (key, code, vk, txt) = cdp_key_spec(&s);
                    push_key(&mut out, &key, &code, vk, txt.as_deref(), modifiers);
                } else {
                    out.push_back(("Input.insertText", json!({ "text": c.to_string() }).to_string()));
                }
            }
        } else if let Some(name) = step["key"].as_str() {
            let (key, code, vk, text) = cdp_key_spec(name);
            push_key(&mut out, &key, &code, vk, text.as_deref(), modifiers);
        }
    }
    out
}

/// Saves a picture of the page as a PNG via WebView2 DevTools Protocol, then
/// sets window.__fmessSnapshotDone to its path.
#[cfg(windows)]
fn snapshot<R: Runtime>(window: &tauri::WebviewWindow<R>, path: String) {
    use base64::Engine;
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;

    let page = window.clone();
    let _ = window.with_webview(move |webview| {
        // SAFETY: Tauri gives the live WebView2 controller on the UI thread.
        let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
            return eprintln!("[snapshot] failed: no CoreWebView2");
        };
        let done_page = page.clone();
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |err, result| {
            if let Err(err) = err {
                eprintln!("[snapshot] failed: {err}");
                return Ok(());
            }
            let bytes = serde_json::from_str::<serde_json::Value>(&result)
                .ok()
                .and_then(|value| value["data"].as_str().map(str::to_owned))
                .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok());
            let Some(bytes) = bytes else {
                eprintln!("[snapshot] failed: invalid screenshot payload");
                return Ok(());
            };
            let saved = std::fs::write(&path, bytes).is_ok();
            eprintln!("[snapshot] {} {path}", if saved { "saved" } else { "not saved" });
            let _ = done_page.eval(format!("window.__fmessSnapshotDone = {};", serde_json::json!(path)));
            Ok(())
        }));
        let method = HSTRING::from("Page.captureScreenshot");
        let params = HSTRING::from(r#"{"format":"png"}"#);
        // SAFETY: COM call on the UI thread with valid HSTRINGs and handler.
        if let Err(err) = unsafe { core.CallDevToolsProtocolMethod(&method, &params, &handler) } {
            eprintln!("[snapshot] failed: {err}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{cdp_commands_for_steps, loggable};
    use serde_json::json;
    use tauri::Url;

    fn log(url: &str) -> String {
        loggable(&Url::parse(url).unwrap())
    }

    #[test]
    fn logged_urls_keep_no_private_parts() {
        assert_eq!(
            log("https://www.facebook.com/messages/t/123/?token=abc&x=1#frag"),
            "https://www.facebook.com/messages/t/123/?token,x"
        );
        assert_eq!(log("https://example.com/private/path?q=secret"), "https://example.com/…");
        assert_eq!(log("mailto:someone@example.com"), "mailto:…");
        assert_eq!(log("tel:+84123456789"), "tel:…");
        assert_eq!(log("data:text/plain,hello"), "data:…");
        assert_eq!(log("about:blank"), "about:blank");
    }

    #[test]
    fn cdp_steps_cover_mouse_wheel_type_and_keys() {
        let steps = vec![
            json!({ "click": [10, 20], "count": 2 }),
            json!({ "rightClick": [30, 40] }),
            json!({ "drag": [0, 0, 100, 50] }),
            json!({ "wheel": [50, 60], "deltaX": 0, "deltaY": -120, "modifiers": ["Control", "Shift"] }),
            json!({ "wheel": [50, 60, 10, 20] }),
            json!({ "type": "aế" }),
            json!({ "key": "Escape" }),
            json!({ "key": "k", "modifiers": ["Control"] }),
        ];
        let cmds: Vec<(&str, serde_json::Value)> = cdp_commands_for_steps(&steps)
            .into_iter()
            .map(|(m, p)| (m, serde_json::from_str(&p).unwrap()))
            .collect();

        // Double click: mouseMoved + 2 * (mousePressed + mouseReleased)
        assert_eq!(cmds[0].1["type"], "mouseMoved");
        assert_eq!(cmds[1].1["clickCount"], 1);
        assert_eq!(cmds[3].1["clickCount"], 2);
        assert_eq!(cmds[4].1["type"], "mouseReleased");
        assert_eq!(cmds[4].1["clickCount"], 2);

        // Right click
        assert_eq!(cmds[6].1["button"], "right");
        assert_eq!(cmds[6].1["buttons"], 2);
        assert_eq!(cmds[7].1["type"], "mouseReleased");

        // Drag: move + down + 10 moves + up = 13 commands (indices 8..21)
        assert_eq!(cmds[9].1["type"], "mousePressed");
        assert_eq!(cmds[19].1["type"], "mouseMoved");
        assert_eq!(cmds[19].1["x"], 100.0);
        assert_eq!(cmds[20].1["type"], "mouseReleased");

        // Wheel with modifiers (Control=2 | Shift=8 = 10)
        assert_eq!(cmds[22].1["type"], "mouseWheel");
        assert_eq!(cmds[22].1["deltaY"], -120.0);
        assert_eq!(cmds[22].1["modifiers"], 10);

        // 4-element wheel shorthand
        assert_eq!(cmds[24].1["type"], "mouseWheel");
        assert_eq!(cmds[24].1["deltaX"], 10.0);
        assert_eq!(cmds[24].1["deltaY"], 20.0);

        // Type ASCII + non-ASCII
        assert_eq!(cmds[25].0, "Input.dispatchKeyEvent");
        assert_eq!(cmds[25].1["type"], "keyDown");
        assert_eq!(cmds[25].1["text"], "a");
        assert_eq!(cmds[27].0, "Input.insertText");
        assert_eq!(cmds[27].1["text"], "ế");

        // Escape
        assert_eq!(cmds[28].1["type"], "rawKeyDown");
        assert_eq!(cmds[28].1["windowsVirtualKeyCode"], 27);

        // Ctrl+K uses rawKeyDown with no text
        assert_eq!(cmds[30].1["type"], "rawKeyDown");
        assert_eq!(cmds[30].1["code"], "KeyK");
        assert_eq!(cmds[30].1["modifiers"], 2);
        assert!(cmds[30].1.get("text").is_none());
    }
}
