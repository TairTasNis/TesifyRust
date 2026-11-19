import { backend } from '../../shared/lib/backend'
import type { LyricsResponse } from './types'

const pending = new Map<string, Promise<LyricsResponse>>()
const cache = new Map<string, LyricsResponse>()

export function getLyrics(playlistId: string, trackId: string, source?: string) {
  const key = `${playlistId}/${trackId}/${source ?? 'auto'}`
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)
  const existing = pending.get(key)
  if (existing) return existing
  const request = backend<LyricsResponse>(
    'get_track_lyrics',
    { playlistId, trackId, source: source ?? null },
    '/lyrics',
    'POST',
    { playlistId, trackId, source: source ?? null }
  )
    .then((response) => {
      if (response.status === 'found') {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!)
        cache.set(key, response)
      }
      return response
    }).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}
