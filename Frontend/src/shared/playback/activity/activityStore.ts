import { useSyncExternalStore } from 'react'

export const hourMs = 60 * 60 * 1000
export type Activity = { visits: number; tracks: number; listeningMs: number }
export type ActivityHistory = Record<number, Activity>

const storageKey = 'tesify.listening-activity.v1'
const empty = { visits: 0, tracks: 0, listeningMs: 0 }
const listeners = new Set<() => void>()
let history = readHistory()
let pending: ActivityHistory = {}
let flushTimer = 0

function readHistory(): ActivityHistory {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([time, activity]) =>
      Number.isSafeInteger(Number(time)) && activity && typeof activity === 'object' &&
      [activity.visits, activity.tracks, activity.listeningMs].every(value => Number.isFinite(value) && value >= 0)))
  } catch { return {} }
}

function hourAt(time: number) {
  const date = new Date(time)
  return time - ((date.getMinutes() * 60 + date.getSeconds()) * 1000 + date.getMilliseconds())
}

function add(target: ActivityHistory, hour: number, field: keyof Activity, value: number) {
  const row = target[hour] ??= { ...empty }
  row[field] += value
}

function merged(saved: ActivityHistory) {
  for (const [key, activity] of Object.entries(pending)) {
    const hour = Number(key)
    add(saved, hour, 'visits', activity.visits)
    add(saved, hour, 'tracks', activity.tracks)
    add(saved, hour, 'listeningMs', activity.listeningMs)
  }
  return saved
}

function publish(next: ActivityHistory) {
  history = next
  listeners.forEach(listener => listener())
}

export function flushActivity() {
  window.clearTimeout(flushTimer)
  flushTimer = 0
  if (!Object.keys(pending).length) return
  try {
    const next = merged(readHistory())
    localStorage.setItem(storageKey, JSON.stringify(next))
    pending = {}
    publish(next)
  } catch { /* Keep the session's counters in memory if storage is unavailable. */ }
}

function record(update: (put: (hour: number, field: keyof Activity, value: number) => void) => void) {
  const next = { ...history }
  update((hour, field, value) => {
    if (next[hour] === history[hour] && history[hour]) next[hour] = { ...history[hour] }
    add(next, hour, field, value)
    add(pending, hour, field, value)
  })
  publish(next)
  flushTimer ||= window.setTimeout(flushActivity, 5000)
}

export function recordListening(endedAt: number, listeningMs: number, finishedTrack: boolean) {
  record(put => {
    for (let cursor = endedAt - listeningMs; cursor < endedAt;) {
      const hour = hourAt(Math.floor(cursor))
      const end = Math.min(hour + hourMs, endedAt)
      put(hour, 'listeningMs', end - cursor)
      cursor = end
    }
    if (finishedTrack) put(hourAt(endedAt), 'tracks', 1)
  })
  if (finishedTrack) flushActivity()
}

export function startVisitTracking() {
  const visit = () => {
    record(put => put(hourAt(Date.now()), 'visits', 1))
    flushActivity()
  }
  if (document.visibilityState === 'visible') visit()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visit()
    else flushActivity()
  })
  window.addEventListener('pagehide', flushActivity)
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) publish(merged(readHistory()))
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useActivity() {
  return useSyncExternalStore(subscribe, () => history)
}
