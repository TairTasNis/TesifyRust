export const playerSlide = {
  below: 'translate3d(0, 100%, 0)',
  visible: 'translate3d(0, 0, 0)',
}

export function playerMotionTiming(page: HTMLElement) {
  return {
    duration: 480,
    easing: getComputedStyle(page).getPropertyValue('--ease-drawer').trim(),
    fill: 'both' as const,
  }
}
