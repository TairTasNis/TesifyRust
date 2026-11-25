import type { LyricLine } from './types'

export function activeLineAt(lines: readonly { start: number }[], time: number) {
  let low = 0, high = lines.length - 1, active = -1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (lines[mid].start <= time) { active = mid; low = mid + 1 }
    else high = mid - 1
  }
  return active
}

type LyricCue = LyricLine | { countdown: true; start: number; end: number }

export function lyricCues(lines: LyricLine[], timed: boolean, offset: number): LyricCue[] {
  if (!timed) return lines
  const cues: LyricCue[] = []
  let sungUntil = -offset
  lines.forEach((line, index) => {
    if (line.start - sungUntil > 5) {
      cues.push({ countdown: true, start: sungUntil, end: line.start })
    }
    cues.push(line)
    // Reserve four seconds for a start-only phrase before estimating the instrumental gap.
    const nextStart = lines[index + 1]?.start ?? line.end
    const end = line.endInferred ? Math.min(nextStart, line.start + 4) : line.end
    // Retain the end of any overlapping vocal line when looking for silence.
    sungUntil = Math.max(sungUntil, line.words.at(-1)?.end ?? end)
  })
  return cues
}

export function wordProgress(time: number, start: number, end: number) {
  return Math.max(0, Math.min(1, (time - start) / Math.max(.001, end - start)))
}

export function shouldAnimateLyricJump(firstPosition: boolean, isCountdown: boolean, canAnimateNow: boolean) {
  return !firstPosition && !isCountdown && canAnimateNow
}

export function rowStaggerDelay(index: number, lead: number, direction: 1 | -1) {
  const distance = direction >= 0 ? Math.max(0, index - lead) : Math.max(0, lead - index)
  return Math.min(5, distance) * 45
}
