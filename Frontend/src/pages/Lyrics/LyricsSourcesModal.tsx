import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import type { Lyrics, LyricsResponse } from './types'
import Icon from '../../shared/ui/Icon/Icon'
import './LyricsSourcesModal.css'

type Props = {
  currentLyrics: Lyrics
  onClose: () => void
  offset?: number
  onOffsetChange?: (offset: number) => void
  onSelectSource?: (sourceId: string) => Promise<LyricsResponse | null>
}

export type SourceItem = {
  id: string
  name: string
  sync: 'word' | 'line' | 'none'
  syncTitle: string
  description: string
  url: string
}

export const KNOWN_SOURCES: SourceItem[] = [
  {
    id: 'lyricsplus',
    name: 'LyricsPlus',
    sync: 'word',
    syncTitle: 'По словам',
    description: 'Мульти-источник KPOE (Musixmatch, Spotify, Apple Music, QQ Music)',
    url: 'https://github.com/ibratabian17/lyricsplus',
  },
  {
    id: 'amll',
    name: 'AMLL TTML Database',
    sync: 'word',
    syncTitle: 'По словам (TTML)',
    description: 'Официальные тексты Apple Music с послоговой синхронизацией',
    url: 'https://github.com/amll-dev/amll-ttml-db',
  },
  {
    id: 'netease',
    name: 'NetEase Cloud Music',
    sync: 'word',
    syncTitle: 'По словам (YRC)',
    description: 'Караоке-разметка YRC и пословные тексты из каталога NetEase',
    url: 'https://music.163.com',
  },
  {
    id: 'kugou',
    name: 'Kugou Music',
    sync: 'word',
    syncTitle: 'По словам (KRC)',
    description: 'Послоговая синхронизация в формате караоке Kugou KRC',
    url: 'https://www.kugou.com',
  },
  {
    id: 'better',
    name: 'Better Lyrics',
    sync: 'word',
    syncTitle: 'По словам',
    description: 'Караоке-тексты для медиаплееров с высокой точностью тайминга',
    url: 'https://betterlyrics.org',
  },
  {
    id: 'lrclib',
    name: 'LRCLIB',
    sync: 'line',
    syncTitle: 'По строкам',
    description: 'Крупнейшая открытая библиотека текстов LRC от сообщества',
    url: 'https://lrclib.net',
  },
  {
    id: 'lrcmux',
    name: 'lrcmux',
    sync: 'word',
    syncTitle: 'По словам',
    description: 'Агрегатор и нормализатор пословных текстов',
    url: 'https://lrcmux.dev',
  },
  {
    id: 'lrcapi',
    name: 'LrcApi',
    sync: 'line',
    syncTitle: 'По строкам',
    description: 'Специализированный сервис синхронизированных LRC',
    url: 'https://github.com/HisAtri/LrcApi',
  },
  {
    id: 'binilyrics',
    name: 'LyricsPlus / BiniLyrics',
    sync: 'word',
    syncTitle: 'По словам',
    description: 'Индексированное зеркало текстов Musixmatch и Spotify',
    url: 'https://lyrics-api.binimum.org',
  },
]

