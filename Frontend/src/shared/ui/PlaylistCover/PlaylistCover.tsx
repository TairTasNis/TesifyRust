import { useState } from 'react'
import Icon from '../Icon/Icon'
import type { IconName } from '../Icon/Icon'
import './PlaylistCover.css'

type Props = { url?: string | null; name: string; className?: string; fallbackIcon?: IconName; eager?: boolean }

export default function PlaylistCover({ url, name, className = '', fallbackIcon = 'library', eager = false }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const tint = [...name].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % 4
  return (
    <div className={`playlist-cover playlist-cover--${tint} ${className}`}>
      {url && failedUrl !== url ? <img key={url} src={url} alt={name} loading={eager ? 'eager' : 'lazy'} data-loaded={loadedUrl === url || undefined} onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)} /> : <Icon name={fallbackIcon} />}
    </div>
  )
}
