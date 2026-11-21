import { useTranslation } from '../../shared/preferences/i18n'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { errorMessage } from '../../shared/lib/backend'
import { canAnimate } from '../../shared/lib/motion'
import { catalogTracks } from '../../shared/catalog/playback'
import type { CatalogItem } from '../../shared/catalog/types'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import { formatDuration } from '../../shared/playlists/format'
import { usePreferences } from '../../shared/preferences/preferences'
import type { LyricsMode } from '../../shared/preferences/preferences'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import { getLyrics } from './api'
import LyricsBackground from './LyricsBackground'
import { activeLineAt, lyricCues, wordProgress } from './timing'
import type { Lyrics, LyricsResponse } from './types'
import LyricsSourcesModal from './LyricsSourcesModal'
import LyricsTrackPicker from './LyricsTrackPicker'
import LyricsToolbar, { LyricsSettings, useLyricsAppearance } from './LyricsToolbar'
import './LyricsPage.css'

type Props = {
  onClose: () => void
  mobile: boolean
  isMaximized?: boolean
  onToggleMaximize?: () => void
}
const MANUAL_SCROLL_MS = 3000
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export default function LyricsPage({ onClose, mobile, isMaximized = false, onToggleMaximize }: Props) {
  const t = useTranslation()
  const player = usePlayback()
  const { lyricsMode } = usePreferences()
  const { appearance, setAppearance, style } = useLyricsAppearance()
  const playingKey = `${player.playlistId}/${player.current?.id}`
  const [override, setOverride] = useState<{ playingKey: string; item: CatalogItem } | null>(null)
  const alternateItem = override?.playingKey === playingKey ? override.item : null
  const track = useMemo(() => alternateItem ? catalogTracks([alternateItem])[0] : player.current, [alternateItem, player.current])
  const trackId = track?.id
  const playlistId = alternateItem ? 'spotify:lyrics' : player.playlistId
  const key = `${playlistId}/${trackId}`
  const currentKey = useRef(key)
  currentKey.current = key
  useEffect(() => { setOverride(null) }, [playingKey])
  const [result, setResult] = useState<{ key: string; response: LyricsResponse } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const [closing, setClosing] = useState(false)
  const [sourcesFor, setSourcesFor] = useState<string | null>(null)
  const [toolDialog, setToolDialog] = useState<'appearance' | 'track' | null>(null)
  const showTrackPicker = toolDialog === 'track'
  const showSources = sourcesFor === key
  const [offset, setOffset] = useState<number>(() => {
    if (!track?.id) return 0
    const val = localStorage.getItem(`tesify_lyrics_offset_${track.id}`)
    return val ? parseFloat(val) || 0 : 0
  })

  useEffect(() => {
    if (!track?.id) return
    const val = localStorage.getItem(`tesify_lyrics_offset_${track.id}`)
    setOffset(val ? parseFloat(val) || 0 : 0)
  }, [track?.id])

  const handleOffsetChange = useCallback((newOffset: number) => {
    setOffset(newOffset)
    if (track?.id) {
      if (newOffset === 0) {
        localStorage.removeItem(`tesify_lyrics_offset_${track.id}`)
      } else {
        localStorage.setItem(`tesify_lyrics_offset_${track.id}`, String(newOffset))
      }
    }
  }, [track?.id])

  const closeRef = useRef<HTMLButtonElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const [source, setSource] = useState<{ key: string; id: string } | null>(null)
  const selectedSource = source?.key === key ? source.id : undefined
  const requestKey = `${key}/${selectedSource ?? 'auto'}`
  const response = result?.key === requestKey ? result.response : null
  const message = error?.key === requestKey ? error.message : null

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  const close = useCallback(() => {
    if (mobile || !canAnimate()) { onClose(); return }
    setClosing(true)
  }, [mobile, onClose])
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(onClose, 180)
    return () => window.clearTimeout(timer)
  }, [closing, onClose])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]') && !showSources && !showTrackPicker) { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [onClose, showSources, showTrackPicker])

  useEffect(() => {
    if (!trackId || !playlistId) return
    let current = true
    getLyrics(playlistId, trackId, selectedSource).then((response) => {
      if (current) setResult({ key: requestKey, response })
    }).catch((error: unknown) => { if (current) setError({ key: requestKey, message: errorMessage(error) }) })
    return () => { current = false }
  }, [playlistId, trackId, requestKey, retry, selectedSource])

  const handleSelectSource = useCallback(async (sourceId: string) => {
    if (!trackId || !playlistId) return null
    try {
      const response = await getLyrics(playlistId, trackId, sourceId)
      if (currentKey.current === key && response.status === 'found' && response.lyrics) {
        setSource({ key, id: sourceId })
        setResult({ key: `${key}/${sourceId}`, response })
      }
      return response
    } catch {
      return null
    }
  }, [trackId, playlistId, key])

  if (!track) return null
  const busy = !response && !message
  const lyrics = response?.lyrics
  return <section className="lyrics-page" id="track-lyrics" aria-label={t("Текст песни «{0}»", track.title)} ref={pageRef} data-closing={closing || undefined} style={style as CSSProperties}>
    <LyricsBackground coverUrl={track.coverUrl} playing={player.playing && !player.loading} mobile={mobile} />
    <header className="lyrics-header" data-tauri-drag-region>
      <span data-tauri-drag-region><Icon name="lyrics" />{t("Текст песни")}</span>
      <div className="lyrics-header-actions">
        {onToggleMaximize && (
          <button
            type="button"
            className="lyrics-icon-button"
            onClick={onToggleMaximize}
            aria-label={isMaximized ? t("Восстановить размер") : t("Развернуть")}
            title={isMaximized ? t("Восстановить размер") : t("Развернуть")}
          >
            <Icon name={isMaximized ? 'restore' : 'maximize'} />
          </button>
        )}
        <button ref={closeRef} className="lyrics-icon-button" onClick={close} aria-label={t("Закрыть текст песни")} title={t("Закрыть (Esc)")}><Icon name="close" /></button>
        {mobile && <button type="button" className="lyrics-icon-button lyrics-settings-trigger" aria-label={t("Настройки текста")}
          aria-haspopup="dialog" onClick={() => setToolDialog('appearance')}><Icon name="settings" /></button>}
      </div>
    </header>
    {!mobile && <LyricsToolbar appearance={appearance} onChange={setAppearance} onChooseTrack={() => setToolDialog('track')} />}
    <div className="lyrics-layout" data-cover={appearance.showCover}>
      <div className="lyrics-now-playing" key={track.id}>
        {appearance.showCover && <PlaylistCover url={track.coverUrl} name={t("Обложка: {0}", track.title)} className="lyrics-cover" />}
        <div className="lyrics-track-info"><h1>{track.title}</h1><p>{track.artist}</p></div>
        {lyrics && <div className="lyrics-credit">
          <button
            type="button"
            className="lyrics-source-badge"
            onClick={() => setSourcesFor(key)}
            title={t("Нажмите, чтобы посмотреть все доступные источники и тип синхронизации")}
          >
            <span className="lyrics-source-prefix">{t("Источник:")}</span>
            <span className="lyrics-source-title">{lyrics.source}</span>
            <span className="lyrics-source-arrow" aria-hidden="true">›</span>
          </button>
        </div>}
      </div>
      <div className="lyrics-reading" aria-busy={busy}>
        {busy ? <div className="lyrics-state" role="status"><MusicLoader variant="compact" label={t("Ищем текст песни")} /><h2>{t("Ищем текст песни")}</h2></div>
          : lyrics ? <LyricStage key={requestKey} lyrics={lyrics} offset={offset} mode={lyricsMode} mobile={mobile} followPlayback={!alternateItem} />
          : <div className="lyrics-state" role="status"><Icon name="lyrics" /><h2>{response?.status === 'instrumental' ? t("Только музыка") : response?.status === 'unavailable' || message ? t("Не удалось загрузить текст") : t("Текст пока не найден")}</h2>
            <p>{message ? t(message) : response?.status === 'instrumental' ? t("У этой композиции нет слов") : response?.status === 'unavailable' ? t("Сервисы текста сейчас недоступны. Попробуйте ещё раз.") : t("В подключённых источниках нет текста этой песни")}</p>
            {response?.status !== 'instrumental' && <button className="lyrics-retry" onClick={() => {
              setResult(null); setError(null); setRetry(n => n + 1)
            }}>{t("Попробовать ещё раз")}</button>}
          </div>}
      </div>
    </div>
    {showSources && lyrics && (
      <LyricsSourcesModal
        currentLyrics={lyrics}
        onClose={() => setSourcesFor(null)}
        offset={offset}
        onOffsetChange={alternateItem ? undefined : handleOffsetChange}
        onSelectSource={handleSelectSource}
      />
    )}
    {mobile && toolDialog === 'appearance' && <LyricsSettings appearance={appearance} onChange={setAppearance}
      onClose={() => setToolDialog(null)} onChooseTrack={() => setToolDialog('track')} />}
    {showTrackPicker && <LyricsTrackPicker alternate={Boolean(alternateItem)} onClose={() => setToolDialog(null)} onSelect={item => {
      setOverride(item && item.id !== player.current?.spotifyId ? { playingKey, item } : null)
      setSource(null)
      setToolDialog(null)
    }} />}
  </section>
}

