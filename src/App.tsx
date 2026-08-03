/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Home, Search, Library as LibraryIcon, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Mic, Plus, Music, X, Loader2, Maximize2, Minimize2, Youtube, Menu, PenSquare, Trash2, ArrowLeft, Heart, Check, User as UserIcon, Clock, Settings as SettingsIcon, BarChart2, RefreshCw, MessageSquare, Edit2, Languages, Link as LinkIcon, Download, AlignLeft, AlignCenter, AlignRight, Radio } from 'lucide-react';
import { Track, Tab, Playlist, UserStats, Comment } from './types';
import { fetchSpotifyData } from './services/spotify';
import AuthScreen from './components/AuthScreen';
import { auth, db } from './services/firebase';
import { onAuthStateChanged, signOut, updatePassword, updateProfile, deleteUser, EmailAuthProvider, reauthenticateWithCredential, linkWithPopup, GoogleAuthProvider, type User } from 'firebase/auth';
import { ref, get, set, onValue, push, remove, update } from 'firebase/database';

interface LyricLine {
  time: number;
  text: string;
}

function parseLrc(lrc: string): LyricLine[] {
  const lines = lrc.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3], 10);
      const msMultiplier = match[3].length === 2 ? 10 : 1;
      const time = minutes * 60 + seconds + (milliseconds * msMultiplier) / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) {
        result.push({ time, text });
      }
    }
  }
  return result;
}

const uploadToImgBB = async (file: File): Promise<string | null> => {
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await fetch('https://api.imgbb.com/1/upload?key=e6a8cb02226b7273a70bceec0f3fbb16', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    return data.data.url;
  } catch (error) {
    console.error('Error uploading image to ImgBB:', error);
    return null;
  }
};

const APP_VERSION = "1.2.2";

