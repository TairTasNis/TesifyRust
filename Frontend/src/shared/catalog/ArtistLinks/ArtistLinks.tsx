import type { ArtistRef, OpenCatalog } from '../types'
import './ArtistLinks.css'
export default function ArtistLinks({ artists, fallback = '', onOpen }: { artists: ArtistRef[]; fallback?: string; onOpen: OpenCatalog }) {
  return <span className="catalog-artist-links">{artists.length ? artists.map((artist, index) => <span key={artist.id}>{index > 0 && ', '}<button type="button" onClick={event => { event.stopPropagation(); onOpen('artist', artist.id) }}>{artist.name}</button></span>) : fallback}</span>
}
