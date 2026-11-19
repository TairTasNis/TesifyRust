import { useEffect } from 'react'

// Keyboard navigation stays immediate; pointer interactions get a short response.
export function useInputMode() {
  useEffect(() => {
    const root = document.documentElement
    const pointer = () => { root.dataset.input = 'pointer' }
    const keyboard = () => { root.dataset.input = 'keyboard' }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', keyboard, true)
    }
  }, [])
}

export function canAnimate() {
  return document.documentElement.dataset.input !== 'keyboard'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
