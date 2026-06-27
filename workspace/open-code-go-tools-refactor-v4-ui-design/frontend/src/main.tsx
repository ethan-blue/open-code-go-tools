import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/fonts.css'
import './styles/v4-design.css'
import './styles/globals.css'

// ── Theme initialization (runs before React mounts) ──
;(function initTheme() {
  const saved = localStorage.getItem('theme') || 'system'
  const resolved =
    saved === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : saved
  document.documentElement.setAttribute('data-theme', resolved)

  const hue = localStorage.getItem('accent-hue')
  if (hue) {
    document.documentElement.style.setProperty('--accent-h', hue)
  }
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
