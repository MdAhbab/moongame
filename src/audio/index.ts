/**
 * Public surface of the audio layer (gameplan §27).
 *
 * A presentation-side layer in the same tier as `src/render/` — see the header
 * of `AudioEngine.ts` for why the Web Audio implementation lives here rather
 * than at §30.1's `game/systems/AudioSystem.ts`.
 *
 * Two things a consumer needs:
 *   `AudioDirector` — construct one, `unlock()` it from the first gesture, and
 *                     call `update(world, dt)` once per frame from the render
 *                     bridge. Everything else follows from the world.
 *   `AudioEngine`   — the mixer behind the Settings > Audio tab (§14.3).
 *
 * `music.ts` is intentionally absent: it is reachable only by the dynamic
 * import inside `AudioEngine`, which is what makes it a separate chunk (§33.4).
 */
export { AudioDirector } from './AudioDirector.ts'
export { AudioEngine, type AudioGraph } from './AudioEngine.ts'
export { Synth } from './synth.ts'
