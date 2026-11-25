import { memo } from 'react'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import { useLibrary } from './LibraryProvider'
import './Membership.css'

export default memo(function TrackPlaylistButton({ spotifyId, title, className = '' }: { spotifyId: string; title: string; className?: string }) {
  const t = useTranslation()
  const { choosePlaylists, index } = useLibrary()
  const saved = Boolean(index?.memberships[spotifyId]?.length)
  const label = saved ? t('Изменить плейлисты для «{0}»', title) : t('Добавить «{0}» в плейлист', title)
  return <button type="button" className={`library-plus ${className}`} title={label} aria-label={label} aria-haspopup="dialog"
    data-saved={saved || undefined} onClick={() => choosePlaylists({ spotifyId, title })}><span className="library-plus-badge" aria-hidden="true"><Icon name={saved ? 'check' : 'plus'} /></span></button>
})
