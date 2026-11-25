import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { errorMessage } from '../../shared/lib/backend'
import { lyricsModes, setPreferences, usePreferences } from '../../shared/preferences/preferences'
import type { LyricsMode } from '../../shared/preferences/preferences'
import Button from '../../shared/ui/Button/Button'
import Modal from '../../shared/ui/Modal/Modal'
import Icon from '../../shared/ui/Icon/Icon'
import {
  builtinFontLabels,
  builtinFonts,
  isCustomFontKey,
  removeCustomLyricsFont,
  resolveLyricsFontStack,
  uploadCustomLyricsFont,
  useCustomLyricsFonts,
} from './fonts'
import type { CustomFontEntry } from './fonts'
import './LyricsToolbar.css'

const alignments = { left: 'Слева', center: 'По центру', right: 'Справа' }
const fontFileAccept = /Android/i.test(navigator.userAgent) ? '*/*' : '.ttf,.otf,.woff,.woff2'
const storageKey = 'tesify_lyrics_appearance'
const defaults = { textScale: 100, coverScale: 100, font: 'manrope', align: null, showCover: true } as const
type Appearance = {
  textScale: number
  coverScale: number
  font: string
  align: keyof typeof alignments | null
  showCover: boolean
}

function validSavedFont(value: unknown): string {
  if (typeof value !== 'string') return defaults.font
  if (Object.hasOwn(builtinFonts, value) || isCustomFontKey(value)) return value
  return defaults.font
}

export function useLyricsAppearance() {
  const { loaded: customLoaded, fonts: customFonts } = useCustomLyricsFonts()
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (!saved) return defaults
      return {
        textScale: Number.isFinite(saved.textScale) ? Math.max(70, Math.min(150, saved.textScale)) : defaults.textScale,
        coverScale: Number.isFinite(saved.coverScale) ? Math.max(60, Math.min(125, saved.coverScale)) : defaults.coverScale,
        font: validSavedFont(saved.font),
        align: Object.hasOwn(alignments, saved.align) ? saved.align : defaults.align,
        showCover: typeof saved.showCover === 'boolean' ? saved.showCover : defaults.showCover,
      }
    } catch { return defaults }
  })

  useEffect(() => {
    if (!customLoaded || !isCustomFontKey(appearance.font)) return
    if (!customFonts.some(font => font.key === appearance.font)) {
      setAppearance(prev => ({ ...prev, font: defaults.font }))
    }
  }, [appearance.font, customFonts, customLoaded])

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(appearance)) } catch { /* Appearance still applies in this session. */ }
  }, [appearance])

  const style = {
    '--lyrics-text-scale': appearance.textScale / 100,
    '--lyrics-cover-scale': appearance.coverScale / 100,
    '--lyrics-font': resolveLyricsFontStack(appearance.font, customFonts),
    '--lyrics-align': appearance.align ?? (appearance.showCover ? 'start' : 'center'),
    '--lyrics-origin': appearance.align ?? (appearance.showCover ? 'left' : 'center'),
  }
  return { appearance, setAppearance, style, customFonts }
}

type ToolbarProps = {
  appearance: Appearance
  onChange: (value: Appearance) => void
  onChooseTrack: () => void
  offset: number
  onOffsetChange: (offset: number) => void
  canAdjustOffset: boolean
  customFonts: CustomFontEntry[]
}

