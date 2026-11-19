# Текст песен

`get_track_lyrics(playlistId, trackId)` и `POST /lyrics` используют одни и те же метаданные библиотеки/кэша Spotify. Произвольные имена треков и адреса для скачивания через frontend не принимаются.

Источники запускаются параллельно. Первый полноценный пословный ответ завершает поиск. Построчный/обычный текст ожидает пословные источники, общий предел — 22 секунды. Ошибки отдельного сервиса не мешают остальным. Успешные результаты хранятся в ограниченном кэше на час, отсутствие — 30 секунд, сетевые ошибки не кэшируются. Повторные frontend-запросы одного трека объединяются.

| Источник | Запросы и документация |
| --- | --- |
| LRCLIB | `/api/get`, `/api/search`, [документация](https://lrclib.net/docs) |
| LyricsPlus / KPOE | `/v2/lyrics/get`, все upstream-источники `apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word`; [схема](https://github.com/ibratabian17/LyricsPlus/blob/gelato/internal/api/openapi/openapi.yaml) |
| BiniLyrics, кэширующий сервер LyricsPlus | `lyrics-api.binimum.org/?track=&artist=`, TTML по проверенному адресу из индекса; [клиент](https://github.com/binimum/am-lyrics/blob/main/src/AmLyrics.ts) |
| Better Lyrics | `/getLyrics?s=&a=`, [официальная схема](https://github.com/better-lyrics/api/blob/master/internal/openapi/openapi.yaml) |
| lrcmux | `/get?level=word&format=json`, [документация](https://lrcmux.dev/docs) |
| LrcApi | `/lyrics?title=&artist=`, [проект](https://github.com/HisAtri/LrcApi) |
| AMLL TTML Database | TTML по Spotify ID; поиск через совместимый LRCLIB API `api.amll.dev/v1/lrclib`; [база](https://github.com/amll-dev/amll-ttml-db), [API](https://amll.dev/reference/http-api/overview) |
| NetEase Cloud Music | `/api/search/pc`, `/api/song/lyric`, YRC предпочтительнее LRC |
| Kugou Music | `/search`, `/download?fmt=krc`, распаковка KRC, проверка названия/исполнителя/длительности |

Известные зеркала KPOE: `lyricsplus.binimum.org`, `lyricsplus.atomix.one`, `lyricsplus-seven.vercel.app`, `lyricsplus.prjktla.workers.dev`, `lyrics-plus-backend.vercel.app`. Они являются независимыми публичными развёртываниями: часть может быть отключена или не иметь нужного upstream-провайдера. `LYRICSPLUS_SERVERS` добавляет адреса в начало списка, стандартные зеркала остаются запасными. Невозможно автоматически обнаружить произвольные частные серверы.

Необязательные серверные настройки: `LYRICSPLUS_SERVERS` (через запятую), `BETTERLYRICS_URL`, `BETTERLYRICS_API_KEY`, `LRCAPI_URL`. Некоторые развёртывания BetterLyrics требуют ключ для промахов кэша; ответ 401/403 обрабатывается как недоступность источника, без обхода авторизации.

Нормализация: секунды, сохранённые интервалы слов, LRC offset и повторные метки, Enhanced LRC, TTML (XML и сущности, пропуск перевода), YRC с абсолютными таймингами, KRC с относительными таймингами. Неполная разметка слов откатывается к целой строке. Искусственная пословная синхронизация не генерируется. Если доступен только обычный текст, он показывается с ручной прокруткой без автоподсветки.

Проверки:

```text
cargo test --manifest-path Backend/Cargo.toml --locked --lib pages::lyrics
cargo test --manifest-path Backend/Cargo.toml --locked --lib pages::lyrics::providers::tests::live_providers -- --ignored --nocapture
npm --prefix Frontend test
npm --prefix Frontend run build
```

Живой тест обращается к публичным API и печатает только источник, вид синхронизации и количество строк/слов. Доступность и содержимое внешних сервисов меняются.
