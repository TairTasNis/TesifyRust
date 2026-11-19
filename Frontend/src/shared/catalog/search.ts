import { backend } from '../lib/backend'
import type { SearchCategory, SearchResults } from './types'

const cache = new Map<string, { result: SearchResults; expires: number }>()
const pending = new Map<string, Promise<SearchResults>>()
const searchKey = (query: string, category: SearchCategory, offset: number) => JSON.stringify([query, category, offset])

export function cachedSearch(query: string, category: SearchCategory, offset = 0) {
  const key = searchKey(query, category, offset)
  const entry = cache.get(key)
  if (entry && entry.expires > Date.now()) return entry.result
  cache.delete(key)
}

export function searchSpotify(query: string, category: SearchCategory, offset = 0) {
  const cached = cachedSearch(query, category, offset)
  if (cached) return Promise.resolve(cached)
  const key = searchKey(query, category, offset)
  const existing = pending.get(key)
  if (existing) return existing
  const limit = category === 'all' ? 12 : 30
  const params = new URLSearchParams({ q: query, category, offset: String(offset), limit: String(limit) })
  const request = backend<SearchResults>('search_spotify', { query, category, offset, limit }, `/search/spotify?${params}`)
    .then(result => {
      if (cache.size >= 40) cache.delete(cache.keys().next().value!)
      cache.set(key, { result, expires: Date.now() + 120_000 })
      return result
    })
    .finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}
