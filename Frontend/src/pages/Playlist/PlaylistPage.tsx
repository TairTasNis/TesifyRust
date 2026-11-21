import { useTranslation } from '../../shared/preferences/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import TrackArtistLinks from '../../shared/catalog/ArtistLinks/TrackArtistLinks'
import TrackMenu from '../../shared/catalog/TrackMenu/TrackMenu'
import { useTrackMenu } from '../../shared/catalog/TrackMenu/useTrackMenu'
import { trackFilter } from '../../shared/catalog/trackFilter'
import type { OpenCatalog } from '../../shared/catalog/types'
import { errorMessage } from '../../shared/lib/backend'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import { useLibrary } from '../../shared/playlists/Membership/LibraryProvider'
import PlaylistEditor from '../../shared/playlists/PlaylistEditor/PlaylistEditor'
import { formatAddedDate, formatDuration, totalDuration, trackCount } from '../../shared/playlists/format'
import type { ImportResult, Playlist } from '../../shared/playlists/types'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import Modal from '../../shared/ui/Modal/Modal'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import PlaybackIndicator from '../../shared/ui/PlaybackIndicator/PlaybackIndicator'
import { deletePlaylist, getPlaylist, importSpotify, updatePlaylist } from './api'
import ImportPlaylistModal from './ImportPlaylistModal'
import TrackSortHeader from './TrackSortHeader'
import { nextTrackSort, sortPlaylistTracks } from './sorting'
import type { TrackSort, TrackSortKey } from './sorting'
import './PlaylistPage.css'

type Props = { playlistId: string; onBack: () => void; onOpen: OpenCatalog; trackQuery?: string }

