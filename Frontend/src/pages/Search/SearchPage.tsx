import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import CatalogCard from '../../shared/catalog/CatalogCard/CatalogCard'
import TrackList from '../../shared/catalog/TrackList/TrackList'
import { catalogTracks } from '../../shared/catalog/playback'
import { categories, kindLabel, mergeItems } from '../../shared/catalog/types'
import type { CatalogItem, OpenCatalog, SearchCategory, SearchResults } from '../../shared/catalog/types'
import { errorMessage } from '../../shared/lib/backend'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import { cachedSearch, searchSpotify } from '../../shared/catalog/search'
import './SearchPage.css'

export function savedSearch(): { query: string; category: SearchCategory } {
  try { const saved = JSON.parse(sessionStorage.getItem('tesify.search') || '{}'); return { query: typeof saved.query === 'string' ? saved.query.slice(0, 180) : '', category: categories.some(item => item.id === saved.category) ? saved.category : 'all' } } catch { return { query: '', category: 'all' } }
}
export default function SearchPage({ onOpen, mobileSearch }: { onOpen: OpenCatalog; mobileSearch?: { query: string; submitCount: number } }) {
  const t = useTranslation()
  const [saved] = useState(savedSearch)
  const [desktopQuery, setQuery] = useState(saved.query)
  const query = mobileSearch?.query ?? desktopQuery
  const [category, setCategory] = useState<SearchCategory>(saved.category)
  const [result, setResult] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const immediate = useRef(false)
  const previousSubmit = useRef(0)
  const generation = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const page = useRef<HTMLElement>(null)
  const mobileResults = useRef<HTMLDivElement>(null)
  const player = usePlayback()
  const term = query.trim()
  const submitCount = mobileSearch?.submitCount ?? 0
  useEffect(() => {
    const request = ++generation.current
    setResult(null); setError(null); setMore(false)
    try { sessionStorage.setItem('tesify.search', JSON.stringify({ query, category })) } catch { /* Storage may be disabled. */ }
    const skipDelay = immediate.current || previousSubmit.current !== submitCount
    previousSubmit.current = submitCount
    immediate.current = false
    const cached = cachedSearch(term, category)
    if (!term || cached) {
      setResult(cached ?? null)
      setLoading(false)
      return
    }
    setLoading(true)
    const timeout = window.setTimeout(() => {
      void searchSpotify(term, category).then(data => { if (request === generation.current) setResult(data) })
        .catch(error => { if (request === generation.current) setError(errorMessage(error)) })
        .finally(() => { if (request === generation.current) setLoading(false) })
    }, skipDelay ? 0 : import.meta.env.MODE === 'android' ? 120 : 160)
    return () => { window.clearTimeout(timeout); ++generation.current }
  }, [term, category, retry, submitCount])
  async function loadMore() {
    if (!result || more || category === 'all') return
    const offset = result[category].nextOffset
    if (offset === null) return
    const request = generation.current
    setMore(true); setError(null)
    try {
      const next = await searchSpotify(term, category, offset)
      if (request === generation.current) setResult(current => current ? { ...current, [category]: { ...next[category], items: mergeItems(current[category].items, next[category].items) } } : current)
    } catch (error) { if (request === generation.current) setError(errorMessage(error)) }
    finally { if (request === generation.current) setMore(false) }
  }
  function openTop(item: CatalogItem) {
    if (item.kind !== 'track') { onOpen(item.kind, item.id); return }
    if (!item.playable) return
    const queue = catalogTracks([item, ...(result?.tracks.items.filter(track => track.id !== item.id) ?? [])])
    if (queue.length) player.playQueue(`spotify:search:${term}`, queue, 0)
  }
  function changeCategory(value: SearchCategory) {
    if (category === value) return
    immediate.current = true
    setCategory(value)
    const scrollArea = mobileResults.current ?? page.current
    if (scrollArea) scrollArea.scrollTop = 0
  }
  function submitSearch() {
    immediate.current = true
    setRetry(value => value + 1)
  }
  const count = result ? result.tracks.items.length + result.artists.items.length + result.albums.items.length + result.playlists.items.length : 0
  const filters = <div className="search-filters" role="group" aria-label={t("Категории поиска")}>{categories.map(item => <button key={item.id} aria-pressed={category === item.id} onClick={() => changeCategory(item.id)}>{t(item.label)}</button>)}</div>
  const results = !term ? null
      : loading ? <MusicLoader label={t("Ищем музыку")} />
      : error && !result ? <div className="search-message" role="alert"><h2>{t("Поиск недоступен")}</h2><p>{error && t(error)}</p><Button variant="secondary" onClick={submitSearch}>{t("Попробовать снова")}</Button></div>
      : result && count === 0 ? <div className="search-message"><h2>{t("Ничего не найдено")}</h2><p>{t("Попробуйте другое название или имя исполнителя.")}</p></div>
      : result && <>
        {category === 'all' ? <>
          <div className="search-overview">{result.topResult && <section className="search-top"><h2>{t("Лучший результат")}</h2><button className="search-top-card" onClick={() => openTop(result.topResult!)} aria-label={t("Лучший результат: {0}", result.topResult.name)}><PlaylistCover className={result.topResult.kind === 'artist' ? 'search-top-avatar' : ''} url={result.topResult.imageUrl} name={result.topResult.name} /><strong>{result.topResult.name}</strong><span>{result.topResult.subtitle && `${result.topResult.subtitle} · `}{t(kindLabel(result.topResult))}</span><span className="search-top-action">{result.topResult.kind === 'track' && player.current?.spotifyId === result.topResult.id
            ? player.loading ? <MusicLoader variant="spinner" label={t("Загрузка трека")} /> : <Icon name={player.playing ? 'pause' : 'play'} />
            : <Icon name={result.topResult.kind === 'track' ? 'play' : 'chevron'} />}</span></button></section>}
            {result.tracks.items.length > 0 && <section className="search-songs"><div className="catalog-section-heading"><h2>{t("Песни")}</h2><button className="catalog-text-button" onClick={() => changeCategory('tracks')}>{t("Показать все")}</button></div><TrackList items={result.tracks.items.slice(0, 5)} queueItems={result.tracks.items} queueId={`spotify:search:${term}`} onOpen={onOpen} compact numbered={false} /></section>}
          </div>
          {(['artists', 'albums', 'playlists'] as const).map(group => result[group].items.length > 0 && <section key={group} className="catalog-section"><div className="catalog-section-heading"><h2>{t(categories.find(item => item.id === group)?.label ?? "")}</h2><button className="catalog-text-button" onClick={() => changeCategory(group)}>{t("Показать все")}</button></div><div className="catalog-grid">{result[group].items.slice(0, 12).map(item => <CatalogCard key={item.id} item={item} onOpen={onOpen} />)}</div></section>)}
        </> : <section className="search-category-results" aria-label={t(categories.find(item => item.id === category)?.label ?? "")}>
          {category === 'tracks' ? <TrackList items={result.tracks.items} queueId={`spotify:search:${term}`} onOpen={onOpen} showAlbum /> : <div className="catalog-grid">{result[category].items.map(item => <CatalogCard key={item.id} item={item} onOpen={onOpen} />)}</div>}
          {error && <p role="alert" className="search-inline-error">{error && t(error)}</p>}
          {result[category].nextOffset !== null && <div className="catalog-more"><Button variant="secondary" onClick={() => { void loadMore() }} disabled={more}>{more ? <MusicLoader label={t("Загружаем результаты")} variant="inline" /> : t("Показать ещё")}</Button></div>}
        </section>}
      </>
  return <main ref={page} className={`workspace search-page${mobileSearch ? ' search-page--mobile' : ''}`} aria-label={t("Поиск")}>
    {mobileSearch ? <>
      <div ref={mobileResults} className="search-mobile-results">
        <header className="search-header"><h1>{t("Поиск")}</h1></header>
        {results}
      </div>
      {filters}
    </> : <>
      <header className="search-header"><h1>{t("Поиск")}</h1><form className="catalog-search" role="search" onSubmit={event => { event.preventDefault(); input.current?.blur(); submitSearch() }}><Icon name="search" /><input ref={input} aria-label={t("Поиск в Spotify")} placeholder={t("Что хотите послушать?")} maxLength={180} value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label={t("Очистить поиск")} onClick={() => { setQuery(''); input.current?.focus() }}><Icon name="close" /></button>}</form></header>
      {filters}
      {results}
    </>}
  </main>
}
