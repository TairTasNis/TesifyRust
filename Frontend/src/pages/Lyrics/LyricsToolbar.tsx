import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import Button from '../../shared/ui/Button/Button'
import Modal from '../../shared/ui/Modal/Modal'
import Icon from '../../shared/ui/Icon/Icon'
import './LyricsToolbar.css'

const fonts = {
  manrope: 'Manrope, "Segoe UI", sans-serif',
  georgia: 'Georgia, serif',
  consolas: 'Consolas, monospace',
}
const fontLabels = { manrope: 'Manrope', georgia: 'Georgia', consolas: 'Consolas' }
const alignments = { left: 'Слева', center: 'По центру', right: 'Справа' }
const storageKey = 'tesify_lyrics_appearance'
const defaults = { textScale: 100, coverScale: 100, font: 'manrope', align: null, showCover: true } as const
type Appearance = {
  textScale: number
  coverScale: number
  font: keyof typeof fonts
  align: keyof typeof alignments | null
  showCover: boolean
}

export function useLyricsAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (!saved) return defaults
      return {
        textScale: Number.isFinite(saved.textScale) ? Math.max(70, Math.min(150, saved.textScale)) : defaults.textScale,
        coverScale: Number.isFinite(saved.coverScale) ? Math.max(60, Math.min(125, saved.coverScale)) : defaults.coverScale,
        font: Object.hasOwn(fonts, saved.font) ? saved.font : defaults.font,
        align: Object.hasOwn(alignments, saved.align) ? saved.align : defaults.align,
        showCover: typeof saved.showCover === 'boolean' ? saved.showCover : defaults.showCover,
      }
    } catch { return defaults }
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(appearance)) } catch { /* Appearance still applies in this session. */ }
  }, [appearance])

  const style = {
    '--lyrics-text-scale': appearance.textScale / 100,
    '--lyrics-cover-scale': appearance.coverScale / 100,
    '--lyrics-font': fonts[appearance.font],
    '--lyrics-align': appearance.align ?? (appearance.showCover ? 'start' : 'center'),
    '--lyrics-origin': appearance.align ?? (appearance.showCover ? 'left' : 'center'),
  }
  return { appearance, setAppearance, style }
}

export default function LyricsToolbar({ appearance, onChange, onChooseTrack }: {
  appearance: Appearance; onChange: (value: Appearance) => void; onChooseTrack: () => void
}) {
  const t = useTranslation()
  const dock = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const open = hovered || expanded

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !dock.current?.contains(event.target)) {
        setHovered(false)
        setExpanded(false)
      }
    }
    const close = () => { setHovered(false); setExpanded(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return <div ref={dock} className="lyrics-tools-dock" data-open={open}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true) }}
    onPointerLeave={event => {
      if (event.pointerType === 'mouse') {
        setHovered(false)
        if (document.documentElement.dataset.input !== 'keyboard') setExpanded(false)
      }
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        event.stopPropagation()
        setHovered(false)
        setExpanded(false)
        handle.current?.focus()
      }
    }}>
    <button ref={handle} type="button" className="lyrics-tools-handle" aria-label={t("Настройки текста")} title={t("Настройки текста")}
      aria-expanded={open} aria-controls="lyrics-appearance" onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true" />
    </button>
    <div id="lyrics-appearance" className="lyrics-tool-panel" role="group" aria-label={t("Настройки текста")} inert={!open}
      onFocus={() => { if (document.documentElement.dataset.input === 'keyboard') setExpanded(true) }}>
      <AppearanceFields appearance={appearance} onChange={onChange} />
      <button type="button" className="lyrics-tool-track" onClick={() => {
        handle.current?.focus()
        setHovered(false)
        setExpanded(false)
        onChooseTrack()
      }}><Icon name="search" />{t('Выбрать другую песню')}</button>
    </div>
  </div>
}

type AppearanceProps = { appearance: Appearance; onChange: (value: Appearance) => void }

export function LyricsSettings({ appearance, onChange, onClose, onChooseTrack }: AppearanceProps & {
  onClose: () => void; onChooseTrack: () => void
}) {
  const t = useTranslation()
  return <Modal title={t("Настройки текста")} onClose={onClose}>
    <div className="lyrics-tool-dialog">
      <AppearanceFields appearance={appearance} onChange={onChange} />
      <Button className="lyrics-tool-dialog-track" variant="secondary" onClick={onChooseTrack}><Icon name="search" />{t("Выбрать другую песню")}</Button>
    </div>
  </Modal>
}

function AppearanceFields({ appearance, onChange }: AppearanceProps) {
  const t = useTranslation()
  return <>
    <label className="lyrics-tool-scale">
      <span>{t("Масштаб текста")} <output>{appearance.textScale}%</output></span>
      <input type="range" min="70" max="150" step="5" value={appearance.textScale} aria-label={t("Масштаб текста")} aria-valuetext={`${appearance.textScale}%`}
        onChange={event => onChange({ ...appearance, textScale: Number(event.currentTarget.value) })} />
    </label>
    <label className="lyrics-tool-scale">
      <span>{t("Масштаб обложки")} <output>{appearance.coverScale}%</output></span>
      <input type="range" min="60" max="125" step="5" value={appearance.coverScale} disabled={!appearance.showCover} aria-label={t("Масштаб обложки")} aria-valuetext={`${appearance.coverScale}%`}
        onChange={event => onChange({ ...appearance, coverScale: Number(event.currentTarget.value) })} />
    </label>
    <label className="lyrics-tool-select">{t("Шрифт")}
      <select value={appearance.font} onChange={event => onChange({ ...appearance, font: event.currentTarget.value as Appearance['font'] })}>
        {Object.entries(fontLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
    </label>
    <label className="lyrics-tool-select">{t("Выравнивание")}
      <select value={appearance.align ?? (appearance.showCover ? 'left' : 'center')} onChange={event => onChange({ ...appearance, align: event.currentTarget.value as Appearance['align'] })}>
        {Object.entries(alignments).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}
      </select>
    </label>
    <label className="lyrics-tool-cover"><input type="checkbox" checked={appearance.showCover}
      onChange={event => onChange({ ...appearance, showCover: event.currentTarget.checked })} />{t("Обложка")}</label>
  </>
}