export default function LyricsSourcesModal({
  currentLyrics,
  onClose,
  offset = 0,
  onOffsetChange,
  onSelectSource,
}: Props) {
  const t = useTranslation()
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [loadingSource, setLoadingSource] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; message: string; type: 'error' | 'success' } | null>(null)

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isCurrent = (source: SourceItem) => {
    const active = currentLyrics.source.toLowerCase().trim()
    const item = source.name.toLowerCase().trim()
    const id = source.id.toLowerCase()
    return active === item || active.includes(id) || item.includes(active)
  }

  const handleSelect = async (source: SourceItem) => {
    if (isCurrent(source) || loadingSource || !onSelectSource) return
    setLoadingSource(source.id)
    setFeedback(null)
    try {
      const response = await onSelectSource(source.id)
      if (response?.status === 'found' && response?.lyrics) {
        setFeedback({ id: source.id, message: t("Источник подключён"), type: 'success' })
      } else {
        setFeedback({ id: source.id, message: t("У этого источника нет текста для этой песни"), type: 'error' })
      }
    } catch {
      setFeedback({ id: source.id, message: t("Ошибка при подключении источника"), type: 'error' })
    } finally {
      setLoadingSource(null)
    }
  }

  return (
    <div
      className="lyrics-sources-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("Источники текста песни")}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="lyrics-sources-modal" ref={modalRef}>
        <header className="lyrics-sources-header">
          <div className="lyrics-sources-header-info">
            <span className="lyrics-sources-header-tag">
              <Icon name="lyrics" />
              {t("Источники текста")}
            </span>
            <h2>{t("Выбор источника и тайминг")}</h2>
            <p>{t("Нажмите на любой сервис, чтобы переключить текст песни")}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="lyrics-icon-button"
            onClick={onClose}
            aria-label={t("Закрыть")}
            title={t("Закрыть (Esc)")}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="lyrics-sources-content">
          {onOffsetChange && (
            <div className="lyrics-offset-bar">
              <div className="lyrics-offset-info">
                <span className="lyrics-offset-label">{t("Калибровка тайминга")}</span>
                <span className={`lyrics-offset-value${offset === 0 ? ' is-zero' : ''}`}>
                  {offset !== 0 ? t("{0}{1} с", offset > 0 ? '+' : '', offset.toFixed(1)) : '0.0 с'}
                </span>
              </div>
              <div className="lyrics-offset-buttons">
                <button
                  type="button"
                  className="lyrics-pill-btn"
                  onClick={() => onOffsetChange(Number((offset - 0.5).toFixed(1)))}
                  title={t("Сдвинуть текст на 0.5 сек раньше")}
                >
                  -0.5 с
                </button>
                <button
                  type="button"
                  className="lyrics-pill-btn"
                  onClick={() => onOffsetChange(Number((offset - 0.1).toFixed(1)))}
                  title={t("Сдвинуть текст на 0.1 сек раньше")}
                >
                  -0.1 с
                </button>
                <button
                  type="button"
                  className="lyrics-pill-btn lyrics-pill-btn--reset"
                  onClick={() => onOffsetChange(0)}
                  disabled={offset === 0}
                  title={t("Сбросить смещение")}
                >
                  {t("Сброс")}
                </button>
                <button
                  type="button"
                  className="lyrics-pill-btn"
                  onClick={() => onOffsetChange(Number((offset + 0.1).toFixed(1)))}
                  title={t("Сдвинуть текст на 0.1 сек позже")}
                >
                  +0.1 с
                </button>
                <button
                  type="button"
                  className="lyrics-pill-btn"
                  onClick={() => onOffsetChange(Number((offset + 0.5).toFixed(1)))}
                  title={t("Сдвинуть текст на 0.5 сек позже")}
                >
                  +0.5 с
                </button>
              </div>
            </div>
          )}

          <div className="lyrics-sources-section">
            <div className="lyrics-sources-section-title">
              <span>{t("Доступные провайдеры (")}{KNOWN_SOURCES.length})</span>
              <span className="lyrics-sources-hint">{t("Кликните для выбора")}</span>
            </div>

            <div className="lyrics-sources-list" role="listbox" aria-label={t("Список источников текста")}>
              {KNOWN_SOURCES.map((source) => {
                const active = isCurrent(source)
                const loading = loadingSource === source.id
                const isItemFeedback = feedback?.id === source.id

                return (
                  <button
                    key={source.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={loading}
                    className={`lyrics-source-row${active ? ' is-active' : ''}${loading ? ' is-loading' : ''}`}
                    onClick={() => handleSelect(source)}
                  >
                    <div className="lyrics-source-row-left">
                      <div className={`lyrics-source-radio${active ? ' is-active' : ''}`}>
                        {loading ? (
                          <span className="lyrics-source-spinner" />
                        ) : active ? (
                          <span className="lyrics-source-check">✓</span>
                        ) : (
                          <span className="lyrics-source-dot" />
                        )}
                      </div>
                      <div className="lyrics-source-meta">
                        <div className="lyrics-source-title-row">
                          <strong className="lyrics-source-title">{source.name}</strong>
                          {source.url && (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="lyrics-source-ext-link"
                              onClick={(e) => e.stopPropagation()}
                              title={t("Перейти на сайт {0}", source.name)}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          )}
                        </div>
                        <p className="lyrics-source-desc">{t(source.description)}</p>
                        {isItemFeedback && (
                          <div className={`lyrics-source-feedback is-${feedback.type}`}>
                            {feedback.message}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="lyrics-source-row-right">
                      {active ? (
                        <span className="lyrics-badge-active">
                          <span className="lyrics-pulse-dot" />
                          {t("Активен")}
                        </span>
                      ) : (
                        <span className="lyrics-badge-switch">{t("Выбрать")}</span>
                      )}
                      <span className={`lyrics-sync-pill lyrics-sync-pill--${source.sync}`}>
                        {t(source.syncTitle)}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
