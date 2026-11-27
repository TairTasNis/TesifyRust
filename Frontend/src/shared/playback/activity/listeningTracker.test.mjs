import test from 'node:test'
import assert from 'node:assert/strict'
import { ListeningTracker } from './listeningTracker.ts'

test('counts only after more than 80% of distinct audio was played', () => {
  const recorded = []
  const tracker = new ListeningTracker((_, milliseconds, completed) => recorded.push({ milliseconds, completed }))
  const media = { currentTime: 0, duration: 10, playbackRate: 1, seeking: false }
  tracker.resume(media, 1000)
  media.currentTime = 8
  tracker.sample(media, 9000)
  assert.equal(recorded.at(-1).completed, false)

  // Seeking ahead does not add the skipped time or cross the completion threshold.
  media.currentTime = 9
  tracker.sample(media, 9050)
  assert.equal(recorded.length, 1)

  // Replaying an already heard interval adds listening time without adding coverage.
  tracker.stop()
  media.currentTime = 3
  tracker.resume(media, 10000)
  media.currentTime = 7
  tracker.sample(media, 14000)
  assert.equal(recorded.at(-1).completed, false)
  assert.equal(recorded.at(-1).milliseconds, 4000)

  media.currentTime = 8.25
  tracker.sample(media, 15250)
  assert.equal(recorded.at(-1).completed, true)
  media.currentTime = 9.25
  tracker.sample(media, 16250)
  assert.equal(recorded.at(-1).completed, false)

  tracker.reset()
  media.currentTime = 0
  tracker.resume(media, 17000)
  media.currentTime = 8.5
  tracker.sample(media, 25500)
  assert.equal(recorded.at(-1).completed, true)
})

test('paused, buffering and seeking intervals do not add listening time', () => {
  let listened = 0
  const tracker = new ListeningTracker((_, milliseconds) => { listened += milliseconds })
  const media = { currentTime: 0, duration: 60, playbackRate: 2, seeking: false }
  tracker.resume(media, 1000)
  media.currentTime = 1
  tracker.sample(media, 1500)
  tracker.stop()
  tracker.sample(media, 2500)
  tracker.resume(media, 3000)
  media.seeking = true
  media.currentTime = 30
  tracker.sample(media, 3100)
  media.seeking = false
  tracker.resume(media, 3500)
  media.currentTime = 32
  tracker.sample(media, 4500)
  assert.equal(listened, 1500)
})
