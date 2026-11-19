import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useState } from 'react'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import Modal from '../../shared/ui/Modal/Modal'
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

export default function LyricsToolbar({ appearance, onChange, onClose, onChooseTrack }: {
  appearance: Appearance; onChange: (value: Appearance) => void; onClose: () => void; onChooseTrack: () => void
}) {
  const t = useTranslation()

  return <Modal title={t("Настройки текста")} onClose={onClose}>
    <div className="lyrics-tool-panel">
      <label className="lyrics-tool-scale">
        <span>{t("Масштаб текста")} <output>{appearance.textScale}%</output></span>
        <input type="range" min="70" max="150" step="5" value={appearance.textScale}
          onChange={event => onChange({ ...appearance, textScale: Number(event.currentTarget.value) })} />
      </label>
      <label className="lyrics-tool-scale">
        <span>{t("Масштаб обложки")} <output>{appearance.coverScale}%</output></span>
        <input type="range" min="60" max="125" step="5" value={appearance.coverScale} disabled={!appearance.showCover}
          onChange={event => onChange({ ...appearance, coverScale: Number(event.currentTarget.value) })} />
      </label>
      <div className="lyrics-tool-selects">
        <label>{t("Шрифт")}
          <select value={appearance.font} onChange={event => onChange({ ...appearance, font: event.currentTarget.value as Appearance['font'] })}>
            {Object.entries(fontLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label>{t("Выравнивание")}
          <select value={appearance.align ?? (appearance.showCover ? 'left' : 'center')} onChange={event => onChange({ ...appearance, align: event.currentTarget.value as Appearance['align'] })}>
            {Object.entries(alignments).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}
          </select>
        </label>
      </div>
      <label className="lyrics-tool-cover"><input type="checkbox" checked={appearance.showCover}
        onChange={event => onChange({ ...appearance, showCover: event.currentTarget.checked })} />{t("Обложка")}</label>
      <Button className="lyrics-tool-track" variant="secondary" onClick={onChooseTrack}><Icon name="search" />{t('Выбрать другую песню')}</Button>
    </div>
  </Modal>
}
