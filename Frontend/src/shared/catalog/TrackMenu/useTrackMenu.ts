import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import type { Track } from '../../playlists/types'

const PRESS_MS = 500
const SCROLL_DISTANCE = 10

type MenuTrack = Track & { canSave?: boolean }
type Menu = { track: MenuTrack; x: number; y: number; touch: boolean }
type Press = { id: number; x: number; y: number; timer: number }

export function useTrackMenu(tracks: MenuTrack[]) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const press = useRef<Press | null>(null)
  const held = useRef(false)
  const releaseGuard = useRef<(() => void) | null>(null)
  const selected = tracks.filter(track => selection.has(track.id))
  const all = tracks.length > 0 && selected.length === tracks.length

  function cancelPress() {
    if (!press.current) return
    window.clearTimeout(press.current.timer)
    press.current = null
  }

  useEffect(() => () => { cancelPress(); releaseGuard.current?.() }, [])

  function openTouchMenu(track: MenuTrack, x: number, y: number) {
    releaseGuard.current?.()
    // The original touch can end over the dialog after it appears. Ignore that click.
    const clear = () => {
      document.removeEventListener('pointerdown', clear, true)
      document.removeEventListener('click', suppress, true)
      releaseGuard.current = null
    }
    const suppress = (event: globalThis.MouseEvent) => {
      if (event.detail === 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      clear()
    }
    document.addEventListener('pointerdown', clear, true)
    document.addEventListener('click', suppress, true)
    releaseGuard.current = clear
    held.current = true
    setMenu({ track, x, y, touch: true })
  }

  function clearSelection() {
    setSelection(new Set())
    setSelecting(false)
  }

  useEffect(() => {
    if (!selecting) return
    function clear(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !menu && !document.querySelector('dialog[open]')) clearSelection()
    }
    function back(event: Event) {
      if (menu || document.querySelector('dialog[open]')) return
      event.preventDefault()
      clearSelection()
    }
    window.addEventListener('keydown', clear)
    window.addEventListener('tesify:back', back, true)
    return () => {
      window.removeEventListener('keydown', clear)
      window.removeEventListener('tesify:back', back, true)
    }
  }, [menu, selecting])

  function row(track: MenuTrack) {
    return {
      'data-selected': selection.has(track.id) || undefined,
      onContextMenu(event: MouseEvent<HTMLTableRowElement>) {
        event.preventDefault()
        cancelPress()
        if (held.current) return
        const bounds = event.currentTarget.getBoundingClientRect()
        const touch = event.nativeEvent instanceof globalThis.PointerEvent && event.nativeEvent.pointerType === 'touch'
        const x = event.clientX || bounds.left + 16, y = event.clientY || bounds.top
        if (touch) openTouchMenu(track, x, y)
        else setMenu({ track, x, y, touch: false })
      },
      onPointerDown(event: PointerEvent<HTMLTableRowElement>) {
        held.current = false
        cancelPress()
        if (event.pointerType === 'mouse' || !event.isPrimary) return
        const { pointerId: id, clientX: x, clientY: y } = event
        const timer = window.setTimeout(() => openTouchMenu(track, x, y), PRESS_MS)
        press.current = { id, x, y, timer }
      },
      onPointerMove(event: PointerEvent<HTMLTableRowElement>) {
        const start = press.current
        if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SCROLL_DISTANCE) cancelPress()
      },
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onPointerLeave: cancelPress,
      onClickCapture(event: MouseEvent<HTMLTableRowElement>) {
        if (held.current) {
          held.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (!selecting && !event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        event.stopPropagation()
        const next = new Set(selected.map(item => item.id))
        if (!next.delete(track.id)) next.add(track.id)
        setSelection(next)
        setSelecting(true)
      },
    }
  }

  return {
    row, menu, all, selected, selecting: selecting && tracks.length > 0,
    targets: menu && (selection.has(menu.track.id) ? selected : [menu.track]),
    close: () => setMenu(null),
    clear: clearSelection,
    start: () => {
      if (menu) setSelection(new Set([menu.track.id]))
      setSelecting(true)
      setMenu(null)
    },
    toggleAll: () => {
      setSelection(new Set(all ? [] : tracks.map(track => track.id)))
      setSelecting(true)
    },
  }
}
