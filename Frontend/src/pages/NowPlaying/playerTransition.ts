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
  const parts = sharedParts.flatMap(({ mini, full, kind }) => {
    const compact = measure(miniPlayer.querySelector<HTMLElement>(mini), kind)
    const expanded = measure(page.querySelector<HTMLElement>(full), kind)
    if (!compact || !expanded) return []
    const crossfade = kind !== 'text' || expanded.bounds.height > Number.parseFloat(expanded.style.lineHeight) * 1.5
    return [{ compact, expanded, crossfade }]
  })

  const overlay = document.createElement('div')
  overlay.className = 'player-transition-layer'
  overlay.inert = true
  overlay.setAttribute('aria-hidden', 'true')
  const animations: Animation[] = []
  function animate(node: HTMLElement, frames: Keyframe[], curve = 'linear') {
    animations.push(node.animate(opening ? frames : frames.slice().reverse().map(frame => ({
      ...frame, offset: typeof frame.offset === 'number' ? 1 - frame.offset : undefined,
    })), { ...timing, easing: curve }))
  }

  document.body.append(overlay)
  page.dataset.transitioning = ''
  animate(page, [{ transform: playerSlide.below }, { transform: playerSlide.visible }], timing.easing)

  function crossfadeCopy(original: Part, other: Part, compact: boolean) {
    const copy = makeCopy(original)
    overlay.append(copy)
    const projected = `translate3d(${other.x - original.x}px, ${other.y - original.y}px, 0) scale(${other.size / original.size})`
    const native = 'translate3d(0, 0, 0) scale(1)'
    const nativeFrames = [{ transform: native }, { transform: projected }]
    animate(copy, compact ? nativeFrames : nativeFrames.reverse(), timing.easing)
    if (original.kind === 'text') {
      // Keep the lower text opaque until the copy above it has fully appeared.
      animate(copy, compact
        ? [{ opacity: 1 }, { opacity: 1, offset: .50 }, { opacity: 0, offset: .52 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 0, offset: .23 }, { opacity: 1, offset: .50 }, { opacity: 1 }])
      return
    }
    // Keep a solid surface as the cover and play button change size and shape.
    animate(copy, compact
      ? [{ opacity: 1 }, { opacity: 1, offset: .36 }, { opacity: 0, offset: .52 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0, offset: .10 }, { opacity: 1, offset: .36 }, { opacity: 1 }])
  }

  for (const { compact, expanded, crossfade } of parts) {
    compact.node.dataset.playerMoving = ''
    expanded.node.dataset.playerMoving = ''
    if (crossfade) {
      crossfadeCopy(compact, expanded, true)
      crossfadeCopy(expanded, compact, false)
    } else {
      // Single-line text travels above the sliding page and stays opaque throughout.
      const copy = makeCopy(expanded)
      overlay.append(copy)
      animate(copy, sharedTextFrames(copy, expanded, compact), timing.easing)
    }
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
      for (const { compact, expanded } of parts) {
        delete compact.node.dataset.playerMoving
        delete expanded.node.dataset.playerMoving
      }
      for (const animation of animations) animation.cancel()
    },
  }
}

function measure(node: HTMLElement | null, kind: PartKind) {
  if (!node) return null
  const bounds = node.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return null
  let x = bounds.left + bounds.width / 2
  let textBounds = bounds
  if (kind === 'text') {
    const content = document.createRange()
    content.selectNodeContents(node)
    textBounds = content.getBoundingClientRect()
    // The mini player may clip a long title with an ellipsis.
    x = (Math.max(bounds.left, textBounds.left) + Math.min(bounds.right, textBounds.right)) / 2
  }
  const style = getComputedStyle(node)
  const size = kind === 'text' ? Number.parseFloat(style.fontSize) : bounds.width
  if (!size) return null
  return { node, bounds, textBounds, x, y: bounds.top + bounds.height / 2, size, kind, style }
}

type Part = NonNullable<ReturnType<typeof measure>>

function sharedTextFrames(copy: HTMLElement, expanded: Part, compact: Part): Keyframe[] {
  const rtl = compact.style.direction === 'rtl'
  const fullX = rtl ? expanded.textBounds.right : expanded.textBounds.left
  const miniX = rtl ? compact.textBounds.right : compact.textBounds.left
  const fullY = expanded.textBounds.top + expanded.textBounds.height / 2
  const miniY = compact.textBounds.top + compact.textBounds.height / 2
  const sizeRatio = compact.size / expanded.size
  // Match the width of the mini player's glyph run, including its letter spacing.
  const widthRatio = compact.textBounds.width > 0 && expanded.textBounds.width > 0
    ? compact.textBounds.width / expanded.textBounds.width : sizeRatio
  const originX = fullX - expanded.bounds.left
  copy.style.transformOrigin = `${originX}px ${fullY - expanded.bounds.top}px`
  const small: Keyframe = { transform: `translate3d(${miniX - fullX}px, ${miniY - fullY}px, 0) scale(${widthRatio}, ${sizeRatio})` }
  const full: Keyframe = { transform: 'translate3d(0, 0, 0) scale(1, 1)' }
  if (compact.textBounds.width > compact.bounds.width) {
    // The mini player can truncate a line that fits in fullscreen.
    const left = Math.max(0, originX + (compact.bounds.left - miniX) / widthRatio)
    const right = Math.max(0, expanded.bounds.width - originX - (compact.bounds.right - miniX) / widthRatio)
    small.clipPath = `inset(0px ${right}px 0px ${left}px)`
    full.clipPath = 'inset(0px)'
  }
  return [small, full]
}

function makeCopy({ node, bounds, x, kind, style }: Part) {
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
      overflow: style.overflow, overflowWrap: style.overflowWrap, direction: style.direction,
    })
  }
  return copy
}
