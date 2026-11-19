import CollectionView from '../../shared/catalog/CollectionView/CollectionView'
import { useCollection } from '../../shared/catalog/CollectionView/useCollection'
import type { OpenCatalog } from '../../shared/catalog/types'
import { getSpotifyAlbum } from './api'
export default function AlbumPage({ id, onOpen, onBack }: { id: string; onOpen: OpenCatalog; onBack: () => void }) { return <CollectionView {...useCollection(id, getSpotifyAlbum)} kind="album" onBack={onBack} onOpen={onOpen} /> }
