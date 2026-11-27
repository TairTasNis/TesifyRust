import type { CatalogKind } from '../../shared/catalog/types'

export type SpotifyTarget = { kind: CatalogKind; id: string }

function target(kind?: string, id?: string): SpotifyTarget | null {
  if (kind !== 'track' && kind !== 'artist' && kind !== 'album' && kind !== 'playlist') return null
  return id && /^[A-Za-z0-9]{22}$/.test(id) ? { kind, id } : null
}

export function spotifyTarget(text: string): SpotifyTarget | null {
  const uri = /^spotify:([^:]+):([^:]+)$/.exec(text.trim())
  if (uri) return target(uri[1], uri[2])
  try {
    const url = new URL(text.trim())
    if (url.hostname !== 'open.spotify.com' || !['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password) return null
    const path = url.pathname.replace(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?|\/$/gi, '')
    const [kind, id, extra] = path.split('/')
    return extra === undefined ? target(kind, id) : null
  } catch { return null }
}

export function isShortSpotifyLink(text: string): boolean {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'https:' && ['spotify.link', 'spotify.app.link'].includes(url.hostname) && !url.port && !url.username && !url.password
  } catch { return false }
}
