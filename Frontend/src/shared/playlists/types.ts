import type { ArtistRef } from '../catalog/types'

export type Track = {
  id: string
  spotifyId: string
  title: string
  artist: string
  artists?: ArtistRef[]
  coverUrl: string | null
  durationMs: number | null
  addedAt: number
  sourceAddedAt: number | null
  sourceUrl: string
}

export type Playlist = {
  id: string
  name: string
  description: string
  coverUrl: string | null
  createdAt: number
  updatedAt: number
  tracks: Track[]
}

export type PlaylistSummary = Pick<Playlist, 'id' | 'name' | 'description' | 'coverUrl' | 'updatedAt'> & { trackCount: number }
export type PlaylistDraft = Pick<Playlist, 'name' | 'description' | 'coverUrl'>
export type ImportResult = { playlist: Playlist; addedCount: number; duplicateCount: number; unavailableCount: number; sourceName: string }

export type SavedCollection = {
  kind: 'album' | 'playlist'
  id: string
  name: string
  owner: string
  coverUrl: string | null
}

export type LibraryIndex = {
  playlists: PlaylistSummary[]
  collections: SavedCollection[]
  memberships: Record<string, string[] | undefined>
}

