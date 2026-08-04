import React from 'react';
import { Play, Plus, Check, Music, User as UserIcon } from 'lucide-react';
import type { SearchResultItem, Playlist, Track } from '../types';

interface Props {
  results: SearchResultItem[];
  query: string;
  playlists: Playlist[];
  trackMenuOpenId: string | null;
  setTrackMenuOpenId: (id: string | null) => void;
  hideCovers: boolean;
  hideArtist: boolean;
  onOpenTrack: (item: SearchResultItem) => void;
  onOpenCollection: (item: SearchResultItem) => void;
  onToggleAdd: (item: SearchResultItem, playlistId: string) => void;
  isSameTrack: (a: Track, b: Track) => boolean;
}

type AnyResult = SearchResultItem | undefined;

const normalize = (s: string) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

// Оценка совпадения строки с запросом: 0..100
const matchScore = (name: string, query: string) => {
  const n = normalize(name);
  const q = normalize(query);
  if (!n || !q) return 0;
  if (n === q) return 100;
  if (q.endsWith(n) || n.endsWith(q)) return 92;
  if (n.includes(q)) return 88;
  if (q.includes(n)) return 70;
  let overlap = 0;
  const qWords = q.split(' ');
  for (const w of qWords) {
    if (n.split(' ').some(nw => nw === w || nw.startsWith(w) || w.startsWith(nw))) overlap++;
  }
  return (overlap / qWords.length) * 60;
};

