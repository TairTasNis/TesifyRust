import { useTranslation } from '../../shared/preferences/i18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage } from '../../shared/lib/backend'
import type { ImportResult } from '../../shared/playlists/types'
import Button from '../../shared/ui/Button/Button'
import Icon from '../../shared/ui/Icon/Icon'
import Modal from '../../shared/ui/Modal/Modal'
import MusicLoader from '../../shared/ui/MusicLoader/MusicLoader'
import { importSpotify } from './api'
import './ImportPlaylistModal.css'

type Props = { playlistId: string; onClose: () => void; onImported: (result: ImportResult) => void }

export default function ImportPlaylistModal({ playlistId, onClose, onImported }: Props) {
  const t = useTranslation()
  const [step, setStep] = useState<'source' | 'link'>('source')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    try {
      const parsed = new URL(url.trim())
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'open.spotify.com' || !/^\/(?:intl-[a-z-]+\/)?playlist\/[a-zA-Z0-9]{22}\/?$/.test(parsed.pathname)) throw new Error()
    } catch { setError(t("Вставьте полную ссылку вида https://open.spotify.com/playlist/…")); return }
    setBusy(true); setError(null)
    try { onImported(await importSpotify(playlistId, url.trim())) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <Modal title={step === 'source' ? t("Импортировать плейлист") : t("Импорт из Spotify")} onClose={onClose} busy={busy}>
      <div className="import-step" key={step}>{step === 'source' ? <button className="import-provider" onClick={() => setStep('link')}><span className="import-provider-icon"><Icon name="spotify" /></span><span><strong>Spotify</strong><small>{t("Публичный плейлист по ссылке")}</small></span><Icon name="chevron" /></button>
        : <form onSubmit={submit}>
          <div className="form-field"><label htmlFor="spotify-playlist-url">{t("Ссылка на плейлист")}</label><input id="spotify-playlist-url" type="url" autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://open.spotify.com/playlist/…" disabled={busy} required /></div>
          <p className="form-note">{t("Плейлист должен быть публичным. Уже добавленные треки будут пропущены.")}</p>
          {busy && <MusicLoader className="import-progress" variant="inline" label={t("Получаем треки из Spotify…")} />}
          {error && <p className="form-error" role="alert">{error && t(error)}</p>}
          <div className="modal-actions"><Button variant="ghost" disabled={busy} onClick={() => { setStep('source'); setError(null) }}>{t("Назад")}</Button><Button type="submit" disabled={busy} aria-busy={busy}><Icon name="import" />{busy ? t("Импортируем…") : t("Импортировать")}</Button></div>
        </form>}</div>
    </Modal>
  )
}
