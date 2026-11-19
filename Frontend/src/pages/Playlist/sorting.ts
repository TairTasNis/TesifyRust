import type { Track } from '../../shared/playlists/types'

export type TrackSortKey = 'index' | 'title' | 'artist' | 'duration' | 'added'
export type TrackSort = { key: TrackSortKey; direction: 'ascending' | 'descending' }
export type TrackEntry = { track: Track; originalIndex: number }

const alphabet = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })

export function nextTrackSort(current: TrackSort | null, key: TrackSortKey): TrackSort {
  return { key, direction: current?.key === key && current.direction === 'ascending' ? 'descending' : 'ascending' }
}

export function sortPlaylistTracks(tracks: Track[], sort: TrackSort | null): TrackEntry[] {
  const entries = tracks.map((track, originalIndex) => ({ track, originalIndex }))
  if (!sort) return entries
  const direction = sort.direction === 'ascending' ? 1 : -1
  return entries.sort((a, b) => {
    let compared: number
    if (sort.key === 'title' || sort.key === 'artist') {
      compared = alphabet.compare(a.track[sort.key].trim(), b.track[sort.key].trim())
    } else {
      const value = ({ track, originalIndex }: TrackEntry) => sort.key === 'index' ? originalIndex
        : sort.key === 'duration' ? track.durationMs !== null && track.durationMs > 0 ? track.durationMs : null
        : track.sourceAddedAt ?? track.addedAt
      const left = value(a), right = value(b)
      // Unknown durations stay at the end in both directions.
      if (left === null || right === null) return left === right ? a.originalIndex - b.originalIndex : left === null ? 1 : -1
      compared = left - right
    }
    return compared * direction || a.originalIndex - b.originalIndex
  })
}
