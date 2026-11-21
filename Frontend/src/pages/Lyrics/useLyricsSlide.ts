import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { canAnimate } from '../../shared/lib/motion'
import { playerMotionTiming, playerSlide } from '../../shared/playback/playerMotion'

export function useLyricsSlide(page: RefObject<HTMLElement | null>, mobile: boolean, shown: boolean, onExited?: () => void) {
  const current = useRef<Animation | null>(null)

  useLayoutEffect(() => () => {
    current.current?.cancel()
    current.current = null
  }, [])

  useLayoutEffect(() => {
    const node = page.current
    if (!mobile || !node) return
    const previous = current.current
    if (!canAnimate() || typeof node.animate !== 'function') {
      previous?.cancel()
      current.current = null
      if (!shown) onExited?.()
      return
    }

    const from = previous && previous.playState !== 'idle'
      ? getComputedStyle(node).transform
      : shown ? playerSlide.below : playerSlide.visible
    previous?.cancel()
    const slide = node.animate([
      { transform: from }, { transform: shown ? playerSlide.visible : playerSlide.below },
    ], playerMotionTiming(node))
    current.current = slide
    void slide.finished.then(() => {
      if (current.current !== slide) return
      if (shown) {
        slide.cancel()
        current.current = null
      } else {
        onExited?.()
      }
    }, () => { /* Reopening or unmounting can interrupt the slide. */ })
  }, [mobile, onExited, page, shown])
}
