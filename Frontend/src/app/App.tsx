import { useCallback, useEffect, useRef, useState } from 'react'
import AboutPage from '../pages/About/AboutPage'
import HomePage from '../pages/Home/HomePage'
import LibraryPage from '../pages/Library/LibraryPage'
import LyricsPage from '../pages/Lyrics/LyricsPage'
import { getLyrics } from '../pages/Lyrics/api'
import PlaylistPage from '../pages/Playlist/PlaylistPage'
import SearchPage from '../pages/Search/SearchPage'
import ArtistPage from '../pages/Artist/ArtistPage'
import AlbumPage from '../pages/Album/AlbumPage'
import SpotifyPlaylistPage from '../pages/SpotifyPlaylist/SpotifyPlaylistPage'
import SettingsPage from '../pages/Settings/SettingsPage'
import type { OpenCatalog } from '../shared/catalog/types'
import AppWindow from '../shared/layout/AppWindow/AppWindow'
import { useAppWindow } from '../shared/layout/AppWindow/useAppWindow'
import Sidebar from '../shared/layout/Sidebar/Sidebar'
import { useInputMode } from '../shared/lib/motion'
import { PlaybackProvider, usePlayback } from '../shared/playback/PlaybackProvider'
import MiniPlayer from '../shared/playback/MiniPlayer/MiniPlayer'
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
  const player = usePlayback()
  const [route, setRoute] = useState(routeFromHash)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const closeLyrics = useCallback(() => setLyricsOpen(false), [])
  const activePage = route.page
  const trackId = player.current?.id
  const playlistId = player.playlistId
  const aboutEnteredFromApp = useRef(false)
  const catalogEnteredFromApp = useRef(false)

  useEffect(() => {
    if (trackId && playlistId) void getLyrics(playlistId, trackId).catch(() => {})
  }, [playlistId, trackId])

  useEffect(() => {
    const syncPage = () => { setRoute(routeFromHash()); setLyricsOpen(false) }
    window.addEventListener('hashchange', syncPage)
    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  useEffect(() => {
    if (!appWindow.isAndroid) return
    const back = (event: Event) => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
      if (dialog) {
        event.preventDefault()
        dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
      } else if (lyricsOpen) {
        event.preventDefault()
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      }
    }
    window.addEventListener('tesify:back', back)
    return () => window.removeEventListener('tesify:back', back)
  }, [appWindow.isAndroid, lyricsOpen])

  useEffect(() => {
    document.title = `Tesify — ${t(pageTitles[activePage])}`
  }, [activePage, t])

  function navigate(page: PageId, id?: string) {
    setLyricsOpen(false)
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

  return (
    <AppWindow appWindow={appWindow} isAbout={activePage === 'about'} hasPlayer={Boolean(player.current)} isLyrics={lyricsOpen}>
      <div style={{ display: 'contents' }} inert={lyricsOpen} aria-hidden={lyricsOpen || undefined}>
      {activePage === 'about' ? (
        <AboutPage onBack={leaveAbout} />
      ) : (
        <>
          <Sidebar activePage={sidebarPage} onNavigate={navigate} />
          {activePage === 'home' && <HomePage />}
          {activePage === 'settings' && <SettingsPage onAbout={() => navigate('about')} />}
          {activePage === 'search' && <SearchPage onOpen={openCatalog} />}
          {activePage === 'artist' && <ArtistPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
          {activePage === 'album' && <AlbumPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
          {activePage === 'spotify-playlist' && <SpotifyPlaylistPage key={route.playlistId} id={route.playlistId ?? ''} onOpen={openCatalog} onBack={leaveCatalog} />}
          {activePage === 'library' && <LibraryPage onOpenPlaylist={(id) => navigate('playlist', id)} />}
          {activePage === 'playlist' && <PlaylistPage key={route.playlistId} playlistId={route.playlistId ?? ''} onBack={() => navigate('library')} onOpen={openCatalog} />}
        </>
      )}
      </div>
      {lyricsOpen && player.current && (
        <LyricsPage
          onClose={closeLyrics}
          isMaximized={appWindow.isMaximized}
          onToggleMaximize={appWindow.isAndroid ? undefined : appWindow.toggleMaximize}
        />
      )}
      <MiniPlayer lyricsOpen={lyricsOpen} onToggleLyrics={() => setLyricsOpen(open => !open)} onOpen={openCatalog} />
    </AppWindow>
  )
}
