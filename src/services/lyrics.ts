import type { Track } from '../types';

export type LyricsProvider = 'lrclib' | 'lyricsplus';
export type LyricsHighlight = 'word' | 'letter' | 'syllable';
export interface LyricWord {
  time: number;
  endTime: number;
  text: string;
}
export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}
export interface LyricsResult {
  lines: LyricLine[] | null;
  plain: string | null;
  provider?: LyricsProvider;
}

export function getLyricWordProgress(word: LyricWord, currentTime: number, nextWordTime?: number, nextLineTime?: number): number {
  if (!Number.isFinite(currentTime) || currentTime < word.time) return 0;
  const isAfterStart = (time: number | undefined): time is number => Number.isFinite(time) && time! > word.time;
  // Inside a line, share the time until the next word between this word's letters.
  // End the last word at its own duration so instrumental gaps don't stretch it.
  const longRest = isAfterStart(nextWordTime) && isAfterStart(word.endTime) && nextWordTime - word.endTime > 7;
  const endTime = isAfterStart(nextWordTime) && !longRest ? nextWordTime
    : Math.min(...[word.endTime, nextLineTime].filter(isAfterStart));
  if (!Number.isFinite(endTime)) return 1;
  return Math.min(1, Math.max(0, (currentTime - word.time) / (endTime - word.time)));
}

const letterSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export function splitLyricLetters(text: string): string[] {
  // Keep combining marks and joined emoji together as one visible character.
  return letterSegmenter ? Array.from(letterSegmenter.segment(text), part => part.segment) : Array.from(text);
}

export function splitLyricSyllables(text: string): string[] {
  return (text.match(/\s+|\S+/gu) || []).flatMap(token => {
    if (/^\s+$/u.test(token)) return [token];
    const letters = splitLyricLetters(token);
    const vowels: { start: number; end: number }[] = [];
    for (let index = 0; index < letters.length; index++) {
      const letter = letters[index].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const cyrillic = /^[аеёиоуыэюяәөұүііїє]$/iu.test(letters[index]);
      const latin = /^[aeiou]$/u.test(letter) || (letter === 'y' && index > 0);
      if (!cyrillic && !latin) continue;
      const previous = vowels[vowels.length - 1];
      // Adjacent Latin vowels form one estimated nucleus; Cyrillic vowels stay separate.
      if (latin && previous?.end === index - 1) previous.end = index;
      else vowels.push({ start: index, end: index });
    }
    const clean = token.replace(/[^a-z]/gi, '').toLowerCase();
    if (/^[a-z\W]+$/i.test(token) && clean.endsWith('e') && !clean.endsWith('le') && vowels.length > 1) vowels.pop();
    if (vowels.length < 2) return [token];
    const syllables: string[] = [];
    let start = 0;
    for (let index = 1; index < vowels.length; index++) {
      const previous = vowels[index - 1];
      const next = vowels[index];
      const consonants = next.start - previous.end - 1;
      let boundary = previous.end + 1 + Math.floor(consonants / 2);
      while (/^[ьъ]$/iu.test(letters[boundary])) boundary++;
      syllables.push(letters.slice(start, boundary).join(''));
      start = boundary;
    }
    syllables.push(letters.slice(start).join(''));
    return syllables;
  });
}

const cache = new Map<string, LyricsResult>();
const lyricsPlusServers = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.prjktla.workers.dev',
];

