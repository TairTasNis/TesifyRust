import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage } from '../lib/backend'
import type { Track } from '../playlists/types'
import { prepareTrack, prefetchTrack } from './api'
import type { PlaybackSource } from './api'

type Queue = { playlistId: string; tracks: Track[]; index: number }
type Playback = {
  current: Track | null; playlistId: string | null; playing: boolean; loading: boolean; error: string | null
  time: number; duration: number; volume: number; canNext: boolean
  playQueue: (playlistId: string, tracks: Track[], index: number) => void
  reorderQueue: (playlistId: string, tracks: Track[]) => void
  toggle: () => void; next: () => void; previous: () => void; seek: (time: number) => void
  setVolume: (volume: number) => void; mute: () => void; retry: () => void
}

const PlaybackContext = createContext<Playback | null>(null)
const initialVolume = () => { try { const saved = localStorage.getItem('tesify.volume'); const value = saved === null ? .7 : Number(saved); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .7 } catch { return .7 } }

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null)
  const queueRef = useRef<Queue | null>(null)
  const request = useRef(0)
  const intent = useRef(false)
  const ready = useRef(false)
  const lastVolume = useRef(.7)
  const prefetched = useRef<{ key: string; source: PlaybackSource | null } | null>(null)
  const prefetchAttempt = useRef('')
  const [queue, setQueue] = useState<Queue | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(initialVolume)
  const current = queue?.tracks[queue.index] ?? null

  const playAudio = useCallback(async (generation: number) => {
    const element = audio.current
    if (!element || !ready.current || !intent.current) return
    try { await element.play() }
    catch (error) {
      if (generation !== request.current || !intent.current || (error instanceof DOMException && error.name === 'AbortError')) return
      intent.current = false; setPlaying(false); setLoading(false)
      setError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Нажмите «Продолжить», чтобы включить музыку.' : 'Не удалось воспроизвести трек. Повторите попытку.')
    }
  }, [])

  const start = useCallback(async (nextQueue: Queue) => {
    const element = audio.current, track = nextQueue.tracks[nextQueue.index]
    if (!element || !track) return
    const generation = ++request.current
    ready.current = false; intent.current = true
    element.pause(); element.removeAttribute('src'); element.load()
    queueRef.current = nextQueue; setQueue(nextQueue)
    setPlaying(true); setLoading(true); setError(null); setTime(0); setDuration((track.durationMs ?? 0) / 1000)
    try {
      const key = `${nextQueue.playlistId}/${track.id}`
      const cached = prefetched.current?.key === key ? prefetched.current.source : null
      const source = cached ?? await prepareTrack(nextQueue.playlistId, track.id)
      if (prefetched.current?.key === key) prefetched.current = null
      if (generation !== request.current) return
      setDuration(source.durationSeconds ?? (track.durationMs ?? 0) / 1000)
      ready.current = true; element.src = source.audioUrl; element.load()
      await playAudio(generation)
    } catch (error) {
      if (generation !== request.current) return
      ready.current = false; intent.current = false; setPlaying(false); setLoading(false); setError(errorMessage(error))
    }
  }, [playAudio])

  const toggle = useCallback(() => {
    const element = audio.current
    if (!element || !queueRef.current) return
    if (!ready.current && !intent.current) { void start(queueRef.current); return }
    intent.current = !intent.current; setPlaying(intent.current); setError(null)
    if (intent.current) {
      if (element.ended) element.currentTime = 0
      void playAudio(request.current)
    } else element.pause()
  }, [playAudio, start])

  const seek = useCallback((value: number) => {
    const element = audio.current
    if (!element || !ready.current || !Number.isFinite(element.duration) || element.duration <= 0) return
    const position = Math.max(0, Math.min(element.duration, value))
    element.currentTime = position; setTime(position)
  }, [])

  const next = useCallback(() => {
    const queue = queueRef.current
    if (queue && queue.index < queue.tracks.length - 1) void start({ ...queue, index: queue.index + 1 })
  }, [start])
  const previous = useCallback(() => {
    const queue = queueRef.current
    if (!queue) return
    if ((audio.current?.currentTime ?? 0) > 3 || queue.index === 0) seek(0)
    else void start({ ...queue, index: queue.index - 1 })
  }, [seek, start])
  const playQueue = useCallback((playlistId: string, tracks: Track[], index: number) => {
    if (queueRef.current?.playlistId === playlistId && queueRef.current.tracks[queueRef.current.index]?.id === tracks[index]?.id) toggle()
    else void start({ playlistId, tracks: [...tracks], index })
  }, [start, toggle])
  const reorderQueue = useCallback((playlistId: string, tracks: Track[]) => {
    const queue = queueRef.current
    if (!queue || queue.playlistId !== playlistId) return
    const currentId = queue.tracks[queue.index]?.id
    const index = tracks.findIndex(track => track.id === currentId)
    if (index < 0) return
    const nextQueue = { playlistId, tracks: [...tracks], index }
    queueRef.current = nextQueue
    setQueue(nextQueue)
  }, [])
  const retry = useCallback(() => { if (queueRef.current) void start(queueRef.current) }, [start])
  const setVolume = useCallback((value: number) => { if (Number.isFinite(value)) setVolumeState(Math.max(0, Math.min(1, value))) }, [])
  const mute = useCallback(() => setVolumeState(value => value > 0 ? 0 : lastVolume.current), [])

  useEffect(() => {
    if (audio.current) audio.current.volume = volume
    if (volume > 0) lastVolume.current = volume
    try { localStorage.setItem('tesify.volume', String(volume)) } catch { /* Storage can be unavailable. */ }
  }, [volume])
  useEffect(() => () => { ++request.current; audio.current?.pause() }, [])
  useEffect(() => {
    if (!queue || !playing || loading || duration <= 0 || time < duration * .5) return
    const nextTrack = queue.tracks[queue.index + 1]
    if (!nextTrack) return
    const key = `${queue.playlistId}/${nextTrack.id}`
    const attempt = `${request.current}/${key}`
    if (prefetchAttempt.current === attempt) return
    prefetchAttempt.current = attempt
    const slot = { key, source: null as PlaybackSource | null }
    prefetched.current = slot
    void prefetchTrack(queue.playlistId, nextTrack.id).then(source => {
      if (prefetched.current === slot) slot.source = source
    }).catch(() => { if (prefetched.current === slot) prefetched.current = null })
  }, [duration, loading, playing, queue, time])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="slider"]')) return
      if (queueRef.current) { event.preventDefault(); toggle() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toggle])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { if (!intent.current) toggle() }, pause: () => { if (intent.current) toggle() },
      nexttrack: next, previoustrack: previous,
      seekto: ({ seekTime }) => { if (seekTime !== undefined) seek(seekTime) },
      seekbackward: ({ seekOffset }) => seek((audio.current?.currentTime ?? 0) - (seekOffset ?? 10)),
      seekforward: ({ seekOffset }) => seek((audio.current?.currentTime ?? 0) + (seekOffset ?? 10)),
    }
    for (const [action, handler] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler) } catch { /* Unsupported system action. */ } }
    return () => { for (const action of Object.keys(actions)) { try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null) } catch { /* Unsupported system action. */ } } }
  }, [next, previous, seek, toggle])
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, artwork: current.coverUrl ? [{ src: current.coverUrl }] : [] })
  }, [current])
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    if (duration > 0) { try { navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.min(time, duration) }) } catch { /* Older WebViews do not support position state. */ } }
  }, [current, duration, playing, time])

  return <PlaybackContext.Provider value={{ current, playlistId: queue?.playlistId ?? null, playing, loading, error, time, duration, volume,
    canNext: Boolean(queue && queue.index < queue.tracks.length - 1), playQueue, reorderQueue, toggle, next, previous, seek, setVolume, mute, retry }}>
    {children}
    <audio ref={audio} preload="auto" data-testid="playback-audio"
      onTimeUpdate={(event) => { if (ready.current) setTime(event.currentTarget.currentTime) }}
      onDurationChange={(event) => { const value = event.currentTarget.duration; if (ready.current && Number.isFinite(value) && value > 0) setDuration(value) }}
      onCanPlay={() => { if (ready.current) setLoading(false) }}
      onPlaying={() => { if (ready.current && intent.current) { setPlaying(true); setLoading(false); setError(null) } }}
      onWaiting={() => { if (ready.current && intent.current) setLoading(true) }}
      onPause={() => { if (!intent.current) setPlaying(false) }}
      onEnded={() => {
        const queue = queueRef.current
        if (queue && queue.index < queue.tracks.length - 1) next()
        else { intent.current = false; setPlaying(false); setLoading(false) }
      }}
      onError={() => { if (ready.current && audio.current?.error) { ready.current = false; intent.current = false; setPlaying(false); setLoading(false); setError('Не удалось загрузить аудио. Повторите попытку или включите следующий трек.') } }} />
  </PlaybackContext.Provider>
}

export function usePlayback() {
  const value = useContext(PlaybackContext)
  if (!value) throw new Error('PlaybackProvider is missing')
  return value
}
