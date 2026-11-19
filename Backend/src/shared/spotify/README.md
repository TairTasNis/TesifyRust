# Гостевой каталог Spotify

Запросы изучены 17 октября 2026 года в новом сеансе Chrome **без аккаунта Spotify**. Проверены реальные HTTP-ответы поиска, исполнителя Lana Del Rey, альбома Born To Die — The Paradise Edition и плейлиста Today’s Top Hits. Основой клиента послужил пользовательский `D:/Python/Tesify/src-tauri/src/search.rs`; адреса операций и схемы актуализированы по текущему веб-плееру.

## Что отправляет веб-плеер

Каталог использует `POST https://api-partner.spotify.com/pathfinder/v2/query`. Тело — JSON:

```json
{
  "operationName": "searchDesktop",
  "variables": { "searchTerm": "Lana Del Rey", "offset": 0, "limit": 50, "numberOfTopResults": 5 },
  "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "хэш зарегистрированной операции" } }
}
```

Полный набор переменных включает флаги типов содержимого из `pages/search/service.rs`. В запросе есть `Authorization: Bearer <гостевой токен>`, `app-platform: WebPlayer`, `Referer: https://open.spotify.com/`. При проверке отдельный `client-token` не требовался. Гостевой access token выдаётся публичной embed-страницей; он хранится только в памяти Rust, обновляется и никогда не отправляется во frontend, не сохраняется в `.env`, журнал или установщик.

Это гостевой интерфейс самого веб-плеера, а не документированный REST Web API `/v1/search`, для которого [Spotify описывает отдельную авторизацию приложения](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow). Логин пользователя не используется.

## Операции и ответы

| Операция | Вход | Поля ответа |
| --- | --- | --- |
| `searchDesktop` | `searchTerm`, `offset`, `limit`, флаги | `data.searchV2`: `topResultsV2.itemsV2`, `tracksV2`, `artists`, `albumsV2`, `playlists` |
| `searchTracks`, `searchArtists`, `searchAlbums`, `searchPlaylists` | запрос, смещение и размер страницы | соответствующий раздел `searchV2`, `items`, `totalCount`, `pagingInfo.nextOffset` |
| `queryArtistOverview` | `uri: spotify:artist:<id>`, `locale`, `preReleaseV2` | `artistUnion.profile`, `headerImage`, `visuals`, `stats`, `discography`, `relatedContent` |
| `queryArtistDiscographyAll/Albums/Singles/Compilations` | URI исполнителя, `offset`, `limit`, `order: DATE_DESC` | `artistUnion.discography.<категория>`: группы изданий `releases.items`, `totalCount` |
| `getAlbum` | `uri: spotify:album:<id>`, `locale`, `offset`, `limit` | `albumUnion`: название, `coverArt`, исполнители, `tracksV2`, дата, лейбл, copyright, другие альбомы |
| `fetchPlaylist` | `uri: spotify:playlist:<id>`, `offset`, `limit`, флаги | `playlistV2`: название, описание, `ownerV2`, `followers`, `images`, `content.items`, даты добавления |

Актуальные хэши сохранены рядом с реализацией. Один хэш может соответствовать нескольким именованным операциям: это наблюдается у дискографии и у загрузки содержимого коллекций. Вход содержит только допустимые идентификаторы Spotify; произвольные адреса для проксирования не принимаются.

## Как преобразуются данные

- Лучший результат — **первый поддерживаемый элемент `topResultsV2.itemsV2`**, соответствующий ранжированию Spotify. `featured` содержит отдельные редакционные подборки и не заменяет лучший результат.
- Треки приходят внутри `item.data`, `itemV2.data` или `track`; длительность — `duration.totalMilliseconds` либо `trackDuration.totalMilliseconds`.
- У исполнителя месячные слушатели — `stats.monthlyListeners`, подписчики — `stats.followers`, место в мире — `stats.worldRank`, популярные треки — `discography.topTracks.items[].track` и их `playcount`.
- Название исполнителя — `profile.name`. Биография — `profile.biography.text`, баннер — `headerImage.data.sources`, аватар — `visuals.avatarImage.sources`.
- Из вариантов обложки выбирается самое большое доступное изображение. Для треков альбома, у которых нет отдельной обложки в ответе, используется настоящая обложка родительского альбома.
- HTML описаний преобразуется в обычный текст; сторонний HTML не исполняется. Отсутствующие биографии и счётчики не выдумываются.
- Категории поиска загружаются по 50 элементов, затем по реальному `nextOffset`. Дискография и содержимое коллекций также имеют постраничную загрузку. Не ограничивать выдачу первыми десятью элементами.
- Ответы кратковременно кэшируются в Rust (5 минут, максимум 64 ответа). Токен гостя общий для запросов одного процесса. Ошибки/ограничения Spotify отображаются явно; фиктивной выдачи нет.
- Воспроизведение использует существующий PlayEngine. Backend запоминает метаданные увиденных треков и принимает от frontend только ID трека. Это не Spotify Web Playback SDK и не поток Spotify.

## Где находится реализация

Общая сессия и преобразование моделей: `Backend/src/shared/spotify/`. Поиск: `Backend/src/pages/search/`. Исполнитель: `pages/artist/`. Альбом: `pages/album/`. Публичный плейлист: `pages/spotify_playlist/`. Локальная библиотека и прежний импорт остаются в своих папках.

## Практические ограничения

Гостевые операции не являются стабильным публичным API: Spotify может изменить хэши, схему, доступность или ограничить частоту запросов. При таких изменениях нужно повторить наблюдение в **гостевом** веб-плеере, обновить операции и проверить пагинацию. Недоступные/закрытые коллекции не превращать в пустые успешные результаты. Значения счётчиков зависят от актуального ответа Spotify.
