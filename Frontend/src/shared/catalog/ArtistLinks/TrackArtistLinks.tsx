import { useTranslation } from '../../preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../playlists/types'
import { searchSpotify } from '../search'
import type { OpenCatalog } from '../types'
import ArtistLinks from './ArtistLinks'

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

async function resolveArtist(track: Track, name: string) {
  const query = `${track.title} ${track.artist}`.slice(0, 180)
  const results = track.spotifyId ? await searchSpotify(query, 'tracks').catch(() => null) : null
  const match = results?.tracks.items.find(item => item.id === track.spotifyId)
  const credited = match?.artists.find(artist => sameName(artist.name, name))
  if (credited) return credited.id

  const { artists } = await searchSpotify(name, 'artists')
  const exact = artists.items.filter(artist => sameName(artist.name, name))
  if (exact.length === 1) return exact[0].id
  throw new Error('Не удалось найти страницу исполнителя. Повторите попытку.')
}

export default function TrackArtistLinks({ track, onOpen }: { track: Track; onOpen: OpenCatalog }) {
  const t = useTranslation()
  const request = useRef(0)
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => () => { ++request.current }, [])

  async function open(name: string) {
    if (pending === name) return
    const current = ++request.current
    const origin = window.location.hash
    setPending(name)
    setFailed(null)
    try {
      const id = await resolveArtist(track, name)
      if (current === request.current && window.location.hash === origin) onOpen('artist', id)
    } catch {
      if (current === request.current) setFailed(name)
    } finally {
      if (current === request.current) setPending(null)
    }
  }

  if (track.artists?.length) return <ArtistLinks artists={track.artists} onOpen={onOpen} />

  const names = track.artist.split(/,\s+/).map(name => name.trim()).filter(Boolean)
  return <span className="catalog-artist-links">{names.map((name, index) => <span key={`${index}/${name}`}>
    {index > 0 && ', '}
    <button type="button" aria-busy={pending === name || undefined} data-lookup-error={failed === name || undefined}
      title={failed === name ? t("Не удалось открыть исполнителя. Нажмите, чтобы повторить.") : undefined}
      onClick={event => { event.stopPropagation(); void open(name) }}>{name}</button>
  </span>)}{failed && <span className="visually-hidden" role="status">{t("Не удалось открыть исполнителя. Нажмите, чтобы повторить.")}</span>}</span>
}
