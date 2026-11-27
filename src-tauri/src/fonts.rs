//! Settings › Font (#42): the fonts the system has, to pick from, and fonts
//! added from a .ttf or .otf file, which fMess keeps in its data folder and
//! hands the page as @font-face rules (data: URLs, which Facebook's
//! Content-Security-Policy allows for fonts), so they need no installing.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use ttf_parser::Tag;

use crate::{
    i18n::{self, pick, Lang},
    settings,
};

/// The page gets an added font with its settings, after every load, so a
/// larger file is turned down.
const MAX_FILE: u64 = 10 * 1024 * 1024;

#[derive(Serialize)]
pub struct Fonts {
    /// The families the system has, sorted, without its hidden ones (".SF NS").
    installed: Vec<String>,
    /// The families of the added files, sorted.
    added: Vec<String>,
}

/// One face of an added font, as an @font-face in the page.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FontFace {
    family: String,
    /// A data: URL.
    src: String,
    /// "400", or "100 900" for a variable font.
    weight: String,
    style: &'static str,
}

/// What fMess reads in a font file.
#[derive(Debug, PartialEq)]
struct FileFace {
    family: String,
    weight: String,
    italic: bool,
}

/// Read the way the system's fonts are listed (fontdb), names in Mac Roman
/// included; ttf-parser only for a variable font's weights.
fn read_face(data: &[u8]) -> Option<FileFace> {
    let mut db = fontdb::Database::new();
    db.load_font_data(data.to_vec());
    let info = db.faces().next()?;
    // The typographic family ("Inter"), or for a font without one its family
    // ("Inter Medium"), in English if it has one: the way CSS names it.
    let family = info.families.first()?.0.trim().to_owned();
    if family.is_empty() {
        return None;
    }
    let weight = ttf_parser::Face::parse(data, 0)
        .ok()
        .and_then(|face| face.variation_axes().into_iter().find(|axis| axis.tag == Tag::from_bytes(b"wght")))
        .map(|axis| format!("{} {}", axis.min_value.round(), axis.max_value.round()))
        .unwrap_or_else(|| info.weight.0.to_string());
    Some(FileFace { family, weight, italic: info.style != fontdb::Style::Normal })
}

fn folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("fonts"))
}

/// The added files with what is read in them.
fn added<R: Runtime>(app: &AppHandle<R>) -> Vec<(PathBuf, FileFace)> {
    let Some(entries) = folder(app).and_then(|dir| fs::read_dir(dir).ok()) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let face = read_face(&fs::read(&path).ok()?)?;
            Some((path, face))
        })
        .collect();
    files.sort_by(|(a, _), (b, _)| a.cmp(b));
    files
}

/// The families named in the Font setting ("Inter, Roboto").
fn families(font: &str) -> impl Iterator<Item = &str> {
    font.split(',').map(|family| family.trim().trim_matches(['"', '\''])).filter(|family| !family.is_empty())
}

/// The @font-face rules the page needs for the Font setting: the added
/// files of the families it names.
pub fn faces_for<R: Runtime>(app: &AppHandle<R>, font: Option<&str>) -> Vec<FontFace> {
    let Some(font) = font else {
        return Vec::new();
    };
    let wanted: Vec<_> = families(font).map(str::to_lowercase).collect();
    added(app)
        .into_iter()
        .filter(|(_, face)| wanted.contains(&face.family.to_lowercase()))
        .filter_map(|(path, face)| {
            let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
                "otf" => "font/otf",
                _ => "font/ttf",
            };
            let data = base64::engine::general_purpose::STANDARD.encode(fs::read(&path).ok()?);
            Some(FontFace {
                family: face.family,
                src: format!("data:{mime};base64,{data}"),
                weight: face.weight,
                style: if face.italic { "italic" } else { "normal" },
            })
        })
        .collect()
}

/// Sorted A to Z whatever the case, once each.
fn sorted(mut names: Vec<String>) -> Vec<String> {
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    names
}

#[tauri::command]
pub async fn list_fonts<R: Runtime>(app: AppHandle<R>) -> Fonts {
    // Reading every font's names takes a moment (a few hundred files).
    let installed = tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db.faces()
            .filter_map(|face| face.families.first().map(|(family, _)| family.trim().to_owned()))
            .filter(|family| !family.is_empty() && !family.starts_with('.'))
            .collect()
    })
    .await
    .unwrap_or_default();
    Fonts {
        installed: sorted(installed),
        added: sorted(added(&app).into_iter().map(|(_, face)| face.family).collect()),
    }
}

/// Adds font files picked by the user (one family's styles may be picked
/// together). Returns the family of the first, or None when nothing was picked.
#[tauri::command]
pub async fn add_font<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let lang = i18n::current(&app);
    let picker = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker
            .dialog()
            .file()
            .set_title(pick(lang, "Add a font", "Thêm phông chữ"))
            .add_filter(pick(lang, "Font", "Phông chữ"), &["ttf", "otf"])
            .blocking_pick_files()
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let dir = folder(&app).ok_or(pick(lang, "no data folder", "Không tìm thấy thư mục dữ liệu"))?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let mut first = None;
    for file in picked {
        let path = file.into_path().map_err(|err| err.to_string())?;
        let family = add_file(&path, &dir, lang)?;
        first.get_or_insert(family);
    }
    refresh_page(&app);
    Ok(first)
}

