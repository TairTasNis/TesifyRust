use crate::shared::{
    playlists::{covers::{MAX_BYTES, image_type}, models::{CoverUpload, UploadedCover}},
    services::AppServices,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct UploadResponse {
    success: Option<bool>,
    data: Option<UploadData>,
}
#[derive(Deserialize)]
struct UploadData {
    url: String,
}

pub async fn upload_cover(
    services: &AppServices,
    input: CoverUpload,
) -> Result<UploadedCover, String> {
    if input.image_base64.len() > (MAX_BYTES * 4 / 3 + 8) {
        return Err("Обложка должна быть не больше 8 МБ.".into());
    }
    let bytes = STANDARD
        .decode(&input.image_base64)
        .map_err(|_| "Не удалось прочитать изображение.".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Обложка должна быть не больше 8 МБ.".into());
    }
    let (mime, extension) = image_type(&bytes).ok_or("Выберите изображение PNG, JPG или WebP.")?;
    #[cfg(target_os = "android")]
    if services.imgbb_api_key.is_none() {
        return Ok(UploadedCover { url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)) });
    }
    let key = services.imgbb_api_key.as_deref()
        .ok_or("Добавьте IMGBB_API_KEY в .env для загрузки обложек.")?;
    let stem: String = input
        .file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or("cover")
        .chars()
        .filter(|character| character.is_alphanumeric() || *character == '-' || *character == '_')
        .take(80)
        .collect();
    let filename = format!(
        "{}.{extension}",
        if stem.is_empty() { "cover" } else { &stem }
    );
    let part = Part::bytes(bytes)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|_| "Не удалось подготовить обложку.".to_string())?;
    // Ключ передаётся в POST-форме только официальному API и не попадает в URL или frontend.
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "Не удалось подключиться к imgbb.".to_string())?;
    let response = http
        .post("https://api.imgbb.com/1/upload")
        .multipart(Form::new().text("key", key.to_owned()).part("image", part))
        .send()
        .await
        .map_err(|_| {
            "Не удалось загрузить обложку. Проверьте подключение и повторите попытку.".to_string()
        })?;
    if !response.status().is_success() {
        return Err("imgbb отклонил изображение. Проверьте ключ и попробуйте другой файл.".into());
    }
    let result: UploadResponse = response
        .json()
        .await
        .map_err(|_| "imgbb вернул некорректный ответ.".to_string())?;
    let url = result
        .data
        .filter(|_| result.success == Some(true))
        .map(|data| data.url)
        .ok_or("Не удалось получить ссылку на обложку.")?;
    let parsed =
        reqwest::Url::parse(&url).map_err(|_| "imgbb вернул некорректную ссылку.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("i.ibb.co") {
        return Err("imgbb вернул неподдерживаемую ссылку.".into());
    }
    Ok(UploadedCover { url })
}
