import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { backend, errorMessage } from '../../lib/backend'
import type { Track } from '../../playlists/types'

export const downloadsQueueId = 'downloads'
type Progress = { active: boolean; total: number; completed: number; failed: number; percent: number; etaSeconds: number | null }
type Downloads = {
  tracks: Track[] | null; ids: Set<string>; error: string | null; progress: Progress | null; busy: boolean
  refresh: () => Promise<void>; download: (playlistId: string, trackIds: string[]) => Promise<void>
}

const Context = createContext<Downloads | null>(null)
const getProgress = () => backend<Progress>('get_download_progress', {}, '/downloads/progress')

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [starting, setStarting] = useState(false)
  const request = useRef(0)
  const ids = useMemo(() => new Set(tracks?.map(track => track.spotifyId)), [tracks])

  const refresh = useCallback(async () => {
    const current = ++request.current
    setError(null)
    try {
      const tracks = await backend<Track[]>('list_downloads', {}, '/downloads')
      if (current === request.current) setTracks(tracks)
    } catch (error) {
      if (current === request.current) setError(errorMessage(error))
    }
  }, [])

  const active = progress?.active ?? false
  const completed = progress?.completed ?? 0
  useEffect(() => { void refresh() }, [refresh, active, completed])

  useEffect(() => {
    let cancelled = false
    void getProgress().then(result => { if (!cancelled) setProgress(current => current ?? result) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: number
    async function poll() {
      try {
        const result = await getProgress()
        if (cancelled) return
        setProgress(result)
        if (!result.active) return
      } catch { /* Retry after the app returns to the foreground. */ }
      if (!cancelled) timer = window.setTimeout(poll, 650)
    }
    timer = window.setTimeout(poll, 650)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [active])

  const download = useCallback(async (playlistId: string, trackIds: string[]) => {
    const input = { playlistId, trackIds }
    setStarting(true)
    try { setProgress(await backend<Progress>('download_tracks', { input }, '/downloads', 'POST', input)) }
    finally { setStarting(false) }
  }, [])

  return <Context.Provider value={{ tracks, ids, error, progress, busy: starting || active, refresh, download }}>{children}</Context.Provider>
}

export function useDownloads() {
  const value = useContext(Context)
  if (!value) throw new Error('DownloadsProvider is required')
  return value
}
