import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import AboutPage from '../pages/About/AboutPage'
import HomePage from '../pages/Home/HomePage'
import LibraryPage from '../pages/Library/LibraryPage'
import LyricsPage from '../pages/Lyrics/LyricsPage'
import { getLyrics } from '../pages/Lyrics/api'
import NowPlayingPage from '../pages/NowPlaying/NowPlayingPage'
import { measurePlayer, movePlayer, playerTransitionMs } from '../pages/NowPlaying/playerTransition'
import PlaylistPage from '../pages/Playlist/PlaylistPage'
import SearchPage from '../pages/Search/SearchPage'
import ArtistPage from '../pages/Artist/ArtistPage'
import AlbumPage from '../pages/Album/AlbumPage'
import SpotifyPlaylistPage from '../pages/SpotifyPlaylist/SpotifyPlaylistPage'
import SettingsPage from '../pages/Settings/SettingsPage'
import type { OpenCatalog } from '../shared/catalog/types'
import AppWindow from '../shared/layout/AppWindow/AppWindow'
import { useAppWindow, useMobileLayout } from '../shared/layout/AppWindow/useAppWindow'
import Sidebar from '../shared/layout/Sidebar/Sidebar'
import { canAnimate, useInputMode } from '../shared/lib/motion'
import { PlaybackProvider, usePlayback } from '../shared/playback/PlaybackProvider'
import MiniPlayer from '../shared/playback/MiniPlayer/MiniPlayer'
import MobileMiniPlayer from '../shared/playback/MiniPlayer/MobileMiniPlayer'
import { useTranslation } from '../shared/preferences/i18n'
import { routeFromHash, pageTitles } from './navigation'
import type { PageId } from './navigation'

export default function App() {
  return <PlaybackProvider><AppContent /></PlaybackProvider>
}

