import type { LyricLine } from './lyrics';

interface VocalEvent {
  lineIndex: number;
  start: number;
  end: number | null;
}
export interface LyricTimeline {
  vocals: VocalEvent[];
  rests: number[];
}
export interface LyricCountdownState {
  afterIndex: number;
  remaining: number;
  target: 'lyrics' | 'end';
}

export function getLyricSeekTime(line: LyricLine): number {
  const wordStarts = line.words?.filter(word => word.text.trim() && Number.isFinite(word.time) && word.time >= 0).map(word => word.time);
  return wordStarts?.length ? Math.min(...wordStarts) : line.time;
}

export function getNextLyricWordTimes(lines: LyricLine[]): (number | undefined)[][] {
  const result: (number | undefined)[][] = lines.map(line => (line.words || []).map(() => undefined));
  const words = lines.flatMap((line, lineIndex) => (line.words || []).flatMap((word, wordIndex) =>
    word.text.trim() && Number.isFinite(word.time) && word.time >= 0 ? [{ time: word.time, lineIndex, wordIndex }] : []
  )).sort((a, b) => a.time - b.time);
  let nextTime: number | undefined;
  for (let index = words.length - 1; index >= 0; index--) {
    const word = words[index];
    const next = words[index + 1];
    if (next && next.time > word.time) nextTime = next.time;
    result[word.lineIndex][word.wordIndex] = nextTime;
  }
  return result;
}

export function buildLyricTimeline(lines: LyricLine[]): LyricTimeline {
  const vocals: VocalEvent[] = [];
  const rests: number[] = [];
  lines.forEach((line, lineIndex) => {
    if (!line.text.trim()) { rests.push(line.time); return; }
    const words = line.words?.filter(word => word.text.trim() && Number.isFinite(word.time));
    if (words?.length) {
      words.forEach(word => vocals.push({
        lineIndex, start: word.time,
        end: Number.isFinite(word.endTime) && word.endTime > word.time ? word.endTime : null,
      }));
    } else {
      // A line timestamp alone doesn't tell us when singing stops.
      vocals.push({ lineIndex, start: line.time, end: null });
    }
  });
  return { vocals: vocals.sort((a, b) => a.start - b.start), rests: rests.sort((a, b) => a - b) };
}

export function getLyricPlaybackState(timeline: LyricTimeline, currentTime: number, trackDuration?: number) {
  let currentEvent = -1;
  let coveredUntil = 0;
  for (let index = 0; index < timeline.vocals.length; index++) {
    const event = timeline.vocals[index];
    if (event.start > currentTime) break;
    currentEvent = index;
    coveredUntil = Math.max(coveredUntil, event.end ?? event.start);
  }
  const current = timeline.vocals[currentEvent];
  const next = timeline.vocals[currentEvent + 1];
  const lastStartedIndex = current?.lineIndex ?? -1;
  let countdown: LyricCountdownState | null = null;
  if (!current && next && next.start > currentTime) {
    countdown = { afterIndex: -1, remaining: next.start - currentTime, target: 'lyrics' };
  } else if (current) {
    const nextStart = next?.start ?? (Number.isFinite(trackDuration) ? trackDuration! : null);
    const explicitRest = timeline.rests.find(time => time > current.start && (nextStart === null || time < nextStart));
    const vocalEnd = explicitRest !== undefined
      ? (current.end === null ? explicitRest : Math.min(coveredUntil, explicitRest))
      : (current.end !== null ? coveredUntil : null);
    // Keep the countdown through its final seconds: the whole gap, not the remaining time, must exceed seven seconds.
    if (vocalEnd !== null && nextStart !== null && nextStart - vocalEnd > 7 && currentTime >= vocalEnd && currentTime < nextStart) {
      countdown = { afterIndex: current.lineIndex, remaining: nextStart - currentTime, target: next ? 'lyrics' : 'end' };
    }
  }
  return { activeIndex: countdown ? -1 : lastStartedIndex, lastStartedIndex, countdown };
}