function moveRows(rows: (HTMLElement | null)[], offset: number | null, mobile: boolean, lead?: number) {
  // The current line starts first. Each of the next five starts 45 ms after the previous one.
  const transform = offset === null ? 'none' : mobile ? `translateY(${offset}px)` : `translate3d(0, ${offset}px, 0)`
  rows.forEach((row, index) => {
    if (!row) return
    row.style.transitionDelay = lead === undefined ? '0ms' : `${Math.min(5, Math.max(0, index - lead)) * 45}ms`
    row.style.transitionDuration = lead === undefined ? '0ms' : ''
    row.style.transform = transform
  })
}

function LyricStage({ lyrics, offset, mode, mobile, followPlayback }: {
  lyrics: Lyrics; offset: number; mode: LyricsMode; mobile: boolean; followPlayback: boolean
}) {
  const t = useTranslation()
  const player = usePlayback()
  const viewport = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLElement | null)[]>([])
  const words = useRef<(HTMLSpanElement | null)[][]>([])
  const timed = followPlayback && lyrics.sync !== 'none'
  const showWordTiming = timed && mode !== 'line'
  const cues = useMemo(() => lyricCues(lyrics.lines, timed, offset), [lyrics.lines, timed, offset])
  const letters = useMemo(() => mode === 'letter' && showWordTiming
    ? cues.map(cue => 'countdown' in cue ? [] : cue.words.map(word => Array.from(graphemes.segment(word.text), part => part.segment)))
    : [], [cues, mode, showWordTiming])
  const [{ index: active, seconds }, setCue] = useState(() => {
    const time = player.time - offset
    const index = activeLineAt(cues, time)
    const cue = cues[index]
    return { index, seconds: cue && 'countdown' in cue ? Math.ceil(cue.end - time) : 0 }
  })
  const [browsing, setBrowsing] = useState(false)
  const browsingRef = useRef(false)
  const resumingFollow = useRef(false)
  const [size, setSize] = useState(0)
  const browseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousActive = useRef(active)
  const firstPosition = useRef(true)
  const playback = useRef(player)
  const oldScroll = useRef(0)
  // Read the media clock directly. React's timeupdate cadence is too coarse for syllables.
  playback.current = player

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => setSize(n => n + 1))
    observer.observe(element)
    if (list.current) observer.observe(list.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!timed) return
    const audio = document.querySelector<HTMLAudioElement>('[data-testid="playback-audio"]')
    let frame = 0, lastActive = -2, lastSeconds = 0, clock = -Infinity
    const animate = () => {
      const rawTime = audio?.currentTime ?? playback.current.time
      clock = mobile ? Math.max(clock, rawTime) : rawTime
      const time = clock - offset
      const index = activeLineAt(cues, time)
      const cue = cues[index]
      const seconds = cue && 'countdown' in cue ? Math.ceil(cue.end - time) : 0
      if (index !== lastActive || seconds !== lastSeconds) {
        setCue({ index, seconds })
        lastActive = index
        lastSeconds = seconds
      }
      // Only update the active line and its immediate neighbours, never the entire song.
      if (showWordTiming) {
        for (let i = Math.max(0, index - 1); i <= Math.min(cues.length - 1, index + 1); i++) {
          const cue = cues[i]
          if ('countdown' in cue) continue
          cue.words.forEach((word, j) => {
            const node = words.current[i]?.[j]
            if (!node) return
            if (mode === 'letter') {
              const count = letters[i][j].length
              const progress = wordProgress(time, word.start, word.end)
              const lit = time < word.start ? 0 : Math.min(count, Math.floor(progress * count) + 1)
              const value = String(lit)
              if (!mobile || node.style.getPropertyValue('--lit-letters') !== value) node.style.setProperty('--lit-letters', value)
            } else if (mobile) {
              const lit = String(time >= word.start)
              if (node.dataset.lit !== lit) node.dataset.lit = lit
            } else {
              node.style.setProperty('--word-fill', time >= word.start ? '100%' : '0%')
            }
            if (!mobile) node.dataset.singing = time >= word.start && time < word.end ? 'true' : 'false'
          })
        }
      }
      if (!document.hidden && playback.current.playing && !playback.current.loading) frame = requestAnimationFrame(animate)
    }
    const resume = () => { cancelAnimationFrame(frame); animate() }
    const seek = () => { clock = -Infinity; resume() }
    resume()
    if (mobile) audio?.addEventListener('seeking', seek)
    audio?.addEventListener('seeked', seek)
    audio?.addEventListener('timeupdate', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      cancelAnimationFrame(frame)
      audio?.removeEventListener('seeking', seek)
      audio?.removeEventListener('seeked', seek)
      audio?.removeEventListener('timeupdate', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [cues, timed, showWordTiming, letters, mode, mobile, player.playing, player.loading, offset])

  useLayoutEffect(() => {
    if (!timed || browsing) return
    const view = viewport.current, current = rows.current[Math.max(0, active)]
    if (!view || !current) return
    const target = mobile
      ? current.offsetTop - Math.max(8, Math.min(view.clientHeight * .33, view.clientHeight - current.offsetHeight - 8))
      : current.offsetTop - view.clientHeight * .32
    const delta = active - previousActive.current
    const cue = cues[active]
    const smooth = !firstPosition.current && !(cue && 'countdown' in cue) && (resumingFollow.current || Math.abs(delta) <= 1) && canAnimate()
    moveRows(rows.current, -target, mobile, smooth ? active : undefined)
    firstPosition.current = false
    resumingFollow.current = false
    previousActive.current = active
  }, [active, browsing, cues, mobile, size, timed])

  useEffect(() => () => { if (browseTimer.current) clearTimeout(browseTimer.current) }, [])

  function browse() {
    if (!timed) return
    if (browseTimer.current) clearTimeout(browseTimer.current)
    if (!browsingRef.current) {
      const view = viewport.current
      const row = rows.current[Math.max(0, active)]
      if (view && row) {
        // Transfer the current visual position into native scroll before manual browsing.
        const visual = row.getBoundingClientRect().top - view.getBoundingClientRect().top
        moveRows(rows.current, null, mobile)
        view.style.overflowY = 'auto'
        view.scrollTop = Math.max(0, row.offsetTop - visual)
        oldScroll.current = view.scrollTop
      }
      browsingRef.current = true
      setBrowsing(true)
    }
    browseTimer.current = setTimeout(follow, MANUAL_SCROLL_MS)
  }

  function follow() {
    if (browseTimer.current) clearTimeout(browseTimer.current)
    if (!browsingRef.current) return
    const view = viewport.current
    if (view) {
      const scroll = view.scrollTop
      moveRows(rows.current, -scroll, mobile)
      view.scrollTop = 0
      view.style.overflowY = 'hidden'
      // Commit the manual position before returning to the current phrase.
      void view.offsetHeight
      oldScroll.current = 0
    }
    firstPosition.current = false
    browsingRef.current = false
    resumingFollow.current = true
    setBrowsing(false)
  }

  function seekLine(index: number) {
    if (!timed || player.error || player.duration <= 0) return
    player.seek(Math.max(0, cues[index].start + offset))
    if (!mobile) setCue({ index, seconds: 0 })
    if (browsingRef.current) follow()
  }

  return <div className="lyrics-stage" data-timed={timed} data-browsing={browsing}>
    <div className="lyrics-viewport" ref={viewport} tabIndex={0} aria-label={t(timed ? "Текст песни. Нажмите на строку, чтобы перемотать." : "Текст песни")}
      onWheel={browse} onTouchStart={mobile ? undefined : browse} onTouchMove={browse} onTouchEnd={mobile ? undefined : browse}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) browse() }}
      onScroll={() => { if (browsingRef.current && viewport.current && oldScroll.current !== viewport.current.scrollTop) { oldScroll.current = viewport.current.scrollTop; if (browseTimer.current) clearTimeout(browseTimer.current); browseTimer.current = setTimeout(follow, MANUAL_SCROLL_MS) } }}>
      <div className="lyrics-lines" ref={list}>
        {cues.map((line, i) => {
          const distance = Math.abs(i - active)
          const isActive = timed && i === active
          const past = timed && i < active
          const canSeek = timed && !player.error && player.duration > 0
          if ('countdown' in line) return <div key={`gap/${line.end}`} className="lyrics-line lyrics-line--countdown" ref={node => { rows.current[i] = node }} aria-hidden={!isActive}>
            {isActive && seconds > 0 && <span role="timer" aria-label={t("До следующей строки {0} сек.", seconds)}>{formatDuration(seconds * 1000)}</span>}
          </div>
          return <button type="button" ref={(node) => { rows.current[i] = node }} key={`${i}/${line.start}`} className="lyrics-line" dir="auto"
            aria-current={isActive ? 'true' : undefined} aria-disabled={!canSeek} tabIndex={canSeek ? 0 : -1}
            onClick={() => seekLine(i)} onFocus={() => { if (document.documentElement.dataset.input === 'keyboard') browse() }}
            data-active={isActive} data-past={past}
            style={{ '--line-blur': `${timed && !browsing ? Math.min(2.5, Math.max(0, distance - 1) * .65) : 0}px`, '--line-opacity': !timed || browsing ? .82 : isActive ? 1 : past ? Math.max(.16, .38 - distance * .045) : Math.max(.25, .6 - distance * .065) } as CSSProperties}>
            <span className="lyrics-line-content">{showWordTiming && line.words.length > 0 ? line.words.map((word, j) =>
              <span key={j} className="lyrics-word" ref={node => { (words.current[i] ??= [])[j] = node }}>
                {mode === 'letter' ? letters[i][j].map((letter, index) => <span key={index} className="lyrics-letter"
                  style={{ '--letter-index': index } as CSSProperties}>{letter}</span>)
                  : mobile ? word.text : <><span>{word.text}</span><span className="lyrics-word-highlight" aria-hidden="true">{word.text}</span></>}
              </span>) : line.text}</span>
          </button>
        })}
      </div>
    </div>
    {browsing && <button className="lyrics-follow" onClick={follow}><Icon name="lyrics" />{t("К текущей строке")}</button>}
  </div>
}
