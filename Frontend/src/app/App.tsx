import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import AboutPage from '../pages/About/AboutPage'
import HomePage from '../pages/Home/HomePage'
import LibraryPage from '../pages/Library/LibraryPage'
import LyricsPage from '../pages/Lyrics/LyricsPage'
import { getLyrics } from '../pages/Lyrics/api'
import NowPlayingPage from '../pages/NowPlaying/NowPlayingPage'
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
import { useInputMode } from '../shared/lib/motion'
import { PlaybackProvider, usePlayback } from '../shared/playback/PlaybackProvider'
import MiniPlayer from '../shared/playback/MiniPlayer/MiniPlayer'
import MobileMiniPlayer from '../shared/playback/MiniPlayer/MobileMiniPlayer'
import { LibraryProvider } from '../shared/playlists/Membership/LibraryProvider'
import { useTranslation } from '../shared/preferences/i18n'
import { routeFromHash, pageTitles } from './navigation'
import type { PageId } from './navigation'

export default function App() {
  return <LibraryProvider><PlaybackProvider><AppContent /></PlaybackProvider></LibraryProvider>
}

function AppContent() {
  const t = useTranslation()
  useInputMode()
  const appWindow = useAppWindow()
  const mobile = useMobileLayout(appWindow)
  const player = usePlayback()
  const [route, setRoute] = useState(routeFromHash)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [keepLyrics, setKeepLyrics] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const backPending = useRef(false)
  const activePage = route.page
  const trackId = player.current?.id
  const playlistId = player.playlistId
  const aboutEnteredFromApp = useRef(false)
  const catalogEnteredFromApp = useRef(false)
  const dismissOverlay = useCallback(() => {
    if (backPending.current) return
    backPending.current = true
    window.history.back()
  }, [])

  const closeLyrics = useCallback(() => {
    setLyricsOpen(false)
    if (window.history.state?.tesifyOverlay === 'lyrics') dismissOverlay()
  }, [dismissOverlay])
  const finishLyricsExit = useCallback(() => setKeepLyrics(false), [])

  const closePlayer = useCallback(() => {
    setPlayerOpen(false)
    setKeepLyrics(false)
    if (window.history.state?.tesifyOverlay === 'player') dismissOverlay()
  }, [dismissOverlay])

  function openPlayer() {
    if (backPending.current || window.history.state?.tesifyOverlay) return
    window.history.pushState({ tesifyOverlay: 'player' }, '')
    setPlayerOpen(true)
  }

  function openLyrics() {
    if (backPending.current || window.history.state?.tesifyOverlay !== 'player') return
    window.history.pushState({ tesifyOverlay: 'lyrics' }, '')
    setKeepLyrics(true)
    setLyricsOpen(true)
  }

  useEffect(() => {
    if (trackId && playlistId) void getLyrics(playlistId, trackId).catch(() => {})
  }, [playlistId, trackId])

  useEffect(() => {
    const syncHistory = () => {
      backPending.current = false
      const nextRoute = routeFromHash()
      setRoute(current => current.page === nextRoute.page && current.playlistId === nextRoute.playlistId ? current : nextRoute)
      const overlay = window.history.state?.tesifyOverlay
      setPlayerOpen(Boolean(trackId) && (overlay === 'player' || overlay === 'lyrics'))
      setLyricsOpen(Boolean(trackId) && overlay === 'lyrics')
      if (trackId && overlay === 'lyrics') setKeepLyrics(true)
      else if (overlay !== 'player' || !trackId) setKeepLyrics(false)
    }
    window.addEventListener('popstate', syncHistory)
    window.addEventListener('hashchange', syncHistory)
    return () => {
      window.removeEventListener('popstate', syncHistory)
      window.removeEventListener('hashchange', syncHistory)
    }
  }, [trackId])

  useLayoutEffect(() => {
    if (window.history.state?.tesifyOverlay) window.history.replaceState(null, '')
  }, [])

  useEffect(() => {
    if (!mobile || !playerOpen || lyricsOpen) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
        event.preventDefault()
        closePlayer()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [closePlayer, lyricsOpen, mobile, playerOpen])

  useLayoutEffect(() => {
    const back = (event: Event) => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
      if (dialog) {
        event.preventDefault()
        dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
      } else if (window.history.state?.tesifyOverlay) {
        event.preventDefault()
        if (window.history.state.tesifyOverlay === 'lyrics') closeLyrics()
        else closePlayer()
      }
    }
    window.addEventListener('tesify:back', back)
    return () => window.removeEventListener('tesify:back', back)
  }, [closeLyrics, closePlayer])

  useEffect(() => {
    document.title = `Tesify — ${t(pageTitles[activePage])}`
  }, [activePage, t])

  function navigate(page: PageId, id?: string) {
    setPlayerOpen(false)
    setLyricsOpen(false)
    setKeepLyrics(false)
    if (page === 'about') aboutEnteredFromApp.current = true
    const hash = id ? `${page}/${id}` : page
    if (window.history.state?.tesifyOverlay) window.history.replaceState(null, '', `#${hash}`)
    else window.location.hash = hash
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
  const playerExpanded = mobile && playerOpen
  const lyricsPresent = lyricsOpen || (playerExpanded && keepLyrics)
  const overlayOpen = lyricsOpen || playerExpanded
  const page = activePage === 'about' ? <AboutPage onBack={leaveAbout} /> : <>
    <Sidebar activePage={sidebarPage} mobile={mobile} onNavigate={navigate} />
    {activePage === 'home' && <HomePage />}
    {activePage === 'settings' && <SettingsPage onAbout={mobile ? () => navigate('about') : undefined} />}
    {activePage === 'search' && <SearchPage onOpen={openCatalog} />}
    {activePage === 'artist' && <ArtistPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
    {activePage === 'album' && <AlbumPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
    {activePage === 'spotify-playlist' && <SpotifyPlaylistPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
    {activePage === 'library' && <LibraryPage onOpenPlaylist={(id) => navigate('playlist', id)} onOpenCatalog={openCatalog} />}
    {activePage === 'playlist' && <PlaylistPage key={route.playlistId} playlistId={route.playlistId ?? ''} onBack={() => navigate('library')} onOpen={openCatalog} />}
  </>

  return (
    <AppWindow appWindow={appWindow} isAbout={activePage === 'about'} hasPlayer={Boolean(player.current)} isLyrics={lyricsPresent} isPlayer={playerExpanded} mobile={mobile}>
      {mobile ? <div style={{ display: 'contents' }} inert={overlayOpen} aria-hidden={overlayOpen || undefined}>{page}</div> : page}
      {mobile && player.current && <NowPlayingPage shown={playerExpanded} active={playerExpanded && !lyricsOpen} onClose={closePlayer}
        onLyrics={openLyrics} onOpen={openCatalog} />}
      {lyricsPresent && player.current && (
        <LyricsPage
          onClose={closeLyrics}
          mobile={mobile}
          shown={lyricsOpen}
          onExited={finishLyricsExit}
          isMaximized={appWindow.isMaximized}
          onToggleMaximize={mobile ? undefined : appWindow.toggleMaximize}
        >{mobile && <MobileMiniPlayer lyricsOpen expanded={false} onOpen={openPlayer} />}</LyricsPage>
      )}
      {mobile
        ? !lyricsPresent && <MobileMiniPlayer lyricsOpen={false} expanded={playerExpanded} onOpen={openPlayer} />
        : <MiniPlayer lyricsOpen={lyricsOpen} onToggleLyrics={() => setLyricsOpen(open => !open)} onOpen={openCatalog} />}
    </AppWindow>
  )
}
