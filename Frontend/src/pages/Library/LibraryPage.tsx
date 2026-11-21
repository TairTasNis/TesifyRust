import { useTranslation } from '../../shared/preferences/i18n'
import { useState } from 'react'
import type { OpenCatalog } from '../../shared/catalog/types'
import { useLibrary } from '../../shared/playlists/Membership/LibraryProvider'
import type { Playlist, PlaylistDraft, SpotifyImportKind } from '../../shared/playlists/types'
import PlaylistEditor from '../../shared/playlists/PlaylistEditor/PlaylistEditor'
import { trackCount } from '../../shared/playlists/format'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import ImportPlaylistModal from '../Playlist/ImportPlaylistModal'
import { createPlaylist, createPlaylistWithSpotify } from './api'
import './LibraryPage.css'

type Props = { onOpenPlaylist: (id: string) => void; onOpenCatalog: OpenCatalog; onOpenDownloads: () => void }

export default function LibraryPage({ onOpenPlaylist, onOpenCatalog, onOpenDownloads }: Props) {
  const t = useTranslation()
  const { index, error, refresh } = useLibrary()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PlaylistDraft>()
  const [importKind, setImportKind] = useState<SpotifyImportKind | null>(null)

  function created(playlist: Playlist) {
    void refresh()
    setDraft(undefined)
    setEditing(false)
    setImportKind(null)
    onOpenPlaylist(playlist.id)
  }

  return (
    <main className="workspace library-page" aria-label={t("Библиотека")}>
      <header className="library-header">
        <h1>{t("Библиотека")}</h1>
        <Button className="library-create" onClick={() => setEditing(true)}><Icon name="plus" />{t("Создать плейлист")}</Button>
      </header>
      <button type="button" className="library-downloads" onClick={onOpenDownloads}>
        <Icon name="import" />
        <span>{t('Скачанные треки')}</span>
        <span className="library-download-count" aria-label={trackCount(0)}>0</span>
        <Icon name="chevron" />
      </button>

      {error && <div className="library-message" role="alert"><Icon name="library" /><h2>{t("Библиотека недоступна")}</h2><p>{t(error)}</p><Button variant="secondary" onClick={() => { void refresh() }}>{t("Попробовать снова")}</Button></div>}
      {!index && !error && <MusicLoader label={t("Загружаем библиотеку")} />}
      {!!index?.playlists.length && <div className="library-grid">{index.playlists.map((playlist) => <button key={playlist.id} className="playlist-card" onClick={() => onOpenPlaylist(playlist.id)} aria-label={t("Открыть плейлист {0}", playlist.name)}>
          <PlaylistCover url={playlist.coverUrl} name={playlist.name} /><h3>{playlist.name}</h3><p>{trackCount(playlist.trackCount)}</p>{playlist.description && <span className="playlist-card-description">{playlist.description}</span>}
        </button>)}</div>}
      {!!index?.collections.length && <section className="library-saved">
        <h2>{t('Сохранённые альбомы и плейлисты')}</h2>
        <div className="library-grid">{index.collections.map(item => <button key={`${item.kind}:${item.id}`} className="playlist-card" onClick={() => onOpenCatalog(item.kind, item.id)}>
          <PlaylistCover url={item.coverUrl} name="" /><h3>{item.name}</h3>
          <p>{t(item.kind === 'album' ? 'Альбом Spotify' : 'Плейлист Spotify')}{item.owner && ` · ${item.owner}`}</p>
        </button>)}</div>
      </section>}

      {editing && !importKind && <PlaylistEditor draft={draft} onClose={() => { setDraft(undefined); setEditing(false) }}
        onSave={async draft => created(await createPlaylist(draft))}
        onImport={async (draft, kind) => { setDraft(draft); setImportKind(kind) }} />}
      {editing && draft && importKind && <ImportPlaylistModal kind={importKind} onClose={() => setImportKind(null)}
        onImport={async (url, autoSync) => created(await createPlaylistWithSpotify(draft, importKind, url, autoSync))} />}
    </main>
  )
}
