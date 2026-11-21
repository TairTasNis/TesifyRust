export type PageId = 'home' | 'search' | 'library' | 'downloads' | 'playlist' | 'about' | 'artist' | 'album' | 'spotify-playlist' | 'settings'

export const pageTitles: Record<PageId, string> = {
  home: 'Главная',
  search: 'Поиск',
  library: 'Библиотека',
  downloads: 'Скачанные треки',
  playlist: 'Плейлист',
  about: 'О программе',
  artist: 'Исполнитель',
  album: 'Альбом',
  'spotify-playlist': 'Плейлист Spotify',
  settings: 'Настройки',
}

export function routeFromHash(): { page: PageId; playlistId?: string } {
  const [page, id] = window.location.hash.slice(1).split('/')
  if (page === 'playlist') return { page, playlistId: id ?? '' }
  if (page === 'artist' || page === 'album' || page === 'spotify-playlist') return { page, playlistId: id ?? '' }
  return { page: page === 'search' || page === 'library' || page === 'downloads' || page === 'about' || page === 'settings' ? page : 'home' }
}
