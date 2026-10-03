import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimedLyricWord from '../components/TimedLyricWord.tsx';
import LyricsCountdown from '../components/LyricsCountdown.tsx';
import { buildLyricTimeline, getLyricPlaybackState, getLyricSeekTime, getNextLyricWordTimes } from './lyricsTiming.ts';
import { fetchLyrics, getLyricWordProgress, parseLrc, parseLyricsPlus, splitLyricLetters, splitLyricSyllables } from './lyrics.ts';

test('estimated syllables preserve Russian soft signs, й, Kazakh vowels, and original spacing', () => {
  assert.deepEqual(splitLyricSyllables('музыка'), ['му', 'зы', 'ка']);
  assert.deepEqual(splitLyricSyllables('семья'), ['семь', 'я']);
  assert.deepEqual(splitLyricSyllables('мой'), ['мой']);
  const original = '  Привет, Өнер әдемі! е\u0301 👨‍👩‍👧‍👦';
  assert.equal(splitLyricSyllables(original).join(''), original);
  assert.deepEqual(splitLyricSyllables('әдемі'), ['ә', 'де', 'мі']);
});

test('estimated English syllables group vowel clusters and account for a silent final e', () => {
  assert.deepEqual(splitLyricSyllables('beautiful'), ['beau', 'ti', 'ful']);
  assert.deepEqual(splitLyricSyllables('hello'), ['hel', 'lo']);
  assert.deepEqual(splitLyricSyllables('love'), ['love']);
  assert.deepEqual(splitLyricSyllables('little'), ['lit', 'tle']);
});

