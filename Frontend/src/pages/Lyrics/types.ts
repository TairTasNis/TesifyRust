export type LyricWord = { text: string; start: number; end: number }
export type LyricLine = { text: string; start: number; end: number; endInferred?: boolean; words: LyricWord[] }
export type Lyrics = { source: string; sourceUrl: string; sync: 'word' | 'line' | 'none'; lines: LyricLine[] }
export type LyricsResponse = { status: 'found' | 'not_found' | 'unavailable' | 'instrumental'; lyrics: Lyrics | null }
