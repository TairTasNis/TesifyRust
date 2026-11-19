import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import './WindowControls.css'

type WindowControlsProps = {
  isMaximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export default function WindowControls({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  const t = useTranslation()
  return (
    <div className="window-controls" role="group" aria-label={t("Управление окном")}>
      <button className="window-button" aria-label={t("Свернуть")} title={t("Свернуть")} onClick={onMinimize}>
        <Icon name="minimize" />
      </button>
      <button
        className="window-button"
        aria-label={isMaximized ? t("Восстановить размер") : t("Развернуть")}
        title={isMaximized ? t("Восстановить размер") : t("Развернуть")}
        onClick={onToggleMaximize}
      >
        <Icon name={isMaximized ? 'restore' : 'maximize'} />
      </button>
      <button className="window-button window-button--close" aria-label={t("Закрыть")} title={t("Закрыть")} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  )
}