export function parseLrc(lrc: string): LyricLine[] {
  const result: LyricLine[] = [];
  const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  for (const line of lrc.split('\n')) {
    const stamps = [...line.matchAll(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of stamps) {
      // Keep empty timed lines: they end the preceding line during instrumental gaps.
      result.push({ time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`) + offset), text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

export function parseLyricsPlus(data: any): LyricsResult | null {
  // V2 schema: https://github.com/ibratabian17/LyricsPlus/blob/gelato/internal/api/openapi/openapi.yaml
  if (!Array.isArray(data?.lyrics) || !data.lyrics.length) return null;
  const timed = String(data.type).toLowerCase() !== 'none';
  const lines: LyricLine[] = data.lyrics.flatMap((line: any) => {
    if (typeof line?.text !== 'string' || (timed && !Number.isFinite(line.time))) return [];
    const words: LyricWord[] = timed && Array.isArray(line.syllabus)
      ? line.syllabus.filter((word: any) => typeof word?.text === 'string' && Number.isFinite(word.time))
        .map((word: any) => ({
          time: word.time / 1000,
          endTime: (word.time + Math.max(0, Number(word.duration) || 0)) / 1000,
          text: word.text,
        }))
      : [];
    return [{ time: timed ? line.time / 1000 : 0, text: line.text, ...(words.length ? { words } : {}) }];
  });
  if (!lines.some(line => line.text.trim())) return null;
  if (timed) lines.sort((a, b) => a.time - b.time);
  return { lines: timed ? lines : null, plain: lines.map(line => line.text).join('\n') };
}

async function requestJson(url: URL, signal?: AbortSignal): Promise<any | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Lyrics HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function artistVariants(artist: string): string[] {
  const clean = artist === 'Unknown Artist' || artist === 'YouTube' ? '' : artist.trim();
  return [...new Set([clean, clean.split(/,|\s+feat\.?\s+|\s+&\s+/i)[0].trim()])];
}

async function fetchLrclib(title: string, artist: string, durationMs?: number, signal?: AbortSignal): Promise<LyricsResult | null> {
  // Search returns an empty list for missing lyrics instead of an expected HTTP 404.
  for (const name of artistVariants(artist)) {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', title);
    if (name) url.searchParams.set('artist_name', name);
    const data = await requestJson(url, signal);
    if (!Array.isArray(data)) continue;
    const candidates = data.filter(item => item.syncedLyrics || item.plainLyrics);
    const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const score = (item: any) =>
      (normalize(item.trackName || '') === normalize(title) ? 100 : 0) +
      (name && normalize(item.artistName || '').includes(normalize(name)) ? 40 : 0) +
      (item.syncedLyrics ? 5 : 0) -
      (durationMs && Number.isFinite(item.duration) ? Math.abs(item.duration - durationMs / 1000) : 0);
    candidates.sort((a, b) => score(b) - score(a));
    if (candidates[0]) {
      const best = candidates[0];
      const lines = best.syncedLyrics ? parseLrc(best.syncedLyrics) : [];
      return { lines: lines.length ? lines : null, plain: best.plainLyrics || lines.map(line => line.text).join('\n') || null };
    }
  }
  return null;
}

async function fetchLyricsPlus(track: Pick<Track, 'title' | 'artist' | 'durationMs'>, signal?: AbortSignal): Promise<LyricsResult | null> {
  if (!artistVariants(track.artist)[0]) return null;
  let result: LyricsResult | null = null;
  let lastError: unknown;
  let receivedResponse = false;
  for (const artist of artistVariants(track.artist)) {
    for (const server of lyricsPlusServers) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = new URL('/v2/lyrics/get', server);
      url.searchParams.set('title', track.title);
      url.searchParams.set('artist', artist);
      if (track.durationMs) url.searchParams.set('duration', String(track.durationMs / 1000));
      try {
        result = parseLyricsPlus(await requestJson(url, signal));
        receivedResponse = true;
        // A healthy mirror's "not found" is authoritative for this artist.
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    if (result) break;
  }
  if (!result && !receivedResponse && lastError) throw lastError;
  return result;
}

export async function fetchLyrics(
  track: Pick<Track, 'title' | 'artist' | 'durationMs'>,
  provider: LyricsProvider,
  signal?: AbortSignal,
): Promise<LyricsResult | null> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!track.title.trim()) return null;
  // Cache fallback results for this track and preference, without changing other tracks.
  const key = JSON.stringify([provider, track.title, track.artist, track.durationMs]);
  if (cache.has(key)) return cache.get(key)!;
  let result: LyricsResult | null = null;
  let resultProvider: LyricsProvider = provider;
  if (provider === 'lyricsplus') {
    try {
      result = await fetchLyricsPlus(track, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      // A provider outage also allows the track to try LRCLIB.
    }
    // LyricsPlus sometimes returns an incomplete response with just one real line.
    const nonemptyLines = result?.plain?.split(/\r?\n/).filter(line => line.trim()).length || 0;
    if (nonemptyLines < 2) result = null;
  }
  if (!result) {
    resultProvider = 'lrclib';
    result = await fetchLrclib(track.title, track.artist, track.durationMs, signal);
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (result) {
    result = { ...result, provider: resultProvider };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
  }
  return result;
}
