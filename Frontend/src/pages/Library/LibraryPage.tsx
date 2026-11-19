import { useTranslation } from '../../shared/preferences/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/lib/backend'
import PlaylistEditor from '../../shared/playlists/PlaylistEditor/PlaylistEditor'
import { trackCount } from '../../shared/playlists/format'
import type { PlaylistSummary } from '../../shared/playlists/types'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import { createPlaylist, listPlaylists } from './api'
import './LibraryPage.css'

type Props = { onOpenPlaylist: (id: string) => void }

export default function LibraryPage({ onOpenPlaylist }: Props) {
  const t = useTranslation()
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const request = useRef(0)

  const load = useCallback(async () => {
    const current = ++request.current
    setLoading(true); setError(null)
    try { const result = await listPlaylists(); if (current === request.current) setPlaylists(result) }
    catch (error) { if (current === request.current) setError(errorMessage(error)) }
    finally { if (current === request.current) setLoading(false) }
  }, [])

  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener('focus', refresh)
    return () => { ++request.current; window.removeEventListener('focus', refresh) }
  }, [load])

  return (
    <main className="workspace library-page" aria-label={t("Библиотека")}>
      <header className="library-header">
        <h1>{t("Библиотека")}</h1>
        <Button className="library-create" onClick={() => setEditing(true)}><Icon name="plus" />{t("Создать плейлист")}</Button>
      </header>

      {error ? <div className="library-message" role="alert"><Icon name="library" /><h2>{t("Библиотека недоступна")}</h2><p>{error && t(error)}</p><Button variant="secondary" onClick={() => { void load() }}>{t("Попробовать снова")}</Button></div>
        : loading && playlists.length === 0 ? <MusicLoader label={t("Загружаем библиотеку")} />
        : playlists.length > 0 && <div className="library-grid">{playlists.map((playlist) => <button key={playlist.id} className="playlist-card" onClick={() => onOpenPlaylist(playlist.id)} aria-label={t("Открыть плейлист {0}", playlist.name)}>
          <PlaylistCover url={playlist.coverUrl} name={playlist.name} /><h3>{playlist.name}</h3><p>{trackCount(playlist.trackCount)}</p>{playlist.description && <span className="playlist-card-description">{playlist.description}</span>}
        </button>)}</div>}

      {editing && <PlaylistEditor onClose={() => setEditing(false)} onSave={async (draft) => { const playlist = await createPlaylist(draft); setEditing(false); onOpenPlaylist(playlist.id) }} />}
    </main>
  )
}
