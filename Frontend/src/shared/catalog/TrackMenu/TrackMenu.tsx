import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from '../../lib/backend'
import { downloadsQueueId, useDownloads } from '../../playback/downloads/DownloadsProvider'
import { useLibrary } from '../../playlists/Membership/LibraryProvider'
import { trackCount } from '../../playlists/format'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import Modal from '../../ui/Modal/Modal'
import TrackArtistLinks from '../ArtistLinks/TrackArtistLinks'
import type { OpenCatalog } from '../types'
import type { useTrackMenu } from './useTrackMenu'
import './TrackMenu.css'

export default function TrackMenu({ state, onOpen, playlistId, queueId, selectingMore = false }: {
  state: ReturnType<typeof useTrackMenu>; onOpen: OpenCatalog; playlistId?: string; queueId: string; selectingMore?: boolean
}) {
  const t = useTranslation()
  const { index, choosePlaylists, changeMemberships } = useLibrary()
  const downloads = useDownloads()
  const [artistTrack, setArtistTrack] = useState<typeof state.menu>(null)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { menu, targets } = state

  useLayoutEffect(() => {
    if (state.selecting) window.dispatchEvent(new Event('tesify:track-selection'))
  }, [state.selecting])

  useLayoutEffect(() => {
    if (!menu || menu.touch || !panel.current) return
    const element = panel.current
    const view = document.documentElement
    element.style.left = `${Math.max(8, Math.min(menu.x, view.clientWidth - element.offsetWidth - 8))}px`
    element.style.top = `${Math.max(8, Math.min(menu.y, view.clientHeight - element.offsetHeight - 8))}px`
    const previous = document.activeElement
    element.querySelector('button')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) state.close()
    }
    const close = () => state.close()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', close)
      if (previous instanceof HTMLElement && previous.isConnected && element.contains(document.activeElement)) previous.focus({ preventScroll: true })
    }
  }, [menu])

  const available = (tracks: typeof state.selected) => [...new Map(tracks.filter(track => track.spotifyId && track.canSave !== false).map(track => [track.spotifyId, track])).values()]
  const menuTracks = available(targets ?? [])
  const selectedTracks = available(state.selected)
  const newDownloads = (tracks: typeof selectedTracks) => tracks.filter(track => !downloads.ids.has(track.spotifyId))
  const actionLabel = (tracks: typeof selectedTracks) => playlistId || (tracks.length && tracks.every(track => index?.memberships[track.spotifyId]?.length))
    ? 'Удалить из плейлиста' : 'Добавить в плейлист'

  function changePlaylists(selected: typeof selectedTracks) {
    state.close()
    if (!playlistId) {
      choosePlaylists(selected.map(track => ({ spotifyId: track.spotifyId, title: track.title })))
      return
    }
    setError(null)
    void changeMemberships({ spotifyIds: selected.map(track => track.spotifyId), add: [], remove: [playlistId] })
      .then(state.clear).catch(error => setError(errorMessage(error)))
  }

  function showArtist() {
    if (!menu) return
    state.close()
    const artists = menu.track.artists ?? []
    if (artists.length === 1) onOpen('artist', artists[0].id)
    else setArtistTrack(menu)
  }

  function download(tracks: typeof selectedTracks) {
    state.close()
    setError(null)
    void downloads.download(queueId, newDownloads(tracks).map(track => track.id))
      .then(state.clear).catch(error => setError(errorMessage(error)))
  }

  const actions = <>
    <button type="button" onClick={state.start}><Icon name="check" />{t('Выбрать треки')}</button>
    <button type="button" onClick={() => { state.toggleAll(); state.close() }}><Icon name="check" />{t(state.all ? 'Снять выделение' : 'Выделить всё')}</button>
    <button type="button" disabled={selectingMore || !menuTracks.length} onClick={() => changePlaylists(menuTracks)}><Icon name={actionLabel(menuTracks) === 'Добавить в плейлист' ? 'plus' : 'trash'} />{t(actionLabel(menuTracks))}</button>
    {queueId !== downloadsQueueId && <button type="button" disabled={selectingMore || downloads.busy || !newDownloads(menuTracks).length} onClick={() => download(menuTracks)}><Icon name="import" />{t('Скачать')}</button>}
    <button type="button" disabled={!menu?.track.artists?.length && !menu?.track.artist.trim()} onClick={showArtist}><Icon name="artist" />{t('Об исполнителе')}</button>
  </>

  return <>
    {state.selecting && <div className="track-selection" role="group" aria-label={t('Выбрать треки')}>
      <button type="button" className="track-selection-close" aria-label={t('Выйти из режима выбора')} onClick={state.clear}><Icon name="close" /></button>
      <span className="track-selection-count" aria-live="polite">{selectingMore ? t('Загружаем треки') : trackCount(state.selected.length)}</span>
      <button type="button" onClick={state.toggleAll}>{t(state.all ? 'Снять выделение' : 'Выделить всё')}</button>
      <div className="track-selection-actions">
        <button type="button" disabled={selectingMore || !selectedTracks.length} aria-label={t(actionLabel(selectedTracks))} onClick={() => changePlaylists(selectedTracks)}>
          <Icon name={actionLabel(selectedTracks) === 'Добавить в плейлист' ? 'plus' : 'trash'} />{t(playlistId ? 'Удалить' : actionLabel(selectedTracks))}
        </button>
        {queueId !== downloadsQueueId && <button type="button" disabled={selectingMore || downloads.busy || !newDownloads(selectedTracks).length} onClick={() => download(selectedTracks)}><Icon name="import" />{t('Скачать')}</button>}
      </div>
    </div>}
    {menu && (menu.touch ? <Modal title={menu.track.title} onClose={state.close}><div className="track-menu-actions">{actions}</div></Modal>
      : createPortal(<div className="track-menu-actions track-menu-popover" ref={panel} role="group" aria-label={menu.track.title}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            state.close()
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            const index = buttons.indexOf(event.target as HTMLButtonElement)
            buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
          }
        }}>{actions}</div>, document.body))}
    {artistTrack && <Modal title={t('Об исполнителе')} subtitle={artistTrack.track.title} onClose={() => setArtistTrack(null)}>
      <TrackArtistLinks track={artistTrack.track} onOpen={(kind, id) => { setArtistTrack(null); onOpen(kind, id) }} />
    </Modal>}
    {error && <p role="alert" className="form-error">{t(error)}</p>}
  </>
}
