import { useTranslation } from '../../preferences/i18n'
import PlaylistCover from '../../ui/PlaylistCover/PlaylistCover'
import { kindLabel } from '../types'
import type { CatalogItem, OpenCatalog } from '../types'
import './CatalogCard.css'
export default function CatalogCard({ item, onOpen }: { item: CatalogItem; onOpen: OpenCatalog }) {
  const t = useTranslation()
  return <button className={`catalog-card catalog-card--${item.kind}`} type="button" onClick={() => { if (item.kind !== 'track') onOpen(item.kind, item.id) }} aria-label={`${t(kindLabel(item))}: ${item.name}`}>
    <PlaylistCover url={item.imageUrl} name={item.name} fallbackIcon={item.kind === 'artist' ? 'artist' : 'library'} />
    <strong>{item.name}</strong><span>{item.kind === 'artist' ? t("Исполнитель") : item.kind === 'album' ? [item.year, item.subtitle || t(kindLabel(item))].filter(Boolean).join(' · ') : item.subtitle || t("Плейлист")}</span>
  </button>
}
