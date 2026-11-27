import { usePlayback } from '../../shared/playback/PlaybackProvider'
import { waveQueueId } from '../../shared/playback/wave'
import { useTranslation } from '../../shared/preferences/i18n'
import Icon from '../../shared/ui/Icon/Icon'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import ListeningStats from './ListeningStats'
import './HomePage.css'

export default function HomePage({ onOpenWave }: { onOpenWave: () => void }) {
  const t = useTranslation()
  const player = usePlayback()
  const active = player.playlistId === waveQueueId
  const playing = active && player.playing
  const loading = player.waveLoading || (active && player.loading)
  const action = playing ? 'Приостановить Мою волну' : 'Слушать Мою волну'
  const subtitle = active && player.current
    ? `${player.current.title} · ${player.current.artist}`
    : t('Новая музыка по твоим плейлистам')

  return (
    <main className="workspace home-page" aria-label={t("Главная")}>
      <h1 className="visually-hidden">{t("Главная")}</h1>
      <section className="wave-banner" aria-label={t('Моя волна')}>
        <button type="button" className="wave-banner-copy" aria-label={t('Открыть Мою волну')} onClick={onOpenWave}>
          <span className="wave-banner-title">{t('Моя волна')}</span>
          <span className="wave-banner-caption">{subtitle}</span>
        </button>
        <button type="button" className="wave-banner-control" aria-label={t(action)} aria-busy={loading} onClick={player.playWave}>
          {loading ? <MusicLoader variant="spinner" label={t('Подбираем музыку')} /> : <Icon name={playing ? 'pause' : 'play'} />}
        </button>
      </section>
      {player.waveError && <p className="form-error wave-banner-error" role="alert">{t(player.waveError)}</p>}
      <ListeningStats />
    </main>
  )
}
