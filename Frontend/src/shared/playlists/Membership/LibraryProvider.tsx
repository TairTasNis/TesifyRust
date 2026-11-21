import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { backend, errorMessage } from '../../lib/backend'
import type { LibraryIndex, SavedCollection } from '../types'
import TrackPlaylistDialog from './TrackPlaylistDialog'

type TrackTarget = { spotifyId: string; title: string }
type MembershipEdit = { spotifyIds: string[]; add: string[]; remove: string[] }
type LibraryState = {
  index: LibraryIndex | null
  error: string | null
  refresh: () => Promise<void>
  choosePlaylists: (track: TrackTarget | TrackTarget[]) => void
  changeMemberships: (edit: MembershipEdit) => Promise<void>
  saveCollection: (kind: SavedCollection['kind'], id: string, saved: boolean) => Promise<void>
}

const LibraryContext = createContext<LibraryState | null>(null)
let startupSync: Promise<boolean> | undefined

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<TrackTarget[] | null>(null)
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
    let active = true
    startupSync ??= backend<boolean>('sync_spotify_playlists', {}, '/playlists/sync/spotify', 'POST').catch(() => false)
    void startupSync.then(changed => { if (active && changed) load() })
    window.addEventListener('focus', load)
    return () => { active = false; ++request.current; window.removeEventListener('focus', load) }
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

  const changeMemberships = useCallback((edit: MembershipEdit) =>
    editLibrary(() => backend('set_bulk_track_memberships', { edit }, '/library/memberships/bulk', 'POST', edit)), [editLibrary])
  const choosePlaylists = useCallback((track: TrackTarget | TrackTarget[]) => {
    setTarget(Array.isArray(track) ? track : [track])
  }, [])
  const value = useMemo(() => ({ index, error, refresh, choosePlaylists, changeMemberships, saveCollection }), [index, error, refresh, choosePlaylists, changeMemberships, saveCollection])

  return <LibraryContext.Provider value={value}>
    {children}
    {target && <TrackPlaylistDialog tracks={target} index={index} error={error} onRetry={refresh} onClose={() => setTarget(null)}
      onSave={async (add, remove) => {
        await changeMemberships({ spotifyIds: target.map(track => track.spotifyId), add, remove })
        setTarget(null)
      }} />}
  </LibraryContext.Provider>
}

export function useLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('LibraryProvider is required')
  return value
}
