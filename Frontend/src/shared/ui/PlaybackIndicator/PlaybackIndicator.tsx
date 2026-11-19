import { useTranslation } from '../../preferences/i18n'
import './PlaybackIndicator.css'

export default function PlaybackIndicator({ playing }: { playing: boolean }) {
  const t = useTranslation()
  return <span className="playback-indicator" data-playing={playing} role="img" aria-label={playing ? t("Сейчас играет") : t("Воспроизведение приостановлено")}><i /><i /><i /><i /></span>
}
