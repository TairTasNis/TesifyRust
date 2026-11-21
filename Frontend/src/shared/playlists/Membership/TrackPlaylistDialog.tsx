import { useState } from 'react'
import { errorMessage } from '../../lib/backend'
import { useTranslation } from '../../preferences/i18n'
import Button from '../../ui/Button/Button'
import Modal from '../../ui/Modal/Modal'
import MusicLoader from '../../ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../ui/PlaylistCover/PlaylistCover'
import type { LibraryIndex } from '../types'
import './Membership.css'

type Props = {
  track: { spotifyId: string; title: string }
  index: LibraryIndex | null
  error: string | null
  onRetry: () => Promise<void>
  onClose: () => void
  onSave: (add: string[], remove: string[]) => Promise<void>
}

export default function TrackPlaylistDialog({ track, index, error, onRetry, onClose, onSave }: Props) {
  const t = useTranslation()
  const [changes, setChanges] = useState<Record<string, boolean | undefined>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const original = new Set(index?.memberships[track.spotifyId])
  const changed = (index?.playlists ?? []).filter(({ id }) => changes[id] !== undefined && changes[id] !== original.has(id))

  return <Modal title={t('Выбрать плейлисты')} subtitle={track.title} busy={busy} onClose={onClose}>
    {(close) => <form onSubmit={async event => {
      event.preventDefault()
      if (busy || !changed.length) return
      setBusy(true)
      setSaveError(null)
      try {
        await onSave(changed.filter(({ id }) => changes[id]).map(({ id }) => id), changed.filter(({ id }) => !changes[id]).map(({ id }) => id))
      } catch (error) {
        setSaveError(errorMessage(error))
        setBusy(false)
      }
    }}>
      {!index && (error ? <div role="alert"><p>{t(error)}</p><Button type="button" variant="secondary" onClick={() => { void onRetry() }}>{t('Попробовать снова')}</Button></div>
        : <MusicLoader label={t('Загружаем библиотеку')} />)}
      {index && (index.playlists.length ? <div className="playlist-membership-list">
        {index.playlists.map(playlist => <label key={playlist.id}>
          <PlaylistCover url={playlist.coverUrl} name="" />
          <span>{playlist.name}</span>
          <input type="checkbox" checked={changes[playlist.id] ?? original.has(playlist.id)} disabled={busy}
            onChange={event => { const checked = event.currentTarget.checked; setChanges(current => ({ ...current, [playlist.id]: checked })) }} />
        </label>)}
      </div> : <p className="playlist-membership-empty">{t('Сначала создайте плейлист в библиотеке.')}</p>)}
      {saveError && <p className="form-error" role="alert">{t(saveError)}</p>}
      <div className="modal-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t('Отмена')}</Button>
        <Button type="submit" disabled={busy || !changed.length} aria-busy={busy}>{t('Сохранить')}</Button>
      </div>
    </form>}
  </Modal>
}
