import CollectionView from '../../shared/catalog/CollectionView/CollectionView'
import { useCollection } from '../../shared/catalog/CollectionView/useCollection'
import type { OpenCatalog } from '../../shared/catalog/types'
import { getSpotifyPlaylist } from './api'
export default function SpotifyPlaylistPage({ id, onOpen, onBack, trackQuery }: { id: string; onOpen: OpenCatalog; onBack: () => void; trackQuery?: string }) { return <CollectionView {...useCollection(id, getSpotifyPlaylist)} kind="playlist" onBack={onBack} onOpen={onOpen} trackQuery={trackQuery} /> }
