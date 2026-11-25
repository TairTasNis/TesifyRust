import { backend } from '../../shared/lib/backend'
import type { CustomLyricsFont, LyricsCandidate, LyricsResponse } from './types'

const pending = new Map<string, Promise<LyricsResponse>>()
const cache = new Map<string, LyricsResponse>()

export function setLyricsCache(playlistId: string, trackId: string, response: LyricsResponse) {
  const key = `${playlistId}/${trackId}/auto`
  if (response.status === 'found') {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(key, response)
  } else {
    cache.delete(key)
  }
}

export function invalidateLyricsCache(playlistId: string, trackId: string) {
  const prefix = `${playlistId}/${trackId}/`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

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
    { playlistId, trackId, source: source ?? null },
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

export function searchLyricsCandidates(query: string) {
  return backend<LyricsCandidate[]>(
    'search_lyrics_candidates',
    { query },
    '/lyrics/search',
    'POST',
    { query },
  )
}

export async function applyLyricsCandidate(playlistId: string, trackId: string, candidateId: string) {
  const response = await backend<LyricsResponse>(
    'apply_lyrics_candidate',
    { playlistId, trackId, candidateId },
    '/lyrics/override',
    'POST',
    { playlistId, trackId, candidateId },
  )
  invalidateLyricsCache(playlistId, trackId)
  setLyricsCache(playlistId, trackId, response)
  return response
}

export async function applySpotifyLyrics(playlistId: string, trackId: string, spotifyTrackId: string) {
  const response = await backend<LyricsResponse>(
    'apply_spotify_lyrics',
    { playlistId, trackId, spotifyTrackId },
    '/lyrics/override/spotify',
    'POST',
    { playlistId, trackId, spotifyTrackId },
  )
  invalidateLyricsCache(playlistId, trackId)
  setLyricsCache(playlistId, trackId, response)
  return response
}

export async function clearTrackLyricsOverride(playlistId: string, trackId: string) {
  invalidateLyricsCache(playlistId, trackId)
  const response = await backend<LyricsResponse>(
    'clear_track_lyrics_override',
    { playlistId, trackId },
    '/lyrics/override',
    'DELETE',
    { playlistId, trackId },
  )
  setLyricsCache(playlistId, trackId, response)
  return response
}

export function listLyricsFonts() {
  return backend<CustomLyricsFont[]>('list_lyrics_fonts', {}, '/lyrics/fonts', 'GET')
}

export function uploadLyricsFont(fileName: string, fontBase64: string) {
  return backend<CustomLyricsFont>(
    'upload_lyrics_font',
    { fileName, fontBase64 },
    '/lyrics/fonts',
    'POST',
    { fileName, fontBase64 },
  )
}

export function deleteLyricsFont(id: string) {
  return backend<void>(
    'delete_lyrics_font',
    { id },
    `/lyrics/fonts/${encodeURIComponent(id)}`,
    'DELETE',
  )
}
