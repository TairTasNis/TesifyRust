type MediaClock = Pick<HTMLMediaElement, 'currentTime' | 'duration' | 'playbackRate' | 'seeking'>
type Span = { start: number; end: number }

export class ListeningTracker {
  private anchor: { position: number; time: number } | null = null
  private spans: Span[] = []
  private listenedToTrack = false
  private emit: (endedAt: number, milliseconds: number, finishedTrack: boolean) => void

  constructor(emit: ListeningTracker['emit']) {
    this.emit = emit
  }

  reset() {
    this.anchor = null
    this.spans = []
    this.listenedToTrack = false
  }

  resume(media: MediaClock, now = Date.now()) {
    if (!this.anchor && !media.seeking) this.anchor = { position: media.currentTime, time: now }
  }

  stop(media?: MediaClock) {
    if (media) this.sample(media)
    this.anchor = null
  }

  sample(media: MediaClock, now = Date.now()) {
    if (media.seeking) {
      this.anchor = null
      return
    }
    const previous = this.anchor
    if (!previous) return
    const position = media.currentTime
    this.anchor = { position, time: now }
    const advanced = position - previous.position
    const listeningMs = advanced * 1000 / media.playbackRate
    // Some WebViews report a timeupdate before seeking. Reject jumps that
    // could not have been played since the last media-clock sample.
    if (!Number.isFinite(listeningMs) || listeningMs <= 0 || listeningMs > now - previous.time + 150) return

    let finished = false
    if (!this.listenedToTrack) {
      const start = previous.position
      const last = this.spans.at(-1)
      if (last && start >= last.start && start <= last.end) last.end = Math.max(last.end, position)
      else this.spans.push({ start, end: position })
      if (Number.isFinite(media.duration) && media.duration > 0 && this.coveredTime() > .8 * media.duration) {
        this.listenedToTrack = finished = true
      }
    }
    this.emit(now, listeningMs, finished)
  }

  private coveredTime() {
    let covered = 0
    let end = 0
    for (const span of [...this.spans].sort((a, b) => a.start - b.start)) {
      covered += Math.max(0, span.end - Math.max(span.start, end))
      end = Math.max(end, span.end)
    }
    return covered
  }
}
