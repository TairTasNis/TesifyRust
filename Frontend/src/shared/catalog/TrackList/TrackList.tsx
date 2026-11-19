import { useTranslation } from '../../preferences/i18n'
import { useMemo } from 'react'
import { usePlayback } from '../../playback/PlaybackProvider'
import { formatAddedDate, formatDuration } from '../../playlists/format'
import Icon from '../../ui/Icon/Icon'
import MusicLoader from '../../ui/MusicLoader/MusicLoader'
import PlaylistCover from '../../ui/PlaylistCover/PlaylistCover'
import PlaybackIndicator from '../../ui/PlaybackIndicator/PlaybackIndicator'
import ArtistLinks from '../ArtistLinks/ArtistLinks'
import { catalogTracks } from '../playback'
import { number } from '../types'
import type { CatalogItem, OpenCatalog } from '../types'
import './TrackList.css'
type Props = { items: CatalogItem[]; queueItems?: CatalogItem[]; queueId: string; onOpen: OpenCatalog; compact?: boolean; showAlbum?: boolean; showPlays?: boolean; showAdded?: boolean; numbered?: boolean }
export default function TrackList({ items, queueItems, queueId, onOpen, compact = false, showAlbum = false, showPlays = false, showAdded = false, numbered = true }: Props) {
  const t = useTranslation()
  const player = usePlayback()
  const queue = useMemo(() => catalogTracks(queueItems ?? items), [queueItems, items])
  function play(item: CatalogItem) { const index = queue.findIndex(track => track.id === item.id); if (index >= 0) player.playQueue(queueId, queue, index) }
  return <div className={`catalog-track-list${compact ? ' catalog-track-list--compact' : ''}`}><table><colgroup>{numbered && <col className="catalog-track-number" />}<col />{showAlbum && <col className="catalog-track-album" />}{showPlays && <col className="catalog-track-plays" />}{showAdded && <col className="catalog-track-added" />}<col className="catalog-track-time" /></colgroup><thead hidden={compact}><tr>{numbered && <th className="catalog-track-number">#</th>}<th>{t("Название")}</th>{showAlbum && <th className="catalog-track-album">{t("Альбом")}</th>}{showPlays && <th className="catalog-track-plays">{t("Прослушивания")}</th>}{showAdded && <th className="catalog-track-added">{t("Добавлено")}</th>}<th className="catalog-track-time"><Icon name="clock" /><span className="visually-hidden">{t("Длительность")}</span></th></tr></thead>
    <tbody>{items.map((item, index) => {
      const active = player.current?.spotifyId === item.id
      const loading = active && player.loading
      const indicator = loading ? <MusicLoader variant="spinner" label={t("Загрузка трека")} />
        : active ? <PlaybackIndicator playing={player.playing && !player.error} /> : null
      return <tr key={`${item.id}:${index}`} data-active={active || undefined} data-unavailable={!item.playable || undefined}>
        {numbered && <td className="catalog-track-number" onClick={() => { if (item.playable) play(item) }}><span className="catalog-track-index">{index + 1}</span>{indicator}{!loading && <Icon name={active && player.playing ? 'pause' : 'play'} />}</td>}
        <td><div className="catalog-track-title"><button className="catalog-track-cover" disabled={!item.playable} onClick={() => play(item)} aria-label={`${active && player.playing ? t("Пауза") : t("Воспроизвести")}: ${item.name}`}><PlaylistCover url={item.imageUrl} name={item.name} />{!numbered && <>{indicator && <span className="catalog-cover-playing">{indicator}</span>}{!loading && <Icon name={active && player.playing ? 'pause' : 'play'} />}</>}</button><div><button className="catalog-track-name" disabled={!item.playable} onClick={() => play(item)}>{item.name}</button><ArtistLinks artists={item.artists} fallback={item.subtitle} onOpen={onOpen} /></div></div></td>
        {showAlbum && <td className="catalog-track-album">{item.albumId && <button className="catalog-inline-link" onClick={() => onOpen('album', item.albumId!)}>{item.albumName || t("Альбом")}</button>}</td>}
        {showPlays && <td className="catalog-track-plays">{item.playCount !== null ? number(item.playCount) : '—'}</td>}
        {showAdded && <td className="catalog-track-added">{item.addedAt !== null ? formatAddedDate(item.addedAt) : '—'}</td>}
        <td className="catalog-track-time">{formatDuration(item.durationMs)}</td>
      </tr>
    })}</tbody></table></div>
}
