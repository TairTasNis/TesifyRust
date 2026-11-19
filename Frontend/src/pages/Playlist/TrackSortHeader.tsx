import { useTranslation } from '../../shared/preferences/i18n'
import type { ReactNode } from 'react'
import Icon from '../../shared/ui/Icon/Icon'
import type { TrackSort, TrackSortKey } from './sorting'

type Props = { column: TrackSortKey; label: string; sort: TrackSort | null; onSort: (key: TrackSortKey) => void; className?: string; children?: ReactNode }

export default function TrackSortHeader({ column, label, sort, onSort, className = '', children }: Props) {
  const t = useTranslation()
  const direction = sort?.key === column ? sort.direction : 'none'
  return <th scope="col" className={className} aria-sort={direction}>
    <button className="track-sort" type="button" onClick={() => onSort(column)} aria-label={t("Сортировать: {0}", label)}>
      {children ?? label}<Icon className="track-sort-arrow" name="sort-up" data-direction={direction} />
    </button>
  </th>
}
