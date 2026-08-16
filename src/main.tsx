/**
 * Entry point.
 *
 * Deliberately thin. Everything it does beyond mounting is documented below,
 * because an entry point that quietly does five things is where startup bugs
 * hide.
 */
import { createRoot } from 'react-dom/client'

import { App } from './ui/App.tsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/fonts.css'
import { applyDisplaySettings } from './state/applyDisplaySettings.ts'
import { useSettingsStore } from './state/useSettingsStore.ts'
import { logError } from './debug/logger.ts'

applyDisplaySettings(useSettingsStore.getState().settings)

const container = document.getElementById('root')

if (container === null) {
  // Rule 10 — never fail silently. A missing root means the HTML shell is
  // wrong, and a blank page would give no clue why.
  logError('No #root element — index.html is missing its mount point', new Error('root not found'))
} else {
  /*
   * `StrictMode` used to wrap the whole app from here. It now wraps the UI layer
   * only, inside `App` — see the note there.
   *
   * The short version: its double-invoked effects mount the WebGL renderer, tear
   * it down, and mount it again, and R3F's teardown calls three's
   * `forceContextLoss()`. That permanently kills the context of the canvas React
   * then reuses, so `npm run dev` rendered a black scene under a working menu
   * while the production build — where React does not double-invoke — was
   * perfectly healthy. Every test passed against a game nobody could develop on.
   */
  createRoot(container).render(<App />)
}
