const parts = {
  mini: ['.mobile-mini-player-cover', '.mobile-mini-player-identity'],
  full: ['.now-playing-cover', '.now-playing-identity'],
}

export const playerTransitionMs = 240

export function measurePlayer(mode: keyof typeof parts) {
  const [coverSelector, identitySelector] = parts[mode]
  const source = document.querySelector('.player-artwork-transition') ?? document.querySelector(coverSelector)
  if (!source) return null

  const art = document.createElement('div')
  art.className = 'player-artwork-transition'
  art.setAttribute('aria-hidden', 'true')
  const style = getComputedStyle(source)
  art.style.backgroundColor = style.backgroundColor
  art.style.color = style.color
  const image = source.querySelector('canvas, img')
  if (image instanceof HTMLCanvasElement || (image instanceof HTMLImageElement && image.complete && image.naturalWidth)) {
    const width = image instanceof HTMLCanvasElement ? image.width : image.naturalWidth
    const height = image instanceof HTMLCanvasElement ? image.height : image.naturalHeight
    const square = Math.min(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = Math.min(512, square)
    canvas.getContext('2d')?.drawImage(image, (width - square) / 2, (height - square) / 2,
      square, square, 0, 0, canvas.width, canvas.height)
    art.append(canvas)
  } else {
    const fallback = source.querySelector('svg')
    if (fallback) art.append(fallback.cloneNode(true))
  }
  return {
    art, cover: source.getBoundingClientRect(),
    identity: document.querySelector(identitySelector)?.getBoundingClientRect(),
  }
}

export function movePlayer(from: NonNullable<ReturnType<typeof measurePlayer>>, mode: keyof typeof parts) {
  const [coverSelector, identitySelector] = parts[mode]
  const cover = document.querySelector<HTMLElement>(coverSelector)
  const identity = document.querySelector<HTMLElement>(identitySelector)
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()
  const titleMotion = identity && from.identity
    ? travel(identity, from.identity, identity.getBoundingClientRect(), 'height', easing) : null
  const target = cover?.getBoundingClientRect()
  if (!cover || !target?.width || !from.cover.width) return () => titleMotion?.cancel()

  const { art } = from
  Object.assign(art.style, {
    left: `${target.left}px`, top: `${target.top}px`,
    width: `${target.width}px`, height: `${target.height}px`,
    borderRadius: getComputedStyle(cover).borderRadius,
  })
  document.body.append(art)
  cover.dataset.moving = 'true'
  const artworkMotion = travel(art, from.cover, target, 'width', easing)
  const decoded = cover.querySelector('img')?.decode().catch(() => {})
  const finish = () => {
    if (!art.isConnected) return
    window.clearTimeout(deadline)
    art.remove()
    delete cover.dataset.moving
    artworkMotion?.cancel()
  }
  const deadline = window.setTimeout(finish, playerTransitionMs + 160)
  if (artworkMotion) void Promise.all([artworkMotion.finished, decoded]).then(finish, () => {})
  return () => {
    titleMotion?.cancel()
    finish()
  }
}

function travel(node: HTMLElement, source: DOMRect, target: DOMRect, axis: 'width' | 'height', easing: string) {
  if (!source[axis] || !target[axis]) return null
  const scale = source[axis] / target[axis]
  const x = source.left - target.left + (source.width - target.width * scale) / 2
  const y = source.top - target.top
  return node.animate([
    { transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], { duration: playerTransitionMs, easing, fill: axis === 'width' ? 'both' : 'none' })
}
