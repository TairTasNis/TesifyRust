export type LyricWord = { text: string; start: number; end: number }
export type LyricLine = { text: string; start: number; end: number; endInferred?: boolean; words: LyricWord[] }
export type Lyrics = { source: string; sourceUrl: string; sync: 'word' | 'line' | 'none'; lines: LyricLine[] }
export type LyricsResponse = { status: 'found' | 'not_found' | 'unavailable' | 'instrumental'; lyrics: Lyrics | null; custom?: boolean }

export type LyricsCandidate = {
  id: string
  title: string
  artist: string
  album?: string | null
  durationMs?: number | null
  source: string
  sync: 'word' | 'line' | 'none' | 'auto'
  preview?: string | null
}

export type CustomLyricsFont = {
  id: string
  name: string
  format: string
  dataBase64: string
}
