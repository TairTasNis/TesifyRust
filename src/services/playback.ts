import type { Track } from '../types';

const backend = 'http://127.0.0.1:8000';

export function getYoutubeId(track: Track): string | undefined {
  if (track.youtubeId) return track.youtubeId;
  try {
    const url = new URL(track.url);
    if (url.pathname === '/proxy_stream') return url.searchParams.get('id') || undefined;
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0];
    if (/(^|\.)youtube\.com$/.test(url.hostname)) {
      return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
    }
  } catch { /* A playlist can store a bare YouTube ID. */ }
  if (/^[\w-]{11}$/.test(track.url)) return track.url;
  return undefined;
}

async function backendJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'Не удалось загрузить аудио. Проверьте сервер.');
  return data;
}

export async function resolvePlayableTrack(track: Track, mode: 'stream' | 'download', signal?: AbortSignal): Promise<Track> {
  const result = { ...track, youtubeId: getYoutubeId(track) };
  if (track.file instanceof Blob) {
    result.url = track.url.startsWith('blob:') ? track.url : URL.createObjectURL(track.file);
    return result;
  }
  // Blob URLs saved in the cloud no longer exist after a browser restart.
  const staleBlob = result.url?.startsWith('blob:');
  const remoteAudio = /\.googlevideo\.com\//.test(result.url || '');
  if (!result.youtubeId && (!result.url || staleBlob || remoteAudio || result.spotifyId)) {
    const data = await backendJson(`${backend}/search?q=${encodeURIComponent(`${track.artist} ${track.title}`)}`, signal);
    const matches = data.results || [];
    if (!matches.length) throw new Error('Не удалось найти трек на YouTube.');
    const targetDuration = track.durationMs ? track.durationMs / 1000 : 0;
    const match = targetDuration
      ? matches.find((item: any) => Number.isFinite(item.duration) && Math.abs(item.duration - targetDuration) <= 3) ||
        matches.find((item: any) => Number.isFinite(item.duration) && Math.abs(item.duration - targetDuration) <= 10) ||
        matches.find((item: any) => Number.isFinite(item.duration) && Math.abs(item.duration - targetDuration) <= 30) || matches[0]
      : matches[0];
    result.youtubeId = match.id;
  }
  if (result.youtubeId) {
    if (mode === 'stream') {
      result.url = `${backend}/proxy_stream?${new URLSearchParams({ id: result.youtubeId })}`;
    } else {
      const data = await backendJson(`${backend}/stream?${new URLSearchParams({ id: result.youtubeId, mode })}`, signal);
      if (typeof data.url !== 'string' || !data.url) throw new Error('Сервер не вернул ссылку на аудио.');
      result.url = data.url;
    }
  }
  if (!result.url) throw new Error('У трека нет источника аудио.');
  return result;
}

interface PlaybackCallbacks {
  onPlaying: (playing: boolean) => void;
  onLoading: (loading: boolean) => void;
  onError: (message: string) => void;
  onErrorClear?: () => void;
}

