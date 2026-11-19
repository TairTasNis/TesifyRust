import { useTranslation } from '../../preferences/i18n'
import type { ReactNode } from 'react'
import Logo from '../../ui/Logo/Logo'
import WindowControls from '../WindowControls/WindowControls'
import { useAppWindow } from './useAppWindow'
import './AppWindow.css'

type AppWindowProps = {
  children: ReactNode
  isAbout: boolean
  hasPlayer?: boolean
  isLyrics?: boolean
  appWindow?: ReturnType<typeof useAppWindow>
}

export default function AppWindow({ children, isAbout, hasPlayer = false, isLyrics = false, appWindow }: AppWindowProps) {
  const t = useTranslation()
  const localWindow = useAppWindow()
  const window = appWindow ?? localWindow
  const classes = [
    'desktop',
    isLyrics && 'desktop--lyrics',
    window.isNative && 'desktop--native',
    window.isMaximized && window.windowState === 'open' && 'desktop--maximized',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {window.windowState === 'open' ? (
        <div className={`app-window${hasPlayer ? ' app-window--with-player' : ''}${isLyrics ? ' app-window--lyrics' : ''}`}>
          {window.isNative && !isLyrics && <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />}
          {children}
          {!isLyrics && (!isAbout || window.isNative) && (
            <WindowControls
              isMaximized={window.isMaximized}
              onMinimize={window.minimize}
              onToggleMaximize={window.toggleMaximize}
              onClose={window.close}
            />
          )}
          {window.windowError && <div className="window-error" role="alert">{window.windowError}</div>}
        </div>
      ) : (
        <button
          autoFocus
          className={`reopen-button${window.windowState === 'minimized' ? ' reopen-button--minimized' : ''}`}
          onClick={window.reopen}
          aria-label={window.windowState === 'minimized' ? t("Восстановить окно Tesify") : t("Открыть Tesify")}
        >
          <Logo className="reopen-logo" width="40" height="40" />
          <span>{window.windowState === 'minimized' ? t("Развернуть Tesify") : t("Открыть Tesify")}</span>
        </button>
      )}
    </div>
  )
}
