/**
 * Entry point.
 *
 * Deliberately thin. Everything it does beyond mounting is documented below,
 * because an entry point that quietly does five things is where startup bugs
 * hide.
 */
import { createRoot } from 'react-dom/client'

import { App } from './ui/App.tsx'
import { ErrorBoundary } from './ui/components/ErrorBoundary.tsx'
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
  /*
   * The boundary *above* `App`, not the one inside it.
   *
   * `App` renders its own per-screen `ErrorBoundary`, and a component cannot be
   * protected by a boundary it renders itself — so anything `App` threw during
   * render or from one of its own effects unmounted the entire root and left a
   * black page with no text on it. That is exactly how a missing iOS Pointer
   * Lock API presented: unplayable, silent, and invisible to every desktop test.
   *
   * This one catches that class of failure and prints what broke. It is not a
   * substitute for fixing the fault; it is the difference between a bug report
   * that says "the screen is dark" and one that names the function.
   */
  createRoot(container).render(
    <ErrorBoundary screen="startup" root>
      <App />
    </ErrorBoundary>,
  )
}