test('syllable mode highlights a whole syllable together within a timed word', () => {
  const html = renderToStaticMarkup(createElement(TimedLyricWord, {
    word: { time: 0, endTime: 3, text: 'музыка' }, highlight: 'syllable', progress: 0.5,
  }));
  assert.match(html, /opacity:1">му/);
  assert.match(html, /opacity:0\.7">зы/);
  assert.match(html, /opacity:0\.4">ка/);
});

test('delta-based word appearance slows down for long intervals and speeds up for short ones', () => {
  const word = { time: 10, endTime: 10.2, text: 'Песня' };
  const render = (time: number, nextTime: number, fraction: number) => renderToStaticMarkup(createElement(TimedLyricWord, {
    word, highlight: 'word', progress: getLyricWordProgress(word, time, nextTime), appearanceFraction: fraction,
  }));
  assert.match(render(10, 12, 0.5), /opacity:0\.4/);
  assert.match(render(10.5, 12, 0.5), /opacity:0\.7/);
  assert.match(render(11, 12, 0.5), /opacity:1/);
  assert.match(render(10.5, 14, 0.5), /opacity:0\.55/);
  assert.match(render(10.5, 12, 0.25), /opacity:1/);
  assert.match(render(10.5, 12, 1), /opacity:0\.55/);
  // Seeking back before the word immediately restores its pending appearance.
  assert.match(render(9, 12, 0.5), /opacity:0\.4/);
});

test('delta-based syllable appearance keeps syllable starts and adjusts each fade duration', () => {
  const word = { time: 0, endTime: 0.1, text: 'музыка' };
  const render = (time: number, nextTime: number, fraction: number) => renderToStaticMarkup(createElement(TimedLyricWord, {
    word, highlight: 'syllable', progress: getLyricWordProgress(word, time, nextTime), appearanceFraction: fraction,
  }));
  const slow = render(1.25, 3, 0.5);
  assert.match(slow, /opacity:1">му/);
  assert.match(slow, /opacity:0\.7">зы/);
  assert.match(slow, /opacity:0\.4">ка/);
  assert.match(render(1.25, 3, 0.25), /opacity:1">зы/);
  assert.match(render(1.25, 3, 1), /opacity:0\.55">зы/);
  assert.match(render(0.5, 6, 1), /opacity:0\.55">му/);
  assert.match(render(0.5, 3, 1), /opacity:0\.7">му/);
  assert.match(render(0, 3, 0.5), /opacity:0\.4">му/);
});

test('next word timing crosses line boundaries and ignores blank words and repeated timestamps', () => {
  const times = getNextLyricWordTimes([
    { time: 0, text: 'Первая', words: [
      { time: 10, endTime: 11, text: 'Первая' }, { time: 11, endTime: 11, text: ' ' },
    ] },
    { time: 0, text: 'Вторая', words: [
      { time: 12, endTime: 13, text: 'Вторая' }, { time: 12, endTime: 13, text: ' тоже' },
    ] },
    { time: 14, text: 'Последняя', words: [{ time: 14, endTime: 15, text: 'Последняя' }] },
  ]);
  assert.deepEqual(times, [[12, undefined], [14, 14], [undefined]]);
});

test('delta-based appearance finishes before an instrumental countdown instead of spanning the silence', () => {
  const word = { time: 10, endTime: 12, text: 'Конец' };
  const html = renderToStaticMarkup(createElement(TimedLyricWord, {
    word, highlight: 'word', progress: getLyricWordProgress(word, 12, 30), appearanceFraction: 1,
  }));
  assert.match(html, /opacity:1/);
  const normal = renderToStaticMarkup(createElement(TimedLyricWord, {
    word, highlight: 'word', progress: 1,
  }));
  assert.match(normal, /lyric-word-sung/);
  assert.doesNotMatch(normal, /style=/);
});

test('long vocal gaps show a countdown through the final second and recover after a seek', () => {
  const timeline = buildLyricTimeline([
    { time: 0, text: 'First', words: [{ time: 0, endTime: 2, text: 'First' }] },
    { time: 15, text: 'Next', words: [{ time: 15, endTime: 17, text: 'Next' }] },
  ]);
  assert.equal(getLyricPlaybackState(timeline, 1).activeIndex, 0);
  assert.deepEqual(getLyricPlaybackState(timeline, 2).countdown, { afterIndex: 0, remaining: 13, target: 'lyrics' });
  assert.equal(getLyricPlaybackState(timeline, 14).countdown?.remaining, 1);
  assert.equal(getLyricPlaybackState(timeline, 14).activeIndex, -1);
  assert.equal(getLyricPlaybackState(timeline, 15).activeIndex, 1);
  assert.equal(getLyricPlaybackState(timeline, 15).countdown, null);
  assert.equal(getLyricPlaybackState(timeline, 1).countdown, null);
});

test('a long sung word or overlapping vocals do not become an instrumental pause', () => {
  const timeline = buildLyricTimeline([
    { time: 0, text: 'Sustained', words: [{ time: 0, endTime: 29, text: 'Sustained' }] },
    { time: 10, text: 'Background', words: [{ time: 10, endTime: 12, text: 'Background' }] },
    { time: 30, text: 'Next', words: [{ time: 30, endTime: 32, text: 'Next' }] },
  ]);
  assert.equal(getLyricPlaybackState(timeline, 20).countdown, null);
});

test('gaps must exceed seven seconds and can occur between words of the same line', () => {
  const timeline = buildLyricTimeline([{ time: 0, text: 'First next last', words: [
    { time: 0, endTime: 2, text: 'First ' },
    { time: 9, endTime: 10, text: 'next ' },
    { time: 20, endTime: 21, text: 'last' },
  ] }]);
  assert.equal(getLyricPlaybackState(timeline, 3).countdown, null);
  assert.deepEqual(getLyricPlaybackState(timeline, 12).countdown, { afterIndex: 0, remaining: 8, target: 'lyrics' });
  assert.equal(getLyricWordProgress({ time: 9, endTime: 10, text: 'next' }, 10, 20), 1);
});

test('line-only lyrics use explicit rest markers and do not guess the end of a sung line', () => {
  const unknownEnd = buildLyricTimeline(parseLrc('[00:01]Long sung line\n[00:30]Next line'));
  assert.equal(getLyricPlaybackState(unknownEnd, 20).countdown, null);
  const markedRest = buildLyricTimeline(parseLrc('[00:01]Line\n[00:05]\n[00:30]Next line'));
  assert.deepEqual(getLyricPlaybackState(markedRest, 10).countdown, { afterIndex: 0, remaining: 20, target: 'lyrics' });
  assert.equal(getLyricPlaybackState(markedRest, 30).activeIndex, 2);
});

test('unknown word durations never invent a pause, while intros and timed outros show their target', () => {
  const timeline = buildLyricTimeline([{ time: 10, text: 'One', words: [{ time: 10, endTime: 12, text: 'One' }] }]);
  assert.deepEqual(getLyricPlaybackState(timeline, 0).countdown, { afterIndex: -1, remaining: 10, target: 'lyrics' });
  assert.deepEqual(getLyricPlaybackState(timeline, 13, 30).countdown, { afterIndex: 0, remaining: 17, target: 'end' });
  const unknownEnd = buildLyricTimeline([
    { time: 0, text: 'Unknown', words: [{ time: 0, endTime: 0, text: 'Unknown' }] },
    { time: 20, text: 'Next' },
  ]);
  assert.equal(getLyricPlaybackState(unknownEnd, 10).countdown, null);
  assert.equal(getLyricPlaybackState(buildLyricTimeline([]), 0).countdown, null);
});

test('countdown displays rounded seconds or minutes without announcing every frame', () => {
  const html = renderToStaticMarkup(createElement(LyricsCountdown, {
    countdown: { afterIndex: 0, remaining: 61.2, target: 'end' },
  }));
  assert.match(html, /1:02/);
  assert.match(html, /До конца трека/);
  assert.match(html, /aria-live="off"/);
});

test('clicking a word-timed line seeks to the first sung word even if the line timestamp is zero', () => {
  assert.equal(getLyricSeekTime({ time: 0, text: 'Sing here', words: [
    { time: 0, endTime: 0, text: ' ' },
    { time: 30, endTime: 32, text: 'Sing ' },
    { time: 32, endTime: 33, text: 'here' },
  ] }), 30);
  assert.equal(getLyricSeekTime({ time: 12.5, text: 'Line only' }), 12.5);
});

test('letter highlighting shares the full interval until the next word and rewinds on seek', () => {
  const word = { time: 10, endTime: 10.2, text: 'Песня' };
  assert.equal(getLyricWordProgress(word, 9, 12), 0);
  assert.equal(getLyricWordProgress(word, 10, 12), 0);
  assert.equal(getLyricWordProgress(word, 11, 12), 0.5);
  assert.equal(getLyricWordProgress(word, 12, 12), 1);
  assert.equal(getLyricWordProgress(word, 10.5, 12), 0.25);
});

test('the last word finishes before instrumental gaps and uses line timing if duration is missing', () => {
  assert.equal(getLyricWordProgress({ time: 10, endTime: 12, text: 'Конец' }, 12, undefined, 20), 1);
  assert.equal(getLyricWordProgress({ time: 10, endTime: 20, text: 'Конец' }, 12, undefined, 12), 1);
  assert.equal(getLyricWordProgress({ time: 10, endTime: 10, text: 'Конец' }, 11, undefined, 12), 0.5);
});

test('repeated timestamps and missing durations never cause invalid letter opacity', () => {
  const word = { time: 10, endTime: 12, text: 'Хор' };
  assert.equal(getLyricWordProgress(word, 11, 10), 0.5);
  assert.equal(getLyricWordProgress(word, 11, Number.NaN), 0.5);
  assert.equal(getLyricWordProgress({ ...word, endTime: 10 }, 10, 10), 1);
  assert.equal(getLyricWordProgress(word, Number.NaN, 12), 0);
});

test('letters preserve Unicode clusters and spaces do not consume singing time', () => {
  assert.deepEqual(splitLyricLetters('е\u0301 👨‍👩‍👧‍👦'), ['е\u0301', ' ', '👨‍👩‍👧‍👦']);
  const html = renderToStaticMarkup(createElement(TimedLyricWord, {
    word: { time: 0, endTime: 4, text: 'АБ ВГ' }, highlight: 'letter', progress: 0.375,
  }));
  assert.match(html, /opacity:1">А/);
  assert.match(html, /opacity:0\.7">Б/);
  assert.match(html, /<\/span> <span style="opacity:0\.4">В/);
  assert.match(html, /opacity:0\.4">Г/);
});

test('LyricsPlus preserves word spacing and converts absolute millisecond timestamps', () => {
  const result = parseLyricsPlus({ type: 'Word', lyrics: [{
    time: 6047, text: 'Hello, it is me', syllabus: [
      { time: 6047, duration: 1232, text: 'Hello, ' },
      { time: 8899, duration: 345, text: 'it is ' },
      { time: 9244, duration: 1100, text: 'me' },
    ],
  }] });
  assert.equal(result?.lines?.[0].time, 6.047);
  assert.equal(result?.lines?.[0].words?.[1].time, 8.899);
  assert.equal(result?.lines?.[0].words?.[2].endTime, 10.344);
  assert.equal(result?.lines?.[0].words?.map(word => word.text).join(''), 'Hello, it is me');
});

test('line and plain responses remain readable without inventing word timing', () => {
  const lines = [{ time: 1000, text: 'Line' }];
  assert.deepEqual(parseLyricsPlus({ type: 'LINE', lyrics: lines })?.lines, [{ time: 1, text: 'Line' }]);
  assert.deepEqual(parseLyricsPlus({ type: 'None', lyrics: lines }), { lines: null, plain: 'Line' });
  assert.equal(parseLyricsPlus({ error: 'missing' }), null);
});

test('LRC handles repeated timestamps, fractions and instrumental gaps', () => {
  assert.deepEqual(parseLrc('[00:10.5][01:10.050]Echo\n[00:12]\n[00:01.005]Start'), [
    { time: 1.005, text: 'Start' }, { time: 10.5, text: 'Echo' },
    { time: 12, text: '' }, { time: 70.05, text: 'Echo' },
  ]);
});

test('LRCLIB retries the primary artist and chooses the matching duration', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    return Response.json(urls.length === 1 ? [] : [
      { trackName: 'Quicksand test', artistName: 'Michi', duration: 300, plainLyrics: 'wrong version' },
      { trackName: 'Quicksand test', artistName: 'Michi', duration: 150, syncedLyrics: '[00:01]right version' },
    ]);
  });
  const result = await fetchLyrics({ title: 'Quicksand test', artist: 'Michi, JOENN', durationMs: 150000 }, 'lrclib');
  assert.equal(result?.plain, 'right version');
  assert.equal(urls[0].pathname, '/api/search');
  assert.equal(urls[1].searchParams.get('artist_name'), 'Michi');
});

test('LyricsPlus switches mirrors on server failure and passes duration in seconds', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    return urls.length === 1 ? new Response('', { status: 502 }) : Response.json({ type: 'Word', lyrics: [
      { time: 1000, text: 'mirror test' }, { time: 2000, text: 'second line' },
    ] });
  });
  const result = await fetchLyrics({ title: 'Mirror test', artist: 'Artist', durationMs: 152500 }, 'lyricsplus');
  assert.equal(result?.lines?.[0].time, 1);
  assert.notEqual(urls[0].origin, urls[1].origin);
  assert.equal(urls[1].searchParams.get('duration'), '152.5');
  assert.equal(urls.length, 2);
  assert.equal(result?.provider, 'lyricsplus');
});

test('a missing track falls back to LRCLIB and caches only that track', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    if (input.hostname === 'lrclib.net') return Response.json([
      { trackName: 'Fallback track', artistName: 'Artist', syncedLyrics: '[00:01]First line\n[00:02]Second line' },
    ]);
    return input.searchParams.get('title') === 'Fallback track'
      ? new Response('', { status: 404 })
      : Response.json({ type: 'Word', lyrics: [
        { time: 1000, text: 'First', syllabus: [{ time: 1000, duration: 500, text: 'First' }] },
        { time: 2000, text: 'Second', syllabus: [{ time: 2000, duration: 500, text: 'Second' }] },
      ] });
  });
  const track = { title: 'Fallback track', artist: 'Artist' };
  const fallback = await fetchLyrics(track, 'lyricsplus');
  assert.equal(fallback?.provider, 'lrclib');
  assert.equal(fallback?.lines?.length, 2);
  assert.equal(urls.length, 2);
  assert.equal(await fetchLyrics(track, 'lyricsplus'), fallback);
  assert.equal(urls.length, 2);
  const otherTrack = await fetchLyrics({ title: 'Other full track', artist: 'Artist' }, 'lyricsplus');
  assert.equal(otherTrack?.provider, 'lyricsplus');
  assert.equal(otherTrack?.lines?.[0].words?.[0].text, 'First');
  assert.equal(urls.length, 3);
  assert.notEqual(urls[2].hostname, 'lrclib.net');
});

test('single-line LyricsPlus responses use LRCLIB, ignoring empty timed lines', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    if (input.hostname === 'lrclib.net') return Response.json([
      { trackName: input.searchParams.get('track_name'), plainLyrics: 'Complete first line\nComplete second line' },
    ]);
    return Response.json(input.searchParams.get('title') === 'One plain line'
      ? { type: 'None', lyrics: [{ text: 'Only one line' }] }
      : { type: 'Word', lyrics: [{ time: 0, text: '' }, { time: 1000, text: 'Only one line' }, { time: 2000, text: ' ' }] });
  });
  for (const title of ['One plain line', 'One timed line']) {
    const result = await fetchLyrics({ title, artist: 'Artist' }, 'lyricsplus');
    assert.equal(result?.provider, 'lrclib');
    assert.equal(result?.plain, 'Complete first line\nComplete second line');
  }
  assert.equal(urls.filter(url => url.hostname === 'lrclib.net').length, 2);
});

test('a LyricsPlus outage still lets the track load from LRCLIB', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    return input.hostname === 'lrclib.net'
      ? Response.json([{ trackName: 'Outage track', plainLyrics: 'First line\nSecond line' }])
      : new Response('', { status: 503 });
  });
  const result = await fetchLyrics({ title: 'Outage track', artist: 'Artist' }, 'lyricsplus');
  assert.equal(result?.provider, 'lrclib');
  assert.equal(urls.length, 4);
});

