import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioPlaybackController, getYoutubeId, resolvePlayableTrack } from './playback.ts';
import type { Track } from '../types';

const track = (url: string, extra: Partial<Track> = {}): Track => ({ id: 'track', title: 'Song', artist: 'Artist', url, ...extra });

test('restores stable YouTube identity from stored proxy and video URLs', () => {
  for (const url of ['http://127.0.0.1:8000/proxy_stream?id=G0Ssa-pz58Q&retry=old', 'https://youtu.be/G0Ssa-pz58Q', 'https://www.youtube.com/watch?v=G0Ssa-pz58Q', 'https://youtube.com/shorts/G0Ssa-pz58Q']) {
    assert.equal(getYoutubeId(track(url)), 'G0Ssa-pz58Q');
  }
  assert.equal(getYoutubeId(track('https://example.com/audio.mp3')), undefined);
});

test('saved video URLs become fresh audio proxy sources', async () => {
  const result = await resolvePlayableTrack(track('https://youtu.be/G0Ssa-pz58Q'), 'stream');
  assert.equal(result.url, 'http://127.0.0.1:8000/proxy_stream?id=G0Ssa-pz58Q');
});

test('stale cloud blob is resolved again instead of replayed', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [
    { id: 'wrong', duration: 400 }, { id: 'correct', duration: 151 },
  ] }));
  const result = await resolvePlayableTrack(track('blob:http://localhost/expired', { durationMs: 150000 }), 'stream');
  assert.equal(result.youtubeId, 'correct');
  assert.ok(result.url.endsWith('id=correct'));
});

test('download mode checks the response before accepting a source', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Stream not found' }, { status: 404 }));
  await assert.rejects(resolvePlayableTrack(track('', { youtubeId: 'video' }), 'download'), /Stream not found/);
});

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  seekableRanges: number[][] | null = null;
  get seekable() {
    const ranges = this.seekableRanges ?? (Number.isFinite(this.duration) ? [[0, this.duration]] : []);
    return { length: ranges.length, start: (index: number) => ranges[index][0], end: (index: number) => ranges[index][1] };
  }
  readyState = 0;
  seeking = false;
  ended = false;
  paused = true;
  loads = 0;
  plays = 0;
  nextPlay: (() => Promise<void>) | null = null;
  load() { this.loads++; this.readyState = 0; this.currentTime = 0; this.seeking = false; this.paused = true; this.dispatchEvent(new Event('pause')); this.dispatchEvent(new Event('loadstart')); }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  play() { this.plays++; return this.nextPlay ? this.nextPlay() : Promise.resolve(); }
  canPlay() { if (!Number.isFinite(this.duration)) this.duration = 180; this.readyState = 4; this.dispatchEvent(new Event('canplay')); }
  metadata(duration = 180) { this.duration = duration; this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
  seeked() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
}
function setup() {
  const audio = new FakeAudio();
  const errors: string[] = [];
  const playing: boolean[] = [];
  const controller = createAudioPlaybackController(audio as unknown as HTMLAudioElement, {
    onError: message => errors.push(message), onPlaying: value => playing.push(value), onLoading: () => {},
  });
  return { audio, errors, playing, controller };
}

test('media errors retry once, wait for canplay, and stop instead of looping', () => {
  const { audio, errors, controller } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  audio.currentTime = 23;
  audio.dispatchEvent(new Event('error'));
  assert.equal(audio.loads, 2);
  assert.equal(audio.plays, 0);
  assert.ok(new URL(audio.src).searchParams.has('retry'));
  audio.canPlay();
  assert.equal(audio.plays, 1);
  assert.equal(audio.currentTime, 23);
  audio.dispatchEvent(new Event('error'));
  assert.equal(audio.loads, 2);
  assert.equal(errors.length, 1);
  controller.dispose();
});

