import { useLayoutEffect, useRef, useState } from 'react'
import { canAnimate } from '../shared/lib/motion'
import { routeKey } from './navigation'
import type { Route } from './navigation'

const distance = .72
const visible = 'translate3d(0, 0, 0)'
const offscreen = 'translate3d(100%, 0, 0)'
const slideDuration = 280

export function useRouteTransition(route: Route) {
  const surface = useRef<HTMLDivElement>(null)
  const motion = useRef<Animation | null>(null)
  const gesture = useRef(false)
  const closing = useRef(false)
  const entering = useRef(false)
  const [preview, setPreview] = useState<Route | null>(null)

  useLayoutEffect(() => {
    const node = surface.current
    if (entering.current) {
      entering.current = false
      if (node) slide(node, visible, slideDuration, () => reset(node), offscreen)
      else setPreview(null)
    }
    return () => {
      motion.current?.cancel()
      motion.current = null
      gesture.current = false
      closing.current = false
      if (node) clearStyle(node)
    }
  }, [route.page, route.playlistId])

  function clearStyle(node: HTMLDivElement) {
    node.style.removeProperty('transform')
    delete node.dataset.backMoving
    delete node.dataset.routeSliding
  }

  function reset(node: HTMLDivElement) {
    motion.current?.cancel()
    motion.current = null
    clearStyle(node)
    setPreview(null)
  }

  function slide(node: HTMLDivElement, to: string, duration: number, finish: () => void, from = getComputedStyle(node).transform) {
    motion.current?.cancel()
    const easing = getComputedStyle(node).getPropertyValue('--ease-drawer').trim()
    node.dataset.routeSliding = ''
    const animation = node.animate([{ transform: from }, { transform: to }], { duration, easing, fill: 'forwards' })
    motion.current = animation
    void animation.finished.then(() => { if (motion.current === animation) finish() }, () => {})
  }

  function open(animated = true) {
    entering.current = animated && canAnimate() && typeof surface.current?.animate === 'function'
    setPreview(entering.current ? route : null)
  }

  function start(destination: Route) {
    const node = surface.current
    if (!node || closing.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches || routeKey(destination) === routeKey(route)) return
    const current = getComputedStyle(node).transform
    motion.current?.cancel()
    motion.current = null
    node.style.transform = current
    node.dataset.backMoving = ''
    node.dataset.routeSliding = ''
    gesture.current = true
    setPreview(destination)
  }

  function progress(value: number) {
    const node = surface.current
    if (!node || !gesture.current) return
    node.style.transform = `translate3d(${Math.min(1, Math.max(0, value)) * distance * 100}%, 0, 0)`
  }

  function cancel() {
    const node = surface.current
    if (!node || !gesture.current) return
    gesture.current = false
    slide(node, visible, 230, () => reset(node))
  }

  function close(destination: Route, done: () => void) {
    const node = surface.current
    if (closing.current) return
    if (!node || typeof node.animate !== 'function' || (!gesture.current && !canAnimate()) || routeKey(destination) === routeKey(route)) { done(); return }
    closing.current = true
    gesture.current = false
    node.dataset.backMoving = ''
    setPreview(destination)
    const from = getComputedStyle(node).transform
    const offset = from === 'none' ? 0 : new DOMMatrixReadOnly(from).m41
    const remaining = Math.min(1, Math.max(0, 1 - offset / (node.offsetWidth || 1)))
    slide(node, offscreen, Math.round(145 + (slideDuration - 145) * remaining), done, from)
  }

  return { surface, preview, clearPreview: () => setPreview(null), open, start, progress, cancel, close }
}
