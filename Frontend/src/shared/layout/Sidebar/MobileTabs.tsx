import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { flushSync } from 'react-dom'
import type { PageId } from '../../../app/navigation'
import { canAnimate } from '../../lib/motion'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import './MobileTabs.css'

const tabs = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'library', label: 'Библиотека', icon: 'library' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
] as const

export type MobileTabsMode = 'tabs' | 'compact' | 'search'
type Drag = { id: number; x: number; y: number; step: number; index: number; timer: number; active: boolean }

type Props = {
  activePage: PageId
  mode: MobileTabsMode
  query: string
  onMode: (mode: MobileTabsMode) => void
  onQuery: (query: string) => void
  onSubmit: () => void
  onNavigate: (page: PageId) => void
}

export default function MobileTabs({ activePage, mode, query, onMode, onQuery, onSubmit, onNavigate }: Props) {
  const t = useTranslation()
  const index = tabs.findIndex(tab => tab.id === activePage)
  const nav = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const lens = useRef<HTMLSpanElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const pulse = useRef<Animation | null>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [holding, setHolding] = useState(false)

  function moveLens(destination: number, animated = true) {
    const node = lens.current
    if (!node || destination < 0) return 0
    const target = `translateX(${destination * 100}%)`
    if (node.style.transform === target && animated) return 0
    const width = node.offsetWidth
    const matrix = getComputedStyle(node).transform
    const offset = matrix === 'none' || !width ? destination : new DOMMatrixReadOnly(matrix).m41 / width
    const distance = Math.abs(destination - offset)
    const duration = animated && canAnimate() && distance > .01 ? Math.min(280, 125 + distance * 45) : 0
    node.style.transitionDuration = `${duration}ms`
    node.style.transform = target
    return duration
  }

  function enlarge(duration: number) {
    const node = fill.current
    if (!node || !duration) return
    const from = getComputedStyle(node).transform
    pulse.current?.cancel()
    pulse.current = node.animate([
      { transform: from },
      { transform: 'scale(1.13, 1.1)', offset: .48 },
      { transform: 'scale(1)' },
    ], { duration: duration + 65, easing: getComputedStyle(node).getPropertyValue('--ease-out').trim() })
  }

  useLayoutEffect(() => { if (!drag.current?.active) moveLens(index) }, [index])
  useLayoutEffect(() => { if (mode !== 'search') input.current?.blur() }, [mode])
  useEffect(() => () => {
    if (drag.current) window.clearTimeout(drag.current.timer)
    pulse.current?.cancel()
  }, [])

  useEffect(() => {
    function outside(event: Event) {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) onMode('compact')
    }
    function playlistScroll(event: Event) {
      if (event.target instanceof Element && event.target.closest('.playlist-page')) onMode('compact')
    }
    document.addEventListener('click', outside, true)
    document.addEventListener('wheel', outside, { capture: true, passive: true })
    document.addEventListener('scroll', playlistScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('click', outside, true)
      document.removeEventListener('wheel', outside, true)
      document.removeEventListener('scroll', playlistScroll, true)
    }
  }, [onMode])

  function openSearch() {
    flushSync(() => {
      onNavigate('search')
      onMode('search')
    })
    input.current?.focus({ preventScroll: true })
  }

  function choose(item: number, animate = true) {
    const duration = moveLens(item)
    if (animate) enlarge(duration)
    const page = tabs[item].id
    if (page === 'search') openSearch()
    else {
      onMode('tabs')
      onNavigate(page)
    }
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, item: number) {
    if (drag.current || event.button !== 0 || !event.isPrimary) return
    suppressClick.current = false
    if (mode !== 'tabs' || !lens.current?.offsetWidth) return
    const { pointerId: id, clientX: x, clientY: y } = event
    const step = lens.current.offsetWidth
    event.currentTarget.setPointerCapture(id)
    const timer = window.setTimeout(() => {
      if (drag.current?.id !== id) return
      drag.current.active = true
      pulse.current?.cancel()
      setHolding(true)
      moveLens(item)
    }, 180)
    drag.current = { id, x, y, step, index: item, timer, active: false }
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const press = drag.current
    const node = lens.current
    if (!press || event.pointerId !== press.id || !node) return
    const delta = event.clientX - press.x
    if (!press.active) {
      if (Math.abs(event.clientY - press.y) > 12 || Math.abs(delta) > 14) {
        window.clearTimeout(press.timer)
        drag.current = null
        suppressClick.current = true
      }
      return
    }
    if (Math.abs(delta) < 2 && node.style.transitionDuration !== '0ms') return
    const position = press.index + delta / press.step
    const boundary = Math.max(0, Math.min(tabs.length - 1, position))
    const over = position - boundary
    node.style.transitionDuration = '0ms'
    node.style.transform = `translateX(${(boundary + over * .18 / (1 + Math.abs(over))) * 100}%)`
  }

  function finish(event: PointerEvent<HTMLButtonElement>, canceled: boolean) {
    const press = drag.current
    if (!press || press.id !== event.pointerId) return
    window.clearTimeout(press.timer)
    drag.current = null
    if (!press.active) return
    suppressClick.current = true
    setHolding(false)
    if (canceled) moveLens(index)
    else choose(Math.max(0, Math.min(tabs.length - 1, Math.round(press.index + (event.clientX - press.x) / press.step))), false)
  }

  return <nav ref={nav} className="mobile-tabs" data-mode={mode} data-holding={holding || undefined} aria-label={t('Основная навигация')}>
    <span className="mobile-tabs-track" aria-hidden="true" />
    <span ref={lens} className="mobile-tab-lens" hidden={index < 0} aria-hidden="true"><span ref={fill} /></span>
    {tabs.map(({ id, label, icon }, i) => {
      const side = id === 'home' || id === 'settings'
      return <button key={id} type="button" className={`mobile-tab mobile-tab--${id}`} aria-label={t(label)}
        aria-current={activePage === id ? 'page' : undefined} inert={mode === 'search' || (mode === 'compact' && !side)}
        onPointerDown={event => pointerDown(event, i)} onPointerMove={pointerMove} onPointerUp={event => finish(event, false)}
        onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
        onClick={event => { if (!suppressClick.current || !event.detail) choose(i); suppressClick.current = false }}>
        <Icon name={icon} />
      </button>
    })}

    <span className="mobile-search-glass" aria-hidden="true" />
    <button type="button" className="mobile-search-open" inert={mode !== 'compact'} aria-label={t('Поиск')} onClick={openSearch}>
      <Icon name="search" /><span>{query || t('Поиск')}</span>
    </button>
    <form className="mobile-search-form" role="search" inert={mode !== 'search'} onSubmit={event => {
      event.preventDefault()
      input.current?.blur()
      onSubmit()
      onMode('compact')
    }}>
      <Icon name="search" />
      <input ref={input} type="text" inputMode="search" enterKeyHint="search" autoComplete="off" maxLength={180} value={query}
        aria-label={t('Поиск в Spotify')} placeholder={t('Что хотите послушать?')} onChange={event => onQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onMode('compact') } }} />
      {query && <button type="button" aria-label={t('Очистить поиск')} onClick={() => { onQuery(''); input.current?.focus() }}><Icon name="trash" /></button>}
      <button type="button" aria-label={t('Закрыть поиск')} onClick={() => onMode('compact')}><Icon name="close" /></button>
    </form>
  </nav>
}
