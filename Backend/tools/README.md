# Инструмент воспроизведения

`yt-dlp.exe` — официальный переносимый выпуск **2026.08.19** проекта [yt-dlp](https://github.com/yt-dlp/yt-dlp), включённый в установщик Tesify. Исполняемый файл не изменён.

Источник: https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe

SHA-256: `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`

Контрольная сумма проверена по официальному `SHA2-256SUMS` того же выпуска. Сведения о лицензиях самого yt-dlp и включённых зависимостей: https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE

Порядок поиска: `YT_DLP_PATH`, папка `tools` рядом с установленным приложением, `Backend/tools` в проекте, затем PATH. Для EJS используется установленный Node.js 22+; свой путь можно задать через `YT_DLP_JS_RUNTIME=node:C:/path/to/node.exe` в `.env`.
