import test from 'node:test'
import assert from 'node:assert/strict'
import { activeLineAt, lyricCues, rowStaggerDelay, shouldAnimateLyricJump, wordProgress } from './timing.ts'

const lines = [
  { start: 3, end: 6 }, { start: 6, end: 8 }, { start: 12, end: 15 },
]
test('lyrics wait for the first phrase and follow boundaries and gaps', () => {
  assert.equal(activeLineAt(lines, 0), -1)
  assert.equal(activeLineAt(lines, 3), 0)
  assert.equal(activeLineAt(lines, 6), 1)
  assert.equal(activeLineAt(lines, 10), 1)
  assert.equal(activeLineAt(lines, 40), 2)
  assert.equal(activeLineAt([], 4), -1)
})
test('seeking in either direction finds the correct phrase', () => {
  for (const [time, line] of [[13, 2], [4, 0], [7, 1], [0, -1]]) assert.equal(activeLineAt(lines, time), line)
})
test('karaoke fill is clamped and uses source word intervals', () => {
  assert.equal(wordProgress(1, 3, 5), 0)
  assert.equal(wordProgress(4, 3, 5), .5)
  assert.equal(wordProgress(8, 3, 5), 1)
  assert.equal(wordProgress(3, 3, 3), 0)
  assert.equal(wordProgress(4, 3, 3), 1)
})

test('counts down during a long intro and gaps over five seconds', () => {
  const lyrics = [
    { text: 'A', start: 8, end: 13, words: [{ text: 'A', start: 8, end: 11 }] },
    { text: 'B', start: 17, end: 20, words: [] },
    { text: 'C', start: 25, end: 28, words: [] },
  ]
  const cues = lyricCues(lyrics, true, 2)
  assert.deepEqual(cues.filter(cue => cue.countdown), [
    { countdown: true, start: -2, end: 8 },
    { countdown: true, start: 11, end: 17 },
  ])
  assert.equal(cues[activeLineAt(cues, 17)].text, 'B')
  assert.equal(cues[activeLineAt(cues, 16)].countdown, true)
  assert.equal(cues[activeLineAt(cues, 10)].text, 'A')
  assert.equal(lyricCues(lyrics, false, 0), lyrics)
})

test('only estimates a lead-in when the source omitted the previous line end', () => {
  const first = { text: 'A', start: 2, end: 14, words: [] }
  const next = { text: 'B', start: 14, end: 17, words: [] }
  assert.deepEqual(lyricCues([first, next], true, 0), [first, next])
  const inferred = { ...first, endInferred: true }
  assert.deepEqual(lyricCues([inferred, next], true, 0), [
    inferred, { countdown: true, start: 6, end: 14 }, next,
  ])
  assert.equal(lyricCues([inferred, { ...next, start: 11 }], true, 0).length, 2)
})

test('animates smoothly when jumping across multiple lines in either direction', () => {
  assert.equal(shouldAnimateLyricJump(true, true), false)
  assert.equal(shouldAnimateLyricJump(false, false), false)
  assert.equal(shouldAnimateLyricJump(false, true), true)

  // Forward jump to line 7: rows <= 7 start immediately, following lines stagger by 45ms.
  assert.equal(rowStaggerDelay(5, 7, 1), 0)
  assert.equal(rowStaggerDelay(7, 7, 1), 0)
  assert.equal(rowStaggerDelay(8, 7, 1), 45)
  assert.equal(rowStaggerDelay(12, 7, 1), 225)
  assert.equal(rowStaggerDelay(20, 7, 1), 225)

  // Backward jump to line 5: rows >= 5 move down first, earlier lines follow cleanly.
  assert.equal(rowStaggerDelay(8, 5, -1), 0)
  assert.equal(rowStaggerDelay(5, 5, -1), 0)
  assert.equal(rowStaggerDelay(4, 5, -1), 45)
  assert.equal(rowStaggerDelay(0, 5, -1), 225)
})