const SpotifySearchResults: React.FC<Props> = ({
  results,
  query,
  playlists,
  trackMenuOpenId,
  setTrackMenuOpenId,
  hideCovers,
  hideArtist,
  onOpenTrack,
  onOpenCollection,
  onToggleAdd,
  isSameTrack,
}) => {
  // Лучший результат работает как "весы": сравниваем, к чему запрос ближе —
  // к имени исполнителя или к названию песни. Убрав имя артиста из запроса,
  // оставшийся "хвост" сигналит про песню.
  const artistCandidates = results.filter(i => i.type === 'artist');
  const trackCandidates = results.filter(i => i.type === 'track');

  const bestArtist = artistCandidates.length
    ? artistCandidates.reduce((a, b) => (matchScore(b.name, query) > matchScore(a.name, query) ? b : a))
    : undefined;
  const bestTrack = trackCandidates.length
    ? trackCandidates.reduce((a, b) => (matchScore(b.title, query) > matchScore(a.title, query) ? b : a))
    : undefined;

  const artistScore = bestArtist ? matchScore(bestArtist.name, query) : 0;

  // Остаток запроса после вычёркивания токенов имени исполнителя
  let leftover = normalize(query);
  if (bestArtist) {
    const anWords = normalize(bestArtist.name).split(' ').filter(Boolean);
    leftover = leftover.split(' ').filter(Boolean).filter(w => !anWords.includes(w)).join(' ');
  }
  const trackScore = bestTrack ? matchScore(bestTrack.title, leftover) : 0;

  const featured: AnyResult =
    (bestTrack && trackScore >= 60)
      ? bestTrack
      : (bestArtist && artistScore >= 60)
        ? bestArtist
        : (bestTrack || bestArtist);

  const featuredId = featured?.id;
  const allTracks = results.filter(i => i.type === 'track');
  const sideTracks = allTracks.filter(t => t.id !== featuredId).slice(0, 4);
  const otherTracks = allTracks.filter(t => t.id !== featuredId).slice(4);
  const albums = results.filter(i => i.type === 'album');
  const artists = results.filter(i => i.type === 'artist' && (!featured || featured.type !== 'artist' || i.id !== featured.id));
  const spotifyPlaylists = results.filter(i => i.type === 'playlist');

  const renderTrackAddButton = (item: SearchResultItem) => {
    const isSavedGlobally = playlists.some(p => p.tracks.some(t => isSameTrack(t, item)));
    return (
      <div className="relative shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setTrackMenuOpenId(trackMenuOpenId === item.id ? null : item.id); }}
          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-colors"
          title="Добавить в плейлист"
        >
          {isSavedGlobally ? <Check size={16} className="text-green-500" /> : <Plus size={16} />}
        </button>
        {trackMenuOpenId === item.id && (
          <div className="absolute right-0 mt-2 w-48 bg-zinc-800 rounded-md shadow-2xl py-1 z-50 border border-white/10">
            <div className="px-3 py-2 text-xs font-semibold text-zinc-400 border-b border-white/10">Где сохранено:</div>
            {playlists.map(pl => {
              const isSavedInPl = pl.tracks.some(t => isSameTrack(t, item));
              return (
                <button
                  key={pl.id}
                  onClick={(e) => { e.stopPropagation(); onToggleAdd(item, pl.id); }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-700 transition-colors flex items-center justify-between"
                >
                  <span className="truncate">{pl.title}</span>
                  {isSavedInPl && <Check size={14} className="text-green-500 shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTrackRow = (item: SearchResultItem) => {
    const title = item.type === 'track' ? item.title : '';
    const subtitle = item.type === 'track' ? item.artist : '';
    const imageUrl = item.type === 'track' ? item.thumbnail : undefined;
    return (
      <div
        key={item.id}
        onClick={() => onOpenTrack(item)}
        className="flex items-center gap-3 p-2 rounded-md hover:bg-white/10 cursor-pointer group"
      >
        {!hideCovers && (
          imageUrl ? (
            <img src={imageUrl} alt={title} className="w-10 h-10 rounded object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 bg-zinc-800 rounded flex items-center justify-center shrink-0">
              <Music size={18} className="text-zinc-400" />
            </div>
          )
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{title}</div>
          {!hideArtist && (
            <div className="text-xs text-zinc-400 truncate">{subtitle}</div>
          )}
        </div>
        {item.type === 'track' && item.durationMs && (
          <div className="text-xs text-zinc-400 shrink-0">
            {Math.floor(item.durationMs / 60000)}:{Math.floor((item.durationMs % 60000) / 1000).toString().padStart(2, '0')}
          </div>
        )}
        {item.type === 'track' && renderTrackAddButton(item)}
      </div>
    );
  };

  const renderFeatured = (item: SearchResultItem) => {
    const isTrack = item.type === 'track';
    const title = isTrack ? item.title : item.type === 'artist' ? item.name : '';
    const subtitle = isTrack ? item.artist : 'Исполнитель';
    const imageUrl = isTrack ? item.thumbnail : item.type === 'artist' ? item.imageUrl : undefined;
    return (
      <div
        onClick={() => isTrack && onOpenTrack(item)}
        className={`relative rounded-lg overflow-hidden p-4 pb-16 bg-gradient-to-br ${isTrack ? 'from-fuchsia-700/60 via-purple-700/50 to-blue-700/60' : 'from-indigo-700/50 via-teal-700/50 to-emerald-700/50'} ${isTrack ? 'cursor-pointer' : 'cursor-default'} shadow-xl`}
      >
        <div className={`w-28 h-28 sm:w-36 sm:h-36 rounded-lg shadow-2xl overflow-hidden bg-zinc-800 flex items-center justify-center mb-4`}>
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            isTrack ? <Music size={44} className="text-zinc-400" /> : <UserIcon size={44} className="text-zinc-400" />
          )}
        </div>
        <p className="text-[10px] uppercase tracking-wide text-zinc-300 mb-1">{isTrack ? 'Трек' : 'Исполнитель'}</p>
        <h2 className="text-2xl sm:text-3xl font-bold mb-1 truncate">{title}</h2>
        <p className="text-sm text-zinc-300 truncate">{subtitle}</p>
        {isTrack && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenTrack(item); }}
            className="absolute bottom-4 right-4 w-12 h-12 rounded-full bg-green-500 text-black flex items-center justify-center shadow-xl hover:scale-105 transition-transform"
          >
            <Play size={22} fill="black" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {(featured || sideTracks.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_1.2fr] gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-2">Лучший результат</p>
            {featured ? renderFeatured(featured) : (
              <div className="rounded-lg bg-zinc-900 aspect-square flex items-center justify-center text-zinc-500">
                Нет лучшего результата
              </div>
            )}
          </div>
          {sideTracks.length > 0 && (
            <div>
              <p className="text-2xl font-bold mb-2">Песни</p>
              <div className="space-y-1">
                {sideTracks.map(t => renderTrackRow(t))}
              </div>
            </div>
          )}
        </div>
      )}

      {albums.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Альбомы</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
            {albums.map(album => (
              <div key={album.id} onClick={() => onOpenCollection(album)} className="group p-2 rounded-md hover:bg-zinc-800/80 cursor-pointer transition-colors">
                <div className="aspect-square w-full rounded overflow-hidden mb-2 bg-zinc-700 flex items-center justify-center shadow">
                  {album.imageUrl ? <img src={album.imageUrl} alt={album.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" /> : <Music size={24} className="text-zinc-500" />}
                </div>
                <h3 className="font-semibold text-xs sm:text-sm truncate">{album.name}</h3>
                <p className="text-[11px] text-zinc-400 truncate">Альбом • {album.artist}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {otherTracks.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Треки</h2>
          <div className="space-y-1">
            {otherTracks.map(t => renderTrackRow(t))}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Исполнители</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {artists.map(artist => (
              <div key={artist.id} className="flex flex-col items-center gap-2 p-4 rounded-md cursor-default hover:bg-white/10 transition-colors">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center">
                  {artist.imageUrl ? <img src={artist.imageUrl} alt={artist.name} className="w-full h-full object-cover" /> : <UserIcon size={32} className="text-zinc-400" />}
                </div>
                <h3 className="font-bold text-sm truncate">{artist.name}</h3>
                <p className="text-xs text-zinc-400">Исполнитель</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {spotifyPlaylists.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Плейлисты</h2>
          <div className="space-y-2">
            {spotifyPlaylists.map(pl => (
              <div key={pl.id} onClick={() => onOpenCollection(pl)} className="flex items-center gap-3 p-2 rounded-md hover:bg-white/10 cursor-pointer">
                <div className="w-12 h-12 rounded bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                  {pl.imageUrl ? <img src={pl.imageUrl} alt={pl.name} className="w-full h-full object-cover" /> : <Music size={20} className="text-zinc-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{pl.name}</div>
                  <div className="text-xs text-zinc-400 truncate">Плейлист {pl.owner ? `• ${pl.owner}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default SpotifySearchResults;