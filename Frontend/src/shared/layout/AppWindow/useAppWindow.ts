import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

type WindowState = 'open' | 'minimized' | 'closed'

export function useAppWindow() {
  const isNative = isTauri()
  const [windowState, setWindowState] = useState<WindowState>('open')
  const [isMaximized, setIsMaximized] = useState(false)
  const [windowError, setWindowError] = useState<string | null>(null)

  const runNative = useCallback(async (action: () => Promise<void>) => {
    setWindowError(null)
    try {
      await action()
    } catch (error) {
      console.error('Ошибка управления окном Tesify:', error)
      setWindowError('Не удалось выполнить действие с окном. Попробуйте ещё раз.')
    }
  }, [])

  useEffect(() => {
    if (!isNative) return

    document.documentElement.dataset.desktop = 'true'
    let disposed = false
    const currentWindow = getCurrentWindow()
    const syncMaximized = async () => {
      const maximized = await currentWindow.isMaximized()
      if (!disposed) setIsMaximized(maximized)
    }

    void runNative(syncMaximized)
    const listener = currentWindow.onResized(() => { void runNative(syncMaximized) })
    void listener.catch((error: unknown) => {
      if (!disposed) {
        console.error('Не удалось отслеживать размер окна:', error)
        setWindowError('Не удалось получить состояние окна.')
      }
    })

    return () => {
      disposed = true
      delete document.documentElement.dataset.desktop
      void listener.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [isNative, runNative])

  function minimize() {
    if (isNative) void runNative(() => getCurrentWindow().minimize())
    else setWindowState('minimized')
  }

  function toggleMaximize() {
    if (isNative) {
      void runNative(async () => {
        const currentWindow = getCurrentWindow()
        await currentWindow.toggleMaximize()
        setIsMaximized(await currentWindow.isMaximized())
      })
    } else setIsMaximized((value) => !value)
  }

  function close() {
    if (isNative) void runNative(() => getCurrentWindow().close())
    else setWindowState('closed')
  }

  return {
    isNative, windowState, isMaximized, windowError,
    minimize, toggleMaximize, close,
    reopen: () => setWindowState('open'),
  }
}