const TrackPageView = ({ track, currentUser, context, onBack, onOpenComments, playlists, setPlaylists }: { track: Track, currentUser: User | null, context: string, onBack: () => void, onOpenComments: () => void, playlists: Playlist[], setPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>> }) => {
  const [likes, setLikes] = useState<number>(0);
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [translatedLyrics, setTranslatedLyrics] = useState<string | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState(true);
  const [isPlaylistMenuOpen, setIsPlaylistMenuOpen] = useState(false);
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslateMenuVisible, setIsTranslateMenuVisible] = useState(false);
  const [selectedTargetLang, setSelectedTargetLang] = useState('ru');
  const [selectedSourceLang, setSelectedSourceLang] = useState('auto');

  const TRANSLATION_LANGUAGES = [
    { code: 'ru', name: 'Русский' },
    { code: 'en', name: 'Английский' },
    { code: 'es', name: 'Испанский' },
    { code: 'fr', name: 'Французский' },
    { code: 'de', name: 'Немецкий' },
    { code: 'it', name: 'Итальянский' },
    { code: 'zh-CN', name: 'Китайский' },
    { code: 'ja', name: 'Японский' },
    { code: 'ko', name: 'Корейский' },
    { code: 'ar', name: 'Арабский' },
  ];

  const handleTranslateLyrics = async () => {
    if (!lyrics) return;
    setIsTranslating(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/translate?target=${selectedTargetLang}&source=${selectedSourceLang}&text=${encodeURIComponent(lyrics)}`);
      const data = await res.json();
      setTranslatedLyrics(data.translatedText);
      setIsTranslateMenuVisible(false);
    } catch (err) {
      console.error(err);
      alert('Ошибка при переводе текста. Проверьте запущен ли Python сервер.');
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const fetchLyrics = async () => {
      setLoadingLyrics(true);
      try {
        const res = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(track.title)}&artist_name=${encodeURIComponent(track.artist)}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setTranslatedLyrics(null);
            setLyrics(data.syncedLyrics || data.plainLyrics || null);
          }
        } else {
          if (isMounted) setLyrics(null);
        }
      } catch (err) {
        if (isMounted) setLyrics(null);
      } finally {
        if (isMounted) setLoadingLyrics(false);
      }
    };
    if (track.title && track.artist) {
      fetchLyrics();
    } else {
      setLoadingLyrics(false);
    }
    
    return () => { isMounted = false; };
  }, [track.title, track.artist]);

  useEffect(() => {
    if (!track.id) return;
    const likesRef = ref(db, `tracks/${track.id}/likes`);
    const commentsRef = ref(db, `tracks/${track.id}/comments`);

    const unlikes = onValue(likesRef, (snapshot) => {
      const data = snapshot.val() || {};
      setLikes(Object.keys(data).length);
      if (currentUser && data[currentUser.uid]) {
        setIsLiked(true);
      } else {
        setIsLiked(false);
      }
    });

    const uncomments = onValue(commentsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const loaded = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        ...val
      })).sort((a, b) => b.timestamp - a.timestamp);
      setComments(loaded);
    });

    return () => {
      unlikes();
      uncomments();
    };
  }, [track.id, currentUser]);

  const handleLike = () => {
    if (!currentUser || !track.id) return;
    const likeRef = ref(db, `tracks/${track.id}/likes/${currentUser.uid}`);
    if (isLiked) {
      remove(likeRef);
    } else {
      set(likeRef, true);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar pb-10 relative">
      <button 
        onClick={onBack} 
        className="absolute top-0 left-0 bg-black/50 hover:bg-black p-3 rounded-full text-white transition-colors z-50 mt-4 ml-4 md:mt-0 md:ml-0"
        title="Назад"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      
      <div className="flex flex-col md:flex-row gap-6 items-end mb-8 mt-16 md:mt-4">
          {track.thumbnail ? (
            <motion.img 
              layoutId={context ? `${context}-cover-${track.id}` : undefined} 
              src={track.thumbnail} 
              alt={track.title} 
              className="w-48 h-48 md:w-60 md:h-60 shadow-2xl shrink-0 rounded-md object-cover bg-zinc-800" 
            />
          ) : (
            <motion.div 
              layoutId={context ? `${context}-cover-${track.id}` : undefined} 
              className="w-48 h-48 md:w-60 md:h-60 shadow-2xl shrink-0 rounded-md bg-zinc-800 flex items-center justify-center"
            >
              <Music size={80} className="text-zinc-600" />
            </motion.div>
          )}
        <div className="flex-1 flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Трек</span>
          <motion.h1 layoutId={context ? `${context}-title-${track.id}` : undefined} className="text-4xl md:text-6xl font-bold truncate">
            {track.title}
          </motion.h1>
          <div className="flex items-center gap-2 mt-2">
            <motion.span layoutId={context ? `${context}-artist-${track.id}` : undefined} className="font-bold text-zinc-300">
              {track.artist}
            </motion.span>
            {track.durationMs ? (
              <>
                <span className="text-zinc-500">•</span>
                <span className="text-zinc-400 text-sm">
                  {Math.floor(track.durationMs / 60000)}:{Math.floor((track.durationMs % 60000) / 1000).toString().padStart(2, '0')}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4 relative">
        <button onClick={handleLike} className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors bg-white/5 px-6 py-3 rounded-full hover:bg-white/10">
          <Heart size={24} fill={isLiked ? "#22c55e" : "transparent"} color={isLiked ? "#22c55e" : "currentColor"} className="transition-colors" />
          <span className="font-bold">{likes}</span>
        </button>
        <button onClick={onOpenComments} className="flex items-center gap-2 transition-colors bg-white/5 px-6 py-3 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white">
          <MessageSquare size={24} />
          <span className="font-bold">{comments.length}</span>
        </button>
        
        <button 
          onClick={() => setIsPlaylistMenuOpen(!isPlaylistMenuOpen)} 
          className="flex items-center gap-2 transition-colors bg-white/5 px-6 py-3 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white"
        >
          <Plus size={24} />
          <span className="font-bold hidden sm:inline">В плейлист</span>
        </button>

        <button 
          onClick={async () => {
            const url = `${window.location.origin}${window.location.pathname}?track=${track.id}`;
            try {
              await navigator.clipboard.writeText(url);
              alert('Ссылка скопирована!');
            } catch (err) {
              alert('Не удалось скопировать ссылку');
            }
          }} 
          className="flex items-center gap-2 transition-colors bg-white/5 px-6 py-3 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          <span className="font-bold hidden sm:inline">Поделиться</span>
        </button>

        {isPlaylistMenuOpen && (
          <div className="absolute top-14 mt-2 w-64 bg-zinc-800 rounded-md shadow-2xl py-2 z-50 border border-white/10 left-0 sm:left-auto">
            <div className="px-3 py-2 text-xs font-semibold text-zinc-400 border-b border-white/10">Где сохранено:</div>
            <div className="max-h-64 overflow-y-auto no-scrollbar">
              {playlists.map(pl => {
                const isSavedInPl = pl.tracks.some(t => t.id === track.id || (t.youtubeId && track.youtubeId && t.youtubeId === track.youtubeId));
                return (
                  <button
                    key={pl.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlaylists(prev => prev.map(p => {
                        if (p.id === pl.id) {
                          if (isSavedInPl) {
                            return { ...p, tracks: p.tracks.filter(t => t.id !== track.id && !(t.youtubeId && track.youtubeId && t.youtubeId === track.youtubeId)) };
                          } else {
                            return { ...p, tracks: [...p.tracks, { ...track, addedAt: Date.now() }] };
                          }
                        }
                        return p;
                      }));
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-white/10 flex items-center justify-between text-sm transition-colors"
                  >
                    <span className="truncate pr-2 truncate max-w-[180px]">{pl.title}</span>
                    {isSavedInPl && <Check size={16} className="text-green-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="px-2 pt-2 border-t border-white/10 mt-1">
               <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const title = prompt("Название нового плейлиста:");
                    if (title) {
                      const newId = Math.random().toString(36).substring(7);
                      setPlaylists(prev => [...prev, {
                        id: newId,
                        title,
                        tracks: [{ ...track, addedAt: Date.now() }]
                      }]);
                    }
                  }}
                  className="w-full text-left px-2 py-2 hover:bg-white/10 flex items-center gap-2 text-sm text-green-400 transition-colors rounded"
                >
                  <Plus size={16} /> Создать новый
                </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 pt-8 border-t border-white/10 max-w-4xl relative">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Текст песни</h2>
          {lyrics && (
            <div className="relative">
              <button onClick={() => setIsTranslateMenuVisible(!isTranslateMenuVisible)} className={`p-2 rounded-full transition-colors ${translatedLyrics ? 'text-green-400 bg-green-400/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`} title="Перевод">
                <Languages size={24} />
              </button>
              {isTranslateMenuVisible && (
                <div className="absolute top-12 right-0 bg-zinc-800 p-4 rounded-xl shadow-2xl border border-white/10 w-80 z-50 flex flex-col gap-4">
                  <h3 className="font-bold text-white text-lg">Перевод текста</h3>
                  
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-white/50 uppercase">С какого языка:</label>
                    <select 
                      value={selectedSourceLang} 
                      onChange={e => setSelectedSourceLang(e.target.value)}
                      className="bg-black/40 text-white rounded p-2 border border-white/10"
                    >
                      <option value="auto">Автоопределение</option>
                      {TRANSLATION_LANGUAGES.map(l => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-white/50 uppercase">На какой язык:</label>
                    <select 
                      value={selectedTargetLang} 
                      onChange={e => setSelectedTargetLang(e.target.value)}
                      className="bg-black/40 text-white rounded p-2 border border-white/10"
                    >
                      {TRANSLATION_LANGUAGES.map(l => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2 mt-2">
                    {translatedLyrics && (
                      <button 
                        onClick={() => {
                          setTranslatedLyrics(null);
                          setIsTranslateMenuVisible(false);
                        }}
                        className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg transition"
                      >
                        Сбросить
                      </button>
                    )}
                    <button 
                      onClick={handleTranslateLyrics}
                      disabled={isTranslating}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-black font-bold py-2 rounded-lg transition disabled:opacity-50"
                    >
                      {isTranslating ? 'Переводим...' : 'Перевести'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {loadingLyrics ? (
          <p className="text-zinc-500">Загрузка текста...</p>
        ) : lyrics ? (
          <pre className="whitespace-pre-wrap font-sans text-lg text-zinc-300 leading-relaxed">{translatedLyrics || lyrics}</pre>
        ) : (
          <p className="text-zinc-500 italic">Для данной песни текста нету</p>
        )}
      </div>

    </div>
  );
};

const CommentsPageView = ({ track, currentUser, onBack }: { track: Track, currentUser: User | null, onBack: () => void }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    if (!track.id) return;
    const commentsRef = ref(db, `tracks/${track.id}/comments`);
    const uncomments = onValue(commentsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const loaded = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        ...val
      })).sort((a, b) => b.timestamp - a.timestamp);
      setComments(loaded);
    });
    return () => uncomments();
  }, [track.id]);

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !commentText.trim() || !track.id) return;
    const commentsRef = ref(db, `tracks/${track.id}/comments`);
    push(commentsRef, {
      userId: currentUser.uid,
      userName: currentUser.displayName || currentUser.email?.split('@')[0] || "User",
      text: commentText.trim(),
      timestamp: Date.now()
    });
    setCommentText("");
  };

  const handleDeleteComment = (commentId: string) => {
    if (!track.id) return;
    if (confirm("Вы уверены, что хотите удалить этот комментарий?")) {
      remove(ref(db, `tracks/${track.id}/comments/${commentId}`));
    }
  };

  const handleStartEdit = (c: Comment) => {
    setEditingCommentId(c.id);
    setEditingText(c.text);
  };

  const handleSaveEdit = (c: Comment) => {
    if (!track.id) return;
    if (editingText.trim()) {
      set(ref(db, `tracks/${track.id}/comments/${c.id}/text`), editingText.trim());
    }
    setEditingCommentId(null);
    setEditingText("");
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingText("");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <div className="flex items-center gap-4 mb-6">
        <button 
          onClick={onBack} 
          className="bg-black/50 hover:bg-black p-3 rounded-full text-white transition-colors"
          title="Назад"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h2 className="text-3xl font-bold">Комментарии</h2>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        {currentUser ? (
          <form onSubmit={submitComment} className="flex gap-2 mb-8">
            <input 
              type="text" 
              value={commentText} 
              onChange={e => setCommentText(e.target.value)} 
              placeholder="Добавьте комментарий..." 
              className="flex-1 bg-zinc-800 text-white rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
            <button type="submit" className="bg-green-500 text-black px-6 py-3 rounded-md font-bold hover:scale-105 transition-transform" disabled={!commentText.trim()}>
              Отправить
            </button>
          </form>
        ) : (
          <p className="text-zinc-500 mb-8 font-semibold">Войдите, чтобы оставить комментарий.</p>
        )}
        
        <div className="flex flex-col gap-4">
          {comments.length > 0 ? comments.map(c => {
            const isOwner = currentUser && currentUser.uid === c.userId;
            const canEdit = isOwner && (Date.now() - c.timestamp < 30 * 60 * 1000); 

            return (
              <div key={c.id} className="flex flex-col gap-1 p-4 bg-zinc-800/30 rounded-md border border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-green-400">{c.userName}</span>
                    <span className="text-xs text-zinc-500">{new Date(c.timestamp).toLocaleString()}</span>
                  </div>
                  {isOwner && (
                    <div className="flex items-center gap-2">
                      {canEdit && editingCommentId !== c.id && (
                        <button onClick={() => handleStartEdit(c)} className="text-zinc-400 hover:text-white p-1" title="Изменить (в течение 30 минут)">
                          <Edit2 size={14} />
                        </button>
                      )}
                      <button onClick={() => handleDeleteComment(c.id)} className="text-zinc-400 hover:text-rose-500 p-1" title="Удалить">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {editingCommentId === c.id ? (
                  <div className="flex flex-col gap-2 mt-2">
                    <input 
                      type="text" 
                      value={editingText} 
                      onChange={e => setEditingText(e.target.value)} 
                      className="bg-zinc-800 text-white rounded px-3 py-2 w-full focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={handleCancelEdit} className="text-xs font-semibold text-zinc-400 hover:text-white">Отмена</button>
                      <button onClick={() => handleSaveEdit(c)} className="text-xs font-semibold text-green-400 hover:text-green-300" disabled={!editingText.trim()}>Сохранить</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-300 whitespace-pre-wrap">{c.text}</p>
                )}
              </div>
            );
          }) : (
            <p className="text-zinc-500 italic">Пока нет комментариев. Будьте первым!</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('week');
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [previousTab, setPreviousTab] = useState<Tab>('home');
  const [viewingTrack, setViewingTrack] = useState<Track | null>(null);
  const [viewingTrackContext, setViewingTrackContext] = useState<string>('');
  const [playlists, setPlaylists] = useState<Playlist[]>([{
    id: 'favorites',
    title: 'Избранное',
    isSystem: true,
    tracks: []
  }]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [currentPlayingPlaylistId, setCurrentPlayingPlaylistId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [userStats, setUserStats] = useState<UserStats>({});
  const [isLyricsModalOpen, setIsLyricsModalOpen] = useState(false);
    const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
    const [userQueue, setUserQueue] = useState<Track[]>([]);
    const [isShuffleQueue, setIsShuffleQueue] = useState(false);
    const queueBeforeShuffleRef = useRef<Track[] | null>(null);
    const [overrideTrack, setOverrideTrack] = useState<Track | null>(null);
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isSpotifyModalOpen, setIsSpotifyModalOpen] = useState(false);
  const [isLibrarySongsVisible, setIsLibrarySongsVisible] = useState(true);
  
  // Sync Session State
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [joinSessionCode, setJoinSessionCode] = useState('');
  const [isLocalPaused, setIsLocalPaused] = useState(false);
  const [syncSession, setSyncSession] = useState<any | null>(null);
  const [invites, setInvites] = useState<any[]>([]);
  const [connectTabMode, setConnectTabMode] = useState<'listen' | 'collab'>('listen');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<any[]>([]);
  const [playlistContextMenu, setPlaylistContextMenu] = useState<{ id: string, x: number, y: number } | null>(null);
  
  const [layoutTheme, setLayoutTheme] = useState<'classic' | 'minimalistic' | 'material3'>(localStorage.getItem('layoutTheme') as 'classic' | 'minimalistic' | 'material3' || 'material3');
  const [lyricsAnimation, setLyricsAnimation] = useState<'classic' | 'apple'>(localStorage.getItem('lyricsAnimation') as 'classic' | 'apple' || 'apple');
  const [md3AutoHideRail, setMd3AutoHideRail] = useState(localStorage.getItem('md3AutoHideRail') !== null ? localStorage.getItem('md3AutoHideRail') === 'true' : false);
  const [md3NavPosition, setMd3NavPosition] = useState(localStorage.getItem('md3NavPosition') || 'top');
  const [md3NavOrientation, setMd3NavOrientation] = useState(localStorage.getItem('md3NavOrientation') || 'auto');
  const [md3PlayerTheme, setMd3PlayerTheme] = useState(localStorage.getItem('md3PlayerTheme') !== null ? localStorage.getItem('md3PlayerTheme') === 'true' : true);
  const [md3NavKey, setMd3NavKey] = useState(0);
  const [minimoConfig, setMinimoConfig] = useState(() => {
    const saved = localStorage.getItem('minimoConfig');
    return saved ? JSON.parse(saved) : { hideSidebar: false, hideCovers: false, simplifiedPlayer: false, hideArtist: false, hideVisualizer: false };
  });

  const [isSidebarCollapsedState, setIsSidebarCollapsed] = useState(false);
  const isSidebarCollapsed = isSidebarCollapsedState || (layoutTheme === 'minimalistic' && minimoConfig.hideSidebar);
  const [isPlayerHidden, setIsPlayerHidden] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  const [settingsSection, setSettingsSection] = useState<'customization' | 'account' | 'audio' | 'downloads' | 'about' | 'server'>('customization');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [accentColor, setAccentColor] = useState(localStorage.getItem('accentColor') || '#22c55e');
  const [audioMode, setAudioMode] = useState<'stream' | 'download'>(localStorage.getItem('audioMode') as 'stream' | 'download' || 'stream');

  const [sysInfo, setSysInfo] = useState<any>(null);
  const [downloadsInfo, setDownloadsInfo] = useState<any>({ files: [], total_size_bytes: 0, dir: '' });
  const [serverStatusData, setServerStatusData] = useState<any>(null);
  const [serverLogs, setServerLogs] = useState<any[]>([]);
  const [serverLogsLoading, setServerLogsLoading] = useState(false);

  const fetchSysInfo = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/info');
      if (res.ok) setSysInfo(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDownloadsInfo = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/settings/downloads');
      if (res.ok) setDownloadsInfo(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchServerData = async () => {
    setServerLogsLoading(true);
    try {
      const [statusRes, logsRes] = await Promise.all([
        fetch('http://127.0.0.1:8000/api/server-status'),
        fetch('http://127.0.0.1:8000/api/logs?n=150')
      ]);
      if (statusRes.ok) setServerStatusData(await statusRes.json());
      else setServerStatusData(null);
      if (logsRes.ok) {
        const d = await logsRes.json();
        setServerLogs(d.logs || []);
      }
    } catch {
      setServerStatusData(null);
    } finally {
      setServerLogsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'settings') {
      if (settingsSection === 'downloads' || settingsSection === 'about' || settingsSection === 'audio') {
        fetchSysInfo();
        fetchDownloadsInfo();
      }
      if (settingsSection === 'server') {
        fetchServerData();
      }
    }
  }, [activeTab, settingsSection]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('accentColor', accentColor);
    document.documentElement.style.setProperty('--accent', accentColor);
  }, [accentColor]);

  useEffect(() => {
    localStorage.setItem('layoutTheme', layoutTheme);
    localStorage.setItem('lyricsAnimation', lyricsAnimation);
    localStorage.setItem('md3AutoHideRail', md3AutoHideRail.toString());
    localStorage.setItem('md3NavPosition', md3NavPosition);
    localStorage.setItem('md3NavOrientation', md3NavOrientation);
    localStorage.setItem('md3PlayerTheme', md3PlayerTheme.toString());
  }, [layoutTheme, md3AutoHideRail, md3NavPosition, md3NavOrientation, md3PlayerTheme, lyricsAnimation]);

  useEffect(() => {
    localStorage.setItem('minimoConfig', JSON.stringify(minimoConfig));
  }, [minimoConfig]);

  useEffect(() => {
    localStorage.setItem('audioMode', audioMode);
  }, [audioMode]);

  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Multi-Select tracking
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [lastSelectedTrackIndex, setLastSelectedTrackIndex] = useState<number | null>(null);

  const openTrackPage = (track: Track, context: string = '') => {
    setViewingTrack(track);
    setViewingTrackContext(context);
    setPreviousTab(activeTab);
    setActiveTab('track');
    if (track.id) {
      const trackRef = ref(db, `tracks/${track.id}`);
      get(trackRef).then((snapshot) => {
        if (!snapshot.exists()) {
          set(trackRef, {
            id: track.id,
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail || null,
            durationMs: track.durationMs || 0
          });
        }
      }).catch(err => console.error("Error saving track:", err));
    }
  };

  const isSimplifiedPlayer = layoutTheme === 'minimalistic' && minimoConfig.simplifiedPlayer;
  const isSidebarForcedHidden = layoutTheme === 'minimalistic' && minimoConfig.hideSidebar;

  // Add to Playlist Menu State
  const [trackMenuOpenId, setTrackMenuOpenId] = useState<string | null>(null);

  const [importTargetId, setImportTargetId] = useState<string | null>(null);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);

type SortField = 'default' | 'index' | 'title' | 'addedAt' | 'durationMs';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      const defaultDir = (field === 'addedAt' || field === 'durationMs') ? 'desc' : 'asc';
      if (sortDirection === defaultDir) {
        setSortDirection(defaultDir === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField('default');
        setSortDirection('desc'); // resets to a clean state
      }
    } else {
      setSortField(field);
      setSortDirection((field === 'addedAt' || field === 'durationMs') ? 'desc' : 'asc');
    }
  };

  const getSortedTracks = (tracks: Track[]) => {
    if (sortField === 'default') return tracks;
    
    if (sortField === 'index') {
      return sortDirection === 'asc' ? [...tracks] : [...tracks].reverse();
    }

    return [...tracks].sort((a, b) => {
      let valA: any, valB: any;
      if (sortField === 'title') {
        valA = a.title.toLowerCase();
        valB = b.title.toLowerCase();
      } else if (sortField === 'addedAt') {
        valA = a.addedAt || 0;
        valB = b.addedAt || 0;
      } else if (sortField === 'durationMs') {
        valA = a.durationMs || 0;
        valB = b.durationMs || 0;
      } else {
        return 0;
      }
      
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const audioRef = useRef<HTMLAudioElement>(null);
  const preloadedNextTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
      
      if (user) {
        // Update public_users for searching
        const publicUserRef = ref(db, `public_users/${user.uid}`);
        set(publicUserRef, {
          displayName: user.displayName || 'Без имени',
          lastSeen: Date.now()
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch from Firebase
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const trackIdFromUrl = urlParams.get('track');
    
    if (trackIdFromUrl && isDataLoaded && currentUser) {
      const trackRef = ref(db, `tracks/${trackIdFromUrl}`);
      get(trackRef).then((snapshot) => {
        if (snapshot.exists()) {
          const trackData = snapshot.val() as Track;
          setViewingTrack(trackData);
          setViewingTrackContext('shared');
          setPreviousTab('home');
          setActiveTab('track');
          
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }).catch(console.error);
    }
  }, [isDataLoaded, currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setPlaylists([{ id: 'favorites', title: 'Избранное', isSystem: true, tracks: [] }]);
      setIsDataLoaded(false);
      return;
    }

    let isMounted = true;
    const fetchPlaylists = async () => {
      try {
        const dbRef = ref(db, `users/${currentUser.uid}/playlists`);
        const snapshot = await get(dbRef);
        if (snapshot.exists() && isMounted) {
          const data = snapshot.val();
          const loadedArray = Object.values(data) as Playlist[];

          const validatedPlaylists = loadedArray.filter(Boolean).map(p => ({
            ...p,
            tracks: p.tracks || []
          }));

          if (!validatedPlaylists.find(p => p.id === 'favorites')) {
            validatedPlaylists.unshift({ id: 'favorites', title: 'Избранное', isSystem: true, tracks: [] });
          }
          setPlaylists(validatedPlaylists);
        } else if (isMounted) {
          setPlaylists([{ id: 'favorites', title: 'Избранное', isSystem: true, tracks: [] }]);
        }

        const statsRef = ref(db, `users/${currentUser.uid}/stats`);
        const statsSnap = await get(statsRef);
        if (statsSnap.exists() && isMounted) {
          setUserStats(statsSnap.val());
        }

        // Register a visit for today
        if (isMounted) {
          const today = new Date().toISOString().split('T')[0];
          setUserStats(prev => {
            const newStats = { ...prev };
            if (!newStats[today]) {
              newStats[today] = { tracks: 0, timeMs: 0, visits: 1 };
            } else {
              // Wait, if they reload the page, is it a new visit? 
              // To prevent 100 visits strictly by reloading, we can use sessionStorage.
              if (!sessionStorage.getItem('visited_today')) {
                newStats[today].visits += 1;
                sessionStorage.setItem('visited_today', 'true');
              }
            }
            return newStats;
          });
        }

      } catch (err) {
        console.error("Failed to load cloud data", err);
      } finally {
        if (isMounted) setIsDataLoaded(true);
      }
    };
    fetchPlaylists();

    return () => { isMounted = false; };
  }, [currentUser]);

  // Invites listener
  useEffect(() => {
    if (!currentUser) return;
    const invitesRef = ref(db, `invites/${currentUser.uid}`);
    const unsub = onValue(invitesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const activeInvites = Object.keys(data).map(k => ({ id: k, ...data[k] }))
          .filter(inv => inv.status === 'pending');
        setInvites(activeInvites);
      } else {
        setInvites([]);
      }
    });
    return () => unsub();
  }, [currentUser]);

  // Sync to Firebase
  useEffect(() => {
    if (!currentUser || !isDataLoaded) return;

    const timeoutMsg = setTimeout(async () => {
      try {
        const playlistsData: Record<string, any> = {};
        playlists.forEach(pl => {
          const cleanTracks = pl.tracks ? pl.tracks.map(t => {
            const { file, ...cleanTrack } = t as any;
            return cleanTrack;
          }) : [];
          playlistsData[pl.id] = { ...pl, tracks: cleanTracks };
        });
        
        const dbRef = ref(db, `users/${currentUser.uid}/playlists`);
        await set(dbRef, playlistsData);
        
        const statsRef = ref(db, `users/${currentUser.uid}/stats`);
        await set(statsRef, userStats);
      } catch (e) {
        console.error("Failed to sync to cloud", e);
      }
    }, 1000);

    return () => clearTimeout(timeoutMsg);
  }, [playlists, userStats, currentUser, isDataLoaded]);

  // Keep-alive ping to backend
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('http://127.0.0.1:8000/api/health').catch(() => { });
    }, 5000);

    const handleUnload = () => {
      navigator.sendBeacon('http://127.0.0.1:8000/api/shutdown');
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  // Проверка обновлений
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/TairTasNis/Tesify/releases/latest');
        if (res.ok) {
          const data = await res.json();
          let tag = data.tag_name;
          if (tag) {
            // Удаляем букву 'v' из тега (например, 'v1.0.0' -> '1.0.0'), чтобы сравнивать чистые версии
            const cleanTag = tag.startsWith('v') ? tag.slice(1) : tag;
            if (cleanTag !== APP_VERSION) {
              setHasUpdate(true);
              setLatestVersion(cleanTag);
            }
          }
        }
      } catch (e) {
        console.error('Failed to check for updates', e);
      }
    };
    checkUpdate();
  }, []);

  const handleTrackSelect = (e: React.MouseEvent, trackId: string, index: number, tracksList: Track[]) => {
    e.preventDefault();
    if (e.type === 'contextmenu') {
      const newSelection = new Set(selectedTrackIds);
      newSelection.add(trackId);
      setSelectedTrackIds(newSelection);
      setLastSelectedTrackIndex(index);
      return;
    }

    if (selectedTrackIds.size > 0) {
      const newSelection = new Set(selectedTrackIds);
      if (e.shiftKey && lastSelectedTrackIndex !== null) {
        const start = Math.min(lastSelectedTrackIndex, index);
        const end = Math.max(lastSelectedTrackIndex, index);
        for (let i = start; i <= end; i++) {
          newSelection.add(tracksList[i].id);
        }
      } else {
        if (newSelection.has(trackId)) {
          newSelection.delete(trackId);
        } else {
          newSelection.add(trackId);
        }
        setLastSelectedTrackIndex(index);
      }
      setSelectedTrackIds(newSelection);
    } else {
      playTrack(index, activePlaylistId!);
    }
  };

  const deleteSelectedTracks = () => {
    if (!activePlaylistId) return;

    if (currentPlayingPlaylistId === activePlaylistId && currentTrack && selectedTrackIds.has(currentTrack.id)) {
      setIsPlaying(false);
      if (audioRef.current) audioRef.current.pause();
    }

    setPlaylists(prev => prev.map(pl => {
      if (pl.id === activePlaylistId) {
        return { ...pl, tracks: pl.tracks.filter(t => !selectedTrackIds.has(t.id)) };
      }
      return pl;
    }));
    setSelectedTrackIds(new Set());
    setIsMoveMenuOpen(false);
  };

  const currentPlayingPlaylist = playlists.find(p => p.id === currentPlayingPlaylistId) || null;
  const currentTrackBase = currentTrackIndex >= 0 && currentPlayingPlaylist ? currentPlayingPlaylist.tracks[currentTrackIndex] : null;
  const currentTrack = overrideTrack || currentTrackBase;

  const isHost = currentSessionId && syncSession && currentUser && (
      syncSession.hostId === currentUser.uid || 
      (syncSession.coHosts && syncSession.coHosts[currentUser.uid])
  );

  // --- TESIFY CONNECT: SESSION SYNC ---
  useEffect(() => {
    if (!currentSessionId) {
      setSyncSession(null);
      setIsLocalPaused(false);
      return;
    }
    const sessionRef = ref(db, `sessions/${currentSessionId}`);
    const unsub = onValue(sessionRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setSyncSession(data);
        
        const isUserHost = data.hostId === currentUser?.uid || (data.coHosts && data.coHosts[currentUser?.uid]);

        // Listener mode: read state from host if we are just a listener
        if (!isUserHost) {
           if (data.currentTrack) {
               // Ensure there is a virtual playlist for the listener
               setPlaylists(prev => {
                  if (!prev.find(p => p.id === `session-${currentSessionId}`)) {
                     return [...prev, { id: `session-${currentSessionId}`, name: `Сессия ${data.hostName || 'друга'}`, tracks: [data.currentTrack], cover: '' }];
                  } else {
                     return prev.map(p => p.id === `session-${currentSessionId}` ? { ...p, tracks: [data.currentTrack] } : p);
                  }
               });

               // If our current track is different from host's, let's switch to it
               if (currentTrack?.id !== data.currentTrack.id) {
                   setCurrentPlayingPlaylistId(`session-${currentSessionId}`);
                   setCurrentTrackIndex(0);
                   setIsLocalPaused(false); // New track, reset local pause
               }
           }
           
           if (audioRef.current && data.currentTrack) {
               const timeDiff = Math.abs(audioRef.current.currentTime - (data.currentTime || 0));
               
               // If host is playing and listener hasn't paused locally
               if (data.isPlaying && !isLocalPaused) {
                   if (timeDiff > 2) {
                       audioRef.current.currentTime = data.currentTime;
                   }
                   if (audioRef.current.paused) {
                       audioRef.current.play().catch(e => console.log('Listener play block:', e));
                       setIsPlaying(true);
                   }
               } 
               // If host paused, pause listener too
               else if (!data.isPlaying && !audioRef.current.paused) {
                   audioRef.current.pause();
                   setIsPlaying(false);
               }
           }
        }
      } else {
          // Session was deleted
          setCurrentSessionId(null);
          setSyncSession(null);
          setIsLocalPaused(false);
          alert('Сессия завершена хостом.');
      }
    });

    return () => unsub();
  }, [currentSessionId, currentUser, currentPlayingPlaylistId, currentTrack?.id, isLocalPaused]);

  // Host mode: push state to Firebase on track or state change
  useEffect(() => {
    if (isHost && currentSessionId) {
       const sessionRef = ref(db, `sessions/${currentSessionId}`);
       const cleanTrack = currentTrack ? { ...currentTrack } : null;
       if (cleanTrack && cleanTrack.file) {
           delete cleanTrack.file; // Don't upload massive base64 files
       }
       update(sessionRef, {
           currentTrack: cleanTrack,
           isPlaying: isPlaying,
           currentTime: audioRef.current?.currentTime || 0,
           updatedAt: Date.now()
       });
    }
  }, [currentSessionId, currentTrack?.id, isPlaying, isHost]);

  // Host mode: push time progress periodically
  useEffect(() => {
    if (!isHost || !currentSessionId || !isPlaying) return;
    const interval = setInterval(() => {
        if (audioRef.current) {
           update(ref(db, `sessions/${currentSessionId}`), {
               currentTime: audioRef.current.currentTime,
               updatedAt: Date.now()
           });
        }
    }, 4000); // 4 seconds is a good balance
    return () => clearInterval(interval);
  }, [currentSessionId, isHost, isPlaying, currentUser]);


  // Sync isPlaying state with actual audio element events (OS media keys, keyboard shortcuts, etc.)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      // Don't update if track just ended (handleEnded manages that)
      if (!audio.ended) setIsPlaying(false);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  // Media Session API — OS media keys and lock screen controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.thumbnail ? [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
    }
    navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', handleNext);
    navigator.mediaSession.setActionHandler('previoustrack', handlePrev);
  }, [currentTrack]);

  useEffect(() => {
    if (audioRef.current && currentTrack?.url) {
      if (isPlaying) {
        audioRef.current.play().catch(e => console.error("Playback failed", e));
      } else {
        audioRef.current.pause();
      }
    }
    // reset preloaded when track changes
    if (currentTrack) {
        if (preloadedNextTrackIdRef.current === currentTrack.id) {
            preloadedNextTrackIdRef.current = null;
        }
    }
  }, [isPlaying, currentTrackIndex, currentTrack?.url]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const preloadNextTrack = async () => {
    if (!currentPlayingPlaylistId) return;
    const playlist = playlists.find(p => p.id === currentPlayingPlaylistId);
    if (!playlist) return;
    if (currentTrackIndex === null || currentTrackIndex >= playlist.tracks.length - 1) return;
    
    const nextTrack = playlist.tracks[currentTrackIndex + 1];
    if (!nextTrack) return;
    if (preloadedNextTrackIdRef.current === nextTrack.id) return;

    preloadedNextTrackIdRef.current = nextTrack.id;

    try {
      let youtubeId = nextTrack.youtubeId;
      let needsUpdate = false;
      
      if (!youtubeId && !nextTrack.file && !nextTrack.url) {
        const res = await fetch(`http://127.0.0.1:8000/search?q=${encodeURIComponent(nextTrack.artist + ' ' + nextTrack.title)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            let bestVideoId = data.results[0].id;
            if (nextTrack.durationMs) {
              const targetSec = nextTrack.durationMs / 1000;
              const tolerances = [3, 10, 30];
              let found = false;
              for (const tol of tolerances) {
                for (const r of data.results) {
                  if (r.duration) {
                    const diff = Math.abs(r.duration - targetSec);
                    if (diff <= tol) { bestVideoId = r.id; found = true; break; }
                  }
                }
                if (found) break;
              }
            }
            youtubeId = bestVideoId;
            needsUpdate = true;
          }
        }
      }
      
      if (youtubeId) {
        const modeParam = localStorage.getItem('audioMode') || 'stream';
        fetch(`http://127.0.0.1:8000/stream?id=${youtubeId}&mode=${modeParam}`).catch(() => {});
        
        if (needsUpdate) {
            setPlaylists(prev => prev.map(pl => {
              if (pl.id === playlist.id) {
                const newTracks = [...pl.tracks];
                newTracks[currentTrackIndex + 1] = { ...nextTrack, youtubeId };
                return { ...pl, tracks: newTracks };
              }
              return pl;
            }));
        }
      }
    } catch (err) {
       console.warn("Preload failed", err);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration > 0 && audioRef.current.currentTime >= audioRef.current.duration * 0.5) {
        preloadNextTrack();
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      const isFiniteDur = isFinite(dur) && !isNaN(dur);

      if (isFiniteDur) {
        setDuration(dur);
      } else if (currentTrack?.durationMs) {
        setDuration(currentTrack.durationMs / 1000);
      }
      
      if (currentTrack && !currentTrack.durationMs && currentPlayingPlaylistId && isFiniteDur) {
        setPlaylists(prev => prev.map(pl => {
          if (pl.id === currentPlayingPlaylistId) {
            const newTracks = [...pl.tracks];
            const trackIndex = newTracks.findIndex(t => t.id === currentTrack.id);
            if (trackIndex !== -1) {
              newTracks[trackIndex] = { ...newTracks[trackIndex], durationMs: Math.floor(dur * 1000) };
            }
            return { ...pl, tracks: newTracks };
          }
          return pl;
        }));
      }
    }
  };

  useEffect(() => {
    let interval: any;
    if (isPlaying && currentTrack) {
      interval = setInterval(() => {
        const today = new Date().toISOString().split('T')[0];
        setUserStats(prev => {
          const newStats = { ...prev };
          if (!newStats[today]) {
            newStats[today] = { tracks: 0, timeMs: 0, visits: 1 };
          }
          newStats[today] = {
            ...newStats[today],
            timeMs: (newStats[today].timeMs || 0) + 1000
          };
          return newStats;
        });
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isPlaying, currentTrack]);

  const handleEnded = () => {
    if (currentTrack) {
      const today = new Date().toISOString().split('T')[0];
      setUserStats(prev => {
        const newStats = { ...prev };
        if (!newStats[today]) {
          newStats[today] = { tracks: 0, timeMs: 0, visits: 1 };
        }
        newStats[today] = {
          ...newStats[today],
          tracks: (newStats[today].tracks || 0) + 1
        };
        return newStats;
      });
    }
    handleNext();
  };

  const handlePlayPause = () => {
    const playlist = currentPlayingPlaylist || playlists.find(p => p.id === 'favorites');
    if (currentTrackIndex === -1 && playlist && playlist.tracks.length > 0) {
      const sortedTracks = getSortedTracks(playlist.tracks);
      const firstTrack = sortedTracks[0];
      const absoluteIndex = playlist.tracks.findIndex(t => t.id === firstTrack.id);
      playTrack(absoluteIndex, playlist.id);
    } else if (currentTrackIndex !== -1) {
      if (!isHost && currentSessionId) {
         if (isPlaying) {
             setIsLocalPaused(true);
         } else {
             setIsLocalPaused(false);
             // Sync back to host time
             if (syncSession && audioRef.current) {
                audioRef.current.currentTime = syncSession.currentTime || 0;
             }
         }
      }
      setIsPlaying(!isPlaying);
    }
  };

const shuffleTracks = (tracks: Track[]) => {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const handleNext = () => {
  if (userQueue.length > 0) {
    const nextT = userQueue[0];
    setUserQueue(prev => prev.slice(1));

    const playlistForQueue = currentPlayingPlaylist || playlists.find(p => p.id === currentPlayingPlaylistId);
    if (playlistForQueue) {
      const absoluteIndex = playlistForQueue.tracks.findIndex(t =>
        t.id === nextT.id || (t.youtubeId && nextT.youtubeId && t.youtubeId === nextT.youtubeId)
      );

      if (absoluteIndex !== -1) {
        setOverrideTrack(null);
        playTrack(absoluteIndex, playlistForQueue.id);
        return;
      }
    }

    playQueueTrack(nextT);
    return;
  }

  if (overrideTrack) {
    setOverrideTrack(null);
  }

  const playlist = currentPlayingPlaylist || playlists.find(p => p.id === 'favorites');
  if (!playlist || playlist.tracks.length === 0) return;

  const sortedTracks = getSortedTracks(playlist.tracks);
  const currentTrackObj = playlist.tracks[currentTrackIndex];

  if (isShuffleQueue) {
    const remaining = sortedTracks.filter(t => !currentTrackObj || t.id !== currentTrackObj.id);

    if (remaining.length > 0) {
      const shuffled = shuffleTracks(remaining);
      const nextT = shuffled[0];

      setUserQueue(shuffled.slice(1));

      const absoluteIndex = playlist.tracks.findIndex(t => t.id === nextT.id);
      if (absoluteIndex !== -1) {
        playTrack(absoluteIndex, playlist.id);
      } else {
        playQueueTrack(nextT);
      }

      return;
    }
  }

  if (!currentTrackObj) {
    const firstTrack = sortedTracks[0];
    const absoluteIndex = playlist.tracks.findIndex(t => t.id === firstTrack.id);
    playTrack(absoluteIndex, playlist.id);
    return;
  }

  const sortedIndex = sortedTracks.findIndex(t => t.id === currentTrackObj.id);
  const nextSortedIndex = (sortedIndex + 1) % sortedTracks.length;
  const nextTrack = sortedTracks[nextSortedIndex];
  const absoluteIndex = playlist.tracks.findIndex(t => t.id === nextTrack.id);

  playTrack(absoluteIndex, playlist.id);
};

  const handlePrev = () => {
    const playlist = currentPlayingPlaylist || playlists.find(p => p.id === 'favorites');
    if (!playlist || playlist.tracks.length === 0) return;
    
    const sortedTracks = getSortedTracks(playlist.tracks);
    const currentTrackObj = playlist.tracks[currentTrackIndex];
    if (!currentTrackObj) {
      const firstTrack = sortedTracks[0];
      const absoluteIndex = playlist.tracks.findIndex(t => t.id === firstTrack.id);
      playTrack(absoluteIndex, playlist.id);
      return;
    }
    
    const sortedIndex = sortedTracks.findIndex(t => t.id === currentTrackObj.id);
    const prevSortedIndex = (sortedIndex - 1 + sortedTracks.length) % sortedTracks.length;
    
    const prevTrack = sortedTracks[prevSortedIndex];
    const absoluteIndex = playlist.tracks.findIndex(t => t.id === prevTrack.id);
    
    playTrack(absoluteIndex, playlist.id);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newTracksPromises: Promise<Track>[] = Array.from(files).map((file: any) => {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file as unknown as Blob);
        const audio = new Audio(url);
        
        audio.addEventListener('loadedmetadata', () => {
          resolve({
            id: Math.random().toString(36).substring(7),
            title: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
            artist: "Unknown Artist",
            file: file as any,
            url: url,
            durationMs: isFinite(audio.duration) ? Math.floor(audio.duration * 1000) : undefined,
            addedAt: Date.now()
          });
        });

        audio.addEventListener('error', () => {
          resolve({
            id: Math.random().toString(36).substring(7),
            title: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
            artist: "Unknown Artist",
            file: file as any,
            url: url,
            addedAt: Date.now()
          });
        });
      });
    });

    const newTracks = await Promise.all(newTracksPromises);

    setPlaylists(prev => prev.map(pl =>
      pl.id === 'favorites' ? { ...pl, tracks: [...pl.tracks, ...newTracks] } : pl
    ));
  };

  useEffect(() => {
    const handleGlobalClick = () => {
      if (playlistContextMenu) setPlaylistContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [playlistContextMenu]);

  
    const playQueueTrack = async (track: Track) => {
      let updatedTrack = { ...track };
      if (updatedTrack.youtubeId) updatedTrack.url = "";

      setOverrideTrack(track);
      setIsPlaying(false);
      setIsLoadingTrack(true);

      if (!updatedTrack.youtubeId && !updatedTrack.file && !updatedTrack.url) {
        try {
          const res = await fetch(`http://127.0.0.1:8000/search?q=${encodeURIComponent(updatedTrack.artist + " " + updatedTrack.title)}`);
          if (!res.ok) throw new Error("Search failed");
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            updatedTrack.youtubeId = data.results[0].id;
          } else throw new Error("No results");
        } catch (err) {
          console.error(err);
          setIsLoadingTrack(false);
          return;
        }
      }
      
      if (updatedTrack.youtubeId) {
        try {
          const modeParam = localStorage.getItem("audioMode") || "stream";
          if (modeParam === "stream") {
            updatedTrack.url = `http://127.0.0.1:8000/proxy_stream?id=${updatedTrack.youtubeId}`;
          } else {
            const res = await fetch(`http://127.0.0.1:8000/stream?id=${updatedTrack.youtubeId}&mode=${modeParam}`);
            const data = await res.json();
            updatedTrack.url = data.url;
          }
        } catch (err) {
          console.error("Error fetching stream URL:", err);
          setIsLoadingTrack(false);
          return;
        }
      }

      setOverrideTrack(updatedTrack);
      setIsPlaying(true);
      setIsLoadingTrack(false);
    };

    const playTrack = async (index: number, playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    let track = playlist.tracks[index];
    let updatedTrack = { ...track };
    let needsUpdate = false;

    // Если у трека есть youtubeId, мы в любом случае будем запрашивать свежую ссылку
    if (updatedTrack.youtubeId) {
      updatedTrack.url = ''; // Очищаем старую ссылку, чтобы она не начала играть
    }

    // Сначала устанавливаем выбранный трек (для UI), но ПОКА не запускаем проигрывание
    setCurrentTrackIndex(index);
    setCurrentPlayingPlaylistId(playlistId);
    setIsPlaying(false);
    setIsLoadingTrack(true);

    // Если это трек из Spotify (нет youtubeId, нет файла и нет url)
    if (!updatedTrack.youtubeId && !updatedTrack.file && !updatedTrack.url) {
      try {
        const res = await fetch(`http://127.0.0.1:8000/search?q=${encodeURIComponent(updatedTrack.artist + ' ' + updatedTrack.title)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          let bestVideoId = data.results[0].id;
          
          // Smart matching by duration if available from Spotify
          if (updatedTrack.durationMs) {
            const targetSec = updatedTrack.durationMs / 1000;
            // Progressively relax precision: exact/very close (+-3s), then close (+-10s), then somewhat ok (+-30s)
            const tolerances = [3, 10, 30]; 
            let found = false;
            
            for (const tol of tolerances) {
              for (const r of data.results) {
                if (typeof r.duration === 'number') {
                  const diff = Math.abs(r.duration - targetSec);
                  if (diff <= tol) {
                    bestVideoId = r.id;
                    found = true;
                    // Also attempt to get the best cover, we can leave this out for now
                    break;
                  }
                }
              }
              if (found) break; // found a match within this tolerance
            }
          }
          
          updatedTrack.youtubeId = bestVideoId;
          needsUpdate = true;
        } else {
          throw new Error('No results found on YouTube');
        }
      } catch (err) {
        console.error('Error searching YouTube for Spotify track:', err);
        alert('Не удалось найти трек на YouTube.');
        setIsLoadingTrack(false);
        return;
      }
    }

    // Если это трек с YouTube, всегда запрашиваем свежую ссылку, так как старая могла протухнуть
    if (updatedTrack.youtubeId) {
      try {
        // Получаем прямую ссылку на аудиопоток
        const modeParam = localStorage.getItem('audioMode') || 'stream';
        if (modeParam === 'stream') {
          updatedTrack.url = `http://127.0.0.1:8000/proxy_stream?id=${updatedTrack.youtubeId}`;
          needsUpdate = true;
        } else {
          const res = await fetch(`http://127.0.0.1:8000/stream?id=${updatedTrack.youtubeId}&mode=${modeParam}`);
          if (!res.ok) throw new Error('Failed to get stream URL');
          const data = await res.json();

          updatedTrack.url = data.url;
          needsUpdate = true;
        }
      } catch (err) {
        console.error('Error fetching stream URL:', err);
        alert('Не удалось запустить трек. Убедитесь, что Python-сервер запущен.');
        setIsLoadingTrack(false);
        return;
      }
    }

    if (needsUpdate) {
      setPlaylists(prev => prev.map(pl => {
        if (pl.id === playlistId) {
          const newTracks = [...pl.tracks];
          newTracks[index] = updatedTrack;
          return { ...pl, tracks: newTracks };
        }
        return pl;
      }));
    }

    setIsPlaying(true);
    setIsLoadingTrack(false);
  };

  const formatPlaylistDuration = (tracks: Track[]) => {
    const totalMs = tracks.reduce((acc, t) => acc + (t.durationMs || 0), 0);
    if (totalMs === 0) return '';
    const totalMin = Math.floor(totalMs / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours > 0) return ` • ${hours}ч ${mins}мин`;
    return ` • ${mins}мин`;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError('');

    try {
      const res = await fetch(`http://127.0.0.1:8000/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();

      const results: Track[] = data.results.map((item: any) => ({
        id: item.id,
        title: item.title,
        artist: item.uploader || 'YouTube',
        url: '', // Будет получено при воспроизведении
        youtubeId: item.id,
        thumbnail: item.thumbnail,
        durationMs: item.duration ? Math.floor(item.duration * 1000) : undefined,
        addedAt: Date.now()
      }));

      setSearchResults(results);
    } catch (err) {
      setSearchError('Ошибка поиска. Запущен ли Python-сервер?');
    } finally {
      setIsSearching(false);
    }
  };

  const addFromSearch = (track: Track) => {
    // Add to favorites by default
    setPlaylists(prev => prev.map(pl =>
      (pl.id === 'favorites' && !pl.tracks.find(t => t.youtubeId === track.youtubeId))
        ? { ...pl, tracks: [...pl.tracks, { ...track, addedAt: Date.now() }] }
        : pl
    ));
    setActiveTab('library');
  };

  const activePlaylist = activePlaylistId ? playlists.find(p => p.id === activePlaylistId) : null;

  // Compute all tracks for sidebar
  const allTracks = playlists.reduce((acc, curr) => {
    if (!curr) return acc;
    (curr.tracks || []).forEach(track => {
      if (!acc.find(t => t.id === track.id || (track.youtubeId && t.youtubeId === track.youtubeId))) {
        acc.push(track);
      }
    });
    return acc;
  }, [] as Track[]);

  const getAggregatedStats = () => {
    let totals = { tracks: 0, timeMs: 0, visits: 0 };
    const chartData: any[] = [];
    const today = new Date();

    if (statsPeriod === 'today') {
      const iso = today.toISOString().split('T')[0];
      const stat = userStats[iso] || { tracks: 0, timeMs: 0, visits: 0 };
      totals = { ...stat };
      chartData.push({ date: 'Сегодня', tracks: stat.tracks, hours: Number((stat.timeMs / 3600000).toFixed(2)), visits: stat.visits });
    } else if (statsPeriod === 'week' || statsPeriod === 'month') {
      const days = statsPeriod === 'week' ? 7 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const stat = userStats[iso] || { tracks: 0, timeMs: 0, visits: 0 };
        chartData.push({
          date: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
          tracks: stat.tracks,
          hours: Number((stat.timeMs / 3600000).toFixed(2)),
          visits: stat.visits
        });
        totals.tracks += stat.tracks;
        totals.timeMs += stat.timeMs;
        totals.visits += stat.visits;
      }
    } else {
      const monthsBack = statsPeriod === 'year' ? 12 : 60;
      const monthMap: Record<string, { tracks: number, timeMs: number, visits: number }> = {};
      
      for(let i=monthsBack - 1; i>=0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap[mKey] = { tracks: 0, timeMs: 0, visits: 0 };
      }
      
      Object.keys(userStats).forEach(iso => {
         const d = new Date(iso);
         const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
         if (monthMap[mKey]) {
            monthMap[mKey].tracks += userStats[iso].tracks;
            monthMap[mKey].timeMs += userStats[iso].timeMs;
            monthMap[mKey].visits += userStats[iso].visits;
         }
      });
      
      const sortedKeys = Object.keys(monthMap).sort();
      sortedKeys.forEach(mKey => {
         const stat = monthMap[mKey];
         const [y, m] = mKey.split('-');
         const dateLabel = new Date(Number(y), Number(m)-1).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
         chartData.push({
            date: dateLabel,
            tracks: stat.tracks,
            hours: Number((stat.timeMs / 3600000).toFixed(2)),
            visits: stat.visits
         });
      });
      
      Object.values(userStats).forEach(s => {
         // for all time we calculate totals across ALL keys, for year we could limit, but let's just use all for 'all'
      });

      if (statsPeriod === 'all') {
         Object.values(userStats).forEach((s: any) => {
            totals.tracks += s.tracks;
            totals.timeMs += s.timeMs;
            totals.visits += s.visits;
         });
      } else {
         sortedKeys.forEach(mKey => {
            totals.tracks += monthMap[mKey].tracks;
            totals.timeMs += monthMap[mKey].timeMs;
            totals.visits += monthMap[mKey].visits;
         });
      }
    }

    return { chartData, totals };
  };

  const formatTime = (time: number) => {
    if (typeof time !== 'number' || isNaN(time) || !isFinite(time)) return "--:--";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSearchUsers = async () => {
    if (!userSearchQuery.trim()) return;
    try {
      const usersRef = ref(db, 'public_users');
      const snapshot = await get(usersRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        console.log("Searching users...", data);
        const results = Object.keys(data)
          .map(uid => ({ uid, ...data[uid] }))
          .filter(u => {
            const searchName = u.username || u.fullName || u.displayName;
            if (!searchName) return false;
            // Разрешаем находить всех, чтобы проверить, что поиск работает (потом можно вернуть исключение себя)
            return searchName.toLowerCase().includes(userSearchQuery.toLowerCase());
          });
        
        if (results.length === 0) {
          alert('Пользователи не найдены.');
        }
        setUserSearchResults(results);
      } else {
        alert('В базе нет пользователей.');
        setUserSearchResults([]);
      }
    } catch (err: any) {
      console.error(err);
      alert('Ошибка при поиске: ' + (err.message || 'недостаточно прав из-за правил Firebase.'));
    }
  };

  const inviteUser = async (uid: string, type: 'session' | 'collab_playlist', targetId?: string) => {
    if (!currentUser) return;
    let actualTargetId = targetId;

    if (type === 'session' && !actualTargetId) {
      if (currentSessionId) {
        actualTargetId = currentSessionId;
      } else {
        actualTargetId = Date.now().toString();
        const sessionRef = ref(db, `sessions/${actualTargetId}`);
        await set(sessionRef, {
          hostId: currentUser.uid,
          hostName: currentUser.displayName,
          participants: {
            [currentUser.uid]: { name: currentUser.displayName, isReady: true }
          },
          currentTrack: null,
          isPlaying: false,
          currentTime: 0,
          updatedAt: Date.now()
        });
        setCurrentSessionId(actualTargetId);
      }
    }

    const inviteRef = push(ref(db, `invites/${uid}`));
    await set(inviteRef, {
      fromUid: currentUser.uid,
      fromName: currentUser.displayName || 'Пользователь',
      toUid: uid,
      type,
      targetId: actualTargetId || '',
      status: 'pending',
      timestamp: Date.now()
    });
    alert('Приглашение отправлено!');
  };

  const acceptInvite = async (invite: any) => {
    try {
      const inviteRef = ref(db, `invites/${currentUser?.uid}/${invite.id}`);
      await remove(inviteRef); // or set status 'accepted'

      if (invite.type === 'session') {
        const sessionRef = ref(db, `sessions/${invite.targetId}/participants/${currentUser?.uid}`);
        await set(sessionRef, { name: currentUser?.displayName, isReady: true });
        setCurrentSessionId(invite.targetId);
        setActiveTab('home');
      } else if (invite.type === 'collab_playlist') {
        alert('Присоединение к совместному плейлисту (в разработке)');
      }
    } catch (e) {
      console.error('Accept invite error:', e);
    }
  };

  const declineInvite = async (inviteId: string) => {
    if (!currentUser) return;
    const inviteRef = ref(db, `invites/${currentUser.uid}/${inviteId}`);
    await remove(inviteRef);
  };

  if (isAuthLoading) {
    return (
      <div className="flex flex-col h-screen bg-black items-center justify-center text-green-500">
        <Loader2 className="animate-spin" size={48} />
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen />;
  }

  return (
    <>
    <div className={`flex flex-col h-screen font-sans overflow-hidden bg-black text-white ${theme === 'light' ? 'light-theme-wrapper' : ''} ${layoutTheme === 'material3' ? 'material3-theme-wrapper' : ''}`}>
      {hasUpdate && (
        <div className="bg-[var(--accent)] text-white px-4 py-2 flex items-center justify-between z-50 shrink-0">
          <div className="flex items-center gap-2">
            <RefreshCw size={18} />
            <span className="font-medium text-sm">Доступна новая версия: {latestVersion}!</span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.open('https://github.com/TairTasNis/Tesify/releases/latest/download/Tesify.exe', '_blank')}
              className="bg-black/20 hover:bg-black/30 text-white px-3 py-1 rounded-full text-xs font-bold transition"
            >
              Скачать
            </button>
            <button onClick={() => setHasUpdate(false)} className="hover:opacity-80 transition">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Invites Popup */}
      {invites.length > 0 && (
        <div className="fixed top-4 right-4 z-[999] flex flex-col gap-2 pointer-events-none">
          {invites.map(inv => (
            <div key={inv.id} className="bg-zinc-800 border border-[var(--accent)] text-white p-4 rounded-xl shadow-2xl flex flex-col gap-3 w-80 pointer-events-auto animate-in slide-in-from-right-8">
              <div>
                <p className="font-semibold text-sm">{inv.fromName} приглашает вас</p>
                <p className="text-xs text-zinc-400">
                  {inv.type === 'session' ? 'в совместное прослушивание' : 'в совместный плейлист'}
                </p>
              </div>
              <div className="flex gap-2 justify-end mt-1">
                <button 
                  onClick={() => declineInvite(inv.id)}
                  className="px-3 py-1 text-xs rounded-full bg-zinc-700 hover:bg-zinc-600 transition"
                >
                  Отклонить
                </button>
                <button 
                  onClick={() => acceptInvite(inv)}
                  className="px-3 py-1 text-xs rounded-full bg-[var(--accent)] hover:brightness-110 text-black font-semibold transition"
                >
                  Принять
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden p-2 gap-2">
        {/* Sidebar */}
        {layoutTheme !== 'material3' && (
        <div className={`w-16 ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} bg-zinc-900 rounded-lg flex flex-col shrink-0 transition-all duration-300`}>
          <div className="p-4 md:px-4 md:py-6 pb-2">
            <div className={`flex items-center mb-8 ${isSidebarCollapsed ? 'justify-center' : 'justify-between md:pl-2'}`}>
              <div className={`items-center gap-2 hidden md:flex ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
                <h1 className="text-2xl font-bold tracking-tight -mt-2">Tesify</h1>
              </div>
              {isSidebarCollapsed && (
                <button
                  onClick={() => !isSidebarForcedHidden && setIsSidebarCollapsed(false)}
                  className={`hidden md:flex shrink-0 ${isSidebarForcedHidden ? 'text-green-500 cursor-default' : 'text-green-500 hover:text-green-400 transition-colors'}`}
                  title={isSidebarForcedHidden ? 'Tesify' : 'Развернуть'}
                >
                  <Music size={24} />
                </button>
              )}
              <Music size={24} className="text-green-500 shrink-0 md:hidden" />

              {!isSidebarCollapsed && (
                <button
                  onClick={() => setIsSidebarCollapsed(true)}
                  className="hidden md:flex text-zinc-400 hover:text-white transition-colors shrink-0 -mt-2"
                  title="Свернуть"
                >
                  <Menu size={20} />
                </button>
              )}
            </div>
            <div className="space-y-4 pt-4">
              {true && (
                <div className={`flex items-center gap-3 px-1 md:px-2 pb-4 border-b border-white/10 mb-4 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
                  <div 
                    onClick={() => { setActiveTab('settings'); setSettingsSection('account'); }}
                    className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center shrink-0 cursor-pointer hover:bg-green-500/40 transition-colors overflow-hidden"
                    title="В профиль"
                  >
                    {currentUser?.photoURL ? (
                      <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon size={16} />
                    )}
                  </div>
                  {!isSidebarCollapsed && (
                    <div className="flex-1 overflow-hidden hidden md:block cursor-pointer" onClick={() => { setActiveTab('settings'); setSettingsSection('account'); }}>
                      <p className="text-sm font-semibold truncate hover:underline">{currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User'}</p>
                      <button onClick={(e) => { e.stopPropagation(); signOut(auth); }} className="text-xs text-red-400 hover:text-red-300 transition-colors">Выйти</button>
                    </div>
                  )}
                </div>
              )}
              {true && (
                <>
                  <button
                    onClick={() => setActiveTab('home')}
                    className={`flex items-center justify-center md:justify-start gap-4 font-semibold transition-colors w-full px-1 md:px-2 ${layoutTheme === 'material3' ? (activeTab === 'home' ? 'md3-sidebar-active' : 'md3-sidebar-inactive') : (activeTab === 'home' ? 'text-white' : 'text-zinc-400 hover:text-white')}`}
                    title="Главная"
                  >
                    <Home size={24} className="shrink-0 min-w-[24px]" />
                    <span className={`hidden md:block truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Главная</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('search')}
                    className={`flex items-center justify-center md:justify-start gap-4 font-semibold transition-colors w-full px-1 md:px-2 ${layoutTheme === 'material3' ? (activeTab === 'search' ? 'md3-sidebar-active' : 'md3-sidebar-inactive') : (activeTab === 'search' ? 'text-white' : 'text-zinc-400 hover:text-white')}`}
                    title="Поиск"
                  >
                    <Search size={24} className="shrink-0 min-w-[24px]" />
                    <span className={`hidden md:block truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Поиск</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 bg-zinc-900 rounded-lg mt-2 flex flex-col overflow-hidden">
            <div className="p-4 flex items-center justify-center md:justify-between px-2 md:px-4">
              <button
                onClick={() => {
                  if (activeTab === 'library') {
                    setIsLibrarySongsVisible(!isLibrarySongsVisible);
                  } else {
                    setActiveTab('library');
                    setIsLibrarySongsVisible(true);
                  }
                }}
                className={`flex items-center justify-center md:justify-start gap-2 font-semibold transition-colors px-1 md:px-2 w-full md:w-auto ${layoutTheme === 'material3' ? (activeTab === 'library' ? 'md3-sidebar-active' : 'md3-sidebar-inactive') : (activeTab === 'library' ? 'text-white' : 'text-zinc-400 hover:text-white')}`}
                title="Моя медиатека"
              >
                <LibraryIcon size={24} className="shrink-0 min-w-[24px]" />
                <span className={`hidden md:block truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Моя медиатека</span>
              </button>
              <div className={`hidden md:flex items-center gap-2 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
                <button
                  onClick={() => {
                    setImportTargetId('favorites');
                    setIsYoutubeModalOpen(true);
                  }}
                  className="cursor-pointer text-zinc-400 hover:text-red-500 transition-colors p-1"
                  title="Скачать с YouTube"
                >
                  <Youtube size={20} />
                </button>
                <label className="cursor-pointer text-zinc-400 hover:text-white transition-colors p-1" title="Добавить локальные файлы">
                  <Plus size={20} />
                  <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => {
                    setImportTargetId('favorites');
                    handleFileUpload(e);
                  }} />
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
              {isLibrarySongsVisible && allTracks.map((track, index) => {
                const sourcePlaylist = playlists.find(p => p.tracks.some(t => t.id === track.id));
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    key={track.id}
                    onClick={() => {
                      if (sourcePlaylist) {
                        const trackIndex = sourcePlaylist.tracks.findIndex(t => t.id === track.id);
                        if (trackIndex !== -1) playTrack(trackIndex, sourcePlaylist.id);
                      }
                    }}
                    className={`flex items-center justify-center md:justify-start gap-3 p-2 rounded-md cursor-pointer group hover:bg-zinc-800/50`}
                    title={`${track.artist} - ${track.title}`}
                  >
                    {(layoutTheme !== 'minimalistic' || !minimoConfig.hideCovers) && (
                      track.thumbnail ? (
                          <motion.img 
                            src={track.thumbnail || undefined} 
                            alt={track.title} 
                            className="w-10 h-10 md:w-12 md:h-12 min-w-[40px] md:min-w-[48px] rounded object-cover shrink-0 cursor-pointer hover:opacity-80 transition-opacity" 
                            onClick={(e) => { e.stopPropagation(); openTrackPage(track, 'sidebar'); }}
                          />
                      ) : (
                        <motion.div 
                          className="w-10 h-10 md:w-12 md:h-12 min-w-[40px] md:min-w-[48px] bg-zinc-800 rounded flex items-center justify-center shrink-0 cursor-pointer hover:bg-zinc-700 transition-colors"
                          onClick={(e) => { e.stopPropagation(); openTrackPage(track, 'sidebar'); }}
                        >
                          <Music size={20} className="text-zinc-400 shrink-0" />
                        </motion.div>
                      )
                    )}
                    <div className={`overflow-hidden hidden md:flex flex-1 items-center justify-between ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
                      <div>
                        <p className={`truncate font-medium text-white`}>
                          {track.title}
                        </p>
                        {(!layoutTheme || layoutTheme !== 'minimalistic' || !minimoConfig.hideArtist) && (
                          <p className="text-sm text-zinc-400 truncate">{track.artist}</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {isLibrarySongsVisible && allTracks.length === 0 && (
                <div className={`p-4 text-center text-sm text-zinc-400 ${isSidebarCollapsed ? 'hidden' : ''}`}>
                  Нажмите + чтобы добавить свои песни
                </div>
              )}
            </div>

            {/* Tesify Connect Button */}
            <div className="p-4 mt-auto border-t border-white/10">
              <button
                onClick={() => setActiveTab('connect')}
                className={`flex items-center justify-center md:justify-start gap-2 font-semibold transition-colors px-1 md:px-2 w-full md:w-auto ${activeTab === 'connect' ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                title="Tesify Connect"
              >
                <Radio size={24} className="shrink-0 min-w-[24px]" />
                <span className={`hidden md:block truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Tesify Connect</span>
              </button>
            </div>

            {/* Settings Button */}
            <div className="p-4 border-t border-white/10">
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center justify-center md:justify-start gap-2 font-semibold transition-colors px-1 md:px-2 w-full md:w-auto ${activeTab === 'settings' ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                title="Настройки"
              >
                <SettingsIcon size={24} className="shrink-0 min-w-[24px]" />
                <span className={`hidden md:block truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Настройки</span>
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Main Content */}
        <div className="flex-1 bg-zinc-900 rounded-lg overflow-y-auto no-scrollbar relative bg-gradient-to-b from-zinc-800 to-zinc-900">
          <div className="p-6 h-full flex flex-col">
            <AnimatePresence mode="wait">
              {activeTab === 'home' && (
                <motion.div
                  key="home"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full overflow-y-auto no-scrollbar pb-6"
                >
                  <h1 className="text-3xl font-bold mb-6">
                    Добрый день{currentUser?.displayName ? `, ${currentUser.displayName.split(' ')[0]}` : ''}
                  </h1>

                  {/* Dashboard filters */}
                  <div className="flex gap-2 mb-8 overflow-x-auto no-scrollbar bg-black/20 p-1.5 rounded-xl border border-white/5 w-fit">
                    {(['today', 'week', 'month', 'year', 'all'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setStatsPeriod(p)}
                        className={`relative px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${statsPeriod === p ? (layoutTheme === 'material3' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'bg-green-500 text-black') : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
                      >
                        {layoutTheme === 'material3' && statsPeriod === p && (
                          <motion.div
                            layoutId="md3DashboardFilterTab"
                            className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-lg z-0"
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          />
                        )}
                        <span className="relative z-10">{p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : p === 'year' ? 'Год' : 'Всё время'}</span>
                      </button>
                    ))}
                  </div>

                  {/* Stats Cards */}
                  {(() => {
                    const { chartData, totals } = getAggregatedStats();
                    return (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                          <div className="bg-zinc-800/50 border border-white/5 p-6 rounded-2xl flex flex-col justify-between group hover:bg-zinc-800 transition-colors">
                            <div className="flex items-center gap-3 text-zinc-400 mb-2">
                              <Music size={20} className="group-hover:text-green-500 transition-colors" />
                              <span className="font-semibold text-sm">Прослушано треков</span>
                            </div>
                            <span className="text-4xl font-bold text-white">{totals.tracks}</span>
                          </div>

                          <div className="bg-zinc-800/50 border border-white/5 p-6 rounded-2xl flex flex-col justify-between group hover:bg-zinc-800 transition-colors">
                            <div className="flex items-center gap-3 text-zinc-400 mb-2">
                              <Clock size={20} className="group-hover:text-amber-500 transition-colors" />
                              <span className="font-semibold text-sm">Время прослушивания</span>
                            </div>
                            <span className="text-4xl font-bold text-white">
                              {totals.timeMs > 3600000 
                                ? `${(totals.timeMs / 3600000).toFixed(1)} ч.`
                                : `${(totals.timeMs / 60000).toFixed(0)} мин.`}
                            </span>
                          </div>

                          <div className="bg-zinc-800/50 border border-white/5 p-6 rounded-2xl flex flex-col justify-between group hover:bg-zinc-800 transition-colors">
                            <div className="flex items-center gap-3 text-zinc-400 mb-2">
                              <BarChart2 size={20} className="group-hover:text-blue-500 transition-colors" />
                              <span className="font-semibold text-sm">Всего заходов</span>
                            </div>
                            <span className="text-4xl font-bold text-white">{totals.visits}</span>
                          </div>
                        </div>

                        {/* Charts Area */}
                        {chartData.length > 0 && (
                          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 w-full">
                            {/* Tracks Chart */}
                            <div className="bg-zinc-800/30 border border-white/5 p-4 sm:p-6 rounded-2xl w-full min-h-[250px]">
                              <h3 className="text-lg font-bold mb-4 text-white">Треки</h3>
                              <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                    <defs>
                                      <linearGradient id="colorTracks" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                                      </linearGradient>
                                    </defs>
                                    <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: '#27272a', border: 'none', borderRadius: '12px', color: '#fff' }}
                                      itemStyle={{ color: '#fff' }}
                                      cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '5 5' }}
                                    />
                                    <Area 
                                      type="monotone" 
                                      dataKey="tracks" 
                                      name="Треков" 
                                      stroke="#22c55e" 
                                      strokeWidth={3}
                                      fillOpacity={1} 
                                      fill="url(#colorTracks)" 
                                      activeDot={{ r: 6, fill: '#22c55e', stroke: '#18181b', strokeWidth: 2 }}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Hours Chart */}
                            <div className="bg-zinc-800/30 border border-white/5 p-4 sm:p-6 rounded-2xl w-full min-h-[250px]">
                              <h3 className="text-lg font-bold mb-4 text-white">Время (ч)</h3>
                              <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                    <defs>
                                      <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                      </linearGradient>
                                    </defs>
                                    <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: '#27272a', border: 'none', borderRadius: '12px', color: '#fff' }}
                                      itemStyle={{ color: '#fff' }}
                                      cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '5 5' }}
                                    />
                                    <Area 
                                      type="monotone" 
                                      dataKey="hours" 
                                      name="Часов" 
                                      stroke="#f59e0b" 
                                      strokeWidth={3}
                                      fillOpacity={1} 
                                      fill="url(#colorHours)" 
                                      activeDot={{ r: 6, fill: '#f59e0b', stroke: '#18181b', strokeWidth: 2 }}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Visits Chart */}
                            <div className="bg-zinc-800/30 border border-white/5 p-4 sm:p-6 rounded-2xl w-full min-h-[250px]">
                              <h3 className="text-lg font-bold mb-4 text-white">Заходы</h3>
                              <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                    <defs>
                                      <linearGradient id="colorVisits" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                      </linearGradient>
                                    </defs>
                                    <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: '#27272a', border: 'none', borderRadius: '12px', color: '#fff' }}
                                      itemStyle={{ color: '#fff' }}
                                      cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '5 5' }}
                                    />
                                    <Area 
                                      type="monotone" 
                                      dataKey="visits" 
                                      name="Заходов" 
                                      stroke="#3b82f6" 
                                      strokeWidth={3}
                                      fillOpacity={1} 
                                      fill="url(#colorVisits)" 
                                      activeDot={{ r: 6, fill: '#3b82f6', stroke: '#18181b', strokeWidth: 2 }}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </motion.div>
              )}
              {activeTab === 'search' && (
                <motion.div
                  key="search"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full flex-1"
                >
                  <h1 className="text-3xl font-bold mb-6">Поиск</h1>
                <form onSubmit={handleSearch} className="relative max-w-md mb-8">
                  <Search className="absolute left-3 top-3 text-zinc-400" size={20} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Что хочешь послушать?"
                    className="w-full bg-zinc-800 text-white rounded-full py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-white/20"
                  />
                  <button type="submit" className="hidden">?скать</button>
                </form>

                <div className="flex-1 overflow-y-auto no-scrollbar">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-10 text-zinc-400">
                      <Loader2 className="animate-spin mr-2" size={24} /> ?щем...
                    </div>
                  ) : searchError ? (
                    <div className="text-red-400 py-4">{searchError}</div>
                  ) : searchResults.length > 0 ? (
                    <div className="space-y-2">
                      {searchResults.map((track) => {
                        const isSavedGlobally = playlists.some(p => p.tracks.some(t => t.id === track.id || (t.youtubeId && track.youtubeId && t.youtubeId === track.youtubeId)));
                        return (
                          <div key={track.id} onClick={() => openTrackPage(track, 'search')} className="flex items-center gap-4 p-3 rounded-md hover:bg-white/10 group cursor-pointer">
                            {(layoutTheme !== 'minimalistic' || !minimoConfig.hideCovers) && (
                              track.thumbnail ? (
                                <motion.img layoutId={`search-cover-${track.id}`} src={track.thumbnail || undefined} alt={track.title} className="w-12 h-12 rounded object-cover" />
                              ) : (
                                <motion.div layoutId={`search-cover-${track.id}`} className="w-12 h-12 bg-zinc-800 rounded flex items-center justify-center">
                                  <Music size={20} className="text-zinc-400" />
                                </motion.div>
                              )
                            )}
                            <div className="flex-1 min-w-0 hidden sm:block">
                              <motion.div layoutId={`search-title-${track.id}`} className="font-semibold truncate">{track.title}</motion.div>
                              {(!layoutTheme || layoutTheme !== 'minimalistic' || !minimoConfig.hideArtist) && (
                                <motion.div layoutId={`search-artist-${track.id}`} className="text-sm text-zinc-400 truncate">{track.artist}</motion.div>
                              )}
                            </div>
                            <div className="w-16 text-right text-sm text-zinc-400">
                              {track.durationMs ? `${Math.floor(track.durationMs / 60000)}:${Math.floor((track.durationMs % 60000) / 1000).toString().padStart(2, '0')}` : '--:--'}
                            </div>
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTrackMenuOpenId(trackMenuOpenId === track.id ? null : track.id);
                                }}
                                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-colors"
                                title="Добавить в плейлист"
                              >
                                {isSavedGlobally ? <Check size={20} className="text-green-500" /> : <Plus size={20} />}
                              </button>

                              {trackMenuOpenId === track.id && (
                                <div className="absolute right-0 mt-2 w-48 bg-zinc-800 rounded-md shadow-2xl py-1 z-50 border border-white/10">
                                  <div className="px-3 py-2 text-xs font-semibold text-zinc-400 border-b border-white/10">Где сохранено:</div>
                                  {playlists.map(pl => {
                                    const isSavedInPl = pl.tracks.some(t => t.id === track.id || (t.youtubeId && track.youtubeId && t.youtubeId === track.youtubeId));
                                    return (
                                      <button
                                        key={pl.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPlaylists(prev => prev.map(p => {
                                            if (p.id === pl.id) {
                                              if (isSavedInPl) {
                                                return { ...p, tracks: p.tracks.filter(t => t.id !== track.id && t.youtubeId !== track.youtubeId) };
                                              } else {
                                                return { ...p, tracks: [...p.tracks, { ...track, addedAt: Date.now() }] };
                                              }
                                            }
                                            return p;
                                          }));
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-700 transition-colors flex items-center justify-between"
                                      >
                                        <span className="truncate">{pl.title}</span>
                                        {isSavedInPl && <Check size={14} className="text-green-500 shrink-0 ml-2" />}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : searchQuery && !isSearching ? (
                    <div className="text-zinc-400 py-4">Ничего не найдено</div>
                  ) : null}
                </div>
                </motion.div>
              )}
              {activeTab === 'library' && (
                <motion.div
                  key="library"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex-1 block"
                >
                  <div>
                {!activePlaylist ? (
                  // PLAYLIST GRID VIEW
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <h1 className="text-3xl font-bold">Моя медиатека</h1>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            const isCollab = confirm("Сделать плейлист совместным?");
                            const title = prompt("Название нового плейлиста:");
                            if (title) {
                              setPlaylists(prev => [...prev, {
                                id: Math.random().toString(36).substring(7),
                                title,
                                tracks: [],
                                isCollaborative: isCollab,
                                ownerId: currentUser?.uid,
                                collaborators: [currentUser?.uid || '']
                              }]);
                            }
                          }}
                          className="bg-green-500 text-black px-4 py-2 rounded-full font-bold cursor-pointer hover:scale-105 transition-transform flex items-center gap-2"
                        >
                          <Plus size={20} />
                          Создать плейлист
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {playlists.map((playlist, idx) => (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          key={playlist.id}
                          onClick={() => setActivePlaylistId(playlist.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setPlaylistContextMenu({ id: playlist.id, x: e.clientX, y: e.clientY });
                          }}
                          className="bg-zinc-800/50 hover:bg-zinc-800 p-4 rounded-md cursor-pointer transition-colors group relative"
                        >
                          <div className="aspect-square w-full bg-zinc-700 rounded-md mb-4 flex items-center justify-center shadow-lg overflow-hidden">
                            {playlist.coverUrl ? (
                              <img src={playlist.coverUrl || undefined} alt={playlist.title} className="w-full h-full object-cover" />
                            ) : playlist.isSystem ? (
                              <div className="w-full h-full bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
                                <Heart fill="#ffffff" color="#ffffff" size={48} className="drop-shadow-lg" />
                              </div>
                            ) : (
                              <Music size={48} className="text-zinc-500" />
                            )}
                          </div>
                          <h3 className="font-bold text-lg truncate mb-1">
                            {playlist.title} {playlist.isCollaborative && '🤝'}
                          </h3>
                          <p className="text-sm text-zinc-400">
                            {playlist.tracks.length} {
                              [1].includes(playlist.tracks.length % 10) && ![11].includes(playlist.tracks.length % 100) ? 'трек' :
                                [2, 3, 4].includes(playlist.tracks.length % 10) && ![12, 13, 14].includes(playlist.tracks.length % 100) ? 'трека' :
                                  'треков'
                            }
                          </p>

                          {/* Play Button Overlay */}
                          <div className="absolute right-6 bottom-20 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (playlist.tracks.length > 0) {
                                  const sorted = getSortedTracks(playlist.tracks);
                                  const idx = playlist.tracks.findIndex(t => t.id === sorted[0].id);
                                  playTrack(idx, playlist.id);
                                }
                              }}
                              className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-black hover:scale-105 hover:bg-green-400 shadow-xl"
                            >
                              <Play size={24} fill="currentColor" className="ml-1" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </>
                ) : (
                  // PLAYLIST DETAIL VIEW
                  <>
                    <div className="flex items-center gap-4 mb-8">
                      <button
                        onClick={() => setActivePlaylistId(null)}
                        className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors"
                      >
                        <ArrowLeft size={24} />
                      </button>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6 mb-8 items-end">
                      <div className="w-48 h-48 md:w-60 md:h-60 shadow-2xl shrink-0 group relative rounded-md overflow-hidden bg-zinc-800">
                        {activePlaylist.coverUrl ? (
                          <img src={activePlaylist.coverUrl || undefined} alt={activePlaylist.title} className="w-full h-full object-cover" />
                        ) : activePlaylist.isSystem ? (
                          <div className="w-full h-full bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
                            <Heart fill="#ffffff" color="#ffffff" size={80} className="drop-shadow-xl" />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music size={80} className="text-zinc-600" />
                          </div>
                        )}

                        {!activePlaylist.isSystem && (
                          <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer">
                            <PenSquare size={48} className="mb-2" />
                            <span className="text-xs font-semibold">?зменить фото</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  alert('Загрузка изображения...');
                                  const url = await uploadToImgBB(file);
                                  if (url) {
                                    setPlaylists(prev => prev.map(p => p.id === activePlaylist.id ? { ...p, coverUrl: url } : p));
                                    alert('Обложка успешно обновлена!');
                                  } else {
                                    alert('Ошибка при загрузке изображения.');
                                  }
                                }
                              }}
                            />
                          </label>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 flex-1">
                        <span className="text-sm font-bold uppercase">{activePlaylist.isSystem ? 'Системный плейлист' : 'Плейлист'}</span>
                        <h1 className="text-4xl md:text-7xl font-bold tracking-tighter mb-4">
                          {activePlaylist.title} {activePlaylist.isCollaborative && <span className="text-sm align-middle ml-2 bg-white/10 px-3 py-1 rounded-full border border-white/20">🤝 Совместный</span>}
                        </h1>
                        {activePlaylist.description && (
                          <p className="text-zinc-300 text-sm mb-2">{activePlaylist.description}</p>
                        )}
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="text-zinc-400">
                            {activePlaylist.tracks.length} {
                              [1].includes(activePlaylist.tracks.length % 10) && ![11].includes(activePlaylist.tracks.length % 100) ? 'трек' :
                                [2, 3, 4].includes(activePlaylist.tracks.length % 10) && ![12, 13, 14].includes(activePlaylist.tracks.length % 100) ? 'трека' :
                                  'треков'
                            }
                            {formatPlaylistDuration(activePlaylist.tracks)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 mb-8 px-4">
                      <button
                        onClick={() => {
                          if (activePlaylist.tracks.length > 0) {
                            const sorted = getSortedTracks(activePlaylist.tracks);
                            const idx = activePlaylist.tracks.findIndex(t => t.id === sorted[0].id);
                            playTrack(idx, activePlaylist.id);
                          }
                        }}
                        className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center text-black hover:scale-105 hover:bg-green-400 transition-all shadow-xl"
                      >
                        <Play size={28} fill="currentColor" className="ml-1" />
                      </button>

                      {/* Import Buttons (Available for all playlists) */}
                      <div className="flex gap-2 ml-auto relative">
                        <button
                          onClick={() => {
                            setImportTargetId(activePlaylistId || 'favorites');
                            setIsImportMenuOpen(!isImportMenuOpen);
                          }}
                          className={`bg-transparent border border-zinc-600 text-white px-2 py-2 md:px-4 rounded-full font-bold cursor-pointer transition-all text-sm flex items-center gap-2 ${isImportMenuOpen ? 'bg-white/10 border-white' : 'hover:bg-white/10 hover:border-white'}`}
                        >
                          <Plus size={20} className="md:hidden" />
                          <span className="hidden md:inline">Импортировать треки</span>
                        </button>
                        
                        {isImportMenuOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsImportMenuOpen(false)}></div>
                            <div className="absolute top-full right-0 mt-2 w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-100 text-sm">
                              <button
                                onClick={() => {
                                  setIsImportMenuOpen(false);
                                  setIsSpotifyModalOpen(true);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-zinc-800 transition-colors flex items-center gap-2"
                              >
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.6 14.6c-.2.3-.6.4-.9.2-2.4-1.5-5.4-1.8-8.9-1-.3.1-.7-.1-.8-.4-.1-.3.1-.7.4-.8 3.8-.9 7.1-.5 9.8 1.1.3.2.4.6.2.9zm1.3-3c-.2.4-.7.5-1 .3-2.8-1.7-7.1-2.3-10.5-1.3-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.9-1.1 8.7-.5 11.9 1.5.3.2.4.7.2 1zm.1-3.1c-3.3-2-8.9-2.2-12.1-1.2-.5.2-1-.1-1.2-.6-.2-.5.1-1 .6-1.2 3.7-1.1 9.9-.9 13.6 1.3.5.3.6.9.3 1.3-.2.4-.8.5-1.2.4z"></path></svg>
                                Из Spotify
                              </button>
                              <button
                                onClick={() => {
                                  setIsImportMenuOpen(false);
                                  setIsYoutubeModalOpen(true);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-zinc-800 transition-colors flex items-center gap-2"
                              >
                                <Youtube size={16} className="text-red-500" />
                                Из YouTube
                              </button>
                              <button
                                onClick={() => {
                                  setIsImportMenuOpen(false);
                                  setIsLinkModalOpen(true);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-zinc-800 transition-colors flex items-center gap-2"
                              >
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                Из ссылки из сайта
                              </button>
                            </div>
                          </>
                        )}
                        
                        <label className="bg-transparent border border-zinc-600 text-white px-2 py-2 md:px-4 rounded-full font-bold cursor-pointer hover:bg-white/10 hover:border-white transition-all text-sm flex items-center gap-2">
                          <Plus size={20} className="md:hidden" />
                          <span className="hidden md:inline">Загрузить файлы</span>
                          <input type="file" accept="audio/*" multiple className="hidden" onChange={handleFileUpload} />
                        </label>
                      </div>

                      {!activePlaylist.isSystem && (
                        <div className="flex gap-2 ml-2">
                          <button
                            onClick={() => {
                              if (confirm('Вы уверены, что хотите удалить этот плейлист?')) {
                                setPlaylists(prev => prev.filter(p => p.id !== activePlaylist.id));
                                setActivePlaylistId(null);
                              }
                            }}
                            className="text-zinc-400 hover:text-white transition-colors p-2"
                            title="Удалить плейлист"
                          >
                            <Trash2 size={24} />
                          </button>
                        </div>
                      )}
                    </div>


                    <div className="space-y-1">
                      {/* Table Header */}
                      <div className="flex items-center gap-4 p-3 border-b border-white/10 mb-2 text-sm text-zinc-400 font-semibold px-4">
                        <div 
                          className="w-8 text-center cursor-pointer hover:text-white select-none relative"
                          onClick={() => handleSort('index')}
                          title="Сортировка по номеру"
                        >
                          #
                          {sortField === 'index' && (
                            <span className="absolute -right-2 top-0">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </div>
                        <div className="flex-1 flex text-left">
                          <div 
                            className="cursor-pointer hover:text-white flex items-center gap-1 select-none"
                            onClick={() => handleSort('title')}
                          >
                            Название {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
                          </div>
                        </div>
                        <div className="w-32 hidden md:flex text-left">
                          <div 
                            className="cursor-pointer hover:text-white flex items-center gap-1 select-none"
                            onClick={() => handleSort('addedAt')}
                          >
                            Дата добавления {sortField === 'addedAt' && (sortDirection === 'desc' ? '↓' : '↑')}
                          </div>
                        </div>
                        <div className="w-16 hidden md:flex justify-end">
                          <div 
                            className="cursor-pointer hover:text-white flex items-center gap-1 select-none text-zinc-400"
                            onClick={() => handleSort('durationMs')}
                            title="Сортировка по длительности"
                          >
                            <Clock size={16} /> 
                            {sortField === 'durationMs' && (
                              <span className="text-xs">{sortDirection === 'desc' ? '↓' : '↑'}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {getSortedTracks(activePlaylist.tracks).map((track, sortedIndex) => {
                        const index = activePlaylist.tracks.findIndex(t => t.id === track.id);
                        return (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: sortedIndex * 0.05 }}
                          key={track.id}
                          onClick={(e) => handleTrackSelect(e, track.id, index, activePlaylist.tracks)}
                          onContextMenu={(e) => handleTrackSelect(e, track.id, index, activePlaylist.tracks)}
                          className={`flex items-center gap-4 p-3 rounded-md cursor-pointer group select-none ${selectedTrackIds.has(track.id) ? 'bg-zinc-700/80' : 'hover:bg-white/10'}`}
                        >
                          <div className={`w-8 text-center text-zinc-400 group-hover:hidden ${currentTrackIndex === index && currentPlayingPlaylistId === activePlaylist.id ? 'text-green-500' : ''}`}>
                            {currentTrackIndex === index && currentPlayingPlaylistId === activePlaylist.id && isLoadingTrack ? (
                              <Loader2 size={16} className="animate-spin mx-auto text-green-500" />
                            ) : currentTrackIndex === index && currentPlayingPlaylistId === activePlaylist.id && isPlaying ? (
                              (!layoutTheme || layoutTheme !== 'minimalistic' || !minimoConfig.hideVisualizer) ? (
                                <div className="flex items-end justify-center gap-[2px] h-4">
                                  <div className="w-[3px] bg-green-500 animate-music-bar" style={{ animationDuration: '0.6s' }}></div>
                                  <div className="w-[3px] bg-green-500 animate-music-bar" style={{ animationDuration: '0.9s', animationDelay: '0.1s' }}></div>
                                  <div className="w-[3px] bg-green-500 animate-music-bar" style={{ animationDuration: '0.7s', animationDelay: '0.3s' }}></div>
                                  <div className="w-[3px] bg-green-500 animate-music-bar" style={{ animationDuration: '0.8s', animationDelay: '0.2s' }}></div>
                                  <div className="w-[3px] bg-green-500 animate-music-bar" style={{ animationDuration: '0.5s', animationDelay: '0.4s' }}></div>
                                </div>
                              ) : (
                                <Play size={16} className="mx-auto" fill="currentColor" />
                              )
                            ) : (
                              index + 1
                            )}
                          </div>
                          <div className="w-8 text-center hidden group-hover:block">
                            <Play size={16} className="mx-auto" />
                          </div>
                          {(layoutTheme !== 'minimalistic' || !minimoConfig.hideCovers) && (
                            track.thumbnail ? (
                              <motion.img 
                                layoutId={`playlist-cover-${track.id}`}
                                src={track.thumbnail || undefined} 
                                alt={track.title} 
                                className="w-10 h-10 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity" 
                                onClick={(e) => { e.stopPropagation(); openTrackPage(track, 'playlist'); }}
                              />
                            ) : (
                              <motion.div 
                                layoutId={`playlist-cover-${track.id}`}
                                className="w-10 h-10 bg-zinc-800 rounded flex items-center justify-center cursor-pointer hover:bg-zinc-700 transition-colors"
                                onClick={(e) => { e.stopPropagation(); openTrackPage(track, 'playlist'); }}
                              >
                                <Music size={16} className="text-zinc-400" />
                              </motion.div>
                            )
                          )}
                          <div className="flex-1 overflow-hidden sm:flex items-center justify-between">
                            <div>
                              <motion.p layoutId={`playlist-title-${track.id}`} className={`truncate font-medium ${currentTrackIndex === index && currentPlayingPlaylistId === activePlaylist.id ? 'text-green-500' : 'text-white'}`}>
                                {track.title}
                              </motion.p>
                              {(!layoutTheme || layoutTheme !== 'minimalistic' || !minimoConfig.hideArtist) && (
                                <motion.p layoutId={`playlist-artist-${track.id}`} className="text-sm text-zinc-400 truncate">{track.artist}</motion.p>
                              )}
                            </div>
                          </div>
                          <div className="w-32 hidden md:block text-sm text-zinc-400 truncate">
                            {track.addedAt ? new Date(track.addedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          </div>
                          <div className="w-16 text-right text-sm text-zinc-400">
                            {track.durationMs ? `${Math.floor(track.durationMs / 60000)}:${Math.floor((track.durationMs % 60000) / 1000).toString().padStart(2, '0')}` : '--:--'}
                          </div>
                        </motion.div>
                        );
                      })}
                      {activePlaylist.tracks.length === 0 && (
                        <div className="text-center py-20">
                          <Music size={48} className="mx-auto text-zinc-600 mb-4" />
                          <h2 className="text-xl font-bold mb-2">Здесь пока пусто</h2>
                          <p className="text-zinc-400 mb-6">Добавьте треки в этот плейлист, чтобы начать слушать.</p>
                          <label className="bg-white text-black px-6 py-3 rounded-full font-bold cursor-pointer hover:scale-105 transition-transform inline-block">
                            Выбрать файлы
                            <input type="file" accept="audio/*" multiple className="hidden" onChange={handleFileUpload} />
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                )}
                  </div>
                </motion.div>
              )}
              {activeTab === 'track' && viewingTrack && (
                <motion.div
                  key="track"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full flex-1"
                >
                  <TrackPageView track={viewingTrack} currentUser={currentUser} context={viewingTrackContext} onBack={() => { setActiveTab(previousTab); }} onOpenComments={() => setActiveTab('comments')} playlists={playlists} setPlaylists={setPlaylists} />
                </motion.div>
              )}
              {activeTab === 'comments' && viewingTrack && (
                <motion.div
                  key="comments"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full flex-1"
                >
                  <CommentsPageView track={viewingTrack} currentUser={currentUser} onBack={() => setActiveTab('track')} />
                </motion.div>
              )}
              {activeTab === 'connect' && (
                <motion.div
                  key="connect"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full flex-1"
                >
                  <h1 className="text-3xl font-bold mb-6">Tesify Connect</h1>
                  
                  <div className="flex gap-4 mb-6 border-b border-white/10 pb-4">
                    <button 
                      onClick={() => setConnectTabMode('listen')}
                      className={`px-4 py-2 rounded-full font-semibold transition ${connectTabMode === 'listen' ? 'bg-[var(--accent)] text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                      Совместное прослушивание
                    </button>
                  </div>

                  {connectTabMode === 'listen' && (
                    <div className="flex flex-col gap-6 max-w-2xl">
                      {!currentSessionId && (
                      <div className="bg-zinc-800/50 p-6 rounded-2xl border border-white/5 mb-4">
                        <h2 className="text-xl font-semibold mb-2">Подключиться по коду</h2>
                        <p className="text-zinc-400 mb-4 text-sm">Вставьте код сессии вашего друга, чтобы присоединиться</p>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            placeholder="Код сессии..."
                            value={joinSessionCode}
                            onChange={(e) => setJoinSessionCode(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && joinSessionCode.trim() && (async () => {
                                const refSnap = await get(ref(db, `sessions/${joinSessionCode.trim()}`));
                                if (refSnap.exists()) {
                                    setCurrentSessionId(joinSessionCode.trim());
                                    await set(ref(db, `sessions/${joinSessionCode.trim()}/participants/${currentUser?.uid}`), { name: currentUser?.displayName, isReady: true });
                                    alert('Успешно подключено к сессии!');
                                } else {
                                    alert('Сессия не найдена. Проверьте код.');
                                }
                            })()}
                            className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-[var(--accent)] transition"
                          />
                          <button onClick={async () => {
                              if (!joinSessionCode.trim()) return;
                              const refSnap = await get(ref(db, `sessions/${joinSessionCode.trim()}`));
                              if (refSnap.exists()) {
                                  setCurrentSessionId(joinSessionCode.trim());
                                  await set(ref(db, `sessions/${joinSessionCode.trim()}/participants/${currentUser?.uid}`), { name: currentUser?.displayName, isReady: true });
                                  alert('Успешно подключено к сессии!');
                              } else {
                                  alert('Сессия не найдена. Проверьте код.');
                              }
                          }} className="px-4 py-2 bg-[var(--accent)] text-black font-semibold rounded-xl hover:brightness-110 transition">
                            Войти
                          </button>
                        </div>
                      </div>
                      )}

                      <div className="bg-zinc-800/50 p-6 rounded-2xl border border-white/5">
                        <h2 className="text-xl font-semibold mb-2">Найти пользователя</h2>
                        <p className="text-zinc-400 mb-4 text-sm">Введите никнейм друга, чтобы пригласить его в совместную сессию</p>
                        
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            placeholder="Никнейм..."
                            value={userSearchQuery}
                            onChange={(e) => setUserSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchUsers()}
                            className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-[var(--accent)] transition"
                          />
                          <button onClick={handleSearchUsers} className="bg-white/10 hover:bg-white/20 p-2 rounded-xl transition">
                            <Search size={20} />
                          </button>
                        </div>

                        {userSearchResults.length > 0 && (
                          <div className="mt-4 flex flex-col gap-2">
                            {userSearchResults.map(u => (
                              <div key={u.uid} className="flex items-center justify-between bg-zinc-900/50 p-3 rounded-lg">
                                <span className="font-medium">{u.displayName}</span>
                                <button 
                                  onClick={() => inviteUser(u.uid, 'session')}
                                  className="px-3 py-1 bg-[var(--accent)] text-black text-xs font-bold rounded-full hover:brightness-110 transition"
                                >
                                  Пригласить
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {currentSessionId && (
                          <div className="mt-6 p-4 bg-zinc-900/80 border border-green-500/30 rounded-xl text-sm shadow-[0_0_20px_rgba(34,197,94,0.1)] transition-all duration-300">
                            <div className="flex items-center gap-3 mb-2">
                                <span className="relative flex h-3 w-3">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                </span>
                                <p className="font-bold text-base text-green-400">Прямой эфир активен!</p>
                            </div>
                            <p className="mb-2 text-zinc-300">
                                Ваша роль: <span className="text-white font-medium">{isHost ? 'Хост (Вы управляете музыкой)' : `Слушатель (Подключено к ${syncSession?.hostName || 'другу'})`}</span>
                            </p>
                            <div className="mb-4 mt-2 flex items-center justify-between bg-black/30 p-2 rounded-lg border border-white/5">
                                <span className="text-zinc-400 text-xs">Код сессии:</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-mono text-xs">{currentSessionId}</span>
                                  <button onClick={() => { navigator.clipboard.writeText(currentSessionId); alert('Код скопирован!'); }} className="text-zinc-400 hover:text-white transition">
                                    <Languages size={14} /> 
                                  </button>
                                </div>
                            </div>
                            {syncSession?.participants && Object.keys(syncSession.participants).length > 1 && (
                                <div className="mb-4 text-xs">
                                  <span className="text-zinc-400">Участники:</span>
                                  <div className="mt-1 flex flex-col gap-1">
                                    {Object.entries(syncSession.participants as Record<string, any>).map(([uid, part]) => {
                                      const isTargetHost = syncSession.hostId === uid || (syncSession.coHosts && syncSession.coHosts[uid]);
                                      return (
                                        <div key={uid} className="flex items-center justify-between bg-white/5 px-2 py-1 rounded">
                                          <span className="text-white truncate">{part.name} {isTargetHost && <span className="text-green-500 text-[10px] ml-1">(Хост)</span>}</span>
                                          {syncSession.hostId === currentUser?.uid && uid !== currentUser?.uid && !isTargetHost && (
                                            <button onClick={() => set(ref(db, `sessions/${currentSessionId}/coHosts/${uid}`), true)} className="text-green-400 hover:text-green-300 bg-green-500/10 px-2 py-0.5 rounded transition">
                                              Дать права хоста
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                            )}

                            {syncSession?.currentTrack && (
                                <div className="mt-3 bg-black/60 rounded-lg p-3 flex items-center gap-3 border border-white/5">
                                    {syncSession.currentTrack.thumbnail ? (
                                        <img src={syncSession.currentTrack.thumbnail} className="w-10 h-10 rounded-md object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 bg-zinc-800 rounded-md flex items-center justify-center shrink-0"><Music size={16} /></div>
                                    )}
                                    <div className="flex-1 overflow-hidden">
                                        <p className="text-white text-sm font-medium truncate">{syncSession.currentTrack.title}</p>
                                        <p className="text-zinc-400 text-xs truncate">{syncSession.currentTrack.artist}</p>
                                    </div>
                                    {syncSession.isPlaying ? (
                                        <div className="flex gap-1 shrink-0 text-green-500 items-end h-4">
                                            <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1 bg-green-500 rounded-t-sm" />
                                            <motion.div animate={{ height: [8, 16, 8] }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-1 bg-green-500 rounded-t-sm" />
                                            <motion.div animate={{ height: [6, 14, 6] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1 bg-green-500 rounded-t-sm" />
                                        </div>
                                    ) : (
                                        <div className="text-zinc-500 text-xs shrink-0">Пауза</div>
                                    )}
                                </div>
                            )}
                            {syncSession?.hostId === currentUser?.uid && (
                                <p className="mt-3 text-xs text-zinc-500">
                                    Используйте поиск выше, чтобы найти друзей по никнейму и пригласить их.
                                </p>
                            )}
                            <button className="mt-4 w-full py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors rounded-lg font-medium text-xs" onClick={() => {
                                setCurrentSessionId(null);
                                setSyncSession(null);
                                if (syncSession?.hostId === currentUser?.uid) {
                                    remove(ref(db, `sessions/${currentSessionId}`)).catch(e => console.error(e));
                                }
                            }}>
                                {syncSession?.hostId === currentUser?.uid ? 'Завершить сессию' : 'Покинуть сессию'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
              {activeTab === 'settings' && (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full flex-1"
                >
                  <h1 className="text-3xl font-bold mb-6">Настройки</h1>
                  
                  <div className={`flex gap-6 mb-8 pb-2 overflow-x-auto no-scrollbar ${layoutTheme === 'material3' ? 'md3-settings-tabs' : 'border-b border-white/10'}`}>
                    {[
                      { id: 'customization', label: 'Кастомизация' },
                      { id: 'account', label: 'Аккаунт' },
                      { id: 'audio', label: 'Аудио' },
                      { id: 'downloads', label: 'Скачанная музыка' },
                      { id: 'about', label: 'О программе' },
                      { id: 'server', label: 'Сервер' }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setSettingsSection(tab.id as any)}
                        className={`relative whitespace-nowrap font-medium transition-colors ${layoutTheme === 'material3' ? (settingsSection === tab.id ? 'active-md3-tab' : 'inactive-md3-tab') : (settingsSection === tab.id ? 'pb-2 text-green-500 border-b-2 border-green-500' : 'pb-2 text-zinc-400 hover:text-white')}`}
                      >
                        {layoutTheme === 'material3' && settingsSection === tab.id && (
                          <motion.div
                            layoutId="md3SettingsActiveTab"
                            className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-full z-0"
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          />
                        )}
                        <span className="relative z-10">{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto pr-4 space-y-8 max-w-3xl">
                    {settingsSection === 'customization' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div>
                          <h3 className="text-lg font-bold mb-3">Стиль интерфейса (Layout)</h3>
                          <div className="flex gap-4">
                            <button onClick={() => setLayoutTheme('classic')} className={`px-4 py-2 rounded-md transition-colors ${layoutTheme === 'classic' ? 'bg-green-500 text-black font-semibold' : 'bg-white/10 text-white hover:bg-white/20'}`}>Classic</button>
                            <button onClick={() => setLayoutTheme('minimalistic')} className={`px-4 py-2 rounded-md transition-colors ${layoutTheme === 'minimalistic' ? 'bg-green-500 text-black font-semibold' : 'bg-white/10 text-white hover:bg-white/20'}`}>Minimalistic</button>
                            <button onClick={() => setLayoutTheme('material3')} className={`px-4 py-2 rounded-md transition-colors ${layoutTheme === 'material3' ? 'bg-green-500 text-black font-semibold' : 'bg-white/10 text-white hover:bg-white/20'}`}>Material Design 3</button>
                          </div>

                          {layoutTheme === 'material3' && (
                            <div className="mt-4 bg-black/20 p-4 rounded-lg border border-white/5 space-y-3">
                              <h4 className="font-semibold text-white mb-2">Настройки Material Design 3:</h4>
                              <label className="flex items-center gap-3 cursor-pointer text-sm">
                                <input type="checkbox" checked={md3AutoHideRail} onChange={e => setMd3AutoHideRail(e.target.checked)} className="w-4 h-4 accent-green-500" />
                                <span className={md3AutoHideRail ? 'text-white' : 'text-zinc-400'}>Автоматически скрывать панель (открывать при наведении)</span>
                              </label>
                              <label className="flex items-center gap-3 mt-4 cursor-pointer text-sm">
                                <input type="checkbox" checked={md3PlayerTheme} onChange={e => setMd3PlayerTheme(e.target.checked)} className="w-4 h-4 accent-green-500" />
                                <span className={md3PlayerTheme ? 'text-white' : 'text-zinc-400'}>Стиль плеера Material 3 (Плавающий)</span>
                              </label>
                              <div className="flex flex-col gap-2 mt-3">
                                <span className="text-sm text-zinc-400">Позиция панели меню:</span>
                                <select value={md3NavPosition} onChange={e => setMd3NavPosition(e.target.value as any)} className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm w-full outline-none focus:border-green-500 transition-colors">
                                  <option value="right">Справа</option>
                                  <option value="left">Слева</option>
                                  <option value="top">Сверху</option>
                                  <option value="bottom">Снизу</option>
                                  <option value="floating">Свободное перемещение</option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-2 mt-3">
                                <span className="text-sm text-zinc-400">Ориентация панели:</span>
                                <select value={md3NavOrientation} onChange={e => setMd3NavOrientation(e.target.value as any)} className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm w-full outline-none focus:border-green-500 transition-colors">
                                  <option value="auto">Автоматически (по позиции)</option>
                                  <option value="vertical">Всегда вертикальная</option>
                                  <option value="horizontal">Всегда горизонтальная</option>
                                </select>
                              </div>
                              {md3NavPosition === 'floating' && (
                                <button onClick={() => setMd3NavKey(prev => prev + 1)} className="mt-3 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg px-3 py-2 transition-colors w-full">
                                  Сбросить перемещение
                                </button>
                              )}
                            </div>
                          )}

                          {layoutTheme === 'minimalistic' && (
                            <div className="mt-4 bg-black/20 p-4 rounded-lg border border-white/5 space-y-3">
                              <h4 className="font-semibold text-white mb-2">Настройки минимализма:</h4>
                              <label className="flex items-center gap-3 cursor-pointer text-sm">
                                <input type="checkbox" checked={minimoConfig.hideSidebar} onChange={e => setMinimoConfig({...minimoConfig, hideSidebar: e.target.checked})} className="w-4 h-4 accent-green-500" />
                                <span className={minimoConfig.hideSidebar ? 'text-white' : 'text-zinc-400'}>Скрыть левое меню (оставить только иконки)</span>
                              </label>
                              <label className="flex items-center gap-3 cursor-pointer text-sm">
                                <input type="checkbox" checked={minimoConfig.hideCovers} onChange={e => setMinimoConfig({...minimoConfig, hideCovers: e.target.checked})} className="w-4 h-4 accent-green-500" />
                                <span className={minimoConfig.hideCovers ? 'text-white' : 'text-zinc-400'}>Скрыть обложки треков в списках</span>
                              </label>
                              <label className="flex items-center gap-3 cursor-pointer text-sm">
                                <input type="checkbox" checked={minimoConfig.hideArtist} onChange={e => setMinimoConfig({...minimoConfig, hideArtist: e.target.checked})} className="w-4 h-4 accent-green-500" />
                                <span className={minimoConfig.hideArtist ? 'text-white' : 'text-zinc-400'}>Скрыть авторов песен</span>
                              </label>
                              <label className="flex items-center gap-3 cursor-pointer text-sm">
                                <input type="checkbox" checked={minimoConfig.hideVisualizer} onChange={e => setMinimoConfig({...minimoConfig, hideVisualizer: e.target.checked})} className="w-4 h-4 accent-green-500" />
                                <span className={minimoConfig.hideVisualizer ? 'text-white' : 'text-zinc-400'}>Скрыть визуализатор (прыгающие полоски)</span>
                              </label>
                              <label className="flex items-center gap-3 cursor-pointer text-sm">
                                <input type="checkbox" checked={minimoConfig.simplifiedPlayer} onChange={e => setMinimoConfig({...minimoConfig, simplifiedPlayer: e.target.checked})} className="w-4 h-4 accent-green-500" />
                                <span className={minimoConfig.simplifiedPlayer ? 'text-white' : 'text-zinc-400'}>Упрощенный плеер снизу</span>
                              </label>
                            </div>
                          )}
                        </div>

                        <div className="pt-4 border-t border-white/10">
                          <h3 className="text-lg font-bold mb-3">Вид текста песен</h3>
                          <div className="flex flex-col gap-2">
                            <span className="text-sm text-zinc-400">Анимация текста:</span>
                            <select value={lyricsAnimation} onChange={e => setLyricsAnimation(e.target.value as any)} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm w-full md:w-1/2 outline-none focus:border-green-500 transition-colors">
                              <option value="classic">Классическая</option>
                              <option value="apple">Улучшенный</option>
                            </select>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-white/10">
                          <h3 className="text-lg font-bold mb-3">Оформление (Цвета)</h3>
                          <div className="flex gap-4 mb-6">
                            <button onClick={() => setTheme('dark')} className={`px-4 py-2 rounded-md ${theme === 'dark' ? 'bg-green-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>Тёмная</button>
                            <button onClick={() => setTheme('light')} className={`px-4 py-2 rounded-md ${theme === 'light' ? 'bg-green-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>Светлая</button>
                          </div>
                          
                          <h3 className="text-lg font-bold mb-3">Акцентный цвет</h3>
                          <div className="flex items-center gap-4">
                            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-12 h-12 rounded cursor-pointer bg-transparent border-0 p-0" />
                            <span className="text-zinc-400">{accentColor}</span>
                            <button onClick={() => setAccentColor('#22c55e')} className="text-sm bg-white/10 hover:bg-white/20 px-3 py-1 rounded">Сбросить</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsSection === 'account' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div>
                          <h3 className="text-lg font-bold text-white mb-2">Очистка данных</h3>
                          <p className="text-sm text-zinc-400 mb-3">Удалить все созданные плейлисты и добавленные песни из медиатеки.</p>
                          <button onClick={() => {
                            if (confirm('Удалить всю музыку и плейлисты? Это действие необратимо.')) {
                              setPlaylists([{ id: 'favorites', title: 'Избранное', isSystem: true, tracks: [] }]);
                            }
                          }} className="bg-rose-500/20 text-rose-500 hover:bg-rose-500 hover:text-white px-4 py-2 rounded transition-colors">
                            Очистить медиатеку
                          </button>
                        </div>
                        <div className="pt-4 border-t border-white/10">
                          <h3 className="text-lg font-bold text-white mb-2">Настройки профиля</h3>
                          
                          <div className="mb-6 flex items-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-zinc-800 overflow-hidden shrink-0 border border-white/10 flex items-center justify-center text-zinc-500">
                              {currentUser?.photoURL ? (
                                <img src={currentUser.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                              ) : (
                                <UserIcon size={32} />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium mb-2">?зменить аватар профиля</p>
                              <label className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded text-sm cursor-pointer transition-colors inline-block">
                                Загрузить картинку
                                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    const url = await uploadToImgBB(file);
                                    if (auth.currentUser) {
                                      await updateProfile(auth.currentUser, { photoURL: url });
                                      setCurrentUser({ ...auth.currentUser });
                                    }
                                  } catch (err) {
                                    alert("Ошибка загрузки аватара");
                                  }
                                }} />
                              </label>
                            </div>
                          </div>

                          {!currentUser?.providerData.some(p => p.providerId === 'google.com') && (
                            <div className="mb-4">
                              <button onClick={async () => {
                                try {
                                  await linkWithPopup(auth.currentUser!, new GoogleAuthProvider());
                                  alert('Google аккаунт успешно привязан!');
                                } catch (e: any) {
                                  alert('Ошибка привязки: ' + e.message);
                                }
                              }} className="bg-white text-black px-4 py-2 rounded hover:bg-gray-200 transition-colors">
                                Привязать Google аккаунт
                              </button>
                            </div>
                          )}

                          <div className="space-y-3 mb-6">
                            <button onClick={async () => {
                              const newPassword = prompt('Введите новый пароль (минимум 6 символов):');
                              if (newPassword && newPassword.length >= 6) {
                                try {
                                  await updatePassword(auth.currentUser!, newPassword);
                                  alert('Пароль успешно изменен');
                                } catch (e: any) {
                                  if (e.code === 'auth/requires-recent-login') {
                                    alert('Для смены пароля необходимо выйти и войти заново.');
                                  } else {
                                    alert('Ошибка: ' + e.message);
                                  }
                                }
                              }
                            }} className="text-blue-400 hover:underline text-sm block">?зменить пароль</button>
                          </div>

                          <div className="pt-4 border-t border-red-500/30">
                            <h3 className="text-lg font-bold text-red-500 mb-2">Опасная зона</h3>
                            <button onClick={async () => {
                              if (confirm('Вы уверены, что хотите НАВСЕГДА удалить аккаунт и все связанные с ним данные?')) {
                                try {
                                  await deleteUser(auth.currentUser!);
                                } catch (e: any) {
                                  if (e.code === 'auth/requires-recent-login') {
                                    alert('Для удаления аккаунта необходимо выйти и войти заново (в целях безопасности).');
                                  } else {
                                    alert('Ошибка: ' + e.message);
                                  }
                                }
                              }
                            }} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors">
                              Удалить аккаунт навсегда
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsSection === 'audio' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div>
                          <h3 className="text-lg font-bold mb-3">Тип воспроизведения</h3>
                          <div className="flex gap-4 mb-2">
                            <button 
                              onClick={() => setAudioMode('stream')} 
                              className={`px-4 py-2 rounded-md ${audioMode === 'stream' ? 'bg-green-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                            >
                              Стриминг
                            </button>
                            <button 
                              onClick={() => setAudioMode('download')} 
                              className={`px-4 py-2 rounded-md ${audioMode === 'download' ? 'bg-green-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                            >
                              Скачивание
                            </button>
                          </div>
                          <p className="text-sm text-zinc-400">
                            <b>Стриминг:</b> Музыка играет напрямую из сети без сохранения на диск (быстро, но зависит от интернета). <br/>
                            <b>Скачивание:</b> При первом воспроизведении музыка кэшируется на ваше устройство. В следующий раз она включится мгновенно и без интернета.
                          </p>
                        </div>
                        <div className="pt-4 border-t border-white/10">
                          <h3 className="text-lg font-bold mb-2">Папка для скачивания (Backend)</h3>
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              value={downloadsInfo.dir || ''} 
                              onChange={(e) => setDownloadsInfo({...downloadsInfo, dir: e.target.value})}
                              className="bg-black/30 border border-white/10 rounded px-3 py-2 flex-1"
                            />
                            <button 
                              onClick={async () => {
                                try {
                                  const res = await fetch('http://127.0.0.1:8000/api/settings/download_dir', {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({ path: downloadsInfo.dir })
                                  });
                                  if (res.ok) {
                                    alert('Директория успешно изменена!');
                                    fetchSysInfo();
                                  }
                                } catch (e) {
                                  alert('Ошибка соединения с сервером');
                                }
                              }}
                              className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded"
                            >
                              Сохранить
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsSection === 'downloads' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold">Скачанные файлы в кэше ({downloadsInfo.files?.length || 0})</h3>
                          <div className="text-sm text-zinc-400">
                            Общий размер: {(downloadsInfo.total_size_bytes / (1024 * 1024)).toFixed(2)} МБ
                          </div>
                        </div>
                        <div className="flex gap-2 mb-4">
                          <button 
                            onClick={async () => {
                              if (confirm('Точно удалить всю скачанную музыку?')) {
                                await fetch('http://127.0.0.1:8000/api/settings/downloads_all', { method: 'DELETE' });
                                fetchDownloadsInfo();
                              }
                            }}
                            className="bg-rose-500/20 text-rose-500 hover:bg-rose-500 hover:text-white px-4 py-2 rounded transition-colors text-sm"
                          >
                            Удалить всё
                          </button>
                        </div>
                        <div className="bg-black/20 rounded-lg p-2 max-h-64 overflow-y-auto border border-white/5 space-y-1">
                          {downloadsInfo.files && downloadsInfo.files.map((f: any) => (
                            <div key={f.name} className="flex items-center justify-between p-2 hover:bg-white/5 rounded">
                              <div className="truncate text-sm pr-4">{f.name}</div>
                              <div className="flex items-center gap-4 shrink-0">
                                <span className="text-xs text-zinc-400">{(f.size / (1024*1024)).toFixed(2)} МБ</span>
                                <button 
                                  onClick={async () => {
                                    await fetch(`http://127.0.0.1:8000/api/settings/downloads/${encodeURIComponent(f.name)}`, { method: 'DELETE' });
                                    fetchDownloadsInfo();
                                  }}
                                  className="text-zinc-500 hover:text-rose-500 transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                          {(!downloadsInfo.files || downloadsInfo.files.length === 0) && (
                            <div className="text-center text-zinc-500 py-4 text-sm">Нет скачанных файлов</div>
                          )}
                        </div>
                      </div>
                    )}

                    {settingsSection === 'about' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <Music size={32} color="black" />
                          </div>
                          <div>
                            <h2 className="text-2xl font-bold">Tesify</h2>
                            <p className="text-zinc-400 font-mono text-sm">v{APP_VERSION}</p>
                          </div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-zinc-400">Директория установки:</span>
                            <span className="text-white text-right max-w-xs truncate" title={sysInfo?.install_dir}>{sysInfo?.install_dir || '...'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400">Директория кэша (загрузок):</span>
                            <span className="text-white text-right max-w-xs truncate" title={downloadsInfo.dir}>{downloadsInfo.dir || '...'}</span>
                          </div>
                        </div>
                        <div>
                          <a href="https://github.com/TairTasNis/Tesify" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md font-semibold hover:bg-gray-200 transition-colors">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                            GitHub Репозиторий
                          </a>
                        </div>
                      </div>
                    )}

                    {settingsSection === 'server' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        {/* Status card */}
                        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold">Состояние сервера</h3>
                            <button
                              onClick={fetchServerData}
                              disabled={serverLogsLoading}
                              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                            >
                              <RefreshCw size={14} className={serverLogsLoading ? 'animate-spin' : ''} />
                              Обновить
                            </button>
                          </div>
                          <div className="flex flex-col gap-3 text-sm">
                            <div className="flex items-center gap-3">
                              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${serverStatusData ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500'}`} />
                              <span className="font-semibold">{serverStatusData ? 'Онлайн' : 'Оффлайн'}</span>
                            </div>
                            {serverStatusData && (
                              <div className="bg-black/30 rounded-md p-3 space-y-1.5 text-zinc-300">
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Аптайм:</span>
                                  <span className="font-mono">{serverStatusData.uptime_str}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Последний пинг:</span>
                                  <span className="font-mono">{serverStatusData.last_ping_ago}с назад</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">PID процесса:</span>
                                  <span className="font-mono">{serverStatusData.pid}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Logs */}
                        <div>
                          <h3 className="text-lg font-bold mb-3">Логи сервера</h3>
                          <div className="bg-black/60 border border-white/5 rounded-lg p-3 h-72 overflow-y-auto font-mono text-xs">
                            {serverLogsLoading ? (
                              <div className="flex items-center gap-2 text-zinc-500">
                                <Loader2 size={14} className="animate-spin" />
                                Загрузка...
                              </div>
                            ) : serverLogs.length === 0 ? (
                              <div className="text-zinc-600">Нет записей в логах</div>
                            ) : (
                              serverLogs.map((log, i) => (
                                <div key={i} className={`mb-0.5 leading-5 ${log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARNING' ? 'text-yellow-400' : 'text-zinc-300'}`}>
                                  {log.time && <span className="text-zinc-600 mr-2 select-none">{log.time}</span>}
                                  <span>{log.msg}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Navigation Rail for Material 3 */}
        {layoutTheme === 'material3' && (() => {
          const isHorizontal = md3NavOrientation === 'auto' ? (md3NavPosition === 'top' || md3NavPosition === 'bottom') : md3NavOrientation === 'horizontal';
          const isDraggable = md3NavPosition === 'floating';
          
          let positionClasses = '';
          if (md3NavPosition === 'right') positionClasses = md3AutoHideRail ? 'right-0 hover:translate-x-0 translate-x-[calc(100%-8px)] top-1/2 -translate-y-1/2 before:absolute before:-left-[100px] before:top-0 before:bottom-0 before:w-[100px]' : 'right-4 top-1/2 -translate-y-1/2';
          else if (md3NavPosition === 'left') positionClasses = md3AutoHideRail ? 'left-0 hover:translate-x-0 -translate-x-[calc(100%-8px)] top-1/2 -translate-y-1/2 before:absolute before:-right-[100px] before:top-0 before:bottom-0 before:w-[100px]' : 'left-4 top-1/2 -translate-y-1/2';
          else if (md3NavPosition === 'top') positionClasses = md3AutoHideRail ? 'top-0 hover:translate-y-0 -translate-y-[calc(100%-8px)] left-1/2 -translate-x-1/2 before:absolute before:-bottom-[100px] before:left-0 before:right-0 before:h-[100px]' : 'top-4 left-1/2 -translate-x-1/2';
          else if (md3NavPosition === 'bottom') positionClasses = md3AutoHideRail ? 'bottom-[96px] hover:translate-y-0 translate-y-[calc(100%-8px)] left-1/2 -translate-x-1/2 before:absolute before:-top-[100px] before:left-0 before:right-0 before:h-[100px]' : 'bottom-[120px] left-1/2 -translate-x-1/2';
          else if (isDraggable) positionClasses = 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';

          const dimensionClasses = isHorizontal
            ? 'flex-row items-center px-6 py-2 w-fit h-[72px] rounded-[32px]'
            : 'flex-col items-center py-6 px-2 h-fit w-[72px] rounded-[32px]';

          const autoHideOpacity = md3AutoHideRail && !isDraggable ? 'opacity-30 hover:opacity-100' : 'opacity-100';

          return (
            <motion.div
              key={md3NavKey}
              drag={isDraggable}
              dragMomentum={false}
              className={`group flex shrink-0 shadow-2xl absolute z-[100] bg-[var(--md-sys-color-surface-variant)] transition-all duration-300 ease-in-out ${autoHideOpacity} ${dimensionClasses} ${positionClasses} ${isDraggable ? '!transition-none cursor-grab active:cursor-grabbing' : ''}`}
            >
              <button onPointerDown={(e) => isDraggable && e.stopPropagation()} onClick={() => setActiveTab('home')} title="Главная" className="relative group p-3 rounded-full flex items-center justify-center w-12 h-12 shrink-0">
                {activeTab === 'home' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
                <Home size={26} className={`relative z-10 ${activeTab === 'home' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}`} />
              </button>
              <button onPointerDown={(e) => isDraggable && e.stopPropagation()} onClick={() => setActiveTab('search')} title="Поиск" className="relative group p-3 rounded-full flex items-center justify-center w-12 h-12 shrink-0">
                {activeTab === 'search' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
                <Search size={26} className={`relative z-10 ${activeTab === 'search' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}`} />
              </button>
              <button onPointerDown={(e) => isDraggable && e.stopPropagation()} onClick={() => setActiveTab('library')} title="Моя медиатека" className="relative group p-3 rounded-full flex items-center justify-center w-12 h-12 shrink-0">
                {activeTab === 'library' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
                <LibraryIcon size={26} className={`relative z-10 ${activeTab === 'library' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}`} />
              </button>
              <button onPointerDown={(e) => isDraggable && e.stopPropagation()} onClick={() => setActiveTab('connect')} title="Tesify Connect" className={`relative group p-3 rounded-full flex items-center justify-center w-12 h-12 shrink-0 ${!isHorizontal ? 'mt-auto' : 'ml-auto'}`}>
                {activeTab === 'connect' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
                <Radio size={26} className={`relative z-10 ${activeTab === 'connect' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}`} />
              </button>
              <button onPointerDown={(e) => isDraggable && e.stopPropagation()} onClick={() => { setActiveTab('settings'); setSettingsSection('account'); }} title="Настройки" className={`relative group p-3 rounded-full flex items-center justify-center w-12 h-12 shrink-0`}>
                {activeTab === 'settings' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
                <SettingsIcon size={26} className={`relative z-10 ${activeTab === 'settings' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}`} />
              </button>
            </motion.div>
          );
        })()}
      </div>

      {/* Playlist Context Menu */}
      {playlistContextMenu && (
        <div 
          className="fixed z-[1000] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 min-w-[200px]"
          style={{ top: playlistContextMenu.y, left: playlistContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            className="w-full text-left px-4 py-2 hover:bg-white/10 transition text-sm flex items-center gap-2"
            onClick={() => {
              // Creating a new session strictly bound to this playlist
              const plId = playlistContextMenu.id;
              if (currentUser) {
                const sid = Date.now().toString();
                set(ref(db, `sessions/${sid}`), {
                  hostId: currentUser.uid,
                  hostName: currentUser.displayName,
                  playlistId: plId,
                  participants: {
                    [currentUser.uid]: { name: currentUser.displayName, isReady: true }
                  },
                  currentTrack: null,
                  isPlaying: false,
                  currentTime: 0,
                  updatedAt: Date.now()
                }).then(() => {
                  setCurrentSessionId(sid);
                  setActiveTab('connect');
                  setConnectTabMode('listen');
                  alert('Сессия запущена. Теперь вы можете пригласить друзей во вкладке Connect!');
                });
              }
              setPlaylistContextMenu(null);
            }}
          >
            <Radio size={16} />
            Запустить совместное прослушивание
          </button>
        </div>
      )}

      {/* Multi-Select Action Bar */}
      {selectedTrackIds.size > 0 && activePlaylistId && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-zinc-800 border border-white/10 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5">
          <span className="text-white font-bold">{selectedTrackIds.size} выбрано</span>
          <div className="w-px h-6 bg-white/10"></div>

          {/* Add to Queue Menu */}
            <button
              onClick={() => {
                const tracksToAdd = playlists.find(p => p.id === activePlaylistId)?.tracks.filter(t => selectedTrackIds.has(t.id)) || [];
                setUserQueue(prev => [...prev, ...tracksToAdd]);
                setSelectedTrackIds(new Set());
              }}
              className="text-sm font-semibold hover:text-white transition-colors px-3 py-1.5 rounded-full hover:bg-white/10"
            >
              В очередь
            </button>
            <div className="w-px h-6 bg-white/10"></div>
            {/* Move Menu */}
          <div className="relative">
            <button
              onClick={() => setIsMoveMenuOpen(!isMoveMenuOpen)}
              className={`text-sm font-semibold hover:text-white transition-colors px-3 py-1.5 rounded-full ${isMoveMenuOpen ? 'bg-white/20 text-white' : 'hover:bg-white/10'}`}
            >
              Переместить
            </button>
            {isMoveMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsMoveMenuOpen(false)}></div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden pb-1 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-2 text-xs font-semibold text-zinc-400 border-b border-white/10 mb-1">Выберите плейлист</div>
                  {playlists.filter(p => p.id !== activePlaylistId).map(pl => (
                    <button
                      key={pl.id}
                      onClick={() => {
                        const tracksToMove = playlists.find(p => p.id === activePlaylistId)?.tracks.filter(t => selectedTrackIds.has(t.id)) || [];
                        setPlaylists(prev => prev.map(p => {
                          if (p.id === pl.id) {
                            const existingIds = new Set(p.tracks.map(t => t.id));
                            const uniqueTracksToMove = tracksToMove.filter(t => !existingIds.has(t.id));
                            return { ...p, tracks: [...p.tracks, ...uniqueTracksToMove] };
                          }
                          if (p.id === activePlaylistId) {
                            return { ...p, tracks: p.tracks.filter(t => !selectedTrackIds.has(t.id)) };
                          }
                          return p;
                        }));

                        if (currentPlayingPlaylistId === activePlaylistId && currentTrack && selectedTrackIds.has(currentTrack.id)) {
                          setIsPlaying(false);
                          if (audioRef.current) audioRef.current.pause();
                        }

                        setSelectedTrackIds(new Set());
                        setIsMoveMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors truncate"
                    >
                      {pl.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button onClick={deleteSelectedTracks} className="text-sm font-semibold text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors px-3 py-1.5 rounded-full">
            Удалить
          </button>

          <button onClick={() => setSelectedTrackIds(new Set())} className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-white/10 ml-2" title="Отменить выделение">
            <X size={20} />
          </button>
        </div>
      )}

      {/* Player */}
      <div
        className={`${isSimplifiedPlayer ? 'h-16' : 'h-24'} px-4 flex items-center justify-between relative z-50 shrink-0 player-container transition-all duration-300 ease-in-out transform ${isPlayerHidden
          ? 'translate-y-full opacity-0 pointer-events-none absolute bottom-0 w-full'
          : (layoutTheme === 'material3' && md3PlayerTheme ? 'translate-y-0 opacity-100 bg-[var(--md-sys-color-surface-container)] mx-4 mb-4 rounded-[32px] border border-white/5 hover:bg-[var(--md-sys-color-surface-container-high)] shadow-[0_4px_24px_rgba(0,0,0,0.4)]' : 'translate-y-0 opacity-100 bg-black/60 backdrop-blur-xl border-t border-zinc-800/50')
          }`}
      >
        
<motion.div 
          className="absolute -top-[40px] left-1/2 -translate-x-1/2 w-48 h-12 flex items-center justify-center cursor-pointer group z-50 pb-2" 
          onClick={() => setIsQueueModalOpen(!isQueueModalOpen)}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.6}
          onDragEnd={(e, info) => {
            if (info.offset.y < -5 || info.velocity.y < -20) {
              setIsQueueModalOpen(true);
            }
          }}
        >
          <div className="w-16 h-2 bg-white/30 rounded-full group-hover:bg-white/70 transition-colors shadow-md"></div>
        </motion.div>
<div className="w-1/3 flex items-center gap-4 relative">
          {currentSessionId && (
            <div 
              className="absolute -top-12 left-0 flex items-center gap-2 text-green-500 bg-zinc-900/90 px-3 py-1.5 rounded-full text-xs font-medium border border-green-500/20 backdrop-blur-xl shadow-lg cursor-pointer hover:bg-zinc-800 transition-colors"
              onClick={() => setActiveTab('connect')} 
              title="Нажмите, чтобы вернуться к сессии Connect"
            >
              <span className="relative flex h-2.5 w-2.5 mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              Совместное прослушивание ({syncSession?.hostId === currentUser?.uid ? 'Вы хост' : `Хост: ${syncSession?.hostName || 'друга'}`})
            </div>
          )}
          {currentTrack && (
            <>
              {!isSimplifiedPlayer && (
                currentTrack.thumbnail ? (
                  <motion.img layoutId={`player-cover-${currentTrack.id}`} src={currentTrack.thumbnail || undefined} onClick={() => openTrackPage(currentTrack, 'player')} alt={currentTrack.title} className="w-14 h-14 rounded object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity" />
                ) : (
                  <motion.div layoutId={`player-cover-${currentTrack.id}`} onClick={() => openTrackPage(currentTrack, 'player')} className="w-14 h-14 bg-zinc-800 rounded flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-zinc-700 transition-colors">
                    <Music size={24} className="text-zinc-400" />
                  </motion.div>
                )
              )}
              <div className="overflow-hidden cursor-pointer" onClick={() => openTrackPage(currentTrack, 'player')}>
                <motion.p layoutId={`player-title-${currentTrack.id}`} className="text-sm font-medium text-white truncate hover:underline">
                  {currentTrack.title}
                </motion.p>
                <motion.p layoutId={`player-artist-${currentTrack.id}`} className="text-xs text-zinc-400 truncate hover:underline">
                  {currentTrack.artist}
                </motion.p>
              </div>
            </>
          )}
        </div>

        <div className="w-1/3 flex flex-col items-center max-w-2xl">
          <div className={`flex items-center gap-6 ${isSimplifiedPlayer ? 'mb-1' : 'mb-2'}`}>
            <button
              onClick={handlePrev}
              className="text-zinc-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={(!currentPlayingPlaylist || currentPlayingPlaylist.tracks.length === 0) || (currentSessionId && !isHost)}
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            {layoutTheme === 'material3' ? (
              <button
                onClick={handlePlayPause}
                className={`h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isPlaying ? 'bg-white/10 text-white w-20 hover:bg-white/20' : 'bg-white text-black w-24 hover:scale-105'}`}
                disabled={!currentPlayingPlaylist || currentPlayingPlaylist.tracks.length === 0}
              >
                {isLoadingTrack ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : isPlaying ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" className="ml-1" />
                )}
              </button>
            ) : (
              <button
                onClick={handlePlayPause}
                className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
                disabled={!currentPlayingPlaylist || currentPlayingPlaylist.tracks.length === 0}
              >
                {isLoadingTrack ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : isPlaying ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" className="ml-1" />
                )}
              </button>
            )}
            <button
              onClick={handleNext}
              className="text-zinc-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={(!currentPlayingPlaylist || currentPlayingPlaylist.tracks.length === 0) || (currentSessionId && !isHost)}
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>
          <div className="w-full flex items-center gap-3 text-xs text-zinc-400 font-medium">
            <span className={layoutTheme === 'material3' ? "w-10 text-right" : ""}>{typeof currentTime === 'number' && isFinite(currentTime) && !isNaN(currentTime) ? formatTime(currentTime) : "0:00"}</span>
            <div className={`flex-1 relative group flex items-center ${layoutTheme === 'material3' ? 'h-8' : 'h-6'} cursor-pointer`}>
              {layoutTheme === 'material3' ? (
                <div className="absolute w-full h-1.5 group-hover:h-2 transition-all duration-200 bg-white/20 rounded-full pointer-events-none progress-bg">
                  <div className="h-full bg-white rounded-full progress-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}></div>
                </div>
              ) : (
                <div className="absolute w-full h-1 bg-zinc-600 rounded-full overflow-hidden pointer-events-none progress-bg">
                  <div className="h-full bg-white group-hover:bg-green-500 rounded-full progress-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}></div>
                </div>
              )}
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="absolute w-full h-full opacity-0 cursor-pointer z-10"
              />
              {layoutTheme !== 'material3' && (
                <div
                  className="absolute h-3 w-3 bg-white rounded-full opacity-0 group-hover:opacity-100 pointer-events-none shadow slider-thumb"
                  style={{ left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 6px)` }}
                ></div>
              )}
            </div>
            <span className={layoutTheme === 'material3' ? "w-10" : ""}>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="w-1/3 flex items-center justify-end gap-4">
          <button
            onClick={() => {
              if (isLyricsModalOpen) {
                setIsLyricsModalOpen(false);
                setIsPlayerHidden(false);
              } else {
                setIsLyricsModalOpen(true);
                setIsPlayerHidden(true);
              }
            }}
            className={`transition-colors ${isLyricsModalOpen ? 'text-green-500' : 'text-zinc-400 hover:text-white'}`}
            title="Текст песни"
          >
            <Mic size={20} />
          </button>
          <div className="flex items-center gap-3 w-36 group">
            <button onClick={() => setIsQueueModalOpen(true)} className="text-zinc-400 hover:text-white transition-colors" title="Очередь"><AlignRight size={20} /></button>
            <button onClick={() => setVolume(volume === 0 ? 1 : 0)} className="text-zinc-400 hover:text-white transition-colors">
              {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <div className={`flex-1 relative flex items-center ${layoutTheme === 'material3' ? 'h-8' : 'h-6'} cursor-pointer`}>
              {layoutTheme === 'material3' ? (
                <div className="absolute w-full h-1.5 group-hover:h-2 transition-all duration-200 bg-white/20 rounded-full pointer-events-none progress-bg">
                  <div className="h-full bg-white rounded-full progress-fill" style={{ width: `${volume * 100}%` }}></div>
                </div>
              ) : (
                <div className="absolute w-full h-1 bg-zinc-600 rounded-full overflow-hidden pointer-events-none progress-bg">
                  <div className="h-full bg-white group-hover:bg-green-500 rounded-full progress-fill" style={{ width: `${volume * 100}%` }}></div>
                </div>
              )}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={handleVolumeChange}
                className="absolute w-full h-full opacity-0 cursor-pointer z-10"
              />
              {layoutTheme !== 'material3' && (
                <div
                  className="absolute h-3 w-3 bg-white rounded-full opacity-0 group-hover:opacity-100 pointer-events-none shadow slider-thumb"
                  style={{ left: `calc(${volume * 100}% - 6px)` }}
                ></div>
              )}
            </div>
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={currentTrack?.url || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={(e) => {
          console.error("Audio playback error:", e);
          if (audioRef.current && currentTrack?.url?.includes('proxy_stream')) {
            // Add a retry timestamp to bypass browser cache and force a new request
            if (!currentTrack.url.includes('&retry=')) {
               const newUrl = `${currentTrack.url}&retry=${Date.now()}`;
               audioRef.current.src = newUrl;
               audioRef.current.load();
               if (isPlaying) {
                 audioRef.current.play().catch(e => console.error("Retry play failed", e));
               }
            }
          }
        }}
      />
    </div>

      {/* Lyrics Modal */}
      <LyricsModal
        isOpen={isLyricsModalOpen}
        onClose={() => {
          setIsLyricsModalOpen(false);
          setIsPlayerHidden(false);
        }}
        currentTrack={currentTrack}
        currentTime={currentTime}
        onSeek={(time) => {
          if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
          }
        }}
        isPlayerHidden={isPlayerHidden}
        onTogglePlayer={() => setIsPlayerHidden(!isPlayerHidden)}
        lyricsAnimation={lyricsAnimation}
      />

      {/* YouTube Downloader Modal */}
      <YoutubeModal
        isOpen={isYoutubeModalOpen}
        onClose={() => setIsYoutubeModalOpen(false)}
        onDownloadComplete={(track) => {
          const targetPl = importTargetId || 'favorites';
          setPlaylists(prev => prev.map(pl =>
            pl.id === targetPl ? { ...pl, tracks: [...pl.tracks, track] } : pl
          ));
          setImportTargetId(null);
          setActiveTab('library');
        }}
      />
      
      {/* Link Downloader Modal */}
      <LinkModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        onDownloadComplete={(track) => {
          const targetPl = importTargetId || 'favorites';
          setPlaylists(prev => prev.map(pl =>
            pl.id === targetPl ? { ...pl, tracks: [...pl.tracks, track] } : pl
          ));
          setImportTargetId(null);
          setActiveTab('library');
        }}
      />

      
      {/* Queue Modal */}
        <AnimatePresence>
          {isQueueModalOpen && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-0 z-40 bg-zinc-900/95 backdrop-blur-3xl flex flex-col pt-8 pb-24 px-4 overflow-y-auto"
              onClick={() => setIsQueueModalOpen(false)}
            >
              <div className="max-w-2xl w-full mx-auto" onClick={e => e.stopPropagation()}>
                <motion.div
                    className="w-full h-16 flex items-center justify-center -mt-8 mb-2 cursor-grab active:cursor-grabbing pb-2"
                    drag="y"
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={0.8}
                    onDragEnd={(e, info) => {
                      if (info.offset.y > 50 || info.velocity.y > 200) {
                        setIsQueueModalOpen(false);
                      }
                    }}
                  >
                    <div className="w-16 h-2 bg-white/30 rounded-full group-hover:bg-white/70 transition-colors shadow-md"></div>
                </motion.div>
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold">Очередь</h2>
                  <div className="flex space-x-4">
                    <button onClick={() => {
                      if (!isShuffleQueue) {
                        queueBeforeShuffleRef.current = userQueue;

                        let baseQueue: Track[] = [];

                        if (userQueue.length > 0) {
                          baseQueue = userQueue;
                        } else if (currentPlayingPlaylist && currentPlayingPlaylist.tracks.length > 0) {
                          const sorted = getSortedTracks(currentPlayingPlaylist.tracks);
                          const currentTrackObj = currentTrackIndex >= 0 ? currentPlayingPlaylist.tracks[currentTrackIndex] : null;
                          const currentSortedIndex = currentTrackObj ? sorted.findIndex(t => t.id === currentTrackObj.id) : -1;

                          baseQueue = currentSortedIndex >= 0 ? sorted.slice(currentSortedIndex + 1) : sorted;
                        }

                        setUserQueue(shuffleTracks(baseQueue));
                        setIsShuffleQueue(true);
                      } else {
                        if (queueBeforeShuffleRef.current !== null) {
                          setUserQueue(queueBeforeShuffleRef.current);
                          queueBeforeShuffleRef.current = null;
                        } else {
                          setUserQueue([]);
                        }

                        setIsShuffleQueue(false);
                      }
                    }} className={`p-2 rounded-full ${isShuffleQueue ? "bg-green-500 text-black" : "bg-white/10 text-white"}`} title="Перемешать очередь">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
                    </button>
                    <button onClick={() => setIsQueueModalOpen(false)} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
                      <X size={20} />
                    </button>
                  </div>
                </div>

                
                {overrideTrack && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-zinc-400 mb-4">Сейчас играет</h3>
                    <div className="flex items-center justify-between bg-green-500/20 border border-green-500/50 p-3 rounded-xl">
                        <div className="flex items-center gap-3">
                          <Music size={20} className="text-green-500" />
                          <div>
                            <p className="text-sm font-medium text-white">{overrideTrack.title}</p>
                            <p className="text-xs text-green-400">{overrideTrack.artist}</p>
                          </div>
                        </div>
                    </div>
                  </div>
                )}
                {!overrideTrack && currentPlayingPlaylist && currentTrackIndex >= 0 && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-zinc-400 mb-4">Сейчас играет</h3>
                    <div className="flex items-center justify-between bg-green-500/20 border border-green-500/50 p-3 rounded-xl">
                        <div className="flex items-center gap-3">
                          <Music size={20} className="text-green-500" />
                          <div>
                            <p className="text-sm font-medium text-white">{currentPlayingPlaylist.tracks[currentTrackIndex].title}</p>
                            <p className="text-xs text-green-400">{currentPlayingPlaylist.tracks[currentTrackIndex].artist}</p>
                          </div>
                        </div>
                    </div>
                  </div>
                )}

                {userQueue.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-zinc-400 mb-4">В очереди</h3>
                    <div className="space-y-2">
                    {userQueue.map((track, idx) => (
                      <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", idx.toString())} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const fromIdx = parseInt(e.dataTransfer.getData("text/plain")); const newQ = [...userQueue]; const item = newQ.splice(fromIdx, 1)[0]; newQ.splice(idx, 0, item); setUserQueue(newQ); }} key={`q-${idx}-${track.id}`} className="flex items-center justify-between bg-white/5 p-3 rounded-xl hover:bg-white/10 group cursor-move">
                        <div className="flex items-center gap-3 flex-1" onClick={() => {
                          setUserQueue(prev => prev.filter((_, i) => i !== idx));

                          const playlistForQueue = currentPlayingPlaylist || playlists.find(p => p.id === currentPlayingPlaylistId);
                          if (playlistForQueue) {
                            const absoluteIndex = playlistForQueue.tracks.findIndex(t =>
                              t.id === track.id || (t.youtubeId && track.youtubeId && t.youtubeId === track.youtubeId)
                            );

                            if (absoluteIndex !== -1) {
                              setOverrideTrack(null);
                              playTrack(absoluteIndex, playlistForQueue.id);
                              return;
                            }
                          }

                          playQueueTrack(track);
                        }} style={{cursor: 'pointer'}}>
                          <Music size={20} className="text-zinc-500" />
                          <div>
                            <p className="text-sm font-medium text-white">{track.title}</p>
                            <p className="text-xs text-zinc-400">{track.artist}</p>
                          </div>
                        </div>
                        <button onClick={() => setUserQueue(userQueue.filter((_, i) => i !== idx))} className="text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {userQueue.length === 0 && currentPlayingPlaylistId && currentPlayingPlaylist && currentTrackIndex >= 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-zinc-400 mb-4">Далее из: {currentPlayingPlaylist.title}</h3>
                  <div className="space-y-2 opacity-70">
                    {currentPlayingPlaylist.tracks.slice(currentTrackIndex + 1, currentTrackIndex + 21).map((track, idx) => (
                      <div key={`pl-${idx}-${track.id}`} className="flex items-center gap-3 bg-transparent p-3 rounded-xl hover:bg-white/5 cursor-default transition-colors">
                        <span className="text-zinc-600 text-xs w-4 text-center">{idx + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-white">{track.title}</p>
                          <p className="text-xs text-zinc-400">{track.artist}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spotify Import Modal */}
      <UniversalImportModal
        isOpen={isSpotifyModalOpen}
        onClose={() => setIsSpotifyModalOpen(false)}
        playlists={playlists}
        targetPlaylistId={importTargetId || activePlaylistId || undefined}
        onImport={(importedTracks, sourceUrl) => {
          const targetPl = importTargetId || 'favorites';
          setPlaylists(prev => prev.map(pl => {
            if (pl.id === targetPl) {
              const uniqueNewTracks = importedTracks.filter(it => 
                !pl.tracks.some(existing => existing.id === it.id || (existing.spotifyId && existing.spotifyId === it.spotifyId))
              );
              return { 
                ...pl, 
                tracks: [...pl.tracks, ...uniqueNewTracks],
                // Если это первый импорт из Spotify и источник не задан, делаем его основным
                spotifySyncUrl: pl.spotifySyncUrl || (sourceUrl?.includes('spotify') ? sourceUrl : undefined),
                isSpotifySyncEnabled: pl.isSpotifySyncEnabled ?? false
              };
            }
            return pl;
          }));
          setImportTargetId(null);
          setActiveTab('library');
        }}
      />
    </>
  );
}

function LyricsModal({ isOpen, onClose, currentTrack, currentTime, onSeek, isPlayerHidden, onTogglePlayer, lyricsAnimation }: { isOpen: boolean, onClose: () => void, currentTrack: Track | null, currentTime: number, onSeek: (time: number) => void, isPlayerHidden: boolean, onTogglePlayer: () => void, lyricsAnimation: 'classic' | 'apple' }) {
  const [trackName, setTrackName] = useState('');
  const [artistName, setArtistName] = useState('');
  const [syncedLyrics, setSyncedLyrics] = useState<LyricLine[] | null>(null);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [translatedSyncedLyrics, setTranslatedSyncedLyrics] = useState<LyricLine[] | null>(null);
  const [translatedPlainLyrics, setTranslatedPlainLyrics] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslateMenuVisible, setIsTranslateMenuVisible] = useState(false);
  const [selectedSourceLang, setSelectedSourceLang] = useState('auto');
  const [selectedTargetLang, setSelectedTargetLang] = useState('ru');
  const [viewMode, setViewMode] = useState<'center' | 'split'>('center');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(
    localStorage.getItem('lyricsTextAlign') as 'left' | 'center' | 'right' || 'center'
  );

  useEffect(() => {
    localStorage.setItem('lyricsTextAlign', textAlign);
  }, [textAlign]);
  
  const TRANSLATION_LANGUAGES = [
    { code: 'ru', name: 'Русский' },
    { code: 'en', name: 'Английский' },
    { code: 'es', name: 'Испанский' },
    { code: 'fr', name: 'Французский' },
    { code: 'de', name: 'Немецкий' },
    { code: 'it', name: 'Итальянский' },
    { code: 'zh-CN', name: 'Китайский' },
    { code: 'ja', name: 'Японский' },
    { code: 'ko', name: 'Корейский' },
    { code: 'ar', name: 'Арабский' },
  ];

  const handleTranslateLyrics = async () => {
    if (!syncedLyrics && !plainLyrics) return;
    setIsTranslating(true);
    try {
      if (syncedLyrics) {
        // Мы склеиваем весь текст, переводим и разбиваем обратно, потому что глубокий перевод может испортить разбивку
        // Разделяем строки уникальным символом \n
        const textToTranslate = syncedLyrics.map(l => l.text).join('\n');
        const res = await fetch(`http://127.0.0.1:8000/api/translate?target=${selectedTargetLang}&source=${selectedSourceLang}&text=${encodeURIComponent(textToTranslate)}`);
        const data = await res.json();
        const translatedArray = data.translatedText.split('\n');
        
        const newSynced = syncedLyrics.map((l, i) => ({
          time: l.time,
          text: translatedArray[i] || l.text
        }));
        setTranslatedSyncedLyrics(newSynced);
        setTranslatedPlainLyrics(null);
      } else if (plainLyrics) {
        const res = await fetch(`http://127.0.0.1:8000/api/translate?target=${selectedTargetLang}&source=${selectedSourceLang}&text=${encodeURIComponent(plainLyrics)}`);
        const data = await res.json();
        setTranslatedPlainLyrics(data.translatedText);
        setTranslatedSyncedLyrics(null);
      }
      setIsTranslateMenuVisible(false);
    } catch (err) {
      console.error(err);
      alert('Ошибка при переводе текста. Проверьте запущен ли Python сервер.');
    } finally {
      setIsTranslating(false);
    }
  };

  const [error, setError] = useState<string | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const lastSearchedTrackId = useRef<string | null>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleUserInteraction = () => {
    setIsUserScrolling(true);
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 3000);
  };

  const handleManualSearch = () => {
    searchLyrics(trackName, artistName);
  };

  const searchLyrics = async (tName: string, aName: string) => {
    if (!tName) {
      setError("Введите название песни");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSyncedLyrics(null);
    setPlainLyrics(null);
    setTranslatedSyncedLyrics(null);
    setTranslatedPlainLyrics(null);

    try {
      // First try exact get
      const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(tName)}&artist_name=${encodeURIComponent(aName)}`;
      const getRes = await fetch(getUrl);
      
      let bestMatch = null;
      if (getRes.ok) {
        bestMatch = await getRes.json();
      } else {
        // Fallback to fuzzy search
        const url = new URL('https://lrclib.net/api/search');
        url.searchParams.append('track_name', tName);
        if (aName) {
          url.searchParams.append('artist_name', aName);
        }

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("Ошибка при поиске");

        const data = await res.json();
        if (data && data.length > 0) {
          bestMatch = data[0];
        }
      }

      if (bestMatch) {
        if (bestMatch.syncedLyrics) {
          setSyncedLyrics(parseLrc(bestMatch.syncedLyrics));
          setIsSearchVisible(false);
        } else if (bestMatch.plainLyrics) {
          setPlainLyrics(bestMatch.plainLyrics);
          setIsSearchVisible(false);
        } else {
          setError("Текст не найден, но песня есть в базе");
          setIsSearchVisible(true);
        }
      } else {
        setError("Текст не найден");
        setIsSearchVisible(true);
      }
    } catch (err) {
      setError("Произошла ошибка при поиске текста");
      console.error(err);
      setIsSearchVisible(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentTrack && currentTrack.id !== lastSearchedTrackId.current) {
      lastSearchedTrackId.current = currentTrack.id;
      const tName = currentTrack.title;
      const aName = currentTrack.artist === 'Unknown Artist' ? '' : currentTrack.artist;
      setTrackName(tName);
      setArtistName(aName);
      searchLyrics(tName, aName);
    }
  }, [currentTrack]);

  let activeIndex = -1;
  const currentSyncedList = translatedSyncedLyrics || syncedLyrics;
  
  if (currentSyncedList) {
    for (let i = 0; i < currentSyncedList.length; i++) {
      if (currentTime >= currentSyncedList[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }
  }

  const timeToStart = currentSyncedList && currentSyncedList.length > 0 ? currentSyncedList[0].time - currentTime : 0;
  const isWaitingForFirstLine = timeToStart > 0;

  const formatTimer = (time: number) => {
    const secs = Math.ceil(time);
    if (secs >= 60) {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    }
    return secs.toString();
  };

  useEffect(() => {
    if (isOpen && activeLineRef.current && scrollRef.current && !isSearchVisible && !isUserScrolling) {
      const container = scrollRef.current;
      const element = activeLineRef.current;
      
      if (lyricsAnimation === 'apple') {
        // Отключаем нативный скролл, чтобы он не конфликтовал с нашей JS-анимацией
        container.style.scrollBehavior = 'auto';

        const elementRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        // ВАЖНО: используем offsetTop элемента, если есть родитель с position: relative, 
        // или вычисляем так:
        const targetY = elementRect.top - containerRect.top + container.scrollTop;
        
        const offset = containerRect.height * 0.30; // 30% spacing from the top (чуть ниже)
        const finalTop = targetY - offset;
        
        const startTop = container.scrollTop;
        const distance = finalTop - startTop;
        const startTime = performance.now();
        // Длительность прокрутки (600мс идеально ложится под нашу анимацию текста)
        const duration = 600;

        const animateScroll = (currentTime: number) => {
          const elapsed = Math.max(0, currentTime - startTime);
          const progress = Math.min(elapsed / duration, 1);
          
          // easeOutExpo (Резкий старт и очень плавный конец)
          const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
          
          container.scrollTop = startTop + distance * ease;
          
          if (elapsed < duration) {
            (container as any)._scrollAnimation = requestAnimationFrame(animateScroll);
          }
        };

        if ((container as any)._scrollAnimation) {
          cancelAnimationFrame((container as any)._scrollAnimation);
        }
        (container as any)._scrollAnimation = requestAnimationFrame(animateScroll);

      } else {
        // Включаем обратно для классической анимации
        container.style.scrollBehavior = 'smooth';
        // Classic animation scrolls to center
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [activeIndex, isSearchVisible, isOpen, isUserScrolling, lyricsAnimation]);

  if (!isOpen) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-40 flex flex-col animate-in fade-in duration-200 overflow-hidden bottom-0`}>
      
      {/* Apple Music Style Animated Background */}
      <div className="absolute inset-0 z-0 bg-zinc-900 overflow-hidden pointer-events-none">
        {currentTrack?.thumbnail && (
          <div 
            className="absolute inset-0 scale-150 transform transition-transform duration-1000 ease-out" 
            style={{
              backgroundImage: `url(${currentTrack.thumbnail})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(90px) brightness(0.6) saturate(1.5)',
              opacity: 0.8
            }}
          />
        )}
        {/* Animated Gradient Overlays (4 colors max) */}
        <div className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full mix-blend-screen filter blur-[90px] opacity-40 animate-blob" style={{ backgroundColor: '#3b82f6' }}></div>
        <div className="absolute top-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full mix-blend-screen filter blur-[90px] opacity-40 animate-blob-reverse" style={{ backgroundColor: '#a855f7' }}></div>
        <div className="absolute -bottom-[20%] left-[20%] w-[80vw] h-[80vw] rounded-full mix-blend-screen filter blur-[90px] opacity-30 animate-blob-slow" style={{ backgroundColor: '#10b981' }}></div>
        <div className="absolute top-[40%] left-[40%] w-[60vw] h-[60vw] rounded-full mix-blend-screen filter blur-[90px] opacity-30 animate-blob" style={{ backgroundColor: '#f43f5e', animationDelay: '2s' }}></div>

        {/* Fallback gradient if no thumbnail */}
        {!currentTrack?.thumbnail && (
          <div className="absolute inset-0 bg-gradient-to-br from-[#3b82f6]/50 via-[#a855f7]/50 to-[#10b981]/50" />
        )}
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* Top Gradient for text fade out */}
      <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none"></div>

      <div className={`p-6 flex items-center justify-between shrink-0 transition-all duration-500 absolute top-0 left-0 right-0 z-50 ${isPlayerHidden ? 'opacity-0 hover:opacity-100 bg-gradient-to-b from-black/60 to-transparent' : ''}`}>
        <button
          onClick={() => setIsSearchVisible(true)}
          className={`text-white/70 hover:text-white transition-colors flex items-center gap-2 font-bold ${isSearchVisible ? 'invisible' : ''}`}
        >
          <Search size={20} />
          Искать другой текст
        </button>
        <div className="flex items-center gap-2 relative">
          <button 
            onClick={() => setTextAlign(prev => prev === 'left' ? 'center' : prev === 'center' ? 'right' : 'left')} 
            className="p-2 rounded-full transition-colors text-white/70 hover:text-white hover:bg-white/10" 
            title="Выравнивание текста"
          >
            {textAlign === 'left' ? <AlignLeft size={24} /> : textAlign === 'right' ? <AlignRight size={24} /> : <AlignCenter size={24} />}
          </button>
          <button onClick={() => setViewMode(prev => prev === 'center' ? 'split' : 'center')} className={`p-2 rounded-full transition-colors ${viewMode === 'split' ? 'text-white bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`} title="Переключить вид">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M12 3v18" />
            </svg>
          </button>
          <div className="relative">
            <button onClick={() => setIsTranslateMenuVisible(!isTranslateMenuVisible)} className={`p-2 rounded-full transition-colors ${translatedSyncedLyrics || translatedPlainLyrics ? 'text-green-400 bg-green-400/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`} title="Перевод">
              <Languages size={24} />
            </button>
            {isTranslateMenuVisible && (
              <div className="absolute top-12 right-0 bg-zinc-800 p-4 rounded-xl shadow-2xl border border-white/10 w-80 z-50 flex flex-col gap-4">
                <h3 className="font-bold text-white text-lg">Перевод текста</h3>
                
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-white/50 uppercase">С какого языка:</label>
                  <select 
                    value={selectedSourceLang} 
                    onChange={e => setSelectedSourceLang(e.target.value)}
                    className="bg-black/40 text-white rounded p-2 border border-white/10"
                  >
                    <option value="auto">Автоопределение</option>
                    {TRANSLATION_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs text-white/50 uppercase">На какой язык:</label>
                  <select 
                    value={selectedTargetLang} 
                    onChange={e => setSelectedTargetLang(e.target.value)}
                    className="bg-black/40 text-white rounded p-2 border border-white/10"
                  >
                    {TRANSLATION_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2 mt-2">
                  {(translatedSyncedLyrics || translatedPlainLyrics) && (
                    <button 
                      onClick={() => {
                        setTranslatedSyncedLyrics(null);
                        setTranslatedPlainLyrics(null);
                        setIsTranslateMenuVisible(false);
                      }}
                      className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg transition"
                    >
                      Сбросить
                    </button>
                  )}
                  <button 
                    onClick={handleTranslateLyrics}
                    disabled={isTranslating}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-black font-bold py-2 rounded-lg transition disabled:opacity-50"
                  >
                    {isTranslating ? 'Переводим...' : 'Перевести'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={onTogglePlayer} className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors" title={isPlayerHidden ? "Показать плеер" : "На весь экран"}>
            {isPlayerHidden ? <Minimize2 size={24} /> : <Maximize2 size={24} />}
          </button>
          <button onClick={onClose} className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors" title="Закрыть">
            <X size={28} />
          </button>
        </div>
      </div>

      {isSearchVisible ? (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto relative z-10">
          <div className="bg-zinc-900/90 p-8 rounded-2xl w-full max-w-2xl shadow-2xl backdrop-blur-md border border-white/10">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-white">
              <Mic size={28} className="text-green-500" />
              Поиск текста (lrclib)
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1 uppercase font-bold tracking-wider">Название песни *</label>
                <input
                  type="text"
                  value={trackName}
                  onChange={(e) => setTrackName(e.target.value)}
                  className="w-full bg-zinc-800 text-white rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 text-lg"
                  placeholder="Например: Bohemian Rhapsody"
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1 uppercase font-bold tracking-wider">?сполнитель (необязательно)</label>
                <input
                  type="text"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  className="w-full bg-zinc-800 text-white rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 text-lg"
                  placeholder="Например: Queen"
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                />
              </div>

              {error && (
                <div className="text-red-400 text-sm py-2">
                  {error}
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3">
                {(syncedLyrics || plainLyrics) && (
                  <button
                    onClick={() => setIsSearchVisible(false)}
                    className="text-white font-bold py-3 px-6 rounded-full hover:bg-white/10 transition-colors"
                  >
                    Отмена
                  </button>
                )}
                <button
                  onClick={handleManualSearch}
                  disabled={isLoading || !trackName}
                  className="bg-green-500 hover:bg-green-400 text-black font-bold py-3 px-8 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
                >
                  {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Найти"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={`flex flex-1 overflow-hidden relative z-10`}>
          {viewMode === 'split' && (
            <div className="w-1/2 flex-col items-center justify-center p-12 hidden md:flex animate-in fade-in slide-in-from-left-8 duration-500">
              <div 
                className="w-full max-w-md aspect-square rounded-2xl shadow-2xl mb-8 object-cover bg-zinc-800"
                style={{
                  backgroundImage: `url(${currentTrack?.thumbnail || ''})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
              <h2 className="text-4xl font-bold text-white mb-2 text-center drop-shadow-lg">{currentTrack?.title}</h2>
              <p className="text-2xl text-white/70 text-center drop-shadow-md">{currentTrack?.artist}</p>
            </div>
          )}
          
          <div
            ref={scrollRef}
            className={`flex-1 overflow-y-auto no-scrollbar p-6 scroll-smooth pb-40 ${viewMode === 'split' ? 'md:w-1/2' : ''}`}
            onWheel={handleUserInteraction}
            onTouchMove={handleUserInteraction}
          >
            {currentSyncedList && (
              <div className={`flex flex-col gap-6 py-[15vh] mx-auto w-full max-w-4xl ${textAlign === 'left' ? 'text-left items-start' : textAlign === 'right' ? 'text-right items-end' : 'text-center items-center'}`}>
              {isWaitingForFirstLine && (
                <div
                  ref={activeIndex === -1 ? activeLineRef : null}
                  className={`text-4xl md:text-5xl font-bold transition-all duration-300 text-green-500 scale-105 flex items-center gap-4 mb-8 ${textAlign === 'left' ? 'origin-left justify-start' : textAlign === 'right' ? 'origin-right justify-end' : 'origin-center justify-center'}`}
                >
                  <div className="flex gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="font-mono w-20 text-left">{formatTimer(timeToStart)}</span>
                </div>
              )}
              {currentSyncedList.map((line, index) => {
                const isActive = index === activeIndex;
                const isPassed = index < activeIndex;
                return (
                  <div
                    key={index}
                    ref={isActive ? activeLineRef : null}
                    onClick={() => onSeek(line.time)}
                    className={`text-4xl md:text-5xl font-bold cursor-pointer hover:text-white ${
                      lyricsAnimation === 'apple'
                        ? `ease-out ${isActive ? `transition-all duration-500 text-white opacity-100 scale-[1.05] translate-y-0 !blur-none ${textAlign === 'left' ? 'origin-left' : textAlign === 'right' ? 'origin-right' : 'origin-center'}` : isPassed ? 'transition-all duration-[700ms] text-white/0 opacity-0 -translate-y-6 blur-[8px] scale-95' : 'transition-all duration-[700ms] text-white/40 blur-[1.5px] translate-y-4 scale-100'}`
                        : `transition-all duration-300 ${isActive ? `text-white scale-[1.05] ${textAlign === 'left' ? 'origin-left' : textAlign === 'right' ? 'origin-right' : 'origin-center'}` : isPassed ? 'text-white/50' : 'text-black/30'}`
                    }`}
                  >
                    {line.text}
                  </div>
                );
              })}
            </div>
          )}

          {(translatedPlainLyrics || plainLyrics) && !currentSyncedList && (
            <div className={`whitespace-pre-wrap font-medium text-2xl leading-relaxed text-zinc-200 py-12 ${textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center'} max-w-2xl mx-auto`}>
              {translatedPlainLyrics || plainLyrics}
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
}

function YoutubeModal({ isOpen, onClose, onDownloadComplete }: { isOpen: boolean, onClose: () => void, onDownloadComplete: (track: Track) => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!url) return;
    setStatus('loading');
    setMessage('Подключение к локальному серверу...');
    try {
      // Поддерживаем как прямые ссылки, так и текстовый поиск
      let downloadQuery = url.trim();
      if (!downloadQuery.startsWith('http://') && !downloadQuery.startsWith('https://')) {
        downloadQuery = `ytsearch1:${downloadQuery}`;
      }

      // 1. Запрашиваем скачивание
      const res = await fetch(`http://127.0.0.1:8000/download?url=${encodeURIComponent(downloadQuery)}`);
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();

      // 2. Скачиваем сам файл с локального сервера в память браузера
      setMessage(`Загрузка аудиофайла ${data.title}...`);
      const fileRes = await fetch(`http://127.0.0.1:8000/files/${encodeURIComponent(data.filename)}`);
      if (!fileRes.ok) throw new Error('File fetch error');
      const blob = await fileRes.blob();

      // 3. Создаем объект File и передаем его в плеер
      const file = new File([blob], data.filename, { type: 'audio/mpeg' });
      const newTrack: Track = {
        id: Math.random().toString(36).substring(7),
        title: data.title,
        artist: 'YouTube',
        file: file,
        url: URL.createObjectURL(file),
        addedAt: Date.now()
      };

      onDownloadComplete(newTrack);

      setStatus('success');
      setMessage(`Успешно добавлено в медиатеку: ${data.title}`);
      setUrl('');

      // Закрываем модалку через 2 секунды
      setTimeout(() => {
        onClose();
        setStatus('idle');
        setMessage('');
      }, 2000);

    } catch (err) {
      setStatus('error');
      setMessage('Ошибка. Убедитесь, что локальный Python-сервер запущен и обновлен.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#1a4b4b] border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors">
          <X size={24} />
        </button>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <Youtube className="text-red-500" size={28} />
          Скачать с YouTube
        </h2>
        <p className="text-white/70 mb-6 text-sm">
          Вставьте ссылку на видео или введите название трека и автора для поиска.
        </p>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="https://www.youtube.com/... или название"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />

          <button
            onClick={handleDownload}
            disabled={!url || status === 'loading'}
            className="w-full bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {status === 'loading' ? <Loader2 className="animate-spin" size={20} /> : <Youtube size={20} />}
            {status === 'loading' ? 'Скачивание...' : 'Скачать аудио'}
          </button>

          {message && (
            <div className={`p-3 rounded-lg text-sm ${status === 'error' ? 'bg-red-500/20 text-red-200' : status === 'success' ? 'bg-green-500/20 text-green-200' : 'bg-white/10 text-white/70'}`}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LinkModal({ isOpen, onClose, onDownloadComplete }: { isOpen: boolean, onClose: () => void, onDownloadComplete: (track: Track) => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!url) return;
    setStatus('loading');
    setMessage('Подключение к локальному серверу...');
    try {
      // 1. Запрашиваем скачивание
      const res = await fetch(`http://127.0.0.1:8000/download?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();

      // 2. Скачиваем сам файл с локального сервера в память браузера
      setMessage(`Загрузка аудиофайла ${data.title}...`);
      const fileRes = await fetch(`http://127.0.0.1:8000/files/${encodeURIComponent(data.filename)}`);
      if (!fileRes.ok) throw new Error('File fetch error');
      const blob = await fileRes.blob();

      // 3. Создаем объект File и передаем его в плеер
      const file = new File([blob], data.filename, { type: 'audio/mpeg' });
      const newTrack: Track = {
        id: Math.random().toString(36).substring(7),
        title: data.title,
        artist: 'Unknown',
        file: file,
        url: URL.createObjectURL(file),
        addedAt: Date.now()
      };

      onDownloadComplete(newTrack);

      setStatus('success');
      setMessage(`Успешно добавлено в медиатеку: ${data.title}`);
      setUrl('');

      // Закрываем модалку через 2 секунды
      setTimeout(() => {
        onClose();
        setStatus('idle');
        setMessage('');
      }, 2000);

    } catch (err) {
      setStatus('error');
      setMessage('Ошибка. Убедитесь, что локальный Python-сервер запущен и ссылка рабочая.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#1a4b4b] border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors">
          <X size={24} />
        </button>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <LinkIcon className="text-blue-400" size={28} />
          Скачать по ссылке
        </h2>
        <p className="text-white/70 mb-6 text-sm">
          Вставьте прямую ссылку на медиа-ресурс. Для работы потребуется запущенный локальный сервер.
        </p>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />

          <button
            onClick={handleDownload}
            disabled={!url || status === 'loading'}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {status === 'loading' ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
            {status === 'loading' ? 'Скачивание...' : 'Скачать'}
          </button>

          {message && (
            <div className={`p-3 rounded-lg text-sm ${status === 'error' ? 'bg-red-500/20 text-red-200' : status === 'success' ? 'bg-green-500/20 text-green-200' : 'bg-white/10 text-white/70'}`}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


export function UniversalImportModal({ isOpen, onClose, onImport, playlists = [], targetPlaylistId = '' }: { isOpen: boolean, onClose: () => void, onImport: (tracks: Track[], sourceUrl?: string) => void, playlists?: Playlist[], targetPlaylistId?: string }) {
  const [url, setUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (!isOpen) return null;

  const handleImport = async () => {
    if (!url) return;
    setStatus('loading');
    
    try {
      let importedTracks: Track[] = [];

      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        setMessage('Скачивание с YouTube...');
        const res = await fetch(`http://127.0.0.1:8000/download?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error('Server error');
        const data = await res.json();

        setMessage(`Загрузка аудиофайла ${data.title}...`);
        const fileRes = await fetch(`http://127.0.0.1:8000/files/${encodeURIComponent(data.filename)}`);
        if (!fileRes.ok) throw new Error('File fetch error');
        const blob = await fileRes.blob();

        const file = new File([blob], data.filename, { type: 'audio/mpeg' });
        const newTrack: Track = {
          id: Math.random().toString(36).substring(7),
          title: data.title,
          artist: 'YouTube',
          file: file,
          url: URL.createObjectURL(file),
          addedAt: Date.now()
        };
        importedTracks = [newTrack];
      }
      else if (url.includes('?track=')) {
        setMessage('Загрузка трека из базы данных...');
        const trackMatch = url.match(/[?&]track=([^&]+)/);
        if (!trackMatch) throw new Error('Track ID not found in URL');
        const trackId = trackMatch[1];
        
        const snapshot = await get(ref(db, 'tracks/' + trackId));
        if (!snapshot.exists()) {
          throw new Error('Трек не найден в базе данных');
        }
        const fetchedTrack = snapshot.val() as Track;
        importedTracks = [fetchedTrack];
      }
      else {
        setMessage('Получение данных из Spotify...');
        importedTracks = await fetchSpotifyData(url);
      }

      if (importedTracks.length === 0) {
        throw new Error('Не найдено треков по этой ссылке');
      }

      const tracksWithDate = importedTracks.map(t => ({ ...t, addedAt: t.addedAt || Date.now() }));
      
      // Save imported tracks to global database to preserve metadata like durationMs (Async, non-blocking)
      if (auth.currentUser) {
        Promise.all(tracksWithDate.map(async (track) => {
          if (track.id) {
            try {
              const trackRef = ref(db, `tracks/${track.id}`);
              const snapshot = await get(trackRef);
              if (!snapshot.exists()) {
                await set(trackRef, {
                  id: track.id,
                  title: track.title,
                  artist: track.artist,
                  thumbnail: track.thumbnail || null,
                  durationMs: track.durationMs || 0
                });
              } else if (track.durationMs) {
                const existingData = snapshot.val();
                if (!existingData.durationMs) {
                  await update(trackRef, { durationMs: track.durationMs });
                }
              }
            } catch (err) {
              console.error("Failed to save global track metadata", err);
            }
          }
        })).catch(err => console.error("Batch save failed", err));
      }

      onImport(tracksWithDate, url);
      setStatus('success');
      setMessage(`Успешно импортировано ${importedTracks.length} треков!`);
      setTimeout(() => {
        onClose();
        setUrl('');
        setClientId('');
        setClientSecret('');
        setShowAdvanced(false);
        setStatus('idle');
        setMessage('');
      }, 2000);
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'Ошибка импорта. Проверьте ссылку и ключи.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md relative animate-in fade-in zoom-in duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <Plus size={28} />
          Импорт
        </h2>
        <div className="text-white/70 mb-6 text-sm space-y-2">
          <p>Вставьте ссылку: Spotify плейлист, ссылка на youtube или ссылка к треку.</p>
          <div className="bg-white/5 p-3 rounded-lg border border-white/10 text-xs text-zinc-300">
            <span className="font-semibold text-white">💡 Поддерживаемые источники:</span><br />
            • Плейлисты, альбомы и треки из Spotify<br />
            • Видео с YouTube / youtu.be<br />
            • Скопированная ссылка к треку Tesify
          </div>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Вставьте любую ссылку"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
          >
            {showAdvanced ? 'Скрыть настройки Spotify' : 'Настройки API Spotify'}
          </button>

          {showAdvanced && (
            <div className="space-y-3 p-4 bg-black/20 rounded-xl border border-white/5">
              <input
                type="text"
                placeholder="Client ID (Optional)"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
              <input
                type="password"
                placeholder="Client Secret (Optional)"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
            </div>
          )}

          <div className="flex gap-3">
            <button 
              className="flex-1 bg-white/10 hover:bg-white/20 transition-colors py-3 rounded-xl font-bold text-white text-sm"
              onClick={() => {
                const myPlaylists = playlists.filter(p => !p.isSystem && p.id !== targetPlaylistId);
                if (myPlaylists.length === 0) {
                  alert("У вас нет других плейлистов для импорта.");
                  return;
                }
                const names = myPlaylists.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
                const choice = prompt(`Выберите плейлист для импорта (введите номер):\n${names}`);
                if (!choice) return;
                const idx = parseInt(choice) - 1;
                if (idx >= 0 && idx < myPlaylists.length) {
                  onImport(myPlaylists[idx].tracks);
                  alert(`Импортировано ${myPlaylists[idx].tracks.length} треков!`);
                  onClose();
                } else {
                  alert("Неверный номер.");
                }
              }}
            >
              Из плейлиста
            </button>
            <button
              onClick={handleImport}
              disabled={!url || status === 'loading'}
              className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {status === 'loading' ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
              {status === 'loading' ? 'Импорт...' : 'Импортировать'}
            </button>
          </div>

          {message && (
            <div className={`p-3 rounded-lg text-sm ${status === 'error' ? 'bg-red-500/20 text-red-200' : status === 'success' ? 'bg-green-500/20 text-green-200' : 'bg-white/10 text-white/70'}`}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
