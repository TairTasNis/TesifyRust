import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import MusicLoader from '../../ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../ui/PlaylistCover/PlaylistCover'
import { usePlayback } from '../PlaybackProvider'
import './MiniPlayer.css'

export default function MiniPlayer({ lyricsOpen, expanded, onOpen }: {
  lyricsOpen: boolean; expanded: boolean; onOpen: () => void
}) {
  const t = useTranslation()
  const player = usePlayback()
  const [peek, setPeek] = useState(false)
  const timer = useRef<number>(0)
  const handle = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)

  const reveal = useCallback(() => {
    setPeek(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (!document.querySelector('dialog[open]') && panel.current?.contains(document.activeElement)) {
        handle.current?.focus({ preventScroll: true })
      }
      setPeek(false)
    }, 3000)
  }, [])

  useEffect(() => {
    if (lyricsOpen) reveal()
    return () => window.clearTimeout(timer.current)
  }, [lyricsOpen, reveal])

  const track = player.current
  if (!track) return null
  const hidden = lyricsOpen && !peek
  const progress = player.duration ? Math.min(100, (player.time / player.duration) * 100) : 0
  const playbackLabel = player.error ? t("Повторить") : player.playing ? t("Пауза") : t("Продолжить")

  return <>
    {lyricsOpen && <button ref={handle} className="mini-player-peek" type="button"
      aria-label={t("Показать плеер")} aria-expanded={!hidden} aria-controls="mini-player"
      onClick={reveal} onPointerEnter={event => { if (event.pointerType === 'mouse') reveal() }}><span /></button>}
    <section ref={panel} className="mini-player" id="mini-player" aria-label={t("Миниплеер")}
      inert={expanded || hidden} data-expanded={expanded || undefined} data-lyrics={lyricsOpen || undefined}
      data-hidden={hidden || undefined} onPointerDown={lyricsOpen ? reveal : undefined}>
      <span className="mini-player-surface" aria-hidden="true"><span style={{ transform: `scaleX(${progress / 100})` }} /></span>
      <button type="button" className="mini-player-open" onClick={onOpen} aria-label={t("Открыть текущий трек")} aria-controls="now-playing">
        <PlaylistCover url={track.coverUrl} name={track.title} className="mini-player-cover" />
        <span className="mini-player-identity"><strong>{track.title}</strong><span>{track.artist}</span></span>
      </button>
      <button type="button" className="mini-player-toggle" aria-label={playbackLabel} title={playbackLabel}
        onClick={player.error ? player.retry : player.toggle} aria-busy={player.loading}>
        {player.loading && player.playing ? <MusicLoader variant="spinner" label={t("Загрузка трека")} />
          : <Icon name={player.playing ? 'pause' : 'play'} />}
      </button>
      {player.error && <p className="mini-player-error" role="alert">{t(player.error.replace(/^PlayEngine: /, ''))}</p>}
    </section>
  </>
}
