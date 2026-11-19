import { backend } from '../../shared/lib/backend'
import type { CollectionDetail } from '../../shared/catalog/types'
export const getSpotifyPlaylist = (id: string, offset = 0) => backend<CollectionDetail>('get_spotify_playlist', { id, offset, limit: 50 }, `/spotify/playlists/${encodeURIComponent(id)}?offset=${offset}&limit=50`)
