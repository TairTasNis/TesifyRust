import { useSyncExternalStore } from 'react'
import { waveModes, waveMoods } from '../playback/wave'
import type { WaveOptions } from '../playback/wave'

export type Language = 'ru' | 'en' | 'kk'
type Theme = 'light' | 'dark'
export type LyricsMode = 'letter' | 'word' | 'line'
export const lyricsModes: Record<LyricsMode, string> = { letter: 'По буквам', word: 'По словам', line: 'По строкам' }
type Preferences = {
  language: Language
  theme: Theme
  accentEnabled: boolean
  accentColor: string
  lyricsMode: LyricsMode
  lyricsBackground: boolean
  backgroundPlayback: boolean
  waveOptions: WaveOptions
  showWaveChanges: boolean
}
const defaults: Preferences = {
  language: 'ru', theme: 'light', accentEnabled: false, accentColor: '#5e80cf', lyricsMode: 'letter', lyricsBackground: true,
  backgroundPlayback: true, waveOptions: { mode: 'balanced', mood: 'any' }, showWaveChanges: false,
}
const storageKey = 'tesify.preferences'
const listeners = new Set<() => void>()

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    return {
      language: saved?.language === 'en' || saved?.language === 'kk' ? saved.language : 'ru',
      theme: saved?.theme === 'dark' ? 'dark' : 'light',
      accentEnabled: saved?.accentEnabled === true,
      accentColor: typeof saved?.accentColor === 'string' && /^#[\da-f]{6}$/i.test(saved.accentColor) ? saved.accentColor : defaults.accentColor,
      lyricsMode: saved?.lyricsMode === 'word' || saved?.lyricsMode === 'line' ? saved.lyricsMode : defaults.lyricsMode,
      lyricsBackground: saved?.lyricsBackground !== false,
      backgroundPlayback: saved?.backgroundPlayback !== false,
      waveOptions: {
        mode: Object.hasOwn(waveModes, saved?.waveOptions?.mode) ? saved.waveOptions.mode : 'balanced',
        mood: Object.hasOwn(waveMoods, saved?.waveOptions?.mood) ? saved.waveOptions.mood : 'any',
      },
      showWaveChanges: saved?.showWaveChanges === true,
    }
  } catch { return defaults }
}

let preferences = readPreferences()
const snapshot = () => preferences
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function apply() {
  const root = document.documentElement
  root.lang = preferences.language
  root.dataset.theme = preferences.theme
  root.toggleAttribute('data-custom-accent', preferences.accentEnabled)
  root.style.setProperty('--custom-accent', preferences.accentColor)
  const channels = preferences.accentColor.slice(1).match(/../g)!.map(hex => {
    const srgb = Number.parseInt(hex, 16) / 255
    return srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4
  })
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
  root.style.setProperty('--custom-accent-contrast', luminance > .179 ? '#000' : '#fff')
}

apply()
window.addEventListener('storage', event => {
  if (event.key !== storageKey && event.key !== null) return
  preferences = readPreferences()
  apply()
  listeners.forEach(listener => listener())
})

export function setPreferences(changes: Partial<Preferences>) {
  preferences = { ...preferences, ...changes }
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* Settings still apply in memory. */ }
  apply()
  listeners.forEach(listener => listener())
}

export function usePreferences() {
  return useSyncExternalStore(subscribe, snapshot)
}

export function currentLanguage() {
  return preferences.language
}
