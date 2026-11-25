import { useEffect, useRef, useState } from 'react'
import { cachedSearch, searchSpotify } from '../../shared/catalog/search'
import type { CatalogItem } from '../../shared/catalog/types'
import { errorMessage } from '../../shared/lib/backend'
import { formatDuration } from '../../shared/playlists/format'
import type { Track } from '../../shared/playlists/types'
import { useTranslation } from '../../shared/preferences/i18n'
import Button from '../../shared/ui/Button/Button'
import Modal from '../../shared/ui/Modal/Modal'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import {
  applyLyricsCandidate,
  applySpotifyLyrics,
  clearTrackLyricsOverride,
  searchLyricsCandidates,
} from './api'
import type { LyricsCandidate, LyricsResponse } from './types'
import './LyricsTrackPicker.css'

type Props = {
  track: Track
  playlistId: string
  hasCustomOverride: boolean
  onClose: () => void
  onApplied: (response: LyricsResponse) => void
}

const syncLabels: Record<LyricsCandidate['sync'], string> = {
  word: 'По словам',
  line: 'По строкам',
  auto: 'Караоке',
  none: 'Без тайминга',
}

export default function LyricsTrackPicker({
  track,
  playlistId,
  hasCustomOverride,
  onClose,
  onApplied,
}: Props) {
  const t = useTranslation()
  const [tab, setTab] = useState<'lyrics' | 'spotify'>('lyrics')
  const [query, setQuery] = useState(() => `${track.title} ${track.artist}`.trim())
  const [lyricsPage, setLyricsPage] = useState<{ term: string; items: LyricsCandidate[]; error?: string }>()
  const [spotifyPage, setSpotifyPage] = useState<{ term: string; tracks: CatalogItem[]; error?: string }>()
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const lyricsCache = useRef(new Map<string, LyricsCandidate[]>())

  const term = query.trim()
  const cachedLyrics = term ? lyricsCache.current.get(term) : undefined
  const currentLyrics = lyricsPage?.term === term ? lyricsPage : undefined
  const candidates = cachedLyrics ?? currentLyrics?.items
  const lyricsBusy = tab === 'lyrics' && Boolean(term && !candidates && currentLyrics?.error === undefined)

  const cachedTracks = cachedSearch(term, 'tracks')
  const currentSpotify = spotifyPage?.term === term ? spotifyPage : undefined
  const tracks = cachedTracks?.tracks.items ?? currentSpotify?.tracks
  const spotifyBusy = tab === 'spotify' && Boolean(term && !tracks)

  useEffect(() => {
    if (tab !== 'lyrics' || !term || cachedLyrics) return
    let active = true
    const delay = window.setTimeout(() => {
      void searchLyricsCandidates(term)
        .then(items => {
          lyricsCache.current.set(term, items)
          if (active) setLyricsPage({ term, items })
        })
        .catch(error => {
          if (active) setLyricsPage({ term, items: [], error: errorMessage(error) })
        })
    }, 240)
    return () => { active = false; window.clearTimeout(delay) }
  }, [tab, term, cachedLyrics])

  useEffect(() => {
    if (tab !== 'spotify' || !term || cachedTracks) return
    let active = true
    const delay = window.setTimeout(() => {
      void searchSpotify(term, 'tracks')
        .then(result => {
          if (active) setSpotifyPage({ term, tracks: result.tracks.items })
        })
        .catch(error => {
          if (active) setSpotifyPage({ term, tracks: [], error: errorMessage(error) })
        })
    }, 180)
    return () => { active = false; window.clearTimeout(delay) }
  }, [tab, term, cachedTracks])

  async function selectCandidate(candidate: LyricsCandidate) {
    if (applyingId) return
    setApplyingId(candidate.id)
    setApplyError(null)
    try {
      const response = await applyLyricsCandidate(playlistId, track.id, candidate.id)
      onApplied(response)
      onClose()
    } catch (error) {
      setApplyError(t(errorMessage(error)))
    } finally {
      setApplyingId(null)
    }
  }

  async function selectSpotifyTrack(item: CatalogItem) {
    if (applyingId) return
    setApplyingId(item.id)
    setApplyError(null)
    try {
      const response = await applySpotifyLyrics(playlistId, track.id, item.id)
      onApplied(response)
      onClose()
    } catch (error) {
      setApplyError(t(errorMessage(error)))
    } finally {
      setApplyingId(null)
    }
  }

  async function resetToAuto() {
    if (applyingId) return
    setApplyingId('__reset__')
    setApplyError(null)
    try {
      const response = await clearTrackLyricsOverride(playlistId, track.id)
      onApplied(response)
      onClose()
    } catch (error) {
      setApplyError(t(errorMessage(error)))
    } finally {
      setApplyingId(null)
    }
  }

  return <Modal
    title={t('Найти другой текст')}
    subtitle={t('Выбранный вариант сразу применится к текущей песне с синхронизацией')}
    onClose={onClose}
    busy={Boolean(applyingId)}
  >
    <div className="form-field">
      <label htmlFor="lyrics-track-query">{t('Название песни или исполнитель')}</label>
      <input
        id="lyrics-track-query"
        type="search"
        maxLength={180}
        data-autofocus
        value={query}
        onChange={event => {
          const value = event.currentTarget.value
          setQuery(value)
          setApplyError(null)
          if (value.trim() !== term) {
            setLyricsPage(undefined)
            setSpotifyPage(undefined)
          }
        }}
      />
    </div>
    <div className="lyrics-track-tabs" role="tablist" aria-label={t('Режим поиска текста')}>
      <button type="button" role="tab" aria-selected={tab === 'lyrics'} onClick={() => { setTab('lyrics'); setApplyError(null) }}>
        {t('Варианты текста')}
      </button>
      <button type="button" role="tab" aria-selected={tab === 'spotify'} onClick={() => { setTab('spotify'); setApplyError(null) }}>
        {t('Треки Spotify')}
      </button>
    </div>
    {hasCustomOverride && (
      <Button variant="secondary" className="lyrics-track-reset" disabled={Boolean(applyingId)} onClick={resetToAuto}>
        {applyingId === '__reset__' ? t('Возвращаем…') : t('Вернуть автоматический текст')}
      </Button>
    )}
    {applyError && <p className="lyrics-track-apply-error" role="alert">{applyError}</p>}
    <div className="lyrics-track-results" aria-busy={lyricsBusy || spotifyBusy || Boolean(applyingId)}>
      {tab === 'lyrics' ? (
        lyricsBusy ? <MusicLoader variant="inline" label={t('Ищем текст песни')} />
          : currentLyrics?.error ? <p role="alert">{t(currentLyrics.error)}</p>
          : term && (!candidates || candidates.length === 0) ? <p role="status">{t('Ничего не найдено')}</p>
          : candidates?.map(candidate => {
            const applying = applyingId === candidate.id
            return <button key={candidate.id} type="button" className="lyrics-candidate-row" disabled={Boolean(applyingId)} onClick={() => void selectCandidate(candidate)}>
              <div className="lyrics-candidate-main">
                <div className="lyrics-candidate-top">
                  <strong>{candidate.title}</strong>
                  <span className="lyrics-candidate-meta">
                    {candidate.artist}
                    {candidate.album ? ` · ${candidate.album}` : ''}
                    {candidate.durationMs ? ` · ${formatDuration(candidate.durationMs)}` : ''}
                  </span>
                </div>
                {candidate.preview && <small className="lyrics-candidate-preview">{candidate.preview}</small>}
              </div>
              <div className="lyrics-candidate-badges">
                <span className={`lyrics-candidate-sync lyrics-candidate-sync--${candidate.sync}`}>
                  {applying ? t('Применяем…') : t(syncLabels[candidate.sync])}
                </span>
                <span className="lyrics-candidate-source">{candidate.source}</span>
              </div>
            </button>
          })
      ) : (
        spotifyBusy ? <MusicLoader variant="inline" label={t('Ищем музыку')} />
          : currentSpotify?.error ? <p role="alert">{t(currentSpotify.error)}</p>
          : term && !tracks?.some(item => item.playable) ? <p role="status">{t('Ничего не найдено')}</p>
          : tracks?.filter(item => item.playable).map(item => {
            const applying = applyingId === item.id
            return <button key={item.id} type="button" disabled={Boolean(applyingId)} onClick={() => void selectSpotifyTrack(item)}>
              <PlaylistCover url={item.imageUrl} name={item.name} />
              <span>
                <strong>{item.name}</strong>
                <small>{applying ? t('Загружаем и применяем текст…') : [item.subtitle, item.albumName].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          })
      )}
    </div>
  </Modal>
}
