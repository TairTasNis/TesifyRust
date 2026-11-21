import { useTranslation } from '../../preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { CSSProperties } from 'react'
import TrackArtistLinks from '../../catalog/ArtistLinks/TrackArtistLinks'
import type { OpenCatalog } from '../../catalog/types'
import { formatDuration } from '../../playlists/format'
import TrackPlaylistButton from '../../playlists/Membership/TrackPlaylistButton'
import Icon from '../../ui/Icon/Icon'
import MusicLoader from '../../ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../ui/PlaylistCover/PlaylistCover'
import { usePlayback } from '../PlaybackProvider'
import './MiniPlayer.css'

const timestamp = (seconds: number) => seconds > 0 ? formatDuration(seconds * 1000) : '0:00'

export default function MiniPlayer({ lyricsOpen, onToggleLyrics, onOpen }: { lyricsOpen: boolean; onToggleLyrics: () => void; onOpen: OpenCatalog }) {
  const t = useTranslation()
  const player = usePlayback()
  const [scrub, setScrub] = useState<{ trackId: string; time: number } | null>(null)
  const [dockHovered, setDockHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [initialVisible, setInitialVisible] = useState(true)
  const pointer = useRef<number | null>(null)
  const track = player.current

  useEffect(() => {
    if (!lyricsOpen) return
    setInitialVisible(true)
    const timer = window.setTimeout(() => setInitialVisible(false), 2000)
    return () => window.clearTimeout(timer)
  }, [lyricsOpen])

  if (!track) return null
  const position = scrub?.trackId === track.id ? scrub.time : player.time
  const progress = player.duration > 0 ? Math.min(1, Math.max(0, position / player.duration)) : 0
  const canSeek = !player.error && player.duration > 0 && (!player.loading || player.time > 0)
  const isHidden = lyricsOpen && !dockHovered && !focusWithin && !scrub && pointer.current === null && !initialVisible

  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * player.duration
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (!canSeek) return
    let value: number
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': value = player.time - 5; break
      case 'ArrowRight': case 'ArrowUp': value = player.time + 5; break
      case 'Home': value = 0; break
      case 'End': value = player.duration; break
      default: return
    }
    event.preventDefault(); player.seek(value)
  }

  return (
    <div
      className={`mini-player-dock${lyricsOpen ? ' mini-player-dock--lyrics' : ''}`}
      onMouseEnter={() => setDockHovered(true)}
      onMouseLeave={() => setDockHovered(false)}
      data-dock-open={!isHidden}
    >
      {lyricsOpen && (
        <button
          type="button"
          className="mini-player-peek-handle"
          onClick={() => setDockHovered(true)}
          aria-label={t("Показать плеер")}
          title={t("Показать плеер")}
          tabIndex={isHidden ? 0 : -1}
        >
          <span className="mini-player-peek-bar" />
        </button>
      )}
      <section
        className="mini-player"
        data-lyrics={lyricsOpen || undefined}
        data-hidden={isHidden || undefined}
        aria-label={t("Миниплеер")}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false)
        }}
      >
    <div className="mini-player-fill" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
    <div className="mini-player-seek" role="slider" tabIndex={0} aria-label={t("Позиция воспроизведения")} aria-valuemin={0} aria-valuemax={Math.round(player.duration)} aria-valuenow={Math.round(position)} aria-valuetext={t("{0} из {1}", timestamp(position), timestamp(player.duration))} aria-disabled={!canSeek}
      onKeyDown={key}
      onPointerDown={(event) => {
        if (!canSeek || event.button !== 0 || pointer.current !== null) return
        pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
        setScrub({ trackId: track.id, time: point(event) })
      }}
      onPointerMove={(event) => { if (pointer.current === event.pointerId) setScrub({ trackId: track.id, time: point(event) }) }}
      onPointerUp={(event) => {
        if (pointer.current !== event.pointerId) return
        pointer.current = null; player.seek(point(event)); setScrub(null)
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { pointer.current = null; setScrub(null) }} />
    <div className="mini-player-content">
      <button className="player-button mini-player-lyrics" aria-label={lyricsOpen ? t("Скрыть текст песни") : t("Показать текст песни")} title={t("Текст песни")} aria-pressed={lyricsOpen} aria-controls="track-lyrics" onClick={onToggleLyrics}><Icon name="lyrics" /></button>
      <div className="mini-player-track" key={track.id}><TrackPlaylistButton spotifyId={track.spotifyId} title={track.title} /><PlaylistCover url={track.coverUrl} name={t("Обложка: {0}", track.title)} /><div className="mini-player-info"><strong>{track.title}</strong><TrackArtistLinks track={track} onOpen={onOpen} /></div></div>
      <div className="mini-player-transport"><div className="mini-player-controls">
        <button className="player-button" aria-label={t("Предыдущий трек")} onClick={player.previous}><Icon name="previous" /></button>
        <button className="player-button player-button-main" aria-label={player.playing ? t("Пауза") : t("Продолжить")} onClick={player.toggle} aria-busy={player.loading}><span className="player-glyph" key={player.playing ? 'pause' : 'play'}><Icon name={player.playing ? 'pause' : 'play'} /></span></button>
        <button className="player-button" aria-label={t("Следующий трек")} onClick={player.next} disabled={!player.canNext}><Icon name="next" /></button>
      </div>
      <div className="mini-player-time" aria-live="off">{player.loading && <MusicLoader variant="compact" label={t("Загрузка трека")} />}<span>{timestamp(position)}<span className="mini-player-duration"> / {timestamp(player.duration)}</span></span></div>
      </div>
      <div className="mini-player-volume"><button className="player-button" aria-label={player.volume > 0 ? t("Выключить звук") : t("Включить звук")} onClick={player.mute}><Icon name={player.volume > 0 ? 'volume' : 'muted'} /></button><input aria-label={t("Громкость")} aria-valuetext={`${Math.round(player.volume * 100)}%`} style={{ '--volume-percent': `${Math.round(player.volume * 100)}%` } as CSSProperties} type="range" min="0" max="100" value={Math.round(player.volume * 100)} onChange={(event) => player.setVolume(Number(event.target.value) / 100)} /></div>
    </div>
    {player.error && <div className="mini-player-error" role="alert"><span>{t(player.error.replace(/^PlayEngine: /, ''))}</span><button onClick={player.retry}>{t("Повторить")}</button></div>}
    </section>
  </div>
  )
}
