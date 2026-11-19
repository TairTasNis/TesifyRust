import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import '@fontsource/michroma/latin-400.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/cyrillic-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/cyrillic-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/cyrillic-700.css'
import '@fontsource/manrope/cyrillic-ext-400.css'
import '@fontsource/manrope/cyrillic-ext-500.css'
import '@fontsource/manrope/cyrillic-ext-600.css'
import '@fontsource/manrope/cyrillic-ext-700.css'
import './shared/styles/global.css'

if (/Android/i.test(navigator.userAgent)) {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewport) viewport.content += ', viewport-fit=cover, interactive-widget=resizes-content'
}

document.addEventListener('contextmenu', event => event.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
