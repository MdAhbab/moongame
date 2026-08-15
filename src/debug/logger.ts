/**
 * Development-only logging (gameplan Rule 10).
 *
 * "No `console.log` in production code. A dev-only debug logger, stripped at
 * build." `import.meta.env.DEV` is statically replaced by Vite, so these calls
 * and the strings inside them are eliminated by dead-code removal in a
 * production build rather than merely being skipped at runtime.
 *
 * Errors are the one exception: an error that reaches here in production is
 * something we would want to know about, and silence would violate the rest of
 * Rule 10 — never swallow an error.
 */

/* eslint-disable no-console -- this module is the sanctioned console boundary. */

const PREFIX = '[mare-noctis]'

export function debug(...args: readonly unknown[]): void {
  if (import.meta.env.DEV) console.debug(PREFIX, ...args)
}

export function warn(...args: readonly unknown[]): void {
  if (import.meta.env.DEV) console.warn(PREFIX, ...args)
}

/**
 * Always reported. If you catch an error you either handle it meaningfully or
 * log it with enough context to debug — this is the second path.
 */
export function logError(message: string, error: unknown, context = ''): void {
  console.error(PREFIX, message, error, context)
}
