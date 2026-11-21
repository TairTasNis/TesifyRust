import { useTranslation } from '../../shared/preferences/i18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage } from '../../shared/lib/backend'
import type { SpotifyImportKind } from '../../shared/playlists/types'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import Modal from '../../shared/ui/Modal/Modal'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import './ImportPlaylistModal.css'

type Props = { kind?: SpotifyImportKind; syncedSources?: Record<string, string[]>; onClose: () => void; onImport: (url: string, autoSync: boolean) => Promise<void> }

const spotifyPath = /^\/(?:intl-[a-z-]+\/)?(track|playlist)\/([a-zA-Z0-9]{22})\/?$/

function sourceId(url: string, kind: SpotifyImportKind) {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol === 'https:' && parsed.host === 'open.spotify.com' && !parsed.username && !parsed.password) {
      const match = spotifyPath.exec(parsed.pathname)
      if (match?.[1] === kind) return match[2]
    }
  } catch { /* The user may still be entering the URL. */ }
  return undefined
}

export default function ImportPlaylistModal({ kind = 'playlist', syncedSources, onClose, onImport }: Props) {
  const t = useTranslation()
  const [step, setStep] = useState<'source' | 'link'>('source')
  const [url, setUrl] = useState('')
  const [syncOverride, setSyncOverride] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const playlist = kind === 'playlist'
  const source = sourceId(url, kind)
  const autoSync = playlist && (syncOverride ?? Boolean(source && syncedSources?.[source]))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!source) { setError(t(playlist ? 'Вставьте полную ссылку вида https://open.spotify.com/playlist/…' : 'Вставьте полную ссылку вида https://open.spotify.com/track/…')); return }
    setBusy(true); setError(null)
    try { await onImport(url.trim(), autoSync) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <Modal title={step === 'source' ? t(playlist ? 'Импортировать плейлист' : 'Импортировать трек') : t('Импорт из Spotify')} onClose={onClose} busy={busy}>
      <div className="import-step" key={step}>{step === 'source' ? <button className="import-provider" onClick={() => setStep('link')}><span className="import-provider-icon"><Icon name="spotify" /></span><span><strong>Spotify</strong><small>{t(playlist ? 'Публичный плейлист по ссылке' : 'Трек Spotify по ссылке')}</small></span><Icon name="chevron" /></button>
        : <form onSubmit={submit}>
          <div className="form-field"><label htmlFor="spotify-import-url">{t(playlist ? 'Ссылка на плейлист' : 'Ссылка на трек')}</label><input id="spotify-import-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={`https://open.spotify.com/${kind}/…`} disabled={busy} required /></div>
          {playlist && <><p className="form-note">{t("Плейлист должен быть публичным. Уже добавленные треки будут пропущены.")}</p>
          <label className="import-sync">
            <input type="checkbox" role="switch" checked={autoSync} disabled={busy} onChange={event => setSyncOverride(event.currentTarget.checked)} />
            {t('Синхронизировать со Spotify при запуске')}
          </label></>}
          {busy && <MusicLoader className="import-progress" variant="inline" label={t("Получаем треки из Spotify…")} />}
          {error && <p className="form-error" role="alert">{error && t(error)}</p>}
          <div className="modal-actions"><Button variant="ghost" disabled={busy} onClick={() => { setStep('source'); setError(null) }}>{t("Назад")}</Button><Button type="submit" disabled={busy} aria-busy={busy}><Icon name="import" />{busy ? t("Импортируем…") : t("Импортировать")}</Button></div>
        </form>}</div>
    </Modal>
  )
}
