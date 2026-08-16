/**
 * The UI's route to the audio layer (gameplan §14.3, §27.4).
 *
 * `AudioDirector` has carried `uiClick`, `uiHover`, `uiConfirm` and `uiBack`
 * since the audio track landed, and `synth.ts` implements all four — a click, a
 * hover near the floor of audibility, a rising two-tone confirm and its
 * inversion for a dismissal. **Nothing called any of them.** The director is
 * owned by a `useRef` inside `App`, and no screen has a reference to it, so
 * every button in the game was silent while the *cockpit* voices leaked over
 * the menus. The one part of the mix the player interacts with directly was the
 * one part that made no sound.
 *
 * A module-level slot rather than a React context, for three reasons:
 *
 *  - `Button` is rendered inside the hot HUD as well as on menus, and a context
 *    read is a subscription — one more thing that can re-render the tree during
 *    play, which §17.2 forbids outright.
 *  - There is exactly one director for the life of the document, created once in
 *    a ref. A context would model a value that can change to carry one that
 *    cannot.
 *  - It keeps the dependency pointing the right way. `src/ui/` already may not
 *    import the simulation; making it import the *director* would hand every
 *    screen `update()` and `reset()` as well, when all it needs is four sounds.
 *
 * Every function here is a no-op until `registerUiAudio` runs and, beneath that,
 * until the engine is unlocked by a real gesture — so importing this from a test
 * or a headless render costs nothing and throws nothing.
 */
import type { AudioDirector } from './AudioDirector.ts'

let director: AudioDirector | null = null

/**
 * Points the bus at the live director, or clears it on teardown.
 *
 * Called once from the shell. Passing `null` matters for StrictMode and for the
 * ErrorBoundary's "Try again", both of which tear the tree down and build it
 * back: a stale director left in this slot would be one whose `AudioContext`
 * the new tree has already replaced.
 */
export function registerUiAudio(next: AudioDirector | null): void {
  director = next
}

/** A button press. */
export function uiClick(): void {
  director?.uiClick()
}

/** Focus or hover moved. Deliberately the quietest sound in the game. */
export function uiHover(): void {
  director?.uiHover()
}

/** A choice committed — a perk taken, a part fitted, a run started. */
export function uiConfirm(): void {
  director?.uiConfirm()
}

/** A screen dismissed. */
export function uiBack(): void {
  director?.uiBack()
}
