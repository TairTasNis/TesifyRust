import { memo, useMemo } from 'react';
import { splitLyricLetters, splitLyricSyllables, type LyricWord, type LyricsHighlight } from '../services/lyrics';

interface Props {
  word: LyricWord;
  highlight: LyricsHighlight;
  progress: number;
  appearanceFraction?: number;
}

export default memo(function TimedLyricWord({ word, highlight, progress, appearanceFraction }: Props) {
  const letters = useMemo(() => highlight === 'syllable' ? splitLyricSyllables(word.text) : splitLyricLetters(word.text), [word.text, highlight]);
  const letterCount = letters.filter(letter => !/^\s+$/u.test(letter)).length;
  const fraction = Number.isFinite(appearanceFraction) ? Math.min(1, Math.max(0.1, appearanceFraction!)) : 1;
  // Derive opacity from the audio clock so pausing, seeking, and changing the slider take effect immediately.
  const revealProgress = (index: number, count: number) => Math.min(1, Math.max(0, (progress * count - index) / fraction));
  if (highlight === 'word') {
    if (appearanceFraction !== undefined) {
      return <span className="lyric-word lyric-word-progress" style={{ opacity: 0.4 + 0.6 * revealProgress(0, 1) }}>{word.text}</span>;
    }
    return <span className={`lyric-word ${progress === 1 ? 'lyric-word-sung' : 'lyric-word-pending'}`}>{word.text}</span>;
  }
  let letterIndex = 0;
  return (
    <span className="lyric-word lyric-word-letters">
      {letters.map((letter, index) => {
        // Spaces remain intact but don't consume a letter's share of singing time.
        if (/^\s+$/u.test(letter)) return letter;
        const letterProgress = revealProgress(letterIndex++, letterCount);
        return <span key={index} style={{ opacity: 0.4 + 0.6 * letterProgress }}>{letter}</span>;
      })}
    </span>
  );
});
