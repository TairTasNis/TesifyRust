import { useMemo } from 'react'
import TrackList from '../../shared/catalog/TrackList/TrackList'
import { trackCatalogItem } from '../../shared/catalog/playback'
import type { OpenCatalog } from '../../shared/catalog/types'
import { downloadsQueueId, useDownloads } from '../../shared/playback/downloads/DownloadsProvider'
import { useTranslation } from '../../shared/preferences/i18n'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import '../Library/LibraryPage.css'
import './DownloadsPage.css'

export default function DownloadsPage({ onBack, onOpen }: { onBack: () => void; onOpen: OpenCatalog }) {
  const t = useTranslation()
  const { tracks, error, refresh } = useDownloads()
  const items = useMemo(() => tracks?.map(trackCatalogItem) ?? [], [tracks])
  return <main className="workspace library-page downloads-page" aria-label={t('Скачанные треки')}>
    <button type="button" className="downloads-back" onClick={onBack}><Icon name="back" />{t('Библиотека')}</button>
    <header className="library-header"><h1>{t('Скачанные треки')}</h1></header>
    {error ? <div className="library-message" role="alert"><h2>{t(error)}</h2><Button variant="secondary" onClick={() => { void refresh() }}>{t('Попробовать снова')}</Button></div>
      : !tracks ? <MusicLoader label={t('Загружаем треки')} />
      : tracks.length ? <TrackList items={items} queueId={downloadsQueueId} onOpen={onOpen} />
      : <div className="library-message"><Icon name="import" /><h2>{t('Скачанных треков пока нет')}</h2></div>}
  </main>
}