// Own the source and play requests in one place so a reload cannot start a retry loop.
export function createAudioPlaybackController(audio: HTMLAudioElement, callbacks: PlaybackCallbacks) {
  let source: string | null = null;
  let generation = 0;
  let desiredPlaying = false;
  let loading = false;
  let retried = false;
  let pendingSeek: number | null = null;
  let seekApplied = false;
  let seekVersion = 0;
  let seekAttempts = 0;
  let seekWatchdog: ReturnType<typeof setTimeout> | null = null;
  let lastPosition = 0;
  let fileRequest: AbortController | null = null;
  let fileUrl: string | null = null;
  let loadingFile = false;
  let usedFileRecovery = false;
  let pendingPlay: Promise<void> | null = null;
  let disposed = false;
  const setLoading = (value: boolean) => {
    loading = value;
    callbacks.onLoading(value);
  };
  const clearSeekWatchdog = () => {
    if (seekWatchdog !== null) clearTimeout(seekWatchdog);
    seekWatchdog = null;
  };
  const watchSeek = () => {
    clearSeekWatchdog();
    const requestVersion = seekVersion;
    seekWatchdog = setTimeout(() => {
      seekWatchdog = null;
      if (!disposed && seekVersion === requestVersion && pendingSeek !== null && !loadingFile) void recoverSeek();
    }, 5000);
  };
  const fail = (message: string) => {
    clearSeekWatchdog();
    generation++;
    pendingPlay = null;
    desiredPlaying = false;
    pendingSeek = null;
    seekApplied = false;
    setLoading(false);
    callbacks.onPlaying(false);
    callbacks.onError(message);
  };
  const cancelFile = () => {
    clearSeekWatchdog();
    fileRequest?.abort();
    fileRequest = null;
    loadingFile = false;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = null;
  };
  const isSeekable = (time: number) => {
    const ranges = audio.seekable;
    for (let index = 0; index < ranges.length; index++) {
      if (time >= ranges.start(index) && time <= ranges.end(index)) return true;
    }
    return false;
  };
  const applySeek = () => {
    if (loadingFile || pendingSeek === null || seekApplied || audio.readyState < 1) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) pendingSeek = Math.min(pendingSeek, audio.duration);
    // Metadata can precede the seek index. Setting currentTime before a range exists can silently clamp to zero.
    if (!isSeekable(pendingSeek)) return;
    seekApplied = true;
    seekAttempts++;
    watchSeek();
    try {
      audio.currentTime = pendingSeek;
    } catch {
      // Metadata may have been invalidated by a new range request; keep the destination for canplay.
      seekApplied = false;
    }
  };
  const recoverSeek = async () => {
    if (disposed || loadingFile || !source || pendingSeek === null) return;
    const isBackendFile = source.startsWith(`${backend}/local_files/`) || source.startsWith(`${backend}/files/`);
    if (usedFileRecovery || (!source.includes('/proxy_stream?') && !isBackendFile)) {
      seekApplied = false;
      if (seekAttempts >= 2 || !isSeekable(pendingSeek)) {
        fail('Не удалось перейти к выбранному моменту трека. Попробуйте запустить трек снова.');
      } else applySeek();
      return;
    }
    // Some streaming decoders reject a seek without a media error. A complete local file has a stable seek index.
    usedFileRecovery = true;
    clearSeekWatchdog();
    loadingFile = true;
    seekApplied = false;
    seekAttempts = 0;
    generation++;
    pendingPlay = null;
    setLoading(true);
    audio.pause();
    const requestSource = source;
    const request = new AbortController();
    fileRequest = request;
    const timeout = setTimeout(() => request.abort(), 45000);
    try {
      const response = await fetch(source, { signal: request.signal });
      if (!response.ok) throw new Error('Audio file request failed');
      const file = await response.blob();
      if (!file.size || /text\/|json/i.test(file.type)) throw new Error('Invalid audio file');
      if (disposed || source !== requestSource || fileRequest !== request) return;
      fileUrl = URL.createObjectURL(file);
      loadingFile = false;
      audio.src = fileUrl;
      audio.load();
    } catch {
      if (!disposed && source === requestSource && fileRequest === request) {
        loadingFile = false;
        fail('Не удалось загрузить аудио для перемотки. Проверьте соединение и запустите трек снова.');
      }
    } finally {
      clearTimeout(timeout);
      if (fileRequest === request) fileRequest = null;
    }
  };
  const onError = () => {
    if (disposed || !source || loadingFile) return;
    if (fileUrl) {
      fail('Не удалось воспроизвести загруженное аудио. Попробуйте запустить трек снова.');
      return;
    }
    if (!retried && source.includes('/proxy_stream?')) {
      retried = true;
      generation++;
      pendingPlay = null;
      // A failed range request can reset the media clock. The user's latest seek wins over recovery time.
      pendingSeek ??= Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : lastPosition;
      seekApplied = false;
      const retry = new URL(source);
      retry.searchParams.set('retry', String(Date.now()));
      setLoading(true);
      audio.src = retry.toString();
      audio.load();
      return;
    }
    fail('Не удалось загрузить аудио. Проверьте соединение и сервер, затем запустите трек снова.');
  };
  const play = () => {
    if (disposed || loadingFile || !source || !desiredPlaying || pendingPlay || audio.readyState < 2 || (pendingSeek !== null && !seekApplied)) return;
    const requestGeneration = generation;
    const requestSeekVersion = seekVersion;
    const request = audio.play();
    pendingPlay = request;
    request.catch((error: DOMException) => {
      if (disposed || generation !== requestGeneration || error.name === 'AbortError') return;
      if (error.name === 'NotSupportedError') onError();
      else fail(error.name === 'NotAllowedError' ? 'Нажмите «Воспроизвести», чтобы разрешить запуск аудио.' : 'Не удалось начать воспроизведение.');
    }).finally(() => {
      if (pendingPlay !== request) return;
      pendingPlay = null;
      // Seeking can abort an in-flight play() after canplay has already fired.
      if (!disposed && seekVersion !== requestSeekVersion && audio.paused) play();
    });
  };
  const onMetadata = () => { if (!disposed && source) applySeek(); };
  const onCanPlay = () => {
    if (disposed || !source || loadingFile) return;
    applySeek();
    if (pendingSeek !== null && (!seekApplied || (!audio.seeking && Math.abs(audio.currentTime - pendingSeek) > 0.5))) {
      void recoverSeek();
      return;
    }
    setLoading(false);
    play();
  };
  const confirmSeek = () => {
    clearSeekWatchdog();
    lastPosition = audio.currentTime;
    pendingSeek = null;
    seekApplied = false;
    setLoading(false);
  };
  const onSeeked = () => {
    if (disposed || !source || loadingFile) return;
    if (pendingSeek !== null && Math.abs(audio.currentTime - pendingSeek) < 0.5) {
      confirmSeek();
    } else if (pendingSeek !== null && seekApplied) { void recoverSeek(); return; }
    play();
  };
  const onTimeUpdate = () => {
    if (pendingSeek !== null && seekApplied && !audio.seeking && !loadingFile && audio.readyState >= 2) {
      // Some decoders omit seeked; the actual media clock must still release the pending destination.
      if (Math.abs(audio.currentTime - pendingSeek) < 1) confirmSeek();
      else { void recoverSeek(); return; }
    }
    if (!loading && pendingSeek === null && !audio.error && Number.isFinite(audio.currentTime)) lastPosition = audio.currentTime;
  };
  const onPlay = () => { if (!disposed) callbacks.onPlaying(true); };
  const onPause = () => { if (!disposed && !loading && pendingSeek === null && !audio.seeking && !audio.ended) callbacks.onPlaying(false); };
  audio.addEventListener('loadedmetadata', onMetadata);
  audio.addEventListener('progress', onMetadata);
  audio.addEventListener('loadeddata', onMetadata);
  audio.addEventListener('canplay', onCanPlay);
  audio.addEventListener('seeked', onSeeked);
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('error', onError);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  return {
    setSource(value: string) {
      if (source === value) return;
      generation++;
      cancelFile();
      pendingPlay = null;
      source = value;
      retried = false;
      pendingSeek = null;
      seekApplied = false;
      seekAttempts = 0;
      usedFileRecovery = false;
      lastPosition = 0;
      setLoading(Boolean(value));
      if (value) audio.src = value;
      else audio.removeAttribute('src');
      audio.load();
    },
    seek(time: number): number | null {
      if (disposed || !source || !Number.isFinite(time)) return null;
      callbacks.onErrorClear?.();
      pendingSeek = Math.max(0, time);
      seekApplied = false;
      seekAttempts = 0;
      seekVersion++;
      watchSeek();
      applySeek();
      if (!seekApplied) {
        setLoading(true);
        audio.pause();
        if (audio.readyState >= 3 && !loadingFile) void recoverSeek();
      }
      return pendingSeek ?? audio.currentTime;
    },
    getCurrentTime(): number {
      // Display real playback once the decoder is running, even if a seek was rejected or seeked was omitted.
      return loading ? pendingSeek ?? lastPosition : audio.error ? lastPosition : audio.currentTime;
    },
    setPlaying(value: boolean) {
      desiredPlaying = value;
      if (value) play();
      else { generation++; pendingPlay = null; audio.pause(); }
    },
    dispose() {
      disposed = true;
      generation++;
      cancelFile();
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('progress', onMetadata);
      audio.removeEventListener('loadeddata', onMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.pause();
    },
  };
}
