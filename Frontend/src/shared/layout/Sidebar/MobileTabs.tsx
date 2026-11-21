import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { PageId } from '../../../app/navigation'
import { canAnimate } from '../../lib/motion'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import type { IconName } from '../../ui/Icon/Icon'
import './MobileTabs.css'

type Tab = { id: PageId; label: string; icon: IconName }
type Drag = { id: number; x: number; y: number; step: number; index: number; timer: number; active: boolean }

export default function MobileTabs({ tabs, activePage, onNavigate }: {
  tabs: Tab[]; activePage: PageId; onNavigate: (page: PageId) => void
}) {
  const t = useTranslation()
  const index = tabs.findIndex(tab => tab.id === activePage)
  const lens = useRef<HTMLSpanElement>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)

  function settle(destination: number, animated = true) {
    const node = lens.current
    if (!node || destination < 0) return
    const width = node.offsetWidth
    const matrix = getComputedStyle(node).transform
    const offset = matrix === 'none' || !width ? destination : new DOMMatrixReadOnly(matrix).m41 / width
    const distance = Math.abs(destination - offset)
    node.style.transitionDuration = animated && canAnimate() && distance > .01 ? `${Math.min(280, 125 + distance * 45)}ms` : '0ms'
    node.style.transform = `translateX(${destination * 100}%)`
  }

  useLayoutEffect(() => { if (!drag.current?.active) settle(index) }, [index])
  useEffect(() => () => { if (drag.current) window.clearTimeout(drag.current.timer) }, [])

  function pointerDown(event: PointerEvent<HTMLButtonElement>, item: number) {
    if (drag.current || event.button !== 0 || !event.isPrimary) return
    suppressClick.current = false
    if (item !== index || !lens.current?.offsetWidth) return
    const { pointerId: id, clientX: x, clientY: y } = event
    const step = lens.current.offsetWidth
    event.currentTarget.setPointerCapture(id)
    const timer = window.setTimeout(() => {
      if (drag.current?.id !== id) return
      drag.current.active = true
      setDragging(true)
      settle(index, false)
    }, 180)
    drag.current = { id, x, y, step, index, timer, active: false }
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
    const position = press.index + delta / press.step
    const boundary = Math.max(0, Math.min(tabs.length - 1, position))
    const over = position - boundary
    const resisted = boundary + over * .18 / (1 + Math.abs(over))
    node.style.transform = `translateX(${resisted * 100}%)`
  }

  function finish(event: PointerEvent<HTMLButtonElement>, canceled: boolean) {
    const press = drag.current
    if (!press || press.id !== event.pointerId) return
    window.clearTimeout(press.timer)
    drag.current = null
    if (!press.active) return
    suppressClick.current = true
    setDragging(false)
    const destination = canceled ? index : Math.max(0, Math.min(tabs.length - 1, Math.round(press.index + (event.clientX - press.x) / press.step)))
    settle(destination)
    if (destination !== index) onNavigate(tabs[destination].id)
  }

  return <nav className="mobile-tabs" data-dragging={dragging || undefined} aria-label={t('Основная навигация')}>
    <span ref={lens} className="mobile-tab-lens" hidden={index < 0} aria-hidden="true" />
    {tabs.map(({ id, label, icon }, i) => <button key={id} type="button" className="mobile-tab" aria-label={t(label)} aria-current={activePage === id ? 'page' : undefined}
      onPointerDown={event => pointerDown(event, i)} onPointerMove={pointerMove} onPointerUp={event => finish(event, false)}
      onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
      onClick={event => { if (!suppressClick.current || !event.detail) onNavigate(id); suppressClick.current = false }}>
      <Icon name={icon} />
    </button>)}
  </nav>
}
