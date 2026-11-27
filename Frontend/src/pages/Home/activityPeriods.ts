import type { Activity, ActivityHistory } from '../../shared/playback/activity/activityStore'

export const periods = ['day', 'week', 'month', 'year', 'all', 'custom'] as const
export type Period = typeof periods[number]
export type CustomRange = { from: string; to: string }
export type Bucket = { start: number; end: number; listeningMs: number }
export type Granularity = 'hour' | 'day' | 'week' | 'month' | 'year'

const hour = 3_600_000
const day = 24 * hour

export function dateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const date = new Date(`${value}T00:00:00`)
  return dateInputValue(date) === value ? date.getTime() : NaN
}

function moveDay(time: number, days: number) {
  const date = new Date(time)
  return date.setDate(date.getDate() + days)
}

export function activityPeriod(history: ActivityHistory, period: Period, today: string, custom: CustomRange) {
  const currentDay = parseDay(today)
  const end = period === 'custom' ? moveDay(parseDay(custom.to), 1) : moveDay(currentDay, 1)
  const start = period === 'custom' ? parseDay(custom.from)
    : period === 'all' ? Object.keys(history).reduce((earliest, time) => {
      const date = new Date(Number(time))
      return Math.min(earliest, date.setHours(0, 0, 0, 0))
    }, currentDay)
    : moveDay(currentDay, -({ day: 0, week: 6, month: 29, year: 364 }[period]))
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > moveDay(currentDay, 1)) return null

  const duration = (end - start) / day
  const granularity: Granularity = duration <= 1.1 ? 'hour'
    : duration <= 35 ? 'day' : duration <= 140 ? 'week'
    : duration <= 730 ? 'month' : 'year'
  const buckets: Bucket[] = []
  for (let cursor = start; cursor < end;) {
    const date = new Date(cursor)
    const boundary = granularity === 'hour' ? cursor + hour
      : granularity === 'day' ? moveDay(cursor, 1)
      : granularity === 'week' ? moveDay(cursor, 7)
      : granularity === 'month' ? date.setFullYear(date.getFullYear(), date.getMonth() + 1, 1)
      : date.setFullYear(date.getFullYear() + Math.max(1, Math.ceil(duration / (365 * 24))), 0, 1)
    const next = Math.min(boundary, end)
    buckets.push({ start: cursor, end: next, listeningMs: 0 })
    cursor = next
  }

  const totals: Activity = { visits: 0, tracks: 0, listeningMs: 0 }
  for (const [key, activity] of Object.entries(history)) {
    const time = Number(key)
    if (time < start || time >= end) continue
    totals.visits += activity.visits
    totals.tracks += activity.tracks
    totals.listeningMs += activity.listeningMs
    const bucket = buckets.find(bucket => time < bucket.end)
    if (bucket) bucket.listeningMs += activity.listeningMs
  }
  return { totals, buckets, granularity }
}

export function bucketLabel(bucket: Bucket, granularity: Granularity, language: string, short = false) {
  const format = (options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(language, options)
  if (granularity === 'hour') return format({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(bucket.start)
  const date = format(granularity === 'year' ? { year: 'numeric' }
    : granularity === 'month' ? { month: 'short', year: '2-digit' } : undefined)
  if (short || granularity === 'day') return date.format(bucket.start)
  return date.formatRange(bucket.start, bucket.end - 1)
}
