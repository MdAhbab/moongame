/**
 * Development-only diagnostics for the audio layer (Rule 10).
 *
 * `no-console` is a lint error project-wide, and correctly so: a shipped game
 * that chatters in the console is a game that has no idea what its users see.
 * The audio layer still needs a way to say "the music file is missing" during
 * development, because that failure is otherwise *completely silent* by design.
 *
 * The `DEV` guard is a compile-time constant, so Vite replaces it with `false`
 * in a production build and the call below is removed by dead-code elimination
 * — there is no `console` reference in the shipped bundle at all.
 */

/** Logs an audio diagnostic in development builds only. Compiled out of production. */
export function debug(message: string): void {
  if (!import.meta.env.DEV) return
  // eslint-disable-next-line no-console -- dev-only; stripped by the DEV guard above.
  console.info(`[audio] ${message}`)
}
