import { backend } from '../../shared/lib/backend'
import type { Playlist, PlaylistDraft, PlaylistSummary } from '../../shared/playlists/types'

export const listPlaylists = () => backend<PlaylistSummary[]>('list_playlists', {}, '/playlists')
export const createPlaylist = (draft: PlaylistDraft) => backend<Playlist>('create_playlist', { draft }, '/playlists', 'POST', draft)
