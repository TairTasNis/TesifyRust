import { useTranslation } from '../../shared/preferences/i18n'
import { useEffect, useRef, useState } from 'react'
import Icon from '../../shared/ui/Icon/Icon'
import Logo from '../../shared/ui/Logo/Logo'
import { defaultAppInfo, getAppInfo } from './api'
import './AboutPage.css'

type AboutPageProps = {
  onBack: () => void
}

export default function AboutPage({ onBack }: AboutPageProps) {
  const t = useTranslation()
  const pageRef = useRef<HTMLElement>(null)
  const [appInfo, setAppInfo] = useState(defaultAppInfo)
  const version = appInfo.version.split('-')[0].split('.').slice(0, 2).join('.')
  const [name, build] = appInfo.version.split('-')[1]?.split('.') ?? []
  const channel = build ? `${name} ${build.padStart(2, '0')}` : name

  useEffect(() => {
    let disposed = false
    getAppInfo()
      .then((info) => { if (!disposed) setAppInfo(info) })
      .catch((error: unknown) => console.error(t("Не удалось получить сведения о Tesify:"), error))
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    pageRef.current?.focus({ preventScroll: true })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  return (
    <main ref={pageRef} className="about-page" aria-label={t("О программе Tesify")} tabIndex={-1}>
      <button className="about-back-button" aria-label={t("Вернуться назад")} onClick={onBack}>
        <Icon name="back" width="22" height="22" />
      </button>

      <div className="about-identity">
        <Logo className="about-logo" />
        <h1 className="about-name">{appInfo.name}</h1>
        <p className="about-version" aria-label={t("Версия {0}", appInfo.version)}>
          v {version}{channel && <span>{channel}</span>}
        </p>
      </div>
    </main>
  )
}
