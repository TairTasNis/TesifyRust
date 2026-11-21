import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { backend, errorMessage } from '../../lib/backend'
import type { LibraryIndex, SavedCollection } from '../types'
import TrackPlaylistDialog from './TrackPlaylistDialog'

type TrackTarget = { spotifyId: string; title: string }
type LibraryState = {
  index: LibraryIndex | null
  error: string | null
  refresh: () => Promise<void>
  choosePlaylists: (track: TrackTarget) => void
  saveCollection: (kind: SavedCollection['kind'], id: string, saved: boolean) => Promise<void>
}

const LibraryContext = createContext<LibraryState | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<TrackTarget | null>(null)
  const request = useRef(0)
  const pending = useRef(Promise.resolve())

  const refresh = useCallback(async () => {
    const current = ++request.current
    setError(null)
    try {
      const index = await backend<LibraryIndex>('get_library_index', {}, '/library')
      if (current === request.current) setIndex(index)
    } catch (error) {
      if (current === request.current) setError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    const load = () => { void refresh() }
    load()
    window.addEventListener('focus', load)
    return () => { ++request.current; window.removeEventListener('focus', load) }
  }, [refresh])

  const editLibrary = useCallback((operation: () => Promise<LibraryIndex>) => {
    const write = pending.current.then(async () => {
      const index = await operation()
      ++request.current
      setIndex(index)
      setError(null)
    })
    pending.current = write.catch(() => {})
    return write
  }, [])

  const saveCollection = useCallback((kind: SavedCollection['kind'], id: string, saved: boolean) => {
    const edit = { kind, id, saved }
    return editLibrary(() => backend('set_saved_collection', { edit }, '/library/collections', 'POST', edit))
  }, [editLibrary])

  const value = useMemo(() => ({ index, error, refresh, choosePlaylists: setTarget, saveCollection }), [index, error, refresh, saveCollection])

  return <LibraryContext.Provider value={value}>
    {children}
    {target && <TrackPlaylistDialog track={target} index={index} error={error} onRetry={refresh} onClose={() => setTarget(null)}
      onSave={async (add, remove) => {
        const edit = { spotifyId: target.spotifyId, add, remove }
        await editLibrary(() => backend('set_track_memberships', { edit }, '/library/memberships', 'POST', edit))
        setTarget(null)
      }} />}
  </LibraryContext.Provider>
}

export function useLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('LibraryProvider is required')
  return value
}
