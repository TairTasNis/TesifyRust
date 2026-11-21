import { backend } from '../../shared/lib/backend'
import type { Playlist, PlaylistDraft, PlaylistSummary, SpotifyImportKind } from '../../shared/playlists/types'

export const listPlaylists = () => backend<PlaylistSummary[]>('list_playlists', {}, '/playlists')
export const createPlaylist = (draft: PlaylistDraft) => backend<Playlist>('create_playlist', { draft }, '/playlists', 'POST', draft)
export function createPlaylistWithSpotify(draft: PlaylistDraft, kind: SpotifyImportKind, url: string, autoSync: boolean) {
  const input = { draft, kind, url, autoSync }
  return backend<Playlist>('create_playlist_with_spotify', { input }, '/playlists/import/spotify', 'POST', input)
}
