import { backend } from '../lib/backend'

export type PlaybackSource = { audioUrl: string; videoUrl: string; durationSeconds: number | null; introCached: boolean }

export const prepareTrack = (playlistId: string, trackId: string) => backend<PlaybackSource>(
  'prepare_track', { playlistId, trackId }, '/playback/resolve', 'POST', { playlistId, trackId },
)

export const prefetchTrack = (playlistId: string, trackId: string) => backend<PlaybackSource>(
  'prefetch_track', { playlistId, trackId }, '/playback/prefetch', 'POST', { playlistId, trackId },
)
