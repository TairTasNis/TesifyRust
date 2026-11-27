import { useEffect, useState } from 'react'
import { backend, errorMessage } from '../../shared/lib/backend'
import { useDownloads } from '../../shared/playback/downloads/DownloadsProvider'
import { useTranslation } from '../../shared/preferences/i18n'
import { usePreferences } from '../../shared/preferences/preferences'
import Button from '../../shared/ui/Button/Button'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'

type StorageUsage = {
  appBytes: number
  previewBytes: number
  downloadBytes: number
  downloadDirectory: string
  volume: { usedBytes: number; totalBytes: number } | null
}

const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']

function formatBytes(bytes: number, language: string) {
  const scale = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3)) : 0
  return new Intl.NumberFormat(language, { style: 'unit', unit: units[scale], maximumFractionDigits: 1 }).format(bytes / 1000 ** scale)
}

export default function StorageSettings() {
  const t = useTranslation()
  const { language } = usePreferences()
  const completedDownloads = useDownloads().progress?.completed ?? 0
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (clearing) return
    let active = true
    backend<StorageUsage>('get_storage_usage', {}, '/settings/storage').then(result => {
      if (active) {
        setUsage(result)
        setError(null)
      }
    }).catch(error => { if (active) setError(errorMessage(error)) })
    return () => { active = false }
  }, [clearing, retry, completedDownloads])

  async function clear() {
    setClearing(true)
    setCleared(false)
    setError(null)
    try {
      setUsage(await backend<StorageUsage>('clear_song_previews', {}, '/settings/storage', 'DELETE'))
      setCleared(true)
    } catch (error) { setError(errorMessage(error)) }
    finally { setClearing(false) }
  }

  const size = (bytes: number) => formatBytes(bytes, language)
  const downloadSize = new Intl.NumberFormat(language, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 2 })
  return <section id="settings-storage" className="settings-panel settings-storage" aria-label={t('Память')} aria-busy={clearing || (!usage && !error)}>
    {!usage && !error && <MusicLoader label={t('Проверяем память')} />}
    {usage && <>
      {usage.volume && <div className="settings-row"><span>{t('Занято на диске')}</span><output>{t('{0} из {1}', size(usage.volume.usedBytes), size(usage.volume.totalBytes))}</output></div>}
      <div className="settings-row"><span>{t('Данные Tesify')}</span><output>{size(usage.appBytes)}</output></div>
      <div className="settings-row"><span>{t('Скачанная музыка')}</span><output>{downloadSize.format(usage.downloadBytes / 1_000_000)}</output></div>
      <div className="settings-row settings-download-directory"><span>{t('Папка скачанной музыки')}</span><output dir="auto">{usage.downloadDirectory}</output></div>
      <div className="settings-row"><span>{t('Превью песен')}</span><output>{size(usage.previewBytes)}</output></div>
      <div className="settings-row"><Button variant="secondary" disabled={clearing || !usage.previewBytes} onClick={() => { void clear() }}>{t('Удалить превью песен')}</Button></div>
    </>}
    {cleared && <p className="settings-storage-status" role="status">{t('Превью песен удалены.')}</p>}
    {error && <p className="form-error" role="alert">{t(error)}</p>}
    {error && !usage && <Button variant="secondary" onClick={() => { setError(null); setRetry(value => value + 1) }}>{t('Попробовать снова')}</Button>}
  </section>
}
