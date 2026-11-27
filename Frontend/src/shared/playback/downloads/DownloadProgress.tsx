import { useEffect, useState } from 'react'
import { formatDuration } from '../../playlists/format'
import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import { useDownloads } from './DownloadsProvider'
import './DownloadProgress.css'

export default function DownloadProgress() {
  const t = useTranslation()
  const { progress } = useDownloads()
  const [dismissed, setDismissed] = useState<typeof progress>(null)
  useEffect(() => {
    if (!progress?.total || progress.active || progress.failed) return
    const timer = window.setTimeout(() => setDismissed(progress), 3600)
    return () => window.clearTimeout(timer)
  }, [progress])
  if (!progress?.total || dismissed === progress) return null

  const count = t('Скачано {0} из {1}', progress.completed, progress.total)
  return <aside className="download-progress" aria-label={t('Скачивание')}>
    <div className="download-progress-heading"><strong role={progress.active ? undefined : 'status'}>{count}</strong>
      {progress.active ? <span>{progress.percent}%</span> : <button type="button" aria-label={t('Закрыть')} onClick={() => setDismissed(progress)}><Icon name="close" /></button>}
    </div>
    {progress.active && <>
      <progress max={100} value={progress.percent} aria-label={t('Скачивание')} />
      <small>{progress.etaSeconds === null ? t('Оцениваем оставшееся время…') : t('Осталось около {0}', formatDuration(progress.etaSeconds * 1000))}</small>
    </>}
    {progress.failed > 0 && <small>{t('Не удалось скачать {0}', progress.failed)}</small>}
  </aside>
}
