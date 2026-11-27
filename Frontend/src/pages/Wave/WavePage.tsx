import { useEffect } from 'react'
import type { OpenCatalog } from '../../shared/catalog/types'
import TrackArtistLinks from '../../shared/catalog/ArtistLinks/TrackArtistLinks'
import TrackMenu from '../../shared/catalog/TrackMenu/TrackMenu'
import { useTrackMenu } from '../../shared/catalog/TrackMenu/useTrackMenu'
import { usePlayback } from '../../shared/playback/PlaybackProvider'
import { waveMoods, waveModes, waveQueueId } from '../../shared/playback/wave'
import type { WaveOptions } from '../../shared/playback/wave'
import { useTranslation } from '../../shared/preferences/i18n'
import { setPreferences, usePreferences } from '../../shared/preferences/preferences'
import { formatDuration } from '../../shared/playlists/format'
import TrackPlaylistButton from '../../shared/playlists/Membership/TrackPlaylistButton'
import Icon from '../../shared/ui/Icon/Icon'
import PlaylistCover from '../../shared/ui/PlaylistCover/PlaylistCover'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import Button from '../../shared/ui/Button/Button'
import './WavePage.css'

export default function WavePage({ onBack, onOpen }: { onBack: () => void; onOpen: OpenCatalog }) {
  const t = useTranslation()
  const { waveOptions } = usePreferences()
  const player = usePlayback()
  const menu = useTrackMenu(player.waveTracks)
  const active = player.playlistId === waveQueueId
  const playing = active && player.playing
  const { prepareWave } = player
  useEffect(() => { prepareWave() }, [prepareWave])

  function change(options: WaveOptions) {
    setPreferences({ waveOptions: options })
    player.refreshWave(options)
  }

  return <main className="workspace wave-page" aria-labelledby="wave-title">
    <header className="wave-heading">
      <button className="wave-back" type="button" onClick={onBack} aria-label={t('Назад')}><Icon name="back" /></button>
      <h1 id="wave-title">{t('Моя волна')}</h1>
      <Button onClick={player.playWave} aria-label={t(playing ? 'Приостановить Мою волну' : 'Слушать Мою волну')}>
        <Icon name={playing ? 'pause' : 'play'} />{t(playing ? 'Пауза' : 'Слушать')}
      </Button>
    </header>
    <div className="wave-filters">
      <div role="group" aria-label={t('Подборка')} className="wave-modes">
        {(Object.entries(waveModes) as [WaveOptions['mode'], string][]).map(([mode, label]) =>
          <button key={mode} type="button" aria-pressed={waveOptions.mode === mode}
            onClick={() => { if (waveOptions.mode !== mode) change({ ...waveOptions, mode }) }}>{t(label)}</button>)}
      </div>
      <div className="wave-mood">
        <label htmlFor="wave-mood">{t('Настроение')}</label>
        <select id="wave-mood" disabled={waveOptions.mode === 'popular'} value={waveOptions.mode === 'popular' ? 'any' : waveOptions.mood} onChange={event => change({ ...waveOptions, mood: event.currentTarget.value as WaveOptions['mood'] })}>
          {Object.entries(waveMoods).map(([mood, label]) => <option key={mood} value={mood}>{t(label)}</option>)}
        </select>
      </div>
    </div>
    <div className="wave-list-heading">
      <h2>{t('Очередь')}</h2>
      {player.waveLoading ? <MusicLoader variant="inline" label={t('Подбираем музыку')} />
        : <Button variant="ghost" onClick={() => player.refreshWave(waveOptions)}>{t('Обновить подборку')}</Button>}
    </div>
    {player.waveError && <p className="form-error" role="alert">{t(player.waveError)}</p>}
    {player.waveFeedbackError && <p className="form-error" role="status">{t(player.waveFeedbackError)}</p>}
    <TrackMenu state={menu} onOpen={onOpen} queueId={waveQueueId} />
    {player.waveTracks.length > 0 && <ol className="wave-track-list" aria-label={t('Очередь')} aria-busy={player.waveLoading}>
      {player.waveTracks.map((track, index) => {
        const current = active && player.current?.id === track.id
        return <li key={track.id} {...menu.row<HTMLLIElement>(track)} aria-current={current || undefined}>
          <button className="wave-track-play" type="button" onClick={() => player.playQueue(waveQueueId, player.waveTracks, index)}
            aria-label={`${t(current && playing ? 'Пауза' : 'Воспроизвести')} · ${track.title}`}>
            <PlaylistCover url={track.coverUrl} name={track.title} />
            <Icon name={current && playing ? 'pause' : 'play'} />
          </button>
          <div className="wave-track-info">
            <button type="button" onClick={() => player.playQueue(waveQueueId, player.waveTracks, index)}>{track.title}</button>
            <TrackArtistLinks track={track} onOpen={onOpen} />
          </div>
          <span className="wave-track-time">{formatDuration(track.durationMs)}</span>
          <TrackPlaylistButton spotifyId={track.spotifyId} title={track.title} />
        </li>
      })}
    </ol>}
  </main>
}
