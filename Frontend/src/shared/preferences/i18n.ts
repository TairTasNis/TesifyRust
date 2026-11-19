import messages from './messages'
import { currentLanguage, usePreferences } from './preferences'
import type { Language } from './preferences'

function translator(language: Language) {
  return (key: string, ...values: (string | number)[]) => {
    const pair = Object.hasOwn(messages, key) ? messages[key] : undefined
    const value = language === 'ru' || !pair ? key : pair[language === 'en' ? 0 : 1]
    return values.length ? value.replace(/\{(\d+)\}/g, (placeholder, index) => String(values[Number(index)] ?? placeholder)) : value
  }
}

const translations = { ru: translator('ru'), en: translator('en'), kk: translator('kk') }
export const useTranslation = () => translations[usePreferences().language]
export const translate = (key: string, ...values: (string | number)[]) => translations[currentLanguage()](key, ...values)
