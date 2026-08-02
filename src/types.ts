export interface Track {
  id: string;
  title: string;
  artist: string;
  file?: File;
  url: string;
  youtubeId?: string;
  thumbnail?: string;
  spotifyId?: string;
  durationMs?: number;
  addedAt?: number;
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
  isSystem?: boolean; // True for "Избранное"
}

export interface DailyStat {
  tracks: number;
  timeMs: number;
  visits: number;
}
export type UserStats = Record<string, DailyStat>;

export type Tab = 'home' | 'search' | 'library' | 'settings' | 'track' | 'comments';

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}
