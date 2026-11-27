import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import CatalogCard from '../../shared/catalog/CatalogCard/CatalogCard'
import TrackList from '../../shared/catalog/TrackList/TrackList'
import { catalogTracks } from '../../shared/catalog/playback'
import { mergeItems, number } from '../../shared/catalog/types'
import type { ArtistDetail, CatalogItem, CatalogPage, OpenCatalog } from '../../shared/catalog/types'
import { errorMessage } from '../../shared/lib/backend'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import Modal from '../../shared/ui/Modal/Modal'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import { getArtistReleases, getSpotifyArtist } from './api'
import '../../shared/catalog/CatalogPage/CatalogPage.css'
import './ArtistPage.css'

const releaseFilters = [{ id: 'popular', name: 'Популярные релизы' }, { id: 'all', name: 'Все' }, { id: 'albums', name: 'Альбомы' }, { id: 'singles', name: 'Синглы и EP' }, { id: 'compilations', name: 'Сборники' }]
export default function ArtistPage({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: OpenCatalog }) {
  const t = useTranslation()
  const [data, setData] = useState<ArtistDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedTracks, setExpandedTracks] = useState(false)
  const [about, setAbout] = useState(false)
  const [filter, setFilter] = useState('popular')
  const [releases, setReleases] = useState<CatalogPage | null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const releaseGeneration = useRef(0)
  const player = usePlayback()
  const queueId = `spotify:artist:${id}`
  const playing = player.playlistId === queueId && player.playing
  const heroImage = data?.headerUrl ?? data?.artist.imageUrl
  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    void getSpotifyArtist(id).then(value => { if (active) setData(value) }).catch(error => { if (active) setError(errorMessage(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, retry])
  useEffect(() => {
    const request = ++releaseGeneration.current
    setReleases(null); setReleaseError(null); setMore(false)
    if (filter === 'popular') { setReleasesLoading(false); return }
    setReleasesLoading(true)
    void getArtistReleases(id, filter).then(page => { if (request === releaseGeneration.current) setReleases(page) })
      .catch(error => { if (request === releaseGeneration.current) setReleaseError(errorMessage(error)) })
      .finally(() => { if (request === releaseGeneration.current) setReleasesLoading(false) })
    return () => { ++releaseGeneration.current }
  }, [id, filter])
  async function loadMore() {
    if (!releases || more || releases.nextOffset === null) return
    const request = releaseGeneration.current
    setMore(true); setReleaseError(null)
    try { const next = await getArtistReleases(id, filter, releases.nextOffset); if (request === releaseGeneration.current) setReleases(current => current ? { ...next, items: mergeItems(current.items, next.items) } : current) }
    catch (error) { if (request === releaseGeneration.current) setReleaseError(errorMessage(error)) }
    finally { if (request === releaseGeneration.current) setMore(false) }
  }
  const grid = (title: string, items: CatalogItem[]) => items.length > 0 && <section className="catalog-section"><div className="catalog-section-heading"><h2>{title}</h2></div><div className="catalog-grid">{items.map(item => <CatalogCard key={`${item.kind}:${item.id}`} item={item} onOpen={onOpen} />)}</div></section>
  const toolbar = <div className="catalog-toolbar"><button className="catalog-back" aria-label={t("Назад")} onClick={onBack}><Icon name="back" /></button></div>
  const stats = data && <div className="artist-about-stats">{data.followers !== null && <div><strong>{number(data.followers)}</strong><span>{t("подписчиков")}</span></div>}{data.monthlyListeners !== null && <div><strong>{number(data.monthlyListeners)}</strong><span>{t("слушателей за месяц")}</span></div>}{data.worldRank !== null && <div><strong>#{number(data.worldRank)}</strong><span>{t("в мире")}</span></div>}</div>
  return <main className="workspace catalog-page artist-page" aria-label={t("Исполнитель Spotify")}>
    {data ? <>
      <header className="artist-hero" style={{ backgroundColor: data.artist.color ?? '#384646', backgroundImage: heroImage ? `linear-gradient(0deg, #0008, #0000 70%), url(${JSON.stringify(heroImage)})` : undefined }}>{toolbar}<div className="artist-identity"><h1>{data.artist.name}{data.artist.verified && <span className="artist-verified" role="img" aria-label={t("Подтверждённый исполнитель")}><Icon name="check" /></span>}</h1>{data.monthlyListeners !== null && <p>{number(data.monthlyListeners)} {t("слушателей за месяц")}</p>}</div></header>
      <div className="catalog-body"><div className="catalog-actions"><button className="catalog-play" disabled={!data.topTracks.length} aria-label={playing ? t("Приостановить исполнителя") : t("Слушать исполнителя")} onClick={() => { const tracks = catalogTracks(data.topTracks); if (player.playlistId === queueId && player.current) player.toggle(); else if (tracks.length) player.playQueue(queueId, tracks, 0) }}><Icon name={playing ? 'pause' : 'play'} /></button></div>
        {data.topTracks.length > 0 && <section className="artist-popular"><h2>{t("Популярное")}</h2><TrackList items={expandedTracks ? data.topTracks : data.topTracks.slice(0, 5)} queueItems={data.topTracks} queueId={queueId} onOpen={onOpen} compact showPlays />{data.topTracks.length > 5 && <button className="catalog-text-button artist-show-tracks" onClick={() => setExpandedTracks(value => !value)}>{expandedTracks ? t("Свернуть") : t("Показать все")}</button>}</section>}
        <section className="catalog-section artist-discography"><div className="catalog-section-heading"><h2>{t("Дискография")}</h2></div><div className="artist-release-filters" role="group" aria-label={t("Виды релизов")}>{releaseFilters.filter(item => item.id !== 'compilations' || data.compilations.total > 0).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.name)}</button>)}</div>
          {releasesLoading ? <MusicLoader label={t("Загружаем релизы")} /> : <><div className="catalog-grid">{(filter === 'popular' ? data.popularReleases : releases?.items ?? []).map(item => <CatalogCard key={item.id} item={item} onOpen={onOpen} />)}</div>{filter !== 'popular' && releases?.items.length === 0 && !releaseError && <p className="artist-no-releases">{t("Релизов в этой категории пока нет.")}</p>}</>}
          {releaseError && <p role="alert" className="search-inline-error">{t(releaseError)}</p>}
          {releases?.nextOffset !== null && releases && !releasesLoading && <div className="catalog-more"><Button variant="secondary" disabled={more} onClick={() => { void loadMore() }}>{more ? <MusicLoader variant="inline" label={t("Загружаем релизы")} /> : t("Показать ещё")}</Button></div>}
        </section>
        {grid(t("С участием исполнителя"), data.playlists)}{grid(t("Также появляется на"), data.appearsOn)}{grid(t("Вам также могут понравиться"), data.relatedArtists)}
        <section className="catalog-section artist-about"><div className="catalog-section-heading"><h2>{t("Об исполнителе")}</h2></div><button className="artist-about-card" onClick={() => setAbout(true)} style={{ backgroundImage: (data.gallery[0] ?? data.artist.imageUrl) ? `linear-gradient(0deg, #000c, #0001 85%), url(${JSON.stringify(data.gallery[0] ?? data.artist.imageUrl)})` : undefined }}><div>{data.monthlyListeners !== null && <strong>{number(data.monthlyListeners)} {t("слушателей за месяц")}</strong>}{data.biography && <p>{data.biography}</p>}<span>{t("Подробнее")}</span></div></button></section>
      </div>
      {about && <Modal title={data.artist.name} onClose={() => setAbout(false)} wide><div className="artist-biography">{stats}{data.biography && <p>{data.biography}</p>}{data.topCities.length > 0 && <div className="artist-cities">{data.topCities.map(city => <div key={`${city.name}:${city.country}`}><strong>{city.name}, {city.country}</strong><span>{number(city.listeners)} {t("слушателей")}</span></div>)}</div>}</div></Modal>}
    </> : <>{toolbar}<div className="catalog-state">{loading ? <MusicLoader label={t("Загружаем исполнителя")} /> : <><h1>{t("Не удалось открыть исполнителя")}</h1><p role="alert">{error && t(error)}</p><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>{t("Попробовать снова")}</Button></>}</div></>}
  </main>
}