export default function LyricsToolbar({
  appearance,
  onChange,
  onChooseTrack,
  offset,
  onOffsetChange,
  canAdjustOffset,
  customFonts,
}: ToolbarProps) {
  const t = useTranslation()
  const dock = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [uploadingFont, setUploadingFont] = useState(false)
  const [fontError, setFontError] = useState<string | null>(null)
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

  async function handleFontFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setUploadingFont(true)
    setFontError(null)
    try {
      const uploaded = await uploadCustomLyricsFont(file)
      onChange({ ...appearance, font: uploaded.key })
    } catch (error) {
      setFontError(t(errorMessage(error)))
      setExpanded(true)
    } finally {
      setUploadingFont(false)
    }
  }

  async function handleDeleteFont(id: string) {
    setFontError(null)
    try {
      await removeCustomLyricsFont(id)
      onChange({ ...appearance, font: defaults.font })
    } catch (error) {
      setFontError(t(errorMessage(error)))
    }
  }

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
    <input ref={fileInput} type="file" accept={fontFileAccept} className="visually-hidden" tabIndex={-1} onChange={handleFontFile} />
    <button ref={handle} type="button" className="lyrics-tools-handle" aria-label={t("Настройки текста")} title={t("Настройки текста")}
      aria-expanded={open} aria-controls="lyrics-appearance" onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true" />
    </button>
    <div id="lyrics-appearance" className="lyrics-tool-panel" role="group" aria-label={t("Настройки текста")} inert={!open}
      onFocus={() => { if (document.documentElement.dataset.input === 'keyboard') setExpanded(true) }}>
      <AppearanceFields
        appearance={appearance}
        onChange={onChange}
        offset={offset}
        onOffsetChange={onOffsetChange}
        canAdjustOffset={canAdjustOffset}
        customFonts={customFonts}
        uploadingFont={uploadingFont}
        fontError={fontError}
        onPickFontFile={() => fileInput.current?.click()}
        onRemoveCustomFont={handleDeleteFont}
      />
      <button type="button" className="lyrics-tool-track" onClick={() => {
        handle.current?.focus()
        setHovered(false)
        setExpanded(false)
        onChooseTrack()
      }}><Icon name="search" />{t('Выбрать другую песню')}</button>
    </div>
  </div>
}

export function LyricsSettings({
  appearance,
  onChange,
  onClose,
  onChooseTrack,
  offset,
  onOffsetChange,
  canAdjustOffset,
  customFonts,
}: ToolbarProps & { onClose: () => void }) {
  const t = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadingFont, setUploadingFont] = useState(false)
  const [fontError, setFontError] = useState<string | null>(null)

  async function handleFontFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setUploadingFont(true)
    setFontError(null)
    try {
      const uploaded = await uploadCustomLyricsFont(file)
      onChange({ ...appearance, font: uploaded.key })
    } catch (error) {
      setFontError(t(errorMessage(error)))
    } finally {
      setUploadingFont(false)
    }
  }

  async function handleDeleteFont(id: string) {
    setFontError(null)
    try {
      await removeCustomLyricsFont(id)
      onChange({ ...appearance, font: defaults.font })
    } catch (error) {
      setFontError(t(errorMessage(error)))
    }
  }

  return <Modal title={t("Настройки текста")} onClose={onClose}>
    <input ref={fileInput} type="file" accept={fontFileAccept} className="visually-hidden" tabIndex={-1} onChange={handleFontFile} />
    <div className="lyrics-tool-dialog">
      <AppearanceFields
        appearance={appearance}
        onChange={onChange}
        offset={offset}
        onOffsetChange={onOffsetChange}
        canAdjustOffset={canAdjustOffset}
        customFonts={customFonts}
        uploadingFont={uploadingFont}
        fontError={fontError}
        onPickFontFile={() => fileInput.current?.click()}
        onRemoveCustomFont={handleDeleteFont}
      />
      <Button className="lyrics-tool-dialog-track" variant="secondary" onClick={onChooseTrack}><Icon name="search" />{t("Выбрать другую песню")}</Button>
    </div>
  </Modal>
}

type FieldsProps = {
  appearance: Appearance
  onChange: (value: Appearance) => void
  offset: number
  onOffsetChange: (offset: number) => void
  canAdjustOffset: boolean
  customFonts: CustomFontEntry[]
  uploadingFont: boolean
  fontError: string | null
  onPickFontFile: () => void
  onRemoveCustomFont: (id: string) => void
}

