import test from 'node:test'
import assert from 'node:assert/strict'
import { activityPeriod } from './activityPeriods.ts'

const activity = (visits, tracks, listeningMs) => ({ visits, tracks, listeningMs })
const hourAt = value => new Date(value).getTime()
const history = {
  [hourAt('2026-11-17T11:00')]: activity(1, 0, 60000),
  [hourAt('2026-11-27T01:00')]: activity(2, 3, 3600000),
  [hourAt('2026-11-28T00:00')]: activity(4, 1, 1000),
}
const today = '2026-11-28'
const custom = { from: '2026-11-17', to: '2026-11-27' }

test('uses the local calendar day and filters visits, tracks and listening time together', () => {
  const result = activityPeriod(history, 'day', today, custom)
  assert.deepEqual(result.totals, activity(4, 1, 1000))
  assert.equal(result.granularity, 'hour')
  assert.equal(result.buckets[0].listeningMs, 1000)
  assert.deepEqual(activityPeriod(history, 'week', today, custom).totals, activity(6, 4, 3601000))
  assert.deepEqual(activityPeriod(history, 'all', today, custom).totals, activity(7, 4, 3661000))
})

test('custom periods include both dates and reject inverted or invalid date ranges', () => {
  const result = activityPeriod(history, 'custom', today, custom)
  assert.deepEqual(result.totals, activity(3, 3, 3660000))
  assert.equal(result.buckets.at(-1).listeningMs, 3600000)
  assert.equal(activityPeriod(history, 'custom', today, { from: custom.to, to: custom.from }), null)
  assert.equal(activityPeriod(history, 'custom', today, { from: '2026-02-31', to: today }), null)
})
