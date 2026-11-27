import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../lib/backend'
import type { CollectionDetail } from '../types'

export function useCollection(id: string, fetcher: (id: string, offset?: number) => Promise<CollectionDetail>) {
  const [data, setData] = useState<CollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const loadingPage = useRef<number | null>(null)
  useEffect(() => {
    const request = ++generation.current
    setData(null); setLoading(true); setError(null); setMore(false)
    void fetcher(id).then(data => { if (request === generation.current) setData(data) })
      .catch(error => { if (request === generation.current) setError(errorMessage(error)) })
      .finally(() => { if (request === generation.current) setLoading(false) })
    return () => { ++generation.current }
  }, [id, fetcher, retry])
  async function loadMore() {
    const request = generation.current
    if (!data || more || loadingPage.current === request || data.tracks.nextOffset === null) return
    loadingPage.current = request
    setMore(true); setError(null)
    try { const next = await fetcher(id, data.tracks.nextOffset); if (request === generation.current) setData(current => current ? { ...current, tracks: { ...next.tracks, items: [...current.tracks.items, ...next.tracks.items] } } : current) }
    catch (error) { if (request === generation.current) setError(errorMessage(error)) }
    finally {
      if (request === loadingPage.current) loadingPage.current = null
      if (request === generation.current) setMore(false)
    }
  }
  return { data, loading, error, more, onRetry: () => setRetry(value => value + 1), onLoadMore: () => { void loadMore() } }
}
