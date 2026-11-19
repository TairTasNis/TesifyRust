import { backend } from '../../shared/lib/backend'
import type { ImportResult, Playlist, PlaylistDraft } from '../../shared/playlists/types'

export const getPlaylist = (id: string) => backend<Playlist>('get_playlist', { id }, `/playlists/${encodeURIComponent(id)}`)
export const deletePlaylist = (id: string) => backend<null>('delete_playlist', { id }, `/playlists/${encodeURIComponent(id)}`, 'DELETE')
export const updatePlaylist = (id: string, draft: PlaylistDraft) => backend<Playlist>('update_playlist', { id, draft }, `/playlists/${encodeURIComponent(id)}`, 'PUT', draft)
export const importSpotify = (id: string, url: string) => backend<ImportResult>('import_spotify_playlist', { id, url }, `/playlists/${encodeURIComponent(id)}/import/spotify`, 'POST', { url })
