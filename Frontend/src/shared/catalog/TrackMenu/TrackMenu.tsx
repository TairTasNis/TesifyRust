import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from '../../lib/backend'
import { useLibrary } from '../../playlists/Membership/LibraryProvider'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import Modal from '../../ui/Modal/Modal'
import TrackArtistLinks from '../ArtistLinks/TrackArtistLinks'
import type { OpenCatalog } from '../types'
import type { useTrackMenu } from './useTrackMenu'
import './TrackMenu.css'

export default function TrackMenu({ state, onOpen, playlistId }: {
  state: ReturnType<typeof useTrackMenu>; onOpen: OpenCatalog; playlistId?: string
}) {
  const t = useTranslation()
  const { index, choosePlaylists, changeMemberships } = useLibrary()
  const [artistTrack, setArtistTrack] = useState<typeof state.menu>(null)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { menu, targets } = state

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

  const selected = [...new Map(targets?.filter(track => track.spotifyId && track.canSave !== false).map(track => [track.spotifyId, track])).values()]
  const saved = selected.length > 0 && selected.every(track => index?.memberships[track.spotifyId]?.length)
  const remove = playlistId || saved

  function changePlaylists() {
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

  const actions = <>
    <button type="button" onClick={() => { state.toggleAll(); state.close() }}><Icon name="check" />{t(state.all ? 'Снять выделение' : 'Выделить всё')}</button>
    <button type="button" disabled={!selected.length} onClick={changePlaylists}><Icon name={remove ? 'trash' : 'plus'} />{t(remove ? 'Удалить из плейлиста' : 'Добавить в плейлист')}</button>
    <button type="button" disabled={!menu?.track.artists?.length && !menu?.track.artist.trim()} onClick={showArtist}><Icon name="artist" />{t('Об исполнителе')}</button>
  </>

  return <>
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
