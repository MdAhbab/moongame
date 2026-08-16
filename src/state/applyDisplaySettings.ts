/**
 * Pushes persisted display / accessibility settings onto the document.
 *
 * Settings used to write `--hud-scale`, `data-contrast` and reduced-motion
 * only from the Settings screen's onChange handlers, so a saved preference
 * did nothing until the player re-opened that tab. One function, called at
 * boot and from every toggle, is the whole fix.
 */
import type { Settings } from './persistence.ts'

export function applyDisplaySettings(settings: Settings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const display = settings.display
  root.setAttribute('data-contrast', display.colorMode === 'high-contrast' ? 'high' : 'default')
  root.style.setProperty('--hud-scale', String(display.hudScale / 100))
  root.dataset.reducedMotion = settings.accessibility.reducedMotion ? 'true' : 'false'
}