test('tracks without a known artist can fall back to a title search in LRCLIB', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    return Response.json([{ trackName: 'Unknown artist track', plainLyrics: 'First line\nSecond line' }]);
  });
  const result = await fetchLyrics({ title: 'Unknown artist track', artist: 'YouTube' }, 'lyricsplus');
  assert.equal(result?.provider, 'lrclib');
  assert.equal(urls.length, 1);
  assert.equal(urls[0].hostname, 'lrclib.net');
  assert.equal(urls[0].searchParams.has('artist_name'), false);
});

test('an incomplete result with no fallback is not cached and a later full response can load', async t => {
  let primaryRequests = 0;
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    if (input.hostname === 'lrclib.net') return Response.json([]);
    primaryRequests++;
    return Response.json({ type: 'Line', lyrics: primaryRequests === 1
      ? [{ time: 1000, text: 'Incomplete line' }]
      : [{ time: 1000, text: 'Full first line' }, { time: 2000, text: 'Full second line' }] });
  });
  const track = { title: 'Transient incomplete track', artist: 'Artist' };
  assert.equal(await fetchLyrics(track, 'lyricsplus'), null);
  const retried = await fetchLyrics(track, 'lyricsplus');
  assert.equal(retried?.provider, 'lyricsplus');
  assert.equal(retried?.lines?.length, 2);
});

test('cancelled lyric requests never continue to another mirror', async t => {
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(fetchLyrics({ title: 'Cancel test', artist: 'Artist' }, 'lyricsplus', controller.signal), { name: 'AbortError' });
  assert.equal(requests, 1);
});
