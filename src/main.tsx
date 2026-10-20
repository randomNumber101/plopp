import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerSW } from 'virtual:pwa-register'

// Neue Version sofort holen: beim Zurückkehren in die App und alle 30 Minuten nach Updates schauen.
// Mit registerType 'autoUpdate' lädt die Seite neu, sobald die neue Version bereitsteht –
// sonst bliebe ein als App installiertes Plopp! tagelang auf dem alten Stand.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => void reg.update().catch(() => {})
    window.setInterval(check, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
