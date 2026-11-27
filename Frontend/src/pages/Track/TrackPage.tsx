import { useEffect, useState } from 'react'
import ArtistLinks from '../../shared/catalog/ArtistLinks/ArtistLinks'
import TrackList from '../../shared/catalog/TrackList/TrackList'
import { trackCatalogItem } from '../../shared/catalog/playback'
import type { CatalogItem, OpenCatalog } from '../../shared/catalog/types'
import { backend, errorMessage } from '../../shared/lib/backend'
import type { Track } from '../../shared/playlists/types'
import { useTranslation } from '../../shared/preferences/i18n'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import '../../shared/catalog/CatalogPage/CatalogPage.css'
import '../../shared/catalog/CollectionView/CollectionView.css'

export default function TrackPage({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: OpenCatalog }) {
  const t = useTranslation()
  const [item, setItem] = useState<CatalogItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setItem(null)
    setError(null)
    void backend<Track>('get_spotify_track', { id }, `/spotify/tracks/${encodeURIComponent(id)}`)
      .then(track => { if (active) setItem(trackCatalogItem(track)) })
      .catch(error => { if (active) setError(errorMessage(error)) })
    return () => { active = false }
  }, [id, retry])

  return <main className="workspace catalog-page collection-page" aria-label={t('Песня')}>
    <header className="collection-hero">
      <div className="catalog-toolbar"><button className="catalog-back" aria-label={t('Назад')} onClick={onBack}><Icon name="back" /></button></div>
      {item && <div className="collection-identity"><PlaylistCover url={item.imageUrl} name={item.name} />
        <div><h1>{item.name}</h1><div className="collection-meta"><ArtistLinks artists={item.artists} fallback={item.subtitle} onOpen={onOpen} /></div></div>
      </div>}
    </header>
    {item ? <div className="catalog-body"><TrackList items={[item]} queueId={`spotify:track:${id}`} onOpen={onOpen} compact numbered={false} /></div>
      : <div className="catalog-state">{error ? <><h1>{t('Не удалось открыть страницу')}</h1><p role="alert">{t(error)}</p><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>{t('Попробовать снова')}</Button></>
        : <MusicLoader label={t('Загрузка трека')} />}</div>}
  </main>
}
