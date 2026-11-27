import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import './PlaylistHeader.css'

export default function PlaylistHeader({ title, heading, onBack }: {
  title: string; heading: RefObject<HTMLHeadingElement | null>; onBack: () => void
}) {
  const t = useTranslation()
  const bar = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const node = heading.current
    const root = bar.current?.closest('.workspace')
    if (!node || !root) return
    const observer = new IntersectionObserver(([entry]) => {
      setPinned(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0))
    }, { root, rootMargin: '-48px 0px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [heading, title])

  return <div className="playlist-sticky" ref={bar} data-pinned={pinned} inert={!pinned}>
    <div className="playlist-sticky-bar">
      <button type="button" aria-label={t('Назад')} onClick={onBack}><Icon name="back" /></button>
      <strong title={title}>{title}</strong>
    </div>
  </div>
}
