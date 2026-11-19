import { useTranslation } from '../../preferences/i18n'
import { currentLanguage } from '../../preferences/preferences'
import type { CSSProperties } from 'react'
import { usePlayback } from '../../playback/PlaybackProvider'
import { totalDuration, trackCount } from '../../playlists/format'
import Button from '../../ui/Button/Button'
import Icon from '../../ui/Icon/Icon'
import MusicLoader from '../../ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../ui/PlaylistCover/PlaylistCover'
import ArtistLinks from '../ArtistLinks/ArtistLinks'
import CatalogCard from '../CatalogCard/CatalogCard'
import TrackList from '../TrackList/TrackList'
import { catalogTracks } from '../playback'
import { kindLabel, number } from '../types'
import type { CollectionDetail, OpenCatalog } from '../types'
import '../CatalogPage/CatalogPage.css'
import './CollectionView.css'

type Props = { data: CollectionDetail | null; loading: boolean; more: boolean; error: string | null; onRetry: () => void; onLoadMore: () => void; onBack: () => void; onOpen: OpenCatalog; kind: 'album' | 'playlist' }
export default function CollectionView({ data, loading, more, error, onRetry, onLoadMore, onBack, onOpen, kind }: Props) {
  const t = useTranslation()
  const player = usePlayback()
  const queueId = `spotify:${kind}:${data?.item.id}`
  const playing = player.playlistId === queueId && player.playing
  const queue = catalogTracks(data?.tracks.items ?? [])
  const duration = data?.tracks.items.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) ?? 0
  const toolbar = <div className="catalog-toolbar"><button className="catalog-back" aria-label={t("Назад")} onClick={onBack}><Icon name="back" /></button></div>
  return <main className="workspace catalog-page collection-page" aria-label={kind === 'album' ? t("Альбом Spotify") : t("Плейлист Spotify")}>
    {data ? <>
      <header className="collection-hero" style={{ '--collection-color': data.item.color ?? '#465344' } as CSSProperties}>{toolbar}<div className="collection-identity"><PlaylistCover url={data.item.imageUrl} name={data.item.name} /><div><span className="collection-kind">{t(kindLabel(data.item))}</span><h1>{data.item.name}</h1>{data.description && <p className="collection-description">{data.description}</p>}<div className="collection-meta">{kind === 'album' ? <ArtistLinks artists={data.item.artists} fallback={data.owner} onOpen={onOpen} /> : <strong>{data.owner}</strong>}{data.item.year && <span>{data.item.year}</span>}{data.followers !== null && <span>{number(data.followers)} {t("сохранений")}</span>}<span>{trackCount(data.tracks.total)}</span>{data.tracks.nextOffset === null && duration > 0 && <span>{totalDuration(duration)}</span>}</div></div></div></header>
      <div className="catalog-body"><div className="catalog-actions"><button className="catalog-play" disabled={!queue.length} aria-label={playing ? t("Пауза альбома или плейлиста") : t("Слушать альбом или плейлист")} onClick={() => { if (player.playlistId === queueId && player.current) player.toggle(); else if (queue.length) player.playQueue(queueId, queue, 0) }}><Icon name={playing ? 'pause' : 'play'} /></button></div>
        <TrackList items={data.tracks.items} queueId={queueId} onOpen={onOpen} showAlbum={kind === 'playlist'} showAdded={kind === 'playlist'} />
        {!data.tracks.items.length && <p className="collection-no-tracks">{t("В этой подборке нет доступных музыкальных треков.")}</p>}
        {error && <p className="search-inline-error" role="alert">{error && t(error)}</p>}
        {data.tracks.nextOffset !== null && <div className="catalog-more"><Button variant="secondary" disabled={more} onClick={onLoadMore}>{more ? <MusicLoader variant="inline" label={t("Загружаем треки")} /> : t("Показать ещё")}</Button></div>}
        {kind === 'album' && <footer className="collection-credits">{data.releaseDate && <p>{new Intl.DateTimeFormat(currentLanguage(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(data.releaseDate))}</p>}{data.label && <p>{data.label}</p>}{data.copyrights.map((line, index) => <small key={index}>{line}</small>)}</footer>}
        {data.moreAlbums.length > 0 && <section className="catalog-section"><div className="catalog-section-heading"><h2>{t("Ещё от исполнителя")}</h2></div><div className="catalog-grid">{data.moreAlbums.map(item => <CatalogCard key={item.id} item={item} onOpen={onOpen} />)}</div></section>}
      </div>
    </> : <>{toolbar}<div className="catalog-state">{loading ? <MusicLoader label={kind === 'album' ? t("Загружаем альбом") : t("Загружаем плейлист")} /> : <><h1>{t("Не удалось открыть страницу")}</h1><p role="alert">{error && t(error)}</p><Button variant="secondary" onClick={onRetry}>{t("Попробовать снова")}</Button></>}</div></>}
  </main>
}
