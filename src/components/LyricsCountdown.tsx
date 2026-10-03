import type { Ref } from 'react';
import type { LyricCountdownState } from '../services/lyricsTiming';

export default function LyricsCountdown({ countdown, containerRef, textAlign = 'center' }: { countdown: LyricCountdownState; containerRef?: Ref<HTMLDivElement>; textAlign?: 'left' | 'center' | 'right' }) {
  const seconds = Math.max(0, Math.ceil(countdown.remaining));
  const timer = seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : String(seconds);
  return (
    <div ref={containerRef} className={`lyric-countdown text-4xl md:text-5xl font-bold text-green-500 scale-105 flex items-center gap-4 mb-8 ${textAlign === 'left' ? 'origin-left justify-start' : textAlign === 'right' ? 'origin-right justify-end' : 'origin-center justify-center'}`} role="timer" aria-live="off" aria-label={`${countdown.target === 'end' ? 'До конца трека' : 'До пения'}: ${timer}`}>
      <div className="flex gap-2" aria-hidden="true">
        {[0, 150, 300].map(delay => <div key={delay} className="w-3 h-3 bg-green-500 rounded-full motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />)}
      </div>
      <span className="font-mono tabular-nums w-20 text-left">{timer}</span>
    </div>
  );
}
