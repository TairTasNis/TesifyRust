import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage } from '../lib/backend'
import type { Track } from '../playlists/types'
import { usePreferences } from '../preferences/preferences'
import { prepareTrack, prefetchTrack } from './api'
import type { PlaybackSource } from './api'
import { getWaveTracks, playedSeconds, saveWaveFeedback, waveQueueId } from './wave'
import type { WaveFeedback, WaveOptions } from './wave'

type Queue = { playlistId: string; tracks: Track[]; index: number }
type WaveLoad = 'preview' | 'start' | 'append'
type Playback = {
  current: Track | null; playlistId: string | null; playing: boolean; loading: boolean; error: string | null
  time: number; duration: number; volume: number; canNext: boolean
  playQueue: (playlistId: string, tracks: Track[], index: number) => void
  playWave: () => void; waveLoading: boolean; waveError: string | null; waveFeedbackError: string | null
  waveTracks: Track[]; prepareWave: () => void; refreshWave: (options: WaveOptions) => void
  reorderQueue: (playlistId: string, tracks: Track[]) => void
  toggle: () => void; next: () => void; previous: () => void; seek: (time: number) => void
  setVolume: (volume: number) => void; mute: () => void; retry: () => void
}

const PlaybackContext = createContext<Playback | null>(null)
const initialVolume = () => { try { const saved = localStorage.getItem('tesify.volume'); const value = saved === null ? .7 : Number(saved); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .7 } catch { return .7 } }

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { waveOptions } = usePreferences()
  const audio = useRef<HTMLAudioElement>(null)
  const queueRef = useRef<Queue | null>(null)
  const request = useRef(0)
  const intent = useRef(false)
  const ready = useRef(false)
  const lastVolume = useRef(.7)
  const prefetched = useRef<{ key: string; source: PlaybackSource | null } | null>(null)
  const prefetchAttempt = useRef('')
  const waveRequest = useRef<{ mode: WaveLoad } | null>(null)
  const waveRecent = useRef<string[]>([])
  const waveRefillFailed = useRef(false)
  const waveOutcome = useRef({ started: false, reported: false })
  const waveFeedbackPending = useRef(Promise.resolve())
  const [queue, setQueue] = useState<Queue | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(initialVolume)
  const [waveLoading, setWaveLoading] = useState(false)
  const [waveError, setWaveError] = useState<string | null>(null)
  const [waveFeedbackError, setWaveFeedbackError] = useState<string | null>(null)
  const [wavePreview, setWavePreview] = useState<Track[]>([])
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
    const currentQueue = queueRef.current
    if (nextQueue.playlistId === waveQueueId &&
      (currentQueue?.playlistId !== waveQueueId || currentQueue.tracks[currentQueue.index]?.id !== track.id)) {
      waveOutcome.current = { started: false, reported: false }
    }
    if (nextQueue.playlistId === waveQueueId) setWavePreview([])
    waveRefillFailed.current = false
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

  const loadWave = useCallback(async (mode: WaveLoad, options = waveOptions) => {
    if (waveRequest.current) {
      if (mode === 'start' && waveRequest.current.mode === 'preview') waveRequest.current.mode = 'start'
      return
    }
    const pending = { mode }
    waveRequest.current = pending
    setWaveLoading(true)
    setWaveError(null)
    if (mode === 'append') {
      ++request.current
      intent.current = false
      audio.current?.pause()
      setPlaying(false)
      setLoading(false)
      setError(null)
    }
    try {
      await waveFeedbackPending.current
      if (waveRequest.current !== pending) return
      const tracks = await getWaveTracks([...waveRecent.current].reverse(), options)
      if (waveRequest.current !== pending) return
      if (!tracks.length) throw new Error('Не нашлось новых треков для Моей волны. Попробуйте ещё раз.')
      waveRecent.current = [...waveRecent.current, ...tracks.map(track => track.spotifyId)].slice(-200)
      const active = queueRef.current?.playlistId === waveQueueId ? queueRef.current : null
      if (pending.mode === 'preview') {
        if (active) {
          const updated = { ...active, tracks: [...active.tracks.slice(0, active.index + 1), ...tracks] }
          queueRef.current = updated; setQueue(updated)
          if (waveRefillFailed.current) { waveRefillFailed.current = false; setError(null) }
        } else setWavePreview(tracks)
      } else {
        const history = pending.mode === 'append' ? (active?.tracks ?? []).slice(-200) : []
        void start({ playlistId: waveQueueId, tracks: [...history, ...tracks], index: history.length })
      }
    } catch (error) {
      if (waveRequest.current !== pending) return
      if (mode === 'append') { waveRefillFailed.current = true; setError(errorMessage(error)) }
      else setWaveError(errorMessage(error))
    } finally {
      if (waveRequest.current === pending) { waveRequest.current = null; setWaveLoading(false) }
    }
  }, [start, waveOptions])

  const cancelWaveRequest = useCallback(() => {
    if (!waveRequest.current) return
    waveRequest.current = null
    setWaveLoading(false)
  }, [])

  const reportWave = useCallback((feedback: WaveFeedback) => {
    const queue = queueRef.current
    if (queue?.playlistId !== waveQueueId || !waveOutcome.current.started || waveOutcome.current.reported) return
    waveOutcome.current.reported = true
    const trackId = queue.tracks[queue.index].id
    waveFeedbackPending.current = waveFeedbackPending.current.then(async () => {
      try { await saveWaveFeedback(trackId, feedback); setWaveFeedbackError(null) }
      catch (error) { setWaveFeedbackError(errorMessage(error)) }
    })
  }, [])

  const reportEarlySkip = useCallback(() => {
    const element = audio.current
    if (element && element.currentTime < 30 && playedSeconds(element.played) < 30) reportWave('skipped')
  }, [reportWave])

  const checkWaveListening = useCallback((element: HTMLAudioElement, ended = false) => {
    if (queueRef.current?.playlistId !== waveQueueId || waveOutcome.current.reported ||
      !Number.isFinite(element.duration) || element.duration <= 0) return
    const listened = playedSeconds(element.played)
    if ((ended || listened >= 30) && listened >= element.duration * .75) reportWave('listened')
  }, [reportWave])

  const toggle = useCallback(() => {
    const element = audio.current
    if (!element || !queueRef.current) return
    if (waveRequest.current?.mode === 'append') return
    if (waveRefillFailed.current) { void loadWave('append'); return }
    if (!ready.current && !intent.current) { void start(queueRef.current); return }
    intent.current = !intent.current; setPlaying(intent.current); setError(null)
    if (intent.current) {
      if (element.ended) element.currentTime = 0
      void playAudio(request.current)
    } else element.pause()
  }, [loadWave, playAudio, start])

  const seek = useCallback((value: number) => {
    const element = audio.current
    if (!element || !ready.current || !Number.isFinite(element.duration) || element.duration <= 0) return
    const position = Math.max(0, Math.min(element.duration, value))
    element.currentTime = position; setTime(position)
  }, [])

  const advance = useCallback((skipped: boolean) => {
    const queue = queueRef.current
    if (!queue || waveRequest.current?.mode === 'append') return
    if (skipped && queue.playlistId === waveQueueId) reportEarlySkip()
    if (queue.index < queue.tracks.length - 1) void start({ ...queue, index: queue.index + 1 })
    else if (queue.playlistId === waveQueueId) {
      cancelWaveRequest()
      void loadWave('append')
    }
    else { intent.current = false; setPlaying(false); setLoading(false) }
  }, [cancelWaveRequest, loadWave, reportEarlySkip, start])
  const next = useCallback(() => advance(true), [advance])
  const previous = useCallback(() => {
    const queue = queueRef.current
    if (!queue) return
    if (waveRequest.current?.mode !== 'append' && ((audio.current?.currentTime ?? 0) > 3 || queue.index === 0)) seek(0)
    else if (queue.index === 0) return
    else { cancelWaveRequest(); void start({ ...queue, index: queue.index - 1 }) }
  }, [cancelWaveRequest, seek, start])
  const playQueue = useCallback((playlistId: string, tracks: Track[], index: number) => {
    const current = queueRef.current
    if (!tracks[index]) return
    if (current?.playlistId === playlistId && current.tracks[current.index]?.id === tracks[index].id) { toggle(); return }
    if (current?.playlistId === waveQueueId && playlistId === waveQueueId && index > current.index) reportEarlySkip()
    cancelWaveRequest()
    void start({ playlistId, tracks: [...tracks], index })
  }, [cancelWaveRequest, reportEarlySkip, start, toggle])
  const playWave = useCallback(() => {
    if (queueRef.current?.playlistId === waveQueueId) toggle()
    else if (wavePreview.length && !waveRequest.current) void start({ playlistId: waveQueueId, tracks: wavePreview, index: 0 })
    else void loadWave('start')
  }, [loadWave, start, toggle, wavePreview])

  const prepareWave = useCallback(() => {
    if (queueRef.current?.playlistId !== waveQueueId && !wavePreview.length) void loadWave('preview')
  }, [loadWave, wavePreview.length])

  const refreshWave = useCallback((options: WaveOptions) => {
    const mode = waveRequest.current?.mode ?? 'preview'
    cancelWaveRequest()
    void loadWave(mode, options)
  }, [cancelWaveRequest, loadWave])
  const reorderQueue = useCallback((playlistId: string, tracks: Track[]) => {
    const queue = queueRef.current
    if (!queue || queue.playlistId !== playlistId) return
    const current = queue.tracks[queue.index]
    const reordered = [...tracks]
    let index = reordered.findIndex(track => track.id === current.id)
    if (index < 0) {
      const remaining = new Set(reordered.map(track => track.id))
      const successor = queue.tracks.slice(queue.index + 1).find(track => remaining.has(track.id))
      index = successor ? reordered.findIndex(track => track.id === successor.id) : reordered.length
      reordered.splice(index, 0, current)
    }
    const nextQueue = { playlistId, tracks: reordered, index }
    queueRef.current = nextQueue
    setQueue(nextQueue)
  }, [])
  const retry = useCallback(() => {
    if (waveRefillFailed.current) void loadWave('append')
    else if (queueRef.current) void start(queueRef.current)
  }, [loadWave, start])
  const setVolume = useCallback((value: number) => { if (Number.isFinite(value)) setVolumeState(Math.max(0, Math.min(1, value))) }, [])
  const mute = useCallback(() => setVolumeState(value => value > 0 ? 0 : lastVolume.current), [])

  useEffect(() => {
    if (audio.current) audio.current.volume = volume
    if (volume > 0) lastVolume.current = volume
    try { localStorage.setItem('tesify.volume', String(volume)) } catch { /* Storage can be unavailable. */ }
  }, [volume])
  useEffect(() => () => { ++request.current; waveRequest.current = null; audio.current?.pause() }, [])
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

  const waveActive = queue?.playlistId === waveQueueId
  return <PlaybackContext.Provider value={{ current, playlistId: queue?.playlistId ?? null, playing, loading: loading || (waveActive && waveLoading), error, time, duration, volume,
    canNext: Boolean(queue && (queue.index < queue.tracks.length - 1 || (waveActive && !waveLoading))), playQueue, playWave, waveLoading, waveError, waveFeedbackError,
    waveTracks: waveActive ? queue.tracks : wavePreview, prepareWave, refreshWave,
    reorderQueue, toggle, next, previous, seek, setVolume, mute, retry }}>
    {children}
    <audio ref={audio} preload="auto" data-testid="playback-audio"
      onTimeUpdate={(event) => { if (ready.current) { setTime(event.currentTarget.currentTime); checkWaveListening(event.currentTarget) } }}
      onDurationChange={(event) => { const value = event.currentTarget.duration; if (ready.current && Number.isFinite(value) && value > 0) setDuration(value) }}
      onCanPlay={() => { if (ready.current) setLoading(false) }}
      onPlaying={() => {
        if (!ready.current || !intent.current) return
        if (queueRef.current?.playlistId === waveQueueId) waveOutcome.current.started = true
        setPlaying(true); setLoading(false); setError(null)
      }}
      onWaiting={() => { if (ready.current && intent.current) setLoading(true) }}
      onPause={() => { if (!intent.current) setPlaying(false) }}
      onEnded={event => { if (ready.current) { checkWaveListening(event.currentTarget, true); advance(false) } }}
      onError={() => { if (ready.current && audio.current?.error) { ready.current = false; intent.current = false; setPlaying(false); setLoading(false); setError('Не удалось загрузить аудио. Повторите попытку или включите следующий трек.') } }} />
  </PlaybackContext.Provider>
}

export function usePlayback() {
  const value = useContext(PlaybackContext)
  if (!value) throw new Error('PlaybackProvider is missing')
  return value
}
