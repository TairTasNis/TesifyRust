import { useEffect, useState } from 'react'
import { cachedSearch, searchSpotify } from '../../shared/catalog/search'
import type { CatalogItem } from '../../shared/catalog/types'
import { errorMessage } from '../../shared/lib/backend'
import { useTranslation } from '../../shared/preferences/i18n'
import Button from '../../shared/ui/Button/Button'
import Modal from '../../shared/ui/Modal/Modal'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import './LyricsTrackPicker.css'

type Props = {
  alternate: boolean
  onClose: () => void
  onSelect: (track: CatalogItem | null) => void
}

export default function LyricsTrackPicker({ alternate, onClose, onSelect }: Props) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<{ term: string; tracks: CatalogItem[]; error?: string }>()
  const term = query.trim()
  const cached = cachedSearch(term, 'tracks')
  const current = page?.term === term ? page : undefined
  const tracks = cached?.tracks.items ?? current?.tracks
  const busy = Boolean(term && !tracks)

  useEffect(() => {
    if (!term || cached) return
    let active = true
    const delay = window.setTimeout(() => {
      void searchSpotify(term, 'tracks').then(result => {
        if (active) setPage({ term, tracks: result.tracks.items })
      }).catch(error => {
        if (active) setPage({ term, tracks: [], error: errorMessage(error) })
      })
    }, 160)
    return () => { active = false; window.clearTimeout(delay) }
  }, [term, cached])

  return <Modal title={t('Выбрать другую песню')} onClose={onClose}>
    <div className="form-field">
      <label htmlFor="lyrics-track-query">{t('Название песни или исполнитель')}</label>
      <input id="lyrics-track-query" type="search" maxLength={180} data-autofocus value={query} onChange={event => {
        const value = event.currentTarget.value
        setQuery(value)
        if (value.trim() !== term) setPage(undefined)
      }} />
    </div>
    {alternate && <Button variant="secondary" className="lyrics-track-reset" onClick={() => onSelect(null)}>{t('Текст текущей песни')}</Button>}
    <div className="lyrics-track-results" aria-busy={busy}>
      {busy ? <MusicLoader variant="inline" label={t('Ищем музыку')} />
        : current?.error ? <p role="alert">{t(current.error)}</p>
        : term && !tracks?.some(track => track.playable) ? <p role="status">{t('Ничего не найдено')}</p>
        : tracks?.filter(track => track.playable).map(track => <button key={track.id} type="button" onClick={() => onSelect(track)}>
          <PlaylistCover url={track.imageUrl} name={track.name} />
          <span><strong>{track.name}</strong><small>{[track.subtitle, track.albumName].filter(Boolean).join(' · ')}</small></span>
        </button>)}
    </div>
  </Modal>
}
