import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { canAnimate } from '../../shared/lib/motion'
import { playerMotionTiming, playerSlide } from '../../shared/playback/playerMotion'

type PartKind = 'artwork' | 'text' | 'button'
const sharedParts = [
  { mini: '.mobile-mini-player-cover', full: '.now-playing-cover', kind: 'artwork' },
  { mini: '.mobile-mini-player-identity > strong', full: '.now-playing-identity > h1', kind: 'text' },
  { mini: '.mobile-mini-player-identity > span', full: '.now-playing-identity > .catalog-artist-links', kind: 'text' },
  { mini: '.mobile-mini-player-toggle', full: '.now-playing-play', kind: 'button' },
] as const

export function usePlayerTransition(page: RefObject<HTMLElement | null>, shown: boolean, covered: boolean, trackId?: string) {
  const previous = useRef({ shown, covered, trackId })
  const motion = useRef<ReturnType<typeof movePlayer>>(null)

  useLayoutEffect(() => {
    function stop() {
      motion.current?.finish()
      motion.current = null
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.addEventListener('change', stop)
    window.addEventListener('resize', stop)
    return () => {
      reducedMotion.removeEventListener('change', stop)
      window.removeEventListener('resize', stop)
      stop()
    }
  }, [])

  useLayoutEffect(() => {
    const from = previous.current
    previous.current = { shown, covered, trackId }
    if (!page.current || covered || from.covered || from.trackId !== trackId || !canAnimate()) {
      motion.current?.finish()
      motion.current = null
      return
    }
    if (from.shown === shown) return
    if (motion.current) {
      if (!motion.current.reverse()) {
        motion.current.finish()
        motion.current = null
      }
      return
    }

    const movement = movePlayer(page.current, shown)
    if (!movement) return
    motion.current = movement
    void movement.done.then(() => {
      if (motion.current === movement) {
        movement.finish()
        motion.current = null
      }
    }, () => { /* A resize or change of track can cancel the transition. */ })
  }, [page, shown, covered, trackId])
}

function movePlayer(page: HTMLElement, opening: boolean) {
  const miniPlayer = document.querySelector('#mobile-mini-player:not([data-lyrics])')
  if (!miniPlayer || typeof page.animate !== 'function') return null

  const timing = playerMotionTiming(page)
  const layers = sharedParts.flatMap(({ mini, full, kind }) => {
    const compact = measure(miniPlayer.querySelector<HTMLElement>(mini), kind)
    const expanded = measure(page.querySelector<HTMLElement>(full), kind)
    if (!compact || !expanded) return []
    return [
      { original: compact, other: expanded, compact: true },
      { original: expanded, other: compact, compact: false },
    ]
  })

  const overlay = document.createElement('div')
  overlay.className = 'player-transition-layer'
  overlay.inert = true
  overlay.setAttribute('aria-hidden', 'true')
  const copies = layers.map(layer => ({ ...layer, copy: makeCopy(layer.original) }))
  overlay.append(...copies.map(({ copy }) => copy))
  const animations: Animation[] = []
  function animate(node: HTMLElement, frames: Keyframe[], curve = 'linear') {
    animations.push(node.animate(opening ? frames : frames.slice().reverse().map(frame => ({
      ...frame, offset: typeof frame.offset === 'number' ? 1 - frame.offset : undefined,
    })), { ...timing, easing: curve }))
  }

  document.body.append(overlay)
  page.dataset.transitioning = ''
  animate(page, [{ transform: playerSlide.below }, { transform: playerSlide.visible }], timing.easing)

  for (const { original, other, compact, copy } of copies) {
    original.node.dataset.playerMoving = ''
    const projected = `translate3d(${other.x - original.x}px, ${other.y - original.y}px, 0) scale(${other.size / original.size})`
    const native = 'translate3d(0, 0, 0) scale(1)'
    animate(copy, compact ? [{ transform: native }, { transform: projected }] : [{ transform: projected }, { transform: native }], timing.easing)
    // Keep a solid surface as the cover and play button change size and shape.
    const compactFade = original.kind === 'text' ? .16 : .36
    const expandedFade = original.kind === 'text' ? .46 : .36
    animate(copy, compact
      ? [{ opacity: 1 }, { opacity: 1, offset: compactFade }, { opacity: 0, offset: .52 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0, offset: .10 }, { opacity: 1, offset: expandedFade }, { opacity: 1 }])
  }

  return {
    done: Promise.all(animations.map(animation => animation.finished)),
    reverse() {
      const lead = animations[0]
      const time = lead.currentTime
      // If no frame was painted, the original layout is already the right endpoint.
      if (time === null || (lead.playbackRate > 0 ? time === 0 : time === timing.duration)) return false
      for (const animation of animations) animation.reverse()
      return true
    },
    finish() {
      overlay.remove()
      delete page.dataset.transitioning
      for (const { original } of layers) delete original.node.dataset.playerMoving
      for (const animation of animations) animation.cancel()
    },
  }
}

function measure(node: HTMLElement | null, kind: PartKind) {
  if (!node) return null
  const bounds = node.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return null
  let x = bounds.left + bounds.width / 2
  if (kind === 'text') {
    const content = document.createRange()
    content.selectNodeContents(node)
    const text = content.getBoundingClientRect()
    // The mini player may clip a long title with an ellipsis.
    x = (Math.max(bounds.left, text.left) + Math.min(bounds.right, text.right)) / 2
  }
  const style = getComputedStyle(node)
  const size = kind === 'text' ? Number.parseFloat(style.fontSize) : bounds.width
  if (!size) return null
  return { node, bounds, x, y: bounds.top + bounds.height / 2, size, kind, style }
}

function makeCopy({ node, bounds, x, kind, style }: NonNullable<ReturnType<typeof measure>>) {
  const copy = node.cloneNode(true) as HTMLElement
  Object.assign(copy.style, {
    position: 'absolute', margin: '0', maxWidth: 'none',
    left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`,
    transformOrigin: `${x - bounds.left}px 50%`,
  })
  if (kind === 'artwork') {
    copy.style.borderRadius = style.borderRadius
    copy.style.boxShadow = style.boxShadow
  } else if (kind === 'button') {
    Object.assign(copy.style, {
      display: 'grid', placeItems: 'center', padding: '0', border: '0', borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor, color: style.color,
    })
  } else {
    Object.assign(copy.style, {
      display: 'block', fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight,
      color: style.color, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
      textAlign: style.textAlign, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace,
      overflow: style.overflow, overflowWrap: style.overflowWrap,
    })
  }
  return copy
}
