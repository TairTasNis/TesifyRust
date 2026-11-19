import { useTranslation } from '../../preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage } from '../../lib/backend'
import Button from '../../ui/Button/Button'
import Icon from '../../ui/Icon/Icon'
import Modal from '../../ui/Modal/Modal'
import MusicLoader from '../../ui/MusicLoader/MusicLoader'
import type { PlaylistDraft } from '../types'
import { uploadCover } from '../covers'
import './PlaylistEditor.css'

type Props = { initial?: PlaylistDraft; onClose: () => void; onSave: (draft: PlaylistDraft) => Promise<void>; onImport?: (draft: PlaylistDraft) => Promise<void> }

export default function PlaylistEditor({ initial, onClose, onSave, onImport }: Props) {
  const t = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploaded = useRef<{ file: File; url: string } | null>(null)

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function chooseFile(selected: File | undefined) {
    if (!selected) return
    if (selected.type && !['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) { setError(t("Выберите обложку в формате PNG, JPG или WebP.")); return }
    if (selected.size > 8 * 1024 * 1024) { setError(t("Обложка должна быть не больше 8 МБ.")); return }
    setError(null); setFile(selected); uploaded.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await save(onSave)
  }

  async function save(action: (draft: PlaylistDraft) => Promise<void>) {
    if (busy) return
    if (!name.trim()) { setError(t("Введите название плейлиста.")); return }
    setBusy(true); setError(null)
    try {
      let image = coverUrl
      if (file) {
        setPhase(t("Загружаем обложку…"))
        if (uploaded.current?.file !== file) uploaded.current = { file, url: await uploadCover(file) }
        image = uploaded.current.url
      }
      setPhase(t("Сохраняем…"))
      await action({ name: name.trim(), description: description.trim(), coverUrl: image })
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false); setPhase('') }
  }

  const image = preview ?? coverUrl
  return (
    <Modal title={initial ? t("Редактировать плейлист") : t("Новый плейлист")} onClose={onClose} busy={busy} wide>
      {(close) => <form onSubmit={submit}>
        <div className="playlist-editor-grid">
          <div className="playlist-editor-art">
            <input className="visually-hidden" ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("Выбрать обложку")} disabled={busy}
              onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
            <button className="playlist-editor-upload" type="button" disabled={busy} onClick={() => inputRef.current?.click()} aria-label={t("Загрузить обложку")}>
              {image ? <img src={image} alt={t("Обложка плейлиста")} /> : <><Icon name="image" /><span>{t("Добавить обложку")}</span></>}
            </button>
            <p>{t("JPG, PNG, WebP · до 8 МБ")}</p>
            {image && <button className="playlist-editor-remove" type="button" disabled={busy} onClick={() => { setFile(null); setCoverUrl(null); uploaded.current = null }}>{t("Убрать обложку")}</button>}
          </div>
          <div>
            <div className="form-field"><label htmlFor="playlist-name">{t("Название")}</label><input id="playlist-name" autoFocus data-autofocus maxLength={500} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
            <div className="form-field"><label htmlFor="playlist-description">{t("Описание")} <span>{t("необязательно")}</span></label><textarea id="playlist-description" maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></div>
          </div>
        </div>
        {error && <p className="form-error" role="alert">{error && t(error)}</p>}
        <div className="playlist-editor-footer">
          {onImport && <Button className="playlist-editor-import" variant="ghost" disabled={busy} onClick={() => { void save(onImport) }}><Icon name="import" />{t("Импортировать плейлист")}</Button>}
          <div className="playlist-editor-save-actions"><Button variant="secondary" onClick={close} disabled={busy}>{t("Отмена")}</Button><Button type="submit" disabled={busy} aria-busy={busy}>{busy && <MusicLoader variant="compact" label={phase || t("Сохраняем")} />}{busy ? phase : initial ? t("Сохранить") : t("Создать плейлист")}</Button></div>
        </div>
      </form>}
    </Modal>
  )
}