function AppearanceFields({
  appearance,
  onChange,
  offset,
  onOffsetChange,
  canAdjustOffset,
  customFonts,
  uploadingFont,
  fontError,
  onPickFontFile,
  onRemoveCustomFont,
}: FieldsProps) {
  const t = useTranslation()
  const { lyricsMode } = usePreferences()
  const selectedCustomFont = customFonts.find(font => font.key === appearance.font) ?? null
  const selectFontValue = Object.hasOwn(builtinFonts, appearance.font) || selectedCustomFont ? appearance.font : defaults.font

  function stepOffset(delta: number) {
    onOffsetChange(Number((offset + delta).toFixed(1)))
  }

  return <>
    <label className="lyrics-tool-select">{t('Подсветка текста')}
      <select value={lyricsMode} onChange={event => setPreferences({ lyricsMode: event.currentTarget.value as LyricsMode })}>
        {Object.entries(lyricsModes).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}
      </select>
    </label>
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
    <div className="lyrics-tool-font-group">
      <label className="lyrics-tool-select">{t("Шрифт")}
        <div className="lyrics-tool-font-row">
          <select value={selectFontValue} onChange={event => onChange({ ...appearance, font: event.currentTarget.value })}>
            <optgroup label={t("Стандартные")}>
              {Object.entries(builtinFontLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </optgroup>
            {customFonts.length > 0 && (
              <optgroup label={t("Мои шрифты")}>
                {customFonts.map(font => <option value={font.key} key={font.key}>{font.name}</option>)}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            className="lyrics-tool-font-btn"
            onClick={onPickFontFile}
            disabled={uploadingFont}
            title={t("Загрузить свой шрифт (TTF, OTF, WOFF, WOFF2)")}
            aria-label={t("Загрузить шрифт")}
          >
            <Icon name="plus" />
            <span>{uploadingFont ? t("Загрузка…") : t("Свой")}</span>
          </button>
          {selectedCustomFont && (
            <button
              type="button"
              className="lyrics-tool-font-btn lyrics-tool-font-btn--delete"
              onClick={() => onRemoveCustomFont(selectedCustomFont.id)}
              title={t("Удалить загруженный шрифт «{0}»", selectedCustomFont.name)}
              aria-label={t("Удалить шрифт")}
            >
              <Icon name="trash" />
            </button>
          )}
        </div>
      </label>
      {fontError && <span className="lyrics-tool-error" role="alert">{fontError}</span>}
    </div>
    <div className="lyrics-tool-offset" data-disabled={!canAdjustOffset || undefined}>
      <span>
        {t("Смещение")}
        <output className={offset === 0 ? 'is-zero' : undefined}>
          {offset !== 0 ? t("{0}{1} с", offset > 0 ? '+' : '', offset.toFixed(1)) : t('0.0 с')}
        </output>
      </span>
      <div className="lyrics-tool-offset-buttons" role="group" aria-label={t("Калибровка тайминга")}>
        <button type="button" disabled={!canAdjustOffset} onClick={() => stepOffset(-0.5)} title={t("Сдвинуть текст на 0.5 сек раньше")}>-0.5</button>
        <button type="button" disabled={!canAdjustOffset} onClick={() => stepOffset(-0.1)} title={t("Сдвинуть текст на 0.1 сек раньше")}>-0.1</button>
        <button type="button" disabled={!canAdjustOffset || offset === 0} onClick={() => onOffsetChange(0)} title={t("Сбросить смещение")}>0</button>
        <button type="button" disabled={!canAdjustOffset} onClick={() => stepOffset(0.1)} title={t("Сдвинуть текст на 0.1 сек позже")}>+0.1</button>
        <button type="button" disabled={!canAdjustOffset} onClick={() => stepOffset(0.5)} title={t("Сдвинуть текст на 0.5 сек позже")}>+0.5</button>
      </div>
    </div>
    <label className="lyrics-tool-select">{t("Выравнивание")}
      <select value={appearance.align ?? (appearance.showCover ? 'left' : 'center')} onChange={event => onChange({ ...appearance, align: event.currentTarget.value as Appearance['align'] })}>
        {Object.entries(alignments).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}
      </select>
    </label>
    <label className="lyrics-tool-cover"><input type="checkbox" checked={appearance.showCover}
      onChange={event => onChange({ ...appearance, showCover: event.currentTarget.checked })} />{t("Обложка")}</label>
  </>
}
