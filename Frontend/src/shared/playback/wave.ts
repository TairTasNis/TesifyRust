import { backend } from '../lib/backend'
import type { Track } from '../playlists/types'

export const waveQueueId = 'spotify:wave'
export type WaveFeedback = 'skipped' | 'listened'

export const waveModes = { balanced: 'Баланс', familiar: 'Похожее', discovery: 'Незнакомое', popular: 'Популярное' } as const
export const waveMoods = { any: 'Любое', sad: 'Грустное', happy: 'Весёлое', energetic: 'Энергичное',
  calm: 'Спокойное', romantic: 'Романтичное', focused: 'Для концентрации' } as const

export type WaveOptions = { mode: keyof typeof waveModes; mood: keyof typeof waveMoods }

export type WaveProfile = {
  configured: boolean
  scanning: boolean
  scannedTracks: number
  totalTracks: number
  scannedPlaylists: number
  totalPlaylists: number
  scanError: string | null
  tags: { tag: string; playlistTracks: number; feedback: number; weight: number; sessionChange: number }[]
}

export const getWaveProfile = () => backend<WaveProfile>('get_wave_profile', {}, '/wave/profile')
export const setWaveApiKey = (key: string) => backend<void>('set_wave_api_key', { key }, '/wave/key', 'POST', { key })
export const getWaveTracks = (recent: string[], options: WaveOptions) => {
  const input = { recent, options }
  return backend<Track[]>('get_wave_tracks', input, '/wave/tracks', 'POST', input)
}
export const saveWaveFeedback = (trackId: string, feedback: WaveFeedback) =>
  backend<void>('save_wave_feedback', { trackId, feedback }, '/wave/feedback', 'POST', { trackId, feedback })

export function playedSeconds(ranges: TimeRanges) {
  let seconds = 0
  for (let index = 0; index < ranges.length; index++) seconds += ranges.end(index) - ranges.start(index)
  return seconds
}
