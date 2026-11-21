import type { Track } from '../playlists/types'
import type { CatalogItem } from './types'
export function catalogTracks(items: CatalogItem[]): Track[] {
  return items.filter(item => item.kind === 'track' && item.playable).map(catalogTrack)
}

export function catalogTrack(item: CatalogItem): Track {
  return { id: item.id, spotifyId: item.id, title: item.name, artist: item.subtitle, artists: item.artists,
    coverUrl: item.imageUrl, durationMs: item.durationMs, addedAt: 0, sourceAddedAt: item.addedAt, sourceUrl: `https://open.spotify.com/track/${item.id}` }
}
