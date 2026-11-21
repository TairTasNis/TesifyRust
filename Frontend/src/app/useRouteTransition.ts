import { useLayoutEffect, useRef, useState } from 'react'
import { canAnimate } from '../shared/lib/motion'
import { routeKey } from './navigation'
import type { Route } from './navigation'

const distance = .72

export function useRouteTransition(route: Route) {
  const surface = useRef<HTMLDivElement>(null)
  const motion = useRef<Animation | null>(null)
  const gesture = useRef(false)
  const closing = useRef(false)
  const [preview, setPreview] = useState<Route | null>(null)

  useLayoutEffect(() => {
    const node = surface.current
    if (node) {
      node.style.removeProperty('transform')
      delete node.dataset.backMoving
    }
    return () => { motion.current?.cancel(); motion.current = null; gesture.current = false; closing.current = false }
  }, [route.page, route.playlistId])

  function slide(node: HTMLDivElement, to: string, duration: number, finish: () => void) {
    const from = getComputedStyle(node).transform
    motion.current?.cancel()
    const easing = getComputedStyle(node).getPropertyValue('--ease-out').trim()
    const animation = node.animate([{ transform: from }, { transform: to }], { duration, easing, fill: 'forwards' })
    motion.current = animation
    void animation.finished.then(() => { if (motion.current === animation) finish() }, () => {})
  }

  function start(destination: Route) {
    const node = surface.current
    if (!node || closing.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches || routeKey(destination) === routeKey(route)) return
    const current = getComputedStyle(node).transform
    motion.current?.cancel()
    motion.current = null
    node.style.transform = current
    node.dataset.backMoving = ''
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
    slide(node, 'translate3d(0, 0, 0)', 200, () => {
      node.style.removeProperty('transform')
      delete node.dataset.backMoving
      motion.current?.cancel()
      motion.current = null
      setPreview(null)
    })
  }

  function close(destination: Route, done: () => void) {
    const node = surface.current
    if (closing.current) return
    if (!node || (!gesture.current && !canAnimate()) || routeKey(destination) === routeKey(route)) { done(); return }
    closing.current = true
    gesture.current = false
    node.dataset.backMoving = ''
    setPreview(destination)
    slide(node, 'translate3d(100%, 0, 0)', 230, done)
  }

  return { surface, preview, clearPreview: () => setPreview(null), start, progress, cancel, close }
}
