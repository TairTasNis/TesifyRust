import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import AboutPage from '../pages/About/AboutPage'
import DownloadsPage from '../pages/Downloads/DownloadsPage'
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
import { routeFromHash, routeKey, pageTitles } from './navigation'
import type { PageId, Route } from './navigation'
import { useRouteTransition } from './useRouteTransition'
import './RouteTransition.css'

const routeParents: Partial<Record<PageId, PageId>> = {
  about: 'home', playlist: 'library', downloads: 'library', artist: 'search', album: 'search', 'spotify-playlist': 'search',
}

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
  const transition = useRouteTransition(route)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [keepLyrics, setKeepLyrics] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const backPending = useRef(false)
  const activePage = route.page
  const trackId = player.current?.id
  const playlistId = player.playlistId
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
      if (routeKey(nextRoute) !== routeKey(route)) transition.clearPreview()
      setRoute(current => routeKey(current) === routeKey(nextRoute) ? current : nextRoute)
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
  }, [route, trackId])

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

  useEffect(() => {
    document.title = `Tesify — ${t(pageTitles[activePage])}`
  }, [activePage, t])

  function navigate(page: PageId, id?: string) {
    const next = { page, playlistId: id }
    if (routeKey(next) === routeKey(route)) return
    setPlayerOpen(false)
    setLyricsOpen(false)
    setKeepLyrics(false)
    transition.clearPreview()
    const hash = `#${routeKey(next)}`
    const history = window.history
    const state = { tesifyPrevious: route }
    if (history.state?.tesifyOverlay) history.replaceState(state, '', hash)
    else history.pushState(state, '', hash)
    setRoute(next)
  }

  function previousRoute(): Route | undefined {
    const previous = window.history.state?.tesifyPrevious as Route | undefined
    const parent = routeParents[route.page]
    return previous ?? (parent ? { page: parent } : undefined)
  }

  function leavePage(destination = previousRoute()) {
    if (!destination) return
    transition.close(destination, () => {
      if (window.history.state?.tesifyPrevious) window.history.back()
      else {
        window.history.replaceState(null, '', `#${routeKey(destination)}`)
        transition.clearPreview()
        setRoute(destination)
      }
    })
  }

  useLayoutEffect(() => {
    const back = (event: Event) => {
      if (event.defaultPrevented) return
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
      if (dialog) {
        event.preventDefault()
        dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
      } else if (window.history.state?.tesifyOverlay) {
        event.preventDefault()
        if (window.history.state.tesifyOverlay === 'lyrics') closeLyrics()
        else closePlayer()
      } else if (mobile && previousRoute()) {
        event.preventDefault()
        leavePage()
      }
    }
    const start = () => {
      if (!mobile || window.history.state?.tesifyOverlay || document.querySelector('dialog[open], .route-surface:not([inert]) .track-selection')) return
      const previous = previousRoute()
      if (previous) transition.start(previous)
    }
    const progress = (event: Event) => transition.progress((event as CustomEvent<number>).detail)
    window.addEventListener('tesify:back', back)
    window.addEventListener('tesify:back-start', start)
    window.addEventListener('tesify:back-progress', progress)
    window.addEventListener('tesify:back-cancel', transition.cancel)
    return () => {
      window.removeEventListener('tesify:back', back)
      window.removeEventListener('tesify:back-start', start)
      window.removeEventListener('tesify:back-progress', progress)
      window.removeEventListener('tesify:back-cancel', transition.cancel)
    }
  }, [route, mobile, closeLyrics, closePlayer, transition])

  const openCatalog: OpenCatalog = (kind, id) => {
    navigate(kind === 'playlist' ? 'spotify-playlist' : kind, id)
  }
  const sidebarPage = activePage === 'playlist' || activePage === 'downloads' ? 'library' : ['artist', 'album', 'spotify-playlist'].includes(activePage) ? 'search' : activePage
  const playerExpanded = mobile && playerOpen
  const lyricsPresent = lyricsOpen || (playerExpanded && keepLyrics)
  const overlayOpen = lyricsOpen || playerExpanded
  function page({ page, playlistId }: Route) {
    const id = playlistId ?? ''
    switch (page) {
      case 'about': return <AboutPage onBack={() => leavePage()} />
      case 'home': return <HomePage />
      case 'settings': return <SettingsPage onAbout={mobile ? () => navigate('about') : undefined} />
      case 'search': return <SearchPage onOpen={openCatalog} />
      case 'artist': return <ArtistPage id={id} onOpen={openCatalog} onBack={() => leavePage()} />
      case 'album': return <AlbumPage id={id} onOpen={openCatalog} onBack={() => leavePage()} />
      case 'spotify-playlist': return <SpotifyPlaylistPage id={id} onOpen={openCatalog} onBack={() => leavePage()} />
      case 'library': return <LibraryPage onOpenPlaylist={id => navigate('playlist', id)} onOpenCatalog={openCatalog} onOpenDownloads={() => navigate('downloads')} />
      case 'downloads': return <DownloadsPage onBack={() => leavePage()} />
      case 'playlist': return <PlaylistPage playlistId={id} onBack={() => leavePage()} onOpen={openCatalog} />
    }
  }
  const routes = transition.preview && routeKey(transition.preview) !== routeKey(route) ? [transition.preview, route] : [route]

  return (
    <AppWindow appWindow={appWindow} isAbout={activePage === 'about'} hasPlayer={Boolean(player.current)} isLyrics={lyricsPresent} isPlayer={playerExpanded} mobile={mobile}>
      <div style={{ display: 'contents' }} inert={mobile && overlayOpen} aria-hidden={mobile && overlayOpen || undefined}>
        {routes.map(item => {
          const preview = item !== route
          return <div key={routeKey(item)} className="route-surface" ref={preview ? undefined : transition.surface}
            data-preview={preview || undefined} inert={preview} aria-hidden={preview || undefined}>{page(item)}</div>
        })}
        {activePage !== 'about' && <Sidebar activePage={sidebarPage} mobile={mobile} onNavigate={navigate} />}
      </div>
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
