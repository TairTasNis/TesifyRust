import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTrackSort, sortPlaylistTracks } from './sorting.ts'

const tracks = [
  { id: 'b', title: 'Трек 10', artist: 'Яна', durationMs: 120000, addedAt: 500, sourceAddedAt: 100 },
  { id: 'a', title: 'трек 2', artist: 'Анна', durationMs: 60000, addedAt: 300, sourceAddedAt: 200 },
  { id: 'c', title: 'Другой', artist: 'Борис', durationMs: 60000, addedAt: 400, sourceAddedAt: null },
  { id: 'd', title: 'Финал', artist: 'Яна', durationMs: null, addedAt: 50, sourceAddedAt: null },
  { id: 'e', title: 'Эхо', artist: 'Анна', durationMs: 0, addedAt: 600, sourceAddedAt: null },
]
const ids = (key, direction) => sortPlaylistTracks(tracks, { key, direction }).map(({ track }) => track.id)

test('titles use natural alphabetical order without depending on case', () => {
  assert.deepEqual(ids('title', 'ascending'), ['c', 'a', 'b', 'd', 'e'])
  assert.deepEqual(ids('title', 'descending'), ['e', 'd', 'b', 'a', 'c'])
})
test('artist ties preserve the original order in either direction', () => {
  assert.deepEqual(ids('artist', 'ascending'), ['a', 'e', 'c', 'b', 'd'])
  assert.deepEqual(ids('artist', 'descending'), ['b', 'd', 'c', 'a', 'e'])
})
test('unknown and zero durations stay last in both directions', () => {
  assert.deepEqual(ids('duration', 'ascending'), ['a', 'c', 'b', 'd', 'e'])
  assert.deepEqual(ids('duration', 'descending'), ['b', 'a', 'c', 'd', 'e'])
})
test('added date matches the displayed source date, falling back to local date', () => {
  assert.deepEqual(ids('added', 'ascending'), ['d', 'b', 'a', 'c', 'e'])
  assert.deepEqual(ids('added', 'descending'), ['e', 'c', 'a', 'b', 'd'])
})
test('number sorting restores or reverses original playlist positions', () => {
  assert.deepEqual(ids('index', 'ascending'), ['b', 'a', 'c', 'd', 'e'])
  assert.deepEqual(ids('index', 'descending'), ['e', 'd', 'c', 'a', 'b'])
  assert.deepEqual(sortPlaylistTracks(tracks, { key: 'title', direction: 'ascending' }).map(entry => entry.originalIndex), [2, 1, 0, 3, 4])
})
test('sorting does not mutate the imported playlist or track objects', () => {
  const original = structuredClone(tracks)
  sortPlaylistTracks(tracks, { key: 'duration', direction: 'descending' })
  assert.deepEqual(tracks, original)
  assert.equal(sortPlaylistTracks(tracks, null)[0].track, tracks[0])
  assert.deepEqual(sortPlaylistTracks([], null), [])
})
test('a new column starts ascending; repeating toggles direction', () => {
  const first = nextTrackSort(null, 'duration')
  assert.deepEqual(first, { key: 'duration', direction: 'ascending' })
  const second = nextTrackSort(first, 'duration')
  assert.deepEqual(second, { key: 'duration', direction: 'descending' })
  assert.deepEqual(nextTrackSort(second, 'duration'), first)
  assert.deepEqual(nextTrackSort(second, 'title'), { key: 'title', direction: 'ascending' })
})
