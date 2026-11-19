import { backend } from '../../shared/lib/backend'
import type { ArtistDetail, CatalogPage } from '../../shared/catalog/types'
export const getSpotifyArtist = (id: string) => backend<ArtistDetail>('get_spotify_artist', { id }, `/spotify/artists/${encodeURIComponent(id)}`)
export const getArtistReleases = (id: string, kind: string, offset = 0) => backend<CatalogPage>('get_spotify_artist_releases', { id, kind, offset, limit: 50 }, `/spotify/artists/${encodeURIComponent(id)}/releases?kind=${kind}&offset=${offset}&limit=50`)
