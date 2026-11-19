import { currentLanguage } from '../preferences/preferences'

export function trackCount(count: number): string {
  const language = currentLanguage()
  if (language === 'en') return `${count} ${count === 1 ? 'track' : 'tracks'}`
  if (language === 'kk') return `${count} трек`
  const last = count % 10
  const teens = count % 100 >= 11 && count % 100 <= 14
  return `${count} ${!teens && last === 1 ? 'трек' : !teens && last >= 2 && last <= 4 ? 'трека' : 'треков'}`
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || milliseconds <= 0) return '—'
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  return hours > 0 ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function totalDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60000)
  const units = { ru: ['ч', 'мин'], en: ['h', 'min'], kk: ['сағ', 'мин'] }
  const [hour, minute] = units[currentLanguage()]
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ${hour} ${minutes % 60} ${minute}` : `${minutes} ${minute}`
}

export function formatAddedDate(value: number): string {
  return new Intl.DateTimeFormat(currentLanguage(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}
