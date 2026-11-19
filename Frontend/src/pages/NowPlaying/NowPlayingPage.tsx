import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import TrackArtistLinks from '../../shared/catalog/ArtistLinks/TrackArtistLinks'
import type { OpenCatalog } from '../../shared/catalog/types'
import { formatDuration } from '../../shared/playlists/format'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import { useTranslation } from '../../shared/preferences/i18n'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import './NowPlayingPage.css'

type Props = { closing: boolean; onClose: () => void; onLyrics: () => void; onOpen: OpenCatalog }
const clock = (seconds: number) => formatDuration(Math.floor(seconds) * 1000)

export default function NowPlayingPage({ closing, onClose, onLyrics, onOpen }: Props) {
  const t = useTranslation()
  const player = usePlayback()
  const close = useRef<HTMLButtonElement>(null)
  const track = player.current

  useLayoutEffect(() => { close.current?.focus({ preventScroll: true }) }, [])
  if (!track) return null

  const playbackLabel = player.error ? t("Повторить") : player.playing ? t("Пауза") : t("Продолжить")
  return <section id="now-playing" className="now-playing-page" aria-label={t("Сейчас играет")} data-closing={closing || undefined} inert={closing}>
    <div className="now-playing-background" aria-hidden="true" />
    <header className="now-playing-header">
      <button ref={close} type="button" className="now-playing-close" onClick={onClose} aria-label={t("Свернуть плеер")}><Icon name="chevron" /></button>
      <span>{t("Сейчас играет")}</span>
    </header>
    <div className="now-playing-scroll">
      <div className="now-playing-layout">
        <PlaylistCover url={track.coverUrl} name={track.title} eager className="now-playing-cover" />
        <div className="now-playing-panel">
          <div className="now-playing-identity"><h1>{track.title}</h1><TrackArtistLinks track={track} onOpen={onOpen} /></div>
          <SeekTrack key={track.id} />
          <div className="now-playing-controls">
            <div className="now-playing-transport">
              <button type="button" aria-label={t("Предыдущий трек")} onClick={player.previous}><Icon name="previous" /></button>
              <button type="button" className="now-playing-play" aria-label={playbackLabel} aria-busy={player.loading} onClick={player.error ? player.retry : player.toggle}>
                {player.loading && player.playing ? <MusicLoader variant="spinner" label={t("Загрузка трека")} /> : <Icon name={player.playing ? 'pause' : 'play'} />}
              </button>
              <button type="button" aria-label={t("Следующий трек")} onClick={player.next} disabled={!player.canNext}><Icon name="next" /></button>
            </div>
            <button type="button" className="now-playing-lyrics" aria-label={t("Показать текст песни")} onClick={onLyrics}><Icon name="lyrics" /></button>
          </div>
          {player.error && <p className="now-playing-error" role="alert">{t(player.error.replace(/^PlayEngine: /, ''))}</p>}
        </div>
      </div>
    </div>
  </section>
}

function SeekTrack() {
  const t = useTranslation()
  const { time, duration, seek, loading, error } = usePlayback()
  const [draft, setDraft] = useState<number | null>(null)
  const dragging = useRef(false)
  const position = Math.min(duration, draft ?? time)
  const enabled = !loading && !error && duration > 0
  function finish(value?: number) {
    if (!dragging.current) return
    dragging.current = false
    if (value !== undefined && enabled) seek(value)
    setDraft(null)
  }
  return <div className="now-playing-seek">
    <input type="range" aria-label={t("Перемотка")} aria-valuetext={clock(position)}
      min="0" max={duration || 1} step=".1" value={position} disabled={!enabled}
      style={{ '--seek-progress': `${duration ? (position / duration) * 100 : 0}%` } as CSSProperties}
      onPointerDown={event => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={event => finish(event.currentTarget.valueAsNumber)}
      onLostPointerCapture={() => finish()}
      onPointerCancel={() => finish()}
      onBlur={() => finish()}
      onChange={event => {
        if (dragging.current) setDraft(event.currentTarget.valueAsNumber)
        else seek(event.currentTarget.valueAsNumber)
      }} />
    <div aria-hidden="true"><span>{clock(position)}</span><span>{clock(duration)}</span></div>
  </div>
}
