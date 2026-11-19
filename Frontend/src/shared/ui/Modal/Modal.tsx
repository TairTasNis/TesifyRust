import { useTranslation } from '../../preferences/i18n'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { canAnimate } from '../../lib/motion'
import Icon from '../Icon/Icon'
import './Modal.css'

type Props = { title: string; subtitle?: string; children: ReactNode | ((close: () => void) => ReactNode); onClose: () => void; busy?: boolean; wide?: boolean }

export default function Modal({ title, subtitle, children, onClose, busy = false, wide = false }: Props) {
  const t = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  const [closing, setClosing] = useState(false)
  const id = useId()
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const dialog = ref.current
    const previousFocus = document.activeElement
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
    return () => {
      dialog?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !document.querySelector('dialog[open]')) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!closing) return
    const dialog = ref.current
    if (!dialog) return
    let active = true
    const finish = () => { if (active) { active = false; onCloseRef.current() } }
    // CSS transitions retarget from the current position if entry is interrupted.
    const transitions = dialog.getAnimations()
    void Promise.all(transitions.map((animation) => animation.finished.catch(() => {}))).then(finish)
    const timeout = window.setTimeout(finish, 290)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [closing])

  function close() {
    if (busy || closing) return
    if (canAnimate()) setClosing(true)
    else onClose()
  }

  return (
    <dialog ref={ref} className={`modal-dialog${wide ? ' modal-dialog--wide' : ''}`} aria-labelledby={id} data-closing={closing || undefined}
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="modal-panel" inert={closing}>
        <header className="modal-header">
          <div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="modal-close" type="button" aria-label={t("Закрыть окно")} onClick={close} disabled={busy}><Icon name="close" /></button>
        </header>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </dialog>
  )
}
