import React from 'react';
import { Play, Plus, Check, Music, User as UserIcon, ChevronRight, Loader2 } from 'lucide-react';
import type { SearchResultItem, Playlist, Track } from '../types';

interface Props {
  results: SearchResultItem[];
  query: string;
  playlists: Playlist[];
  trackMenuOpenId: string | null;
  setTrackMenuOpenId: (id: string | null) => void;
  hideCovers: boolean;
  hideArtist: boolean;
  onOpenTrack: (item: Extract<SearchResultItem, { type: 'track' }>) => void;
  onOpenCollection: (item: SearchResultItem) => void;
  onOpenAllTracks: (tracks: Track[]) => void;
  onToggleAdd: (item: Extract<SearchResultItem, { type: 'track' }>, playlistId: string) => void;
  openingSearchCollectionId: string | null;
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
  onOpenAllTracks,
  onToggleAdd,
  isSameTrack,
  openingSearchCollectionId,
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

  // Если название трека совпадает с именем исполнителя — приоритет у трека.
  const trackTitleMatchesArtist = !!(bestTrack && bestArtist && normalize(bestTrack.title) === normalize(bestArtist.name));

  const featured: AnyResult =
    trackTitleMatchesArtist
      ? bestTrack
      : (bestTrack && trackScore >= 60)
        ? bestTrack
        : (bestArtist && artistScore >= 60)
          ? bestArtist
          : (bestTrack || bestArtist);

  const featuredId = featured?.id;
  const allTracks = results.filter(i => i.type === 'track');
  const sideTracks = allTracks.filter(t => t.id !== featuredId).slice(0, 4);
  const albums = results.filter(i => i.type === 'album');
  const artists = results.filter((i): i is Extract<SearchResultItem, { type: 'artist' }> => i.type === 'artist' && (!featured || featured.type !== 'artist' || i.id !== featured.id));
  const spotifyPlaylists = results.filter(i => i.type === 'playlist');

  // Листание горизонтальных строк колёсиком мыши
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  const renderTrackAddButton = (item: Extract<SearchResultItem, { type: 'track' }>) => {
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

  const renderTrackRow = (item: Extract<SearchResultItem, { type: 'track' }>) => {
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
        className={`relative rounded-lg overflow-hidden p-4 sm:p-6 sm:pr-20 bg-gradient-to-br ${isTrack ? 'from-fuchsia-700/60 via-purple-700/50 to-blue-700/60' : 'from-indigo-700/50 via-teal-700/50 to-emerald-700/50'} ${isTrack ? 'cursor-pointer' : 'cursor-default'} shadow-xl`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className={`w-32 h-32 sm:w-40 sm:h-40 rounded-lg shadow-2xl overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0`}>
            {imageUrl ? (
              <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
            ) : (
              isTrack ? <Music size={44} className="text-zinc-400" /> : <UserIcon size={44} className="text-zinc-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-zinc-300 mb-1">{isTrack ? 'Трек' : 'Исполнитель'}</p>
            <h2 className="text-2xl sm:text-4xl font-bold mb-1 truncate">{title}</h2>
            <p className="text-sm text-zinc-300 truncate">{subtitle}</p>
          </div>
        </div>
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
      {(featured || allTracks.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {featured && (
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-2">Лучший результат</p>
              {renderFeatured(featured)}
            </div>
          )}
          {allTracks.length > 0 && (
            <div>
              <button
                onClick={() => onOpenAllTracks(allTracks)}
                className="flex items-center gap-2 mb-2 group"
                title="Показать все треки"
              >
                <p className="text-2xl font-bold group-hover:underline">Песни</p>
                <ChevronRight size={28} className="text-zinc-400 group-hover:text-white transition-colors shrink-0" />
              </button>
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
          <div className="flex gap-3 overflow-x-auto hs-scrollbar pb-1.5" onWheel={handleWheel}>
            {albums.map(album => (
              <div key={album.id} onClick={() => onOpenCollection(album)} className="group w-32 shrink-0 p-2 rounded-md hover:bg-zinc-800/80 cursor-pointer transition-colors">
                <div className="relative aspect-square w-full rounded-md overflow-hidden mb-2 bg-zinc-700 flex items-center justify-center shadow">
                  {album.imageUrl ? <img src={album.imageUrl} alt={album.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" /> : <Music size={20} className="text-zinc-500" />}
                  {openingSearchCollectionId === album.id && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 size={28} className="animate-spin text-white" />
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-xs sm:text-sm truncate text-center">{album.name}</h3>
                <p className="text-[11px] text-zinc-400 truncate text-center">Альбом • {album.artist}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Исполнители</h2>
          <div className="flex gap-3 overflow-x-auto hs-scrollbar pb-1.5" onWheel={handleWheel}>
            {artists.map(artist => (
              <div key={artist.id} className="flex flex-col items-center gap-2 p-3 rounded-md cursor-default hover:bg-white/10 transition-colors w-28 shrink-0">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center">
                  {artist.imageUrl ? <img src={artist.imageUrl} alt={artist.name} className="w-full h-full object-cover" /> : <UserIcon size={32} className="text-zinc-400" />}
                </div>
                <h3 className="font-bold text-sm truncate max-w-full">{artist.name}</h3>
                <p className="text-xs text-zinc-400">Исполнитель</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {spotifyPlaylists.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Плейлисты</h2>
          <div className="flex gap-3 overflow-x-auto hs-scrollbar pb-1.5" onWheel={handleWheel}>
            {spotifyPlaylists.map(pl => (
              <div key={pl.id} onClick={() => onOpenCollection(pl)} className="group w-32 shrink-0 p-2 rounded-md hover:bg-zinc-800/80 cursor-pointer transition-colors">
                <div className="relative aspect-square w-full rounded-md overflow-hidden mb-2 bg-zinc-700 flex items-center justify-center shadow">
                  {pl.imageUrl ? <img src={pl.imageUrl} alt={pl.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" /> : <Music size={20} className="text-zinc-500" />}
                  {openingSearchCollectionId === pl.id && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 size={28} className="animate-spin text-white" />
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-xs sm:text-sm truncate text-center">{pl.name}</h3>
                <p className="text-[11px] text-zinc-400 truncate text-center">Плейлист {pl.owner ? `• ${pl.owner}` : ''}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default SpotifySearchResults;