test('switching tracks ignores rejection of an old play request', async () => {
  const { audio, errors, controller } = setup();
  let reject!: (error: Error) => void;
  audio.nextPlay = () => new Promise<void>((_, failure) => { reject = failure; });
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=old');
  controller.setPlaying(true);
  audio.canPlay();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=new');
  reject(new DOMException('Old source failed', 'NotSupportedError'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 0);
  assert.equal(audio.loads, 2);
  assert.ok(audio.src.endsWith('id=new'));
  controller.dispose();
});

test('pausing during recovery prevents automatic playback when the retry loads', () => {
  const { audio, controller } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  audio.dispatchEvent(new Event('error'));
  controller.setPlaying(false);
  audio.canPlay();
  assert.equal(audio.plays, 0);
  controller.dispose();
});

test('re-rendering or toggling playback retains the recovered source', () => {
  const { audio, controller } = setup();
  const source = 'http://127.0.0.1:8000/proxy_stream?id=video';
  controller.setSource(source);
  audio.dispatchEvent(new Event('error'));
  const retry = audio.src;
  controller.setSource(source);
  controller.setPlaying(false);
  controller.setPlaying(true);
  assert.equal(audio.src, retry);
  assert.equal(audio.loads, 2);
  controller.dispose();
});

test('seeking before metadata keeps the destination and applies it as soon as metadata arrives', () => {
  const { audio, controller } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  assert.equal(controller.seek(30), 30);
  assert.equal(audio.currentTime, 0);
  assert.equal(controller.getCurrentTime(), 30);
  audio.metadata();
  assert.equal(audio.currentTime, 30);
  audio.seeked();
  audio.canPlay();
  assert.equal(audio.loads, 1);
  assert.equal(audio.plays, 1);
  audio.currentTime = 31;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(controller.getCurrentTime(), 31);
  controller.dispose();
});

test('the latest seek during recovery replaces the old resume position, including a seek to zero', () => {
  for (const destination of [30, 0]) {
    const { audio, controller } = setup();
    controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
    audio.canPlay();
    audio.currentTime = 23;
    audio.dispatchEvent(new Event('error'));
    assert.equal(audio.currentTime, 0);
    assert.equal(controller.getCurrentTime(), 23);
    controller.seek(destination);
    audio.metadata();
    audio.seeked();
    audio.canPlay();
    assert.equal(audio.currentTime, destination);
    assert.equal(controller.getCurrentTime(), destination);
    assert.equal(audio.loads, 2);
    controller.dispose();
  }
});

test('a failed seek keeps its destination even when the media element resets its clock', () => {
  const { audio, controller, playing } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  audio.canPlay();
  controller.seek(30);
  audio.dispatchEvent(new Event('pause'));
  assert.deepEqual(playing, []);
  audio.currentTime = 0;
  audio.dispatchEvent(new Event('error'));
  assert.equal(controller.getCurrentTime(), 30);
  audio.metadata();
  assert.equal(audio.currentTime, 30);
  audio.seeked();
  audio.canPlay();
  assert.equal(audio.currentTime, 30);
  assert.equal(audio.loads, 2);
  controller.dispose();
});

test('dragging repeatedly while buffering keeps the last destination and preserves a paused player', () => {
  const { audio, controller } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.seek(30);
  controller.seek(60);
  controller.seek(10);
  audio.metadata();
  audio.seeked();
  audio.canPlay();
  assert.equal(audio.currentTime, 10);
  assert.equal(audio.loads, 1);
  assert.equal(audio.plays, 0);
  controller.dispose();
});

test('seeking resumes playback when an older play request is aborted after canplay', async () => {
  const { audio, controller, errors } = setup();
  let reject!: (error: Error) => void;
  audio.nextPlay = () => new Promise<void>((_, failure) => { reject = failure; });
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  audio.canPlay();
  controller.seek(30);
  audio.seeked();
  audio.canPlay();
  audio.nextPlay = null;
  reject(new DOMException('Interrupted by seeking', 'AbortError'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.plays, 2);
  assert.equal(audio.loads, 1);
  assert.equal(audio.currentTime, 30);
  assert.deepEqual(errors, []);
  controller.dispose();
});

test('invalid positions are ignored and a new track never inherits the previous seek', () => {
  const { audio, controller } = setup();
  assert.equal(controller.seek(30), null);
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=old');
  controller.seek(30);
  assert.equal(controller.seek(Number.NaN), null);
  assert.equal(controller.seek(Number.POSITIVE_INFINITY), null);
  assert.equal(controller.getCurrentTime(), 30);
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=new');
  audio.metadata();
  audio.canPlay();
  assert.equal(audio.currentTime, 0);
  assert.equal(controller.getCurrentTime(), 0);
  controller.dispose();
});

test('metadata without a seek index never sends the decoder to the start', () => {
  const { audio, controller } = setup();
  audio.seekableRanges = [];
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.seek(77);
  audio.metadata();
  assert.equal(audio.currentTime, 0);
  audio.seekableRanges = [[0, 180]];
  audio.dispatchEvent(new Event('progress'));
  assert.equal(audio.currentTime, 77);
  audio.seeked();
  audio.canPlay();
  assert.equal(controller.getCurrentTime(), 77);
  assert.equal(audio.loads, 1);
  controller.dispose();
});

test('a decoder omitting seeked still updates the actual clock and allows pause', () => {
  const { audio, controller, playing } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  audio.canPlay();
  controller.seek(77);
  audio.currentTime = 77.3;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(controller.getCurrentTime(), 77.3);
  audio.currentTime = 78;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(controller.getCurrentTime(), 78);
  controller.setPlaying(false);
  assert.deepEqual(playing, [false]);
  controller.dispose();
});

test('a streaming seek silently clamped to zero recovers using a complete audio file', { timeout: 2000 }, async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requests.push(url);
    return new Response(new Blob(['audio data'], { type: 'audio/mp4' }));
  });
  const revoked: string[] = [];
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const { audio, controller, errors } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  audio.canPlay();
  controller.seek(77);
  const loaded = new Promise(resolve => audio.addEventListener('loadstart', resolve, { once: true }));
  audio.currentTime = 0;
  audio.seeked();
  audio.canPlay();
  await loaded;
  assert.equal(requests.length, 1);
  assert.ok(audio.src.startsWith('blob:'));
  const localSource = audio.src;
  audio.metadata();
  audio.seeked();
  audio.canPlay();
  assert.equal(audio.currentTime, 77);
  audio.currentTime = 78;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(controller.getCurrentTime(), 78);
  assert.deepEqual(errors, []);
  controller.setSource(requests[0]);
  assert.equal(audio.src, localSource);
  controller.dispose();
  assert.deepEqual(revoked, [localSource]);
});