function AppContent() {
  const t = useTranslation()
  useInputMode()
  const appWindow = useAppWindow()
  const mobile = useMobileLayout(appWindow)
  const player = usePlayback()
  const [route, setRoute] = useState(routeFromHash)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const closeLyrics = useCallback(() => setLyricsOpen(false), [])
  const [playerView, setPlayerView] = useState<'closed' | 'open' | 'closing'>('closed')
  const closeTimer = useRef(0)
  const stopMoving = useRef<(() => void) | null>(null)
  const activePage = route.page
  const trackId = player.current?.id
  const playlistId = player.playlistId
  const aboutEnteredFromApp = useRef(false)
  const catalogEnteredFromApp = useRef(false)
  const resetOverlays = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    stopMoving.current?.()
    setPlayerView('closed')
    setLyricsOpen(false)
  }, [])

  const closePlayer = useCallback(() => {
    const animate = canAnimate()
    const from = animate ? measurePlayer('full') : null
    stopMoving.current?.()
    const finish = () => {
      setPlayerView('closed')
      document.querySelector<HTMLButtonElement>('.mobile-mini-player-open')?.focus({ preventScroll: true })
    }
    if (!from) {
      flushSync(() => setPlayerView('closed'))
      finish()
      return
    }
    flushSync(() => setPlayerView('closing'))
    stopMoving.current = movePlayer(from, 'mini')
    closeTimer.current = window.setTimeout(finish, playerTransitionMs)
  }, [])

  function openPlayer() {
    window.clearTimeout(closeTimer.current)
    const from = canAnimate() ? measurePlayer('mini') : null
    stopMoving.current?.()
    flushSync(() => { setLyricsOpen(false); setPlayerView('open') })
    if (from) stopMoving.current = movePlayer(from, 'full')
  }

  useEffect(() => {
    if (trackId && playlistId) void getLyrics(playlistId, trackId).catch(() => {})
  }, [playlistId, trackId])

  useEffect(() => {
    const syncPage = () => { setRoute(routeFromHash()); resetOverlays() }
    window.addEventListener('hashchange', syncPage)
    return () => {
      window.removeEventListener('hashchange', syncPage)
      window.clearTimeout(closeTimer.current)
      stopMoving.current?.()
    }
  }, [resetOverlays])

  useEffect(() => {
    if (!mobile || playerView !== 'open' || lyricsOpen) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
        event.preventDefault()
        closePlayer()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [closePlayer, lyricsOpen, mobile, playerView])

  useEffect(() => {
    if (!appWindow.isAndroid) return
    const back = (event: Event) => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
      if (dialog) {
        event.preventDefault()
        dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
      } else if (lyricsOpen) {
        event.preventDefault()
        const target = document.activeElement ?? document.body
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      } else if (playerView === 'open') {
        event.preventDefault()
        closePlayer()
      } else if (playerView === 'closing') {
        event.preventDefault()
      }
    }
    window.addEventListener('tesify:back', back)
    return () => window.removeEventListener('tesify:back', back)
  }, [appWindow.isAndroid, closePlayer, lyricsOpen, playerView])

  useEffect(() => {
    document.title = `Tesify — ${t(pageTitles[activePage])}`
  }, [activePage, t])

  function navigate(page: PageId, id?: string) {
    resetOverlays()
    if (page === 'about') aboutEnteredFromApp.current = true
    window.location.hash = id ? `${page}/${id}` : page
    setRoute(routeFromHash())
  }

  const leaveAbout = useCallback(() => {
    if (aboutEnteredFromApp.current) {
      window.history.back()
    } else {
      window.location.hash = 'home'
    }
  }, [])
  const openCatalog: OpenCatalog = (kind, id) => {
    catalogEnteredFromApp.current = true
    navigate(kind === 'playlist' ? 'spotify-playlist' : kind, id)
  }
  const leaveCatalog = () => { if (catalogEnteredFromApp.current) window.history.back(); else navigate('search') }
  const sidebarPage = activePage === 'playlist' ? 'library' : ['artist', 'album', 'spotify-playlist'].includes(activePage) ? 'search' : activePage
  const playerExpanded = mobile && playerView !== 'closed'
  const overlayOpen = lyricsOpen || playerExpanded
  const page = activePage === 'about' ? <AboutPage onBack={leaveAbout} /> : <>
    <Sidebar activePage={sidebarPage} mobile={mobile} onNavigate={navigate} />
    {activePage === 'home' && <HomePage />}
    {activePage === 'settings' && <SettingsPage onAbout={mobile ? () => navigate('about') : undefined} />}
    {activePage === 'search' && <SearchPage onOpen={openCatalog} />}
    {activePage === 'artist' && <ArtistPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
    {activePage === 'album' && <AlbumPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
    {activePage === 'spotify-playlist' && <SpotifyPlaylistPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
    {activePage === 'library' && <LibraryPage onOpenPlaylist={(id) => navigate('playlist', id)} />}
    {activePage === 'playlist' && <PlaylistPage key={route.playlistId} playlistId={route.playlistId ?? ''} onBack={() => navigate('library')} onOpen={openCatalog} />}
  </>

  return (
    <AppWindow appWindow={appWindow} isAbout={activePage === 'about'} hasPlayer={Boolean(player.current)} isLyrics={lyricsOpen} isPlayer={playerExpanded} mobile={mobile}>
      {mobile ? <div style={{ display: 'contents' }} inert={overlayOpen} aria-hidden={overlayOpen || undefined}>{page}</div> : page}
      {lyricsOpen && player.current && (
        <LyricsPage
          onClose={closeLyrics}
          mobile={mobile}
          isMaximized={appWindow.isMaximized}
          onToggleMaximize={mobile ? undefined : appWindow.toggleMaximize}
        />
      )}
      {!lyricsOpen && playerExpanded && <NowPlayingPage closing={playerView === 'closing'} onClose={closePlayer}
        onLyrics={() => setLyricsOpen(true)} onOpen={openCatalog} />}
      {mobile
        ? <MobileMiniPlayer lyricsOpen={lyricsOpen} expanded={!lyricsOpen && playerView === 'open'} onOpen={openPlayer} />
        : <MiniPlayer lyricsOpen={lyricsOpen} onToggleLyrics={() => setLyricsOpen(open => !open)} onOpen={openCatalog} />}
    </AppWindow>
  )
}
