# Spotify import

Реализация адаптирована из пользовательского проекта `D:/Python/Tesify/src-tauri/src/backend.rs`: функции `extract_spotify_playlist`, `spotify_playlist_track_from_item`, `spotify_id_from_uri` и работа с длительностью и `addedAt`.

Исходное авторство: Copyright (c) 2026 Tair Tasmukhambetov (@ttfotg), TFG License.

Сохранены извлечение гостевого токена из embed-страницы, persisted query `fetchPlaylist`, размер страницы 100 и разбор `itemV2/data`. Добавлены строгая проверка ссылки, явная обработка ошибок страниц, выбор обложки, учёт неподдерживаемых записей и атомарное добавление в локальный плейлист без повторов. Импорт не скачивает аудио.