fn add_file(path: &Path, dir: &Path, lang: Lang) -> Result<String, String> {
    let shown = path.file_name().unwrap_or_default().to_string_lossy();
    if fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) > MAX_FILE {
        return Err(match lang {
            Lang::En => format!("{shown} is over 10 MB, too big for fMess to hand the page"),
            Lang::Vi => format!("{shown} nặng hơn 10 MB, quá lớn để fMess đưa vào trang"),
        });
    }
    let data = fs::read(path).map_err(|err| match lang {
        Lang::En => format!("could not read {shown}: {err}"),
        Lang::Vi => format!("Không đọc được {shown}: {err}"),
    })?;
    let face = read_face(&data).ok_or_else(|| match lang {
        Lang::En => format!("{shown} isn't a font fMess can read (a .ttf or .otf file)"),
        Lang::Vi => format!("{shown} không phải phông chữ fMess đọc được (file .ttf hoặc .otf)"),
    })?;
    // The same name with other contents (another font's "Regular.ttf")
    // goes beside it, not over it.
    let target = (1..)
        .map(|n| match n {
            1 => dir.join(&*shown),
            n => dir.join(format!(
                "{}-{n}.{}",
                path.file_stem().unwrap_or_default().to_string_lossy(),
                path.extension().unwrap_or_default().to_string_lossy()
            )),
        })
        .find(|target| fs::read(target).map_or(true, |existing| existing == data))
        .expect("an unused name");
    fs::write(&target, &data).map_err(|err| match lang {
        Lang::En => format!("could not save the font to {}: {err}", target.display()),
        Lang::Vi => format!("Không lưu được phông chữ vào {}: {err}", target.display()),
    })?;
    Ok(face.family)
}

/// Removes the added files of a family.
#[tauri::command]
pub fn remove_font<R: Runtime>(app: AppHandle<R>, family: String) -> Result<(), String> {
    let mut by_family: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    for (path, face) in added(&app) {
        by_family.entry(face.family.to_lowercase()).or_default().push(path);
    }
    for path in by_family.remove(&family.to_lowercase()).unwrap_or_default() {
        fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    refresh_page(&app);
    Ok(())
}

/// The page's @font-face rules follow the files even when the Font setting
/// stays the same (a file added for the font already picked).
fn refresh_page<R: Runtime>(app: &AppHandle<R>) {
    let settings = settings::current(app);
    for webview in crate::services::webviews(app) {
        let _ = webview.eval(settings::page_settings_script(&webview, &settings));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_font_setting_names_families() {
        let named: Vec<_> = families(r#" Inter, "Be Vietnam Pro" ,,'Roboto'"#).collect();
        assert_eq!(named, ["Inter", "Be Vietnam Pro", "Roboto"]);
    }

    #[test]
    fn families_are_sorted_once_each() {
        let names = ["roboto", "Inter", "Roboto", "arial"].map(String::from).to_vec();
        assert_eq!(sorted(names), ["arial", "Inter", "roboto"]);
    }

    #[test]
    fn a_file_that_is_not_a_font_is_turned_down() {
        assert_eq!(read_face(b"body { color: red }"), None);
    }

    #[test]
    fn the_system_s_fonts_are_listed_and_their_files_read() {
        let started = std::time::Instant::now();
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let files: Vec<_> = db
            .faces()
            .filter_map(|face| match &face.source {
                fontdb::Source::File(path) if face.index == 0 => Some(path.clone()),
                _ => None,
            })
            .collect();
        eprintln!("{} faces in {:?}", db.len(), started.elapsed());
        assert!(!files.is_empty(), "no system fonts found");
        let read = files.iter().filter_map(|path| read_face(&fs::read(path).ok()?)).count();
        assert!(read * 10 >= files.len() * 9, "read {read} of {} font files", files.len());
    }

    #[test]
    fn an_added_file_is_kept_beside_one_of_the_same_name() {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let fonts: Vec<PathBuf> = db
            .faces()
            .filter_map(|face| match &face.source {
                fontdb::Source::File(path) if path.extension().is_some_and(|ext| ext == "ttf") => Some(path.clone()),
                _ => None,
            })
            .filter(|path| fs::metadata(path).is_ok_and(|meta| meta.len() <= MAX_FILE))
            .collect();
        // Two that differ (by size, to be sure).
        let size = |path: &PathBuf| fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        let fonts: Vec<PathBuf> = fonts.first().into_iter().chain(fonts.iter().find(|path| size(path) != size(&fonts[0]))).cloned().collect();
        let [first, second] = fonts.as_slice() else {
            return eprintln!("fewer than two .ttf system fonts: skipped");
        };
        let from = std::env::temp_dir().join(format!("fmess-font-test-{}", std::process::id()));
        let dir = from.join("fonts");
        fs::create_dir_all(from.join("a")).unwrap();
        fs::create_dir_all(from.join("b")).unwrap();
        // Two different fonts both named Regular.ttf, and the first again.
        let (a, b) = (from.join("a/Regular.ttf"), from.join("b/Regular.ttf"));
        fs::copy(first, &a).unwrap();
        fs::copy(second, &b).unwrap();
        fs::create_dir_all(&dir).unwrap();
        let family = add_file(&a, &dir, Lang::En).unwrap();
        add_file(&b, &dir, Lang::En).unwrap();
        assert_eq!(add_file(&a, &dir, Lang::En).unwrap(), family);
        let mut kept: Vec<_> = fs::read_dir(&dir).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        kept.sort();
        assert_eq!(kept, ["Regular-2.ttf", "Regular.ttf"]);
        let not_a_font = from.join("a/notes.ttf");
        fs::write(&not_a_font, "not a font").unwrap();
        assert!(add_file(&not_a_font, &dir, Lang::En).is_err());
        fs::remove_dir_all(&from).unwrap();
    }
}
