import { setPreferences, usePreferences } from '../../shared/preferences/preferences'
import type { Language, LyricsMode } from '../../shared/preferences/preferences'
import { useTranslation } from '../../shared/preferences/i18n'
import './SettingsPage.css'

const languages = { ru: 'Русский', en: 'English', kk: 'Қазақша' }
const lyricsModes: Record<LyricsMode, string> = { letter: 'По буквам', word: 'По словам', line: 'По строкам' }
const labels = {
  ru: ['Настройки', 'Основное', 'Язык интерфейса', 'Тёмная тема'],
  en: ['Settings', 'General', 'Interface language', 'Dark theme'],
  kk: ['Баптаулар', 'Жалпы', 'Интерфейс тілі', 'Қараңғы тақырып'],
}

export default function SettingsPage({ onAbout }: { onAbout?: () => void }) {
  const { language, theme, accentEnabled, accentColor, lyricsMode } = usePreferences()
  const t = useTranslation()
  const [title, general, languageLabel, themeLabel] = labels[language]

  return <main className="workspace settings-page" aria-label={title}>
    <h1>{title}</h1>
    <div className="settings-tabs" role="tablist" aria-label={title}>
      <button type="button" role="tab" id="settings-general-tab" aria-selected="true" aria-controls="settings-general">{general}</button>
    </div>
    <section id="settings-general" className="settings-panel" role="tabpanel" aria-labelledby="settings-general-tab">
      <label className="settings-row">
        <span>{languageLabel}</span>
        <select value={language} onChange={event => setPreferences({ language: event.currentTarget.value as Language })}>
          {Object.entries(languages).map(([id, name]) => <option key={id} value={id} lang={id}>{name}</option>)}
        </select>
      </label>
      <label className="settings-row">
        <span>{themeLabel}</span>
        <input type="checkbox" role="switch" checked={theme === 'dark'} onChange={event => setPreferences({ theme: event.currentTarget.checked ? 'dark' : 'light' })} />
      </label>
      <label className="settings-row">
        <span>{t('Акцентный цвет')}</span>
        <input type="checkbox" role="switch" checked={accentEnabled} onChange={event => setPreferences({ accentEnabled: event.currentTarget.checked })} />
      </label>
      {accentEnabled && <label className="settings-row">
        <span>{t('Выбрать цвет')}</span>
        <span className="settings-color"><output>{accentColor.toUpperCase()}</output><input type="color" value={accentColor}
          onChange={event => setPreferences({ accentColor: event.currentTarget.value })} /></span>
      </label>}
      <label className="settings-row">
        <span>{t('Предпочитать текст песни')}</span>
        <select value={lyricsMode} onChange={event => setPreferences({ lyricsMode: event.currentTarget.value as LyricsMode })}>
          {Object.entries(lyricsModes).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </label>
    </section>
    {onAbout && <button type="button" className="settings-about" onClick={onAbout}>{t("О программе Tesify")}</button>}
  </main>
}
