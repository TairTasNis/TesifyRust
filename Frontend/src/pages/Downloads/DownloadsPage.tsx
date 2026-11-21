import { useTranslation } from '../../shared/preferences/i18n'
import Icon from '../../shared/ui/Icon/Icon'
import '../Library/LibraryPage.css'
import './DownloadsPage.css'

export default function DownloadsPage({ onBack }: { onBack: () => void }) {
  const t = useTranslation()
  return <main className="workspace library-page downloads-page" aria-label={t('Скачанные треки')}>
    <button type="button" className="downloads-back" onClick={onBack}><Icon name="back" />{t('Библиотека')}</button>
    <header className="library-header"><h1>{t('Скачанные треки')}</h1></header>
    <div className="library-message"><Icon name="import" /><h2>{t('Скачанных треков пока нет')}</h2></div>
  </main>
}