export default function PlaylistPage({ playlistId, onBack, onOpen, trackQuery }: Props) {
  const t = useTranslation()
  const player = usePlayback()
  const { reorderQueue } = player
  const { index, refresh } = useLibrary()
  const updatedAt = index?.playlists.find(playlist => playlist.id === playlistId)?.updatedAt
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [sort, setSort] = useState<TrackSort | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    getPlaylist(playlistId).then((playlist) => { if (active) setPlaylist(playlist) })
      .catch((error) => { if (active) setError(errorMessage(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [playlistId, retry, updatedAt])

  const imported = useCallback((result: ImportResult) => {
    setPlaylist(result.playlist); setImporting(false); void refresh()
  }, [refresh])

  const entries = useMemo(() => sortPlaylistTracks(playlist?.tracks ?? [], sort), [playlist, sort])
  const tracks = useMemo(() => entries.map(({ track }) => track), [entries])
  const shown = useMemo(() => {
    const matches = trackFilter(trackQuery ?? '')
    return entries.map((entry, index) => ({ ...entry, index })).filter(({ track }) => matches(track.title, track.artist))
  }, [entries, trackQuery])
  const shownTracks = useMemo(() => shown.map(({ track }) => track), [shown])
  const menu = useTrackMenu(shownTracks)
  const duration = playlist?.tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0) ?? 0

  useEffect(() => {
    if (playlist) reorderQueue(playlistId, tracks)
  }, [playlist, playlistId, reorderQueue, tracks])

  function changeSort(key: TrackSortKey) {
    setSort(nextTrackSort(sort, key))
  }

  return (
    <main className="workspace playlist-page" aria-label={t("Плейлист")} data-dock-scroll={trackQuery !== undefined || undefined}>
      <button className="playlist-back" onClick={onBack}><Icon name="back" />{t("Библиотека")}</button>
      {loading && !playlist ? <MusicLoader label={t("Загружаем плейлист")} /> : error || !playlist ? <div className="playlist-error" role="alert"><h1>{t("Не удалось открыть плейлист")}</h1><p>{error && t(error)}</p><Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>{t("Попробовать снова")}</Button></div> : <>
        <header className="playlist-hero">
          <PlaylistCover url={playlist.coverUrl} name={playlist.name} className="playlist-hero-cover" />
          <div className="playlist-hero-info">
            <h1>{playlist.name}</h1>
            {playlist.description && <p className="playlist-description">{playlist.description}</p>}
            <div className="playlist-meta"><span>{trackCount(playlist.tracks.length)}</span>{duration > 0 && <span><Icon name="clock" />{totalDuration(duration)}</span>}</div>
            <div className="playlist-actions"><Button variant="secondary" onClick={() => setEditing(true)}><Icon name="edit" />{t("Редактировать")}</Button><Button variant="ghost" className="playlist-delete" aria-label={t("Удалить плейлист")} onClick={() => { setDeleting(true); setDeleteError(null) }}><Icon name="trash" /></Button></div>
          </div>
        </header>
        {!!trackQuery?.trim() && !shown.length && <p role="status">{t('Ничего не найдено')}</p>}
        {shown.length > 0 && <section className="playlist-tracks" aria-label={t("Треки плейлиста")}>
          <TrackMenu state={menu} onOpen={onOpen} playlistId={playlistId} />
          <div className="track-table-scroll"><table className="track-table"><thead><tr>
            <TrackSortHeader column="index" label={t("Номер")} className="track-number" sort={sort} onSort={changeSort}>#</TrackSortHeader>
            <TrackSortHeader column="title" label={t("Название")} sort={sort} onSort={changeSort} />
            <TrackSortHeader column="added" label={t("Добавлено")} className="track-date-column" sort={sort} onSort={changeSort} />
            <TrackSortHeader column="duration" label={t("Длительность")} className="track-time" sort={sort} onSort={changeSort}><Icon name="clock" /></TrackSortHeader>
          </tr></thead><tbody>{shown.map(({ track, originalIndex, index }) => {
            const active = player.playlistId === playlistId && player.current?.id === track.id
            const loading = active && player.loading
            const added = formatAddedDate(track.sourceAddedAt ?? track.addedAt)
            return <tr key={track.id} {...menu.row(track)} data-active={active || undefined} data-loading={loading || undefined} onClick={() => player.playQueue(playlistId, tracks, index)}>
              <td className="track-number">
                <span className="track-row-number">{originalIndex + 1}</span>
                {loading ? <MusicLoader variant="spinner" label={t("Загрузка трека")} /> : active && <PlaybackIndicator playing={player.playing && !player.error} />}
                <Icon className="track-row-play" name={active && player.playing ? 'pause' : 'play'} />
              </td>
              <td><div className="track-title">
                <PlaylistCover url={track.coverUrl} name={t("Обложка: {0}", track.title)} />
                <div className="track-details">
                  <button type="button" className="track-start" aria-label={`${active && player.playing ? t("Пауза") : t("Воспроизвести")}: ${track.title}`} aria-current={active ? 'true' : undefined}
                    onClick={event => { event.stopPropagation(); player.playQueue(playlistId, tracks, index) }}>{track.title}</button>
                  <TrackArtistLinks track={track} onOpen={onOpen} />
                </div>
              </div></td>
              <td className="track-date-column">{added}</td>
              <td className="track-time">{formatDuration(track.durationMs)}</td>
            </tr>
          })}</tbody></table></div>
        </section>}
        {editing && <PlaylistEditor initial={playlist} onClose={() => setEditing(false)} onSave={async (draft) => { setPlaylist(await updatePlaylist(playlist.id, draft)); setEditing(false); void refresh() }} onImport={async (draft) => { setPlaylist(await updatePlaylist(playlist.id, draft)); setEditing(false); setImporting(true); void refresh() }} />}
        {importing && <ImportPlaylistModal syncedSources={playlist.spotifySync?.sources} onClose={() => { setImporting(false); setEditing(true) }}
          onImport={async (url, autoSync) => imported(await importSpotify(playlist.id, url, autoSync))} />}
        {deleting && <Modal title={t("Удалить плейлист?")} onClose={() => setDeleting(false)} busy={deleteBusy}>{(close) => <><p className="playlist-delete-note">{t("Плейлист «{0}» и его треки будут удалены из библиотеки.", playlist.name)}</p>{deleteError && <p className="form-error" role="alert">{t(deleteError)}</p>}<div className="modal-actions"><Button variant="secondary" onClick={close} disabled={deleteBusy}>{t("Отмена")}</Button><Button variant="danger" disabled={deleteBusy} aria-busy={deleteBusy} onClick={async () => { setDeleteBusy(true); try { await deletePlaylist(playlist.id); void refresh(); onBack() } catch (error) { setDeleteError(errorMessage(error)) } finally { setDeleteBusy(false) } }}>{deleteBusy && <MusicLoader variant="compact" label={t("Удаляем плейлист")} />}{deleteBusy ? t("Удаляем…") : t("Удалить")}</Button></div></>}</Modal>}
      </>}
    </main>
  )
}
