import { backend } from '../../shared/lib/backend'
import type { CollectionDetail } from '../../shared/catalog/types'
export const getSpotifyAlbum = (id: string, offset = 0) => backend<CollectionDetail>('get_spotify_album', { id, offset, limit: 50 }, `/spotify/albums/${encodeURIComponent(id)}?offset=${offset}&limit=50`)
