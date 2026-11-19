import { useTranslation } from '../../preferences/i18n'
import Icon from '../../ui/Icon/Icon'
import type { IconName } from '../../ui/Icon/Icon'
import Logo from '../../ui/Logo/Logo'
import type { PageId } from '../../../app/navigation'
import './Sidebar.css'

const navigation: { id: PageId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Главная', icon: 'dashboard' },
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'library', label: 'Библиотека', icon: 'library' },
]

type SidebarProps = {
  activePage: PageId
  onNavigate: (page: PageId) => void
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const t = useTranslation()
  const selectedIndex = navigation.findIndex(({ id }) => id === activePage)
  return (
    <aside className="sidebar" aria-label={t("Боковая панель")}>
      <button
        className="brand-button"
        aria-label={t("О программе Tesify")}
        onClick={() => onNavigate('about')}
      >
        <Logo className="brand-logo" width="48" height="44" />
      </button>

      <nav className="navigation" aria-label={t("Основная навигация")}>
        {selectedIndex >= 0 && <div className="navigation-selection" aria-hidden="true" style={{ clipPath: `inset(calc(${selectedIndex} * var(--navigation-step)) 0 calc(${navigation.length - selectedIndex - 1} * var(--navigation-step)) round 13px)` }}>
          {navigation.map(({ id, icon }) => <span key={id}><Icon name={icon} /></span>)}
        </div>}
        {navigation.map(({ id, label, icon }) => (
          <button
            key={id}
            className="navigation-button"
            aria-label={t(label)}
            aria-current={activePage === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </nav>
      <button type="button" className="navigation-button settings-button" aria-label={t("Настройки")} title={t("Настройки")} aria-current={activePage === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}>
        <Icon name="settings" />
      </button>
    </aside>
  )
}