for (const route of ['local_files', 'files']) {
  test(`a downloaded MP3 without a seekable range recovers from /${route}`, { timeout: 2000 }, async t => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      requests.push(url);
      return new Response(new Blob(['downloaded MP3'], { type: 'audio/mpeg' }));
    });
    const { audio, controller, errors } = setup();
    const source = `http://127.0.0.1:8000/${route}/aSWBaZi7UYc.mp3`;
    controller.setSource(source);
    controller.setPlaying(true);
    audio.canPlay();
    audio.seekableRanges = [[0, 3]];
    const loaded = new Promise(resolve => audio.addEventListener('loadstart', resolve, { once: true }));
    controller.seek(77);
    await loaded;
    assert.deepEqual(requests, [source]);
    assert.ok(audio.src.startsWith('blob:'));
    audio.seekableRanges = [[0, 180]];
    audio.metadata();
    audio.seeked();
    audio.canPlay();
    audio.currentTime = 78;
    audio.dispatchEvent(new Event('timeupdate'));
    assert.equal(controller.getCurrentTime(), 78);
    assert.deepEqual(errors, []);
    controller.dispose();
  });
}

test('pausing and choosing another destination during file recovery keeps both decisions', { timeout: 2000 }, async t => {
  let finish!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
  const { audio, controller, errors } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  controller.setPlaying(true);
  audio.canPlay();
  controller.seek(77);
  const loaded = new Promise(resolve => audio.addEventListener('loadstart', resolve, { once: true }));
  audio.currentTime = 0;
  audio.seeked();
  controller.setPlaying(false);
  controller.seek(90);
  finish(new Response(new Blob(['audio'], { type: 'audio/mp4' })));
  await loaded;
  assert.ok(audio.src.startsWith('blob:'));
  audio.metadata();
  audio.seeked();
  audio.canPlay();
  assert.equal(audio.currentTime, 90);
  assert.equal(audio.paused, true);
  assert.equal(audio.plays, 1);
  assert.deepEqual(errors, []);
  controller.dispose();
});

test('switching tracks cancels file recovery and discards a late response', async t => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => {
    signal = options.signal!;
    return new Promise<Response>(resolve => { finish = resolve; });
  });
  const { audio, controller, errors } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=old');
  audio.canPlay();
  controller.seek(77);
  audio.currentTime = 0;
  audio.seeked();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=new');
  assert.equal(signal?.aborted, true);
  finish(new Response(new Blob(['old audio'], { type: 'audio/mp4' })));
  await new Promise(resolve => setImmediate(resolve));
  audio.metadata();
  audio.canPlay();
  assert.ok(audio.src.endsWith('id=new'));
  assert.equal(audio.currentTime, 0);
  assert.deepEqual(errors, []);
  controller.dispose();
});

test('a failed file recovery stops playback and releases the frozen requested timestamp', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const { audio, controller, errors, playing } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  audio.canPlay();
  controller.seek(77);
  audio.currentTime = 0;
  audio.seeked();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(playing.at(-1), false);
  assert.equal(controller.getCurrentTime(), 0);
  controller.dispose();
});

test('a seek stuck without seeked or clock progress recovers instead of freezing forever', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(new Blob(['audio'], { type: 'audio/mp4' }));
  });
  const { audio, controller, errors } = setup();
  controller.setSource('http://127.0.0.1:8000/proxy_stream?id=video');
  audio.canPlay();
  controller.seek(77);
  audio.seeking = true;
  const loaded = new Promise(resolve => audio.addEventListener('loadstart', resolve, { once: true }));
  t.mock.timers.tick(5000);
  await loaded;
  assert.equal(requests, 1);
  assert.ok(audio.src.startsWith('blob:'));
  audio.metadata();
  audio.seeked();
  audio.canPlay();
  audio.currentTime = 78;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(controller.getCurrentTime(), 78);
  assert.deepEqual(errors, []);
  controller.dispose();
});
