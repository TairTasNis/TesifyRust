import { backend } from '../lib/backend'

export type PlaybackSource = { audioUrl: string; videoUrl: string; durationSeconds: number | null; introCached: boolean }

export type MediaStatePayload = {
  hasTrack: boolean
  playing: boolean
  loading: boolean
  title: string
  artist: string
  coverUrl: string | null
  durationMs: number
  positionMs: number
}

export const prepareTrack = (playlistId: string, trackId: string) => backend<PlaybackSource>(
  'prepare_track', { playlistId, trackId }, '/playback/resolve', 'POST', { playlistId, trackId },
)

export const prefetchTrack = (playlistId: string, trackId: string) => backend<PlaybackSource>(
  'prefetch_track', { playlistId, trackId }, '/playback/prefetch', 'POST', { playlistId, trackId },
)

export const setBackgroundPlayback = (enabled: boolean) => backend<void>(
  'set_background_playback', { enabled }, '/playback/background', 'POST', { enabled },
)

export const syncMediaState = (state: MediaStatePayload) => backend<void>(
  'sync_media_state', { state }, '/playback/media-state', 'POST', state,
)
