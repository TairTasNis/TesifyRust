import { useEffect, useState } from 'react'
import { errorMessage } from '../../shared/lib/backend'
import { getWaveProfile, setWaveApiKey } from '../../shared/playback/wave'
import type { WaveProfile } from '../../shared/playback/wave'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import { useTranslation } from '../../shared/preferences/i18n'
import { setPreferences, usePreferences } from '../../shared/preferences/preferences'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import Button from '../../shared/ui/Button/Button'

export default function DeveloperSettings() {
  const t = useTranslation()
  const { language, showWaveChanges } = usePreferences()
  const { waveFeedbackError } = usePlayback()
  const [profile, setProfile] = useState<WaveProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<{ error: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const update = async () => {
      try {
        const result = await getWaveProfile()
        if (active) { setProfile(result); setError(null) }
      } catch (error) {
        if (active) setError(errorMessage(error))
      } finally {
        if (active) timer = window.setTimeout(update, 2000)
      }
    }
    void update()
    return () => { active = false; window.clearTimeout(timer) }
  }, [])

  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 3 })
  const signed = new Intl.NumberFormat(language, { maximumFractionDigits: 3, signDisplay: 'exceptZero' })

  async function saveKey() {
    setSavingKey(true)
    setKeyStatus(null)
    try {
      await setWaveApiKey(key)
      setKey('')
      setKeyStatus({ error: false, text: 'Ключ Last.fm сохранён.' })
    } catch (error) { setKeyStatus({ error: true, text: errorMessage(error) }) }
    finally { setSavingKey(false) }
  }

  return <section className="settings-panel wave-settings" aria-labelledby="wave-settings-title">
    <h2 id="wave-settings-title">{t('Моя волна')}</h2>
    <label className="settings-row wave-changes-switch">
      <span>{t('Показывать изменения вкусов')}</span>
      <input type="checkbox" role="switch" checked={showWaveChanges}
        onChange={event => setPreferences({ showWaveChanges: event.currentTarget.checked })} />
    </label>
    {!profile && !error && <MusicLoader variant="inline" label={t('Загружаем профиль')} />}
    {error && <p className="form-error" role="alert">{t(error)}</p>}
    {waveFeedbackError && <p className="form-error" role="status">{t(waveFeedbackError)}</p>}
    {profile && <>
      <details className="wave-key" open={!profile.configured || undefined}>
        <summary>{t('Ключ Last.fm')}</summary>
        <form className="settings-row" onSubmit={event => { event.preventDefault(); void saveKey() }}>
          <input type="password" aria-label={t('Ключ Last.fm')} autoComplete="off" spellCheck={false} value={key}
            onChange={event => setKey(event.currentTarget.value)} required disabled={savingKey} />
          <Button variant="secondary" type="submit" disabled={!key.trim() || savingKey}>{t('Сохранить')}</Button>
        </form>
        {keyStatus && <p className={keyStatus.error ? 'form-error' : 'wave-settings-status'} role="status">{t(keyStatus.text)}</p>}
      </details>
      <div className="wave-scan">
        <label htmlFor="wave-scan-progress">{t('Сканирование треков')}</label>
        <span>{t('{0} из {1}', profile.scannedTracks, profile.totalTracks)}</span>
        <progress id="wave-scan-progress" max={profile.totalTracks || 1} value={profile.scannedTracks} />
      </div>
      {profile.totalPlaylists > 0 && <p className="wave-settings-status">
        {t('Плейлисты Spotify: {0} из {1}', profile.scannedPlaylists, profile.totalPlaylists)}
      </p>}
      {profile.scanning && <MusicLoader variant="inline" label={t('Сканируем в фоне')} />}
      {profile.scanError && <p className="form-error" role="status">{t(profile.scanError)}</p>}
      {profile.tags.length > 0 ? <table className="wave-weights">
        <thead><tr><th scope="col">{t('Тег')}</th><th scope="col">{t('В плейлистах')}</th><th scope="col">{t('Реакции')}</th><th scope="col">{t('Вес')}</th>{showWaveChanges && <th scope="col">{t('За сеанс')}</th>}</tr></thead>
        <tbody>{profile.tags.map(row => <tr key={row.tag}>
          <th scope="row">{row.tag}</th>
          <td>{number.format(row.playlistTracks)}</td><td>{signed.format(row.feedback)}</td><td>{number.format(row.weight)}</td>
          {showWaveChanges && <td>{signed.format(row.sessionChange)}</td>}
        </tr>)}</tbody>
      </table> : <p className="wave-settings-status">{t('Тегов пока нет.')}</p>}
    </>}
  </section>
}
