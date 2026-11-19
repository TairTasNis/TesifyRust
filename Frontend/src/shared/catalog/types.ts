import { currentLanguage } from '../preferences/preferences'

export type CatalogKind = 'track' | 'artist' | 'album' | 'playlist'
export type SearchCategory = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists'
export type OpenCatalog = (kind: Exclude<CatalogKind, 'track'>, id: string) => void
export type ArtistRef = { id: string; name: string; imageUrl: string | null }
export type CatalogItem = {
  id: string; kind: CatalogKind; name: string; subtitle: string; imageUrl: string | null; color: string | null
  artists: ArtistRef[]; albumId: string | null; albumName: string | null; durationMs: number | null
  year: number | null; releaseType: string | null; playCount: number | null; addedAt: number | null
  discNumber: number | null; trackNumber: number | null; verified: boolean; playable: boolean
}
export type CatalogPage = { items: CatalogItem[]; total: number; offset: number; nextOffset: number | null }
export type SearchResults = { query: string; topResult: CatalogItem | null; tracks: CatalogPage; artists: CatalogPage; albums: CatalogPage; playlists: CatalogPage }
export type ArtistDetail = {
  artist: CatalogItem; headerUrl: string | null; biography: string; monthlyListeners: number | null; followers: number | null; worldRank: number | null
  topTracks: CatalogItem[]; popularReleases: CatalogItem[]; albums: CatalogPage; singles: CatalogPage; compilations: CatalogPage
  playlists: CatalogItem[]; appearsOn: CatalogItem[]; relatedArtists: CatalogItem[]; gallery: string[]
  topCities: { name: string; country: string; listeners: number }[]
}
export type CollectionDetail = { item: CatalogItem; description: string; owner: string; followers: number | null; releaseDate: string | null; label: string | null; copyrights: string[]; tracks: CatalogPage; moreAlbums: CatalogItem[] }
export const categories: { id: SearchCategory; label: string }[] = [{ id: 'all', label: 'Все' }, { id: 'tracks', label: 'Песни' }, { id: 'artists', label: 'Исполнители' }, { id: 'playlists', label: 'Плейлисты' }, { id: 'albums', label: 'Альбомы' }]
export const kindLabel = (item: CatalogItem) => item.kind === 'artist' ? 'Исполнитель' : item.kind === 'playlist' ? 'Плейлист' : item.kind === 'track' ? 'Песня' : item.releaseType === 'SINGLE' ? 'Сингл' : item.releaseType === 'COMPILATION' ? 'Сборник' : 'Альбом'
export const number = (value: number) => new Intl.NumberFormat(currentLanguage()).format(value)
export function mergeItems(current: CatalogItem[], next: CatalogItem[]) { const ids = new Set(current.map(item => `${item.kind}:${item.id}`)); return [...current, ...next.filter(item => !ids.has(`${item.kind}:${item.id}`))] }

