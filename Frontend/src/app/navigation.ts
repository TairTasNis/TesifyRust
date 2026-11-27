export type PageId = 'home' | 'wave' | 'search' | 'library' | 'downloads' | 'playlist' | 'about' | 'track' | 'artist' | 'album' | 'spotify-playlist' | 'settings'
export type Route = { page: PageId; playlistId?: string }

export const pageTitles: Record<PageId, string> = {
  home: 'Главная',
  wave: 'Моя волна',
  search: 'Поиск',
  library: 'Библиотека',
  downloads: 'Скачанные треки',
  playlist: 'Плейлист',
  about: 'О программе',
  track: 'Песня',
  artist: 'Исполнитель',
  album: 'Альбом',
  'spotify-playlist': 'Плейлист Spotify',
  settings: 'Настройки',
}

export function routeKey(route: Route) {
  return route.playlistId ? `${route.page}/${route.playlistId}` : route.page
}

export function routeFromHash(): Route {
  const [page, id] = window.location.hash.slice(1).split('/')
  if (page === 'playlist') return { page, playlistId: id ?? '' }
  if (page === 'track' || page === 'artist' || page === 'album' || page === 'spotify-playlist') return { page, playlistId: id ?? '' }
  return { page: page === 'wave' || page === 'search' || page === 'library' || page === 'downloads' || page === 'about' || page === 'settings' ? page : 'home' }
}
