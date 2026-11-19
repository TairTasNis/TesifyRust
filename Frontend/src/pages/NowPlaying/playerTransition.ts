const parts = {
  mini: ['.mobile-mini-player-cover', '.mobile-mini-player-identity'],
  full: ['.now-playing-cover', '.now-playing-identity'],
}

export const playerTransitionMs = 240

export function measurePlayer(mode: keyof typeof parts) {
  return parts[mode].map(selector => document.querySelector(selector)?.getBoundingClientRect())
}

export function movePlayer(from: ReturnType<typeof measurePlayer>, mode: keyof typeof parts) {
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-drawer').trim()
  const animations: Animation[] = []
  parts[mode].forEach((selector, index) => {
    const node = document.querySelector<HTMLElement>(selector)
    const source = from[index]
    if (!source || !node) return
    const target = node.getBoundingClientRect()
    if (!source.width || !target.width || !target.height) return
    const scale = index === 0 ? source.width / target.width : source.height / target.height
    const x = source.left - target.left + (source.width - target.width * scale) / 2
    animations.push(node.animate([
      { transform: `translate(${x}px, ${source.top - target.top}px) scale(${scale})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: playerTransitionMs, easing }))
  })
  return animations
}
