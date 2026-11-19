# Backend

Нативная часть Tesify на Rust и Tauri 3.0.0-alpha.5 с Wry runtime.

- `src/main.rs` — точка запуска Windows-приложения.
- `src/lib.rs` — настройка runtime и регистрация команд страниц.
- `src/pages/about/` — сведения о приложении: `get_app_info` возвращает название и версию из Cargo.
- `src/pages/library/` — создание и список плейлистов, загрузка обложек в imgbb.
- `src/pages/playlist/` — данные плейлиста, редактирование и импорт Spotify, перенесённый из старого проекта.
- `src/shared/playlists/` — модели и атомарное файловое хранилище с блокировкой.
- `src/shared/config.rs` — чтение `.env` без передачи ключей в frontend.
- `src/preview/` и `src/bin/tesify-preview.rs` — локальный сервис для браузерного просмотра; использует те же модули, что и команды Tauri.
- `tauri.conf.json` — окно, пути к фронтенду и сборка установщика.
- `capabilities/main.json` — разрешения основного окна.
- `icons/` — иконки приложения, созданные из исходного логотипа.

Новые серверные функции размещаются в папках соответствующих страниц согласно `../instructions.md`. Frontend находится отдельно; `src-tauri` внутри него создавать не нужно.

Из корня проекта:

```powershell
npm run desktop:dev
npm run desktop:check
npm run desktop:build
cargo test --manifest-path Backend/Cargo.toml --lib --locked
```
