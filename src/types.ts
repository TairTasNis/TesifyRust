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
  isCollaborative?: boolean;
  ownerId?: string;
  collaborators?: string[];
  spotifySyncUrl?: string;
  isSpotifySyncEnabled?: boolean;
}

export type SearchSource = 'youtube' | 'spotify';

export type SearchResultItem =
  | (Track & {
      type: 'track';
      source: SearchSource;
      spotifyUrl?: string;
      isTopResult?: boolean;
    })
  | {
      type: 'artist';
      source: 'spotify';
      id: string;
      spotifyId: string;
      name: string;
      url: string;
      imageUrl?: string;
      isTopResult?: boolean;
    }
  | {
      type: 'album';
      source: 'spotify';
      id: string;
      spotifyId: string;
      name: string;
      artist: string;
      url: string;
      imageUrl?: string;
      isTopResult?: boolean;
    }
  | {
      type: 'playlist';
      source: 'spotify';
      id: string;
      spotifyId: string;
      name: string;
      owner: string;
      url: string;
      imageUrl?: string;
      isTopResult?: boolean;
    };

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