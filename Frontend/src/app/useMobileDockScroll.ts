import { useLayoutEffect, useState } from 'react'

export function useMobileDockScroll(route: string, enabled: boolean) {
  const [hidden, setHidden] = useState(false)

  useLayoutEffect(() => {
    setHidden(false)
    if (!enabled) return
    let area = document.querySelector<HTMLElement>('.route-surface:not([inert]) [data-dock-scroll]')
    let previous = area?.scrollTop ?? 0
    let previousLimit = area ? Math.max(0, area.scrollHeight - area.clientHeight) : 0
    let distance = 0

    function scroll(event: Event) {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.matches('[data-dock-scroll]') || target.closest('[inert]')) return
      const limit = Math.max(0, target.scrollHeight - target.clientHeight)
      const position = Math.max(0, Math.min(target.scrollTop, limit))
      if (target !== area) {
        area = target
        previous = 0
        previousLimit = limit
        distance = 0
      }
      const delta = position - previous
      const clamped = limit < previousLimit && position === limit
      previous = position
      previousLimit = limit
      if (target.closest('.route-surface')?.querySelector('.track-selection')) {
        showDock()
        return
      }
      if (position <= 2) { distance = 0; setHidden(false); return }
      if (!delta || clamped) return
      distance = Math.sign(delta) === Math.sign(distance) ? distance + delta : delta
      if (distance >= 26) { setHidden(true); distance = 0 }
      else if (distance <= -10) { setHidden(false); distance = 0 }
    }

    function showDock() {
      distance = 0
      setHidden(false)
    }
    document.addEventListener('scroll', scroll, { capture: true, passive: true })
    window.addEventListener('tesify:track-selection', showDock)
    return () => {
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('tesify:track-selection', showDock)
    }
  }, [route, enabled])

  return enabled && hidden
}
