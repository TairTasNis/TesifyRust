use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub const MAX_FONT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CUSTOM_FONTS: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontRecord {
    pub id: String,
    pub name: String,
    pub format: String,
    pub extension: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomLyricsFont {
    pub id: String,
    pub name: String,
    pub format: String,
    pub data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadLyricsFontInput {
    pub file_name: String,
    pub font_base64: String,
}

pub struct LyricsFontStore {
    directory: PathBuf,
    lock: Mutex<()>,
}

impl LyricsFontStore {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            lock: Mutex::new(()),
        }
    }

    pub fn list(&self) -> Result<Vec<CustomLyricsFont>, String> {
        let _guard = self.lock.lock().map_err(|_| "Хранилище шрифтов недоступно.")?;
        let records = self.read_index()?;
        let mut fonts = Vec::with_capacity(records.len());
        for record in records {
            if !is_safe_id(&record.id) || !is_safe_ext(&record.extension) {
                continue;
            }
            let path = self.directory.join(format!("{}.{}", record.id, record.extension));
            let Ok(bytes) = fs::read(path) else {
                continue;
            };
            if bytes.is_empty() || bytes.len() > MAX_FONT_BYTES {
                continue;
            }
            fonts.push(CustomLyricsFont {
                id: record.id,
                name: record.name,
                format: record.format,
                data_base64: STANDARD.encode(bytes),
            });
        }
        Ok(fonts)
    }

    pub fn upload(&self, input: UploadLyricsFontInput) -> Result<CustomLyricsFont, String> {
        if input.font_base64.len() > (MAX_FONT_BYTES * 4 / 3 + 16) {
            return Err("Файл шрифта должен быть не больше 16 МБ.".into());
        }
        let bytes = STANDARD
            .decode(input.font_base64.trim())
            .map_err(|_| "Не удалось прочитать файл шрифта.".to_string())?;
        if bytes.is_empty() || bytes.len() > MAX_FONT_BYTES {
            return Err("Файл шрифта должен быть не больше 16 МБ.".into());
        }
        let (extension, format) = detect_font_format(&bytes)
            .ok_or_else(|| "Выберите шрифт в формате TTF, OTF, WOFF или WOFF2.".to_string())?;

        let _guard = self.lock.lock().map_err(|_| "Хранилище шрифтов недоступно.")?;
        let mut records = self.read_index()?;
        if records.len() >= MAX_CUSTOM_FONTS {
            return Err("Достигнут лимит пользовательских шрифтов (32). Удалите неиспользуемый шрифт.".into());
        }

        fs::create_dir_all(&self.directory)
            .map_err(|_| "Не удалось подготовить папку для шрифтов.".to_string())?;

        let id = Uuid::new_v4().to_string();
        let name = clean_font_name(&input.file_name, &records);
        let file_path = self.directory.join(format!("{id}.{extension}"));
        write_atomic(&file_path, &bytes)
            .map_err(|_| "Не удалось сохранить файл шрифта.".to_string())?;

        records.push(FontRecord {
            id: id.clone(),
            name: name.clone(),
            format: format.to_string(),
            extension: extension.to_string(),
        });
        if let Err(err) = self.write_index(&records) {
            let _ = fs::remove_file(&file_path);
            return Err(err);
        }

        Ok(CustomLyricsFont {
            id,
            name,
            format: format.to_string(),
            data_base64: STANDARD.encode(bytes),
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        if !is_safe_id(id) {
            return Err("Некорректный идентификатор шрифта.".into());
        }
        let _guard = self.lock.lock().map_err(|_| "Хранилище шрифтов недоступно.")?;
        let mut records = self.read_index()?;
        let Some(pos) = records.iter().position(|r| r.id == id) else {
            return Ok(());
        };
        let removed = records.remove(pos);
        self.write_index(&records)?;
        if is_safe_ext(&removed.extension) {
            let _ = fs::remove_file(self.directory.join(format!("{}.{}", removed.id, removed.extension)));
        }
        Ok(())
    }

    fn index_path(&self) -> PathBuf {
        self.directory.join("index.json")
    }

    fn read_index(&self) -> Result<Vec<FontRecord>, String> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(path).map_err(|_| "Не удалось прочитать список шрифтов.".to_string())?;
        serde_json::from_slice(&bytes)
            .map_err(|_| "Список пользовательских шрифтов повреждён.".to_string())
    }

    fn write_index(&self, records: &[FontRecord]) -> Result<(), String> {
        fs::create_dir_all(&self.directory)
            .map_err(|_| "Не удалось подготовить папку для шрифтов.".to_string())?;
        let json = serde_json::to_vec_pretty(records)
            .map_err(|_| "Не удалось сохранить список шрифтов.".to_string())?;
        write_atomic(&self.index_path(), &json)
            .map_err(|_| "Не удалось сохранить список шрифтов.".to_string())
    }
}

pub fn detect_font_format(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.len() < 4 {
        return None;
    }
    match &bytes[..4] {
        [0x00, 0x01, 0x00, 0x00] | b"true" | b"typ1" => Some(("ttf", "truetype")),
        b"OTTO" => Some(("otf", "opentype")),
        b"wOFF" => Some(("woff", "woff")),
        b"wOF2" => Some(("woff2", "woff2")),
        _ => None,
    }
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_safe_ext(ext: &str) -> bool {
    matches!(ext, "ttf" | "otf" | "woff" | "woff2")
}

fn clean_font_name(file_name: &str, existing: &[FontRecord]) -> String {
    let base = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .replace(['_', '-'], " ");
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let base_name: String = if trimmed.is_empty() {
        "Мой шрифт".into()
    } else {
        trimmed.chars().take(60).collect()
    };
    if !existing.iter().any(|r| r.name.eq_ignore_ascii_case(&base_name)) {
        return base_name;
    }
    for n in 2..=99 {
        let candidate = format!("{base_name} ({n})");
        if !existing.iter().any(|r| r.name.eq_ignore_ascii_case(&candidate)) {
            return candidate;
        }
    }
    base_name
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let res = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_uploads_lists_and_deletes_fonts() {
        let dir = std::env::temp_dir().join(format!("tesify-fonts-{}", Uuid::new_v4()));
        let store = LyricsFontStore::new(dir.clone());

        let rejected = store.upload(UploadLyricsFontInput {
            file_name: "bad.ttf".into(),
            font_base64: STANDARD.encode(b"not a font"),
        });
        assert!(rejected.is_err());

        let fake_woff2 = b"wOF2\x00\x01\x00\x00test-font-bytes";
        let uploaded = store
            .upload(UploadLyricsFontInput {
                file_name: "My_Cool-Font.woff2".into(),
                font_base64: STANDARD.encode(fake_woff2),
            })
            .unwrap();
        assert_eq!(uploaded.name, "My Cool Font");
        assert_eq!(uploaded.format, "woff2");

        let duplicate = store
            .upload(UploadLyricsFontInput {
                file_name: "My_Cool-Font.woff2".into(),
                font_base64: STANDARD.encode(fake_woff2),
            })
            .unwrap();
        assert_eq!(duplicate.name, "My Cool Font (2)");

        let listed = store.list().unwrap();
        assert_eq!(listed.len(), 2);

        store.delete(&uploaded.id).unwrap();
        let listed_after = store.list().unwrap();
        assert_eq!(listed_after.len(), 1);
        assert_eq!(listed_after[0].id, duplicate.id);

        let _ = fs::remove_dir_all(dir);
    }
}
