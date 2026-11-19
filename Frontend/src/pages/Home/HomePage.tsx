import { useTranslation } from '../../shared/preferences/i18n'
export default function HomePage() {
  const t = useTranslation()
  return (
    <main className="workspace" aria-label={t("Главная")}>
      <h1 className="visually-hidden">{t("Главная")}</h1>
    </main>
  )
}
