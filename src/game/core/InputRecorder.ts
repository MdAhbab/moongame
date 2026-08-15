/**
 * Recording and replaying a run's input (gameplan §10.4, §37.3).
 *
 * ## What this is for
 *
 * The simulation is deterministic: same seed, same inputs, same state, asserted
 * at ten thousand steps. That makes a *replay* possible, and a replay makes two
 * things possible that this game could not otherwise have.
 *
 * **A leaderboard that cannot be forged.** The client submits the seed and the
 * input log rather than a score; the server replays it through this same code in
 * Node and accepts the result only if it reproduces. A score endpoint that takes
 * a number is a leaderboard of whoever opens devtools first.
 *
 * **A bug report that is a bug.** "It happened around wave 7" becomes a file
 * that reproduces the exact frame.
 *
 * ## Why it is this small
 *
 * `InputState` is eight numbers and four flags, sampled at the head of every
 * fixed step. At 120 Hz a twelve-wave run is on the order of 100,000 steps, and
 * storing that naively would be megabytes.
 *
 * It compresses to almost nothing because **input is overwhelmingly constant**.
 * A player holds a turn for half a second — sixty identical steps — then holds
 * another. So the log is run-length encoded over *changes*: a frame is written
 * only when the input differs from the previous one, and each entry carries how
 * many steps it lasted. Axes are quantised to a signed byte first, which is
 * finer than any human input and turns near-identical analogue frames into
 * genuinely identical ones.
 *
 * ## The quantisation is not lossy in a way that matters — but it must be applied
 *
 * A replay must feed the simulation the **quantised** values, not the originals,
 * or the recording and the replay diverge on the first analogue frame. So
 * `InputRecorder.record` writes the quantised value back into the world's input
 * as it records: what the simulation sees is what the log holds, always. Getting
 * this wrong produces a replay that works for keyboard players and fails for
 * anybody using a mouse, which is the kind of bug that reaches production.
 */
import type { InputState, World } from './World.ts'

/**
 * The wire format version.
 *
 * Distinct from `SIM_VERSION`: this changes when the *encoding* changes, that
 * changes when the *physics* change. A replay needs both to match.
 */
export const REPLAY_FORMAT = 2

/** One run of identical input. */
export interface InputFrame {
  /** How many fixed steps this input was held for. */
  steps: number
  /** Axes, quantised to [-127, 127]. */
  steerX: number
  steerY: number
  strafe: number
  climb: number
  /** Throttle, quantised to [0, 127]. */
  throttle: number
  /**
   * Bit 0 firing, 1 locking, 2 boosting, 3 flaring, 4 bombing, 5 weapon switch,
   * 6 engine cut, 7 drone bay.
   *
   * The last three were missing, and their absence was not cosmetic: a replay
   * that dropped them reproduced a run in which the player never dropped a
   * bomb, never changed weapon and never cut the engine — so an honest run flown
   * with any of them scored differently on the verifier than it did on the
   * player's screen, and came back rejected.
   */
  buttons: number
  /** Enemy slot requested for lock, or -1. */
  lockTarget: number
}

/**
 * The physical context a run was flown in.
 *
 * **Identifiers, never multipliers.** The world registry and the part registry
 * are the authority on what a world and a part do; a replay only records *which*
 * ones were in play. That is the difference between a verifier and a rubber
 * stamp — sending `{ gravity: 0.1 }` would let a client define the physics its
 * own run is checked against.
 *
 * A replay is meaningless without this. Gravity and drag vary by world and every
 * flight multiplier varies by equipped parts, so the same seed and the same
 * inputs legitimately produce different scores in different contexts.
 */
export interface RunContext {
  readonly worldId: string
  /** Slot → part id. Empty means stock, which is what a new pilot flies. */
  readonly equipped: Readonly<Record<string, string>>
}

export interface Replay {
  readonly format: number
  readonly simVersion: number
  readonly seed: string
  readonly endless: boolean
  readonly context: RunContext
  readonly frames: readonly InputFrame[]
  /** Total fixed steps, so a truncated log is detectable without replaying it. */
  readonly steps: number
}

const AXIS_SCALE = 127

/**
 * Axis → signed byte.
 *
 * The `|| 0` is not decoration. `Math.round(-0.001 * 127)` is **negative zero**,
 * and negative zero does not survive a round trip: `JSON.stringify(-0)` is
 * `"0"`, and the packed form cannot represent the sign of zero either. Leaving
 * it in means a replay compares unequal to itself after serialisation — for a
 * value that behaves identically in every arithmetic operation, which is
 * exactly the kind of difference that costs an afternoon.
 */
function quantiseAxis(value: number): number {
  if (!Number.isFinite(value)) return 0
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value
  return Math.round(clamped * AXIS_SCALE) || 0
}

/** Signed byte → axis. See `quantiseAxis` for why zero is normalised. */
function dequantiseAxis(value: number): number {
  return value / AXIS_SCALE || 0
}

function quantiseThrottle(value: number): number {
  if (!Number.isFinite(value)) return 0
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value
  return Math.round(clamped * AXIS_SCALE) || 0
}

function sameFrame(frame: InputFrame, next: Omit<InputFrame, 'steps'>): boolean {
  return (
    frame.steerX === next.steerX &&
    frame.steerY === next.steerY &&
    frame.strafe === next.strafe &&
    frame.climb === next.climb &&
    frame.throttle === next.throttle &&
    frame.buttons === next.buttons &&
    frame.lockTarget === next.lockTarget
  )
}

/**
 * Captures input as the simulation samples it.
 *
 * Wraps `Simulation.sampleInput`, so it sees exactly what the world sees — after
 * every device has been combined and after conditioning, but before the step.
 * Recording anywhere else would capture something the simulation never ran on.
 */
export class InputRecorder {
  private readonly frames: InputFrame[] = []
  private totalSteps = 0

  /**
   * Records the current input, and normalises it in place.
   *
   * The write-back is the load-bearing half. Quantising for storage while
   * letting the simulation run on the unrounded value means the log does not
   * describe the run it came from, and every replay of a mouse-flown run
   * diverges within a second.
   *
   * @hot-path — runs once per fixed step, allocating only on a change.
   */
  record(input: InputState): void {
    const steerX = quantiseAxis(input.steerX)
    const steerY = quantiseAxis(input.steerY)
    const strafe = quantiseAxis(input.strafe)
    const climb = quantiseAxis(input.climb)
    const throttle = quantiseThrottle(input.throttle)
    const buttons =
      (input.firing ? 1 : 0) |
      (input.locking ? 2 : 0) |
      (input.boosting ? 4 : 0) |
      (input.flaring ? 8 : 0) |
      (input.bombing ? 16 : 0) |
      (input.switchWeapon ? 32 : 0) |
      (input.engineCutToggle ? 64 : 0) |
      (input.deployDrones ? 128 : 0)
    const lockTarget = Math.trunc(input.requestLockTarget)

    input.steerX = dequantiseAxis(steerX)
    input.steerY = dequantiseAxis(steerY)
    input.strafe = dequantiseAxis(strafe)
    input.climb = dequantiseAxis(climb)
    input.throttle = dequantiseAxis(throttle)
    input.requestLockTarget = lockTarget

    this.totalSteps++
    const last = this.frames[this.frames.length - 1]
    const next = { steerX, steerY, strafe, climb, throttle, buttons, lockTarget }
    if (last !== undefined && sameFrame(last, next)) {
      last.steps++
      return
    }
    this.frames.push({ steps: 1, ...next })
  }

  get stepCount(): number {
    return this.totalSteps
  }

  /** Distinct input changes — the thing that actually determines the log size. */
  get frameCount(): number {
    return this.frames.length
  }

  build(seed: string, simVersion: number, endless: boolean, context: RunContext): Replay {
    return {
      format: REPLAY_FORMAT,
      simVersion,
      seed,
      endless,
      context: { worldId: context.worldId, equipped: { ...context.equipped } },
      frames: this.frames.map((frame) => ({ ...frame })),
      steps: this.totalSteps,
    }
  }

  reset(): void {
    this.frames.length = 0
    this.totalSteps = 0
  }
}

/**
 * Feeds a recorded log back into a simulation, one step at a time.
 *
 * The counterpart of `InputRecorder`, and it plugs into the same hook, which is
 * what makes the replay path identical to the live one. Past the end of the log
 * it writes neutral input rather than repeating the last frame: a replay that
 * ran out of data should coast, not keep the player's final turn held forever.
 */
export class InputPlayer {
  private frameIndex = 0
  private stepsIntoFrame = 0

  constructor(private readonly replay: Replay) {}

  /** True once every recorded step has been played. */
  get finished(): boolean {
    return this.frameIndex >= this.replay.frames.length
  }

  /** Total steps this replay describes. */
  get stepCount(): number {
    return this.replay.steps
  }

  /** @hot-path */
  apply(input: InputState): void {
    const frame = this.replay.frames[this.frameIndex]
    if (frame === undefined) {
      neutral(input)
      return
    }

    input.steerX = dequantiseAxis(frame.steerX)
    input.steerY = dequantiseAxis(frame.steerY)
    input.strafe = dequantiseAxis(frame.strafe)
    input.climb = dequantiseAxis(frame.climb)
    input.throttle = dequantiseAxis(frame.throttle)
    input.firing = (frame.buttons & 1) !== 0
    input.locking = (frame.buttons & 2) !== 0
    input.boosting = (frame.buttons & 4) !== 0
    input.flaring = (frame.buttons & 8) !== 0
    input.bombing = (frame.buttons & 16) !== 0
    input.switchWeapon = (frame.buttons & 32) !== 0
    input.engineCutToggle = (frame.buttons & 64) !== 0
    input.deployDrones = (frame.buttons & 128) !== 0
    input.requestLockTarget = frame.lockTarget
    // The press edges are *derived*, never played back: `stepInput` recomputes
    // them from the held flags above against the world's own previous step, so
    // the replay produces the same edges the live run did.

    this.stepsIntoFrame++
    if (this.stepsIntoFrame >= frame.steps) {
      this.frameIndex++
      this.stepsIntoFrame = 0
    }
  }

  /** Binds this player to a simulation's input hook. */
  attach(simulation: { sampleInput: ((world: World) => void) | null }): void {
    simulation.sampleInput = (world) => { this.apply(world.input) }
  }
}

function neutral(input: InputState): void {
  input.steerX = 0
  input.steerY = 0
  input.strafe = 0
  input.climb = 0
  input.throttle = 1
  input.firing = false
  input.locking = false
  input.boosting = false
  input.flaring = false
  input.bombing = false
  input.switchWeapon = false
  input.engineCutToggle = false
  input.deployDrones = false
  input.requestLockTarget = -1
}

/* ------------------------------------------------------------------ */
/* The driver                                                          */
/* ------------------------------------------------------------------ */

/**
 * Replays a log and returns the finished simulation.
 *
 * **Both the server and the tests must use this, and neither should write its
 * own loop.** Stepping input alone is not enough to reproduce a run, because a
 * run is not only input: at every wave boundary the *shell* issues commands the
 * world does not issue for itself, and those commands mutate score.
 *
 * Concretely, `captureWaveSummary` calls `settleWave`, which awards the
 * accuracy, no-damage and all-intact bonuses. A replay driver that stepped the
 * world and skipped that call would produce a lower score than the run it was
 * replaying, reject an honest submission, and look exactly like a cheating
 * player. The sequence below mirrors `App.tsx` beat for beat:
 *
 *   poll sees `WaveClear` → `captureWaveSummary()`
 *   Briefing screen       → `advanceWave()`
 *   Playing screen        → `skipBriefing()`
 *
 * The world is frozen on the menus in between, so no steps are consumed there —
 * which is why the step count alone is enough to describe a whole campaign.
 */
export function runReplay(
  replay: Replay,
  make: (seed: string) => ReplayTarget,
): ReplayTarget {
  const sim = make(replay.seed)
  // Before `startRun`, and before anything reads a multiplier. The shell applies
  // the same context at the same moment (on the Briefing beat), through the same
  // method, which is the only reason the two paths can be trusted to agree.
  sim.applyRunContext(replay.context)
  sim.startRun(replay.endless)
  sim.skipBriefing()

  const player = new InputPlayer(replay)
  sim.sampleInput = (world) => { player.apply(world.input) }

  for (let step = 0; step < replay.steps; step++) {
    sim.advance(FIXED_DT_LOCAL)
    sim.world.events.clear()

    const phase = sim.world.phase
    if (phase.kind === 'WaveClear') {
      sim.captureWaveSummary()
      sim.advanceWave()
      sim.skipBriefing()
    } else if (phase.kind === 'RunOver') {
      break
    }
  }

  sim.sampleInput = null
  return sim
}

/**
 * The surface `runReplay` needs.
 *
 * Structural rather than an import of `Simulation`, so this module stays a leaf:
 * `Simulation` already imports half the game, and a cycle between them would
 * make the server's dependency graph unnecessarily wide.
 */
export interface ReplayTarget {
  readonly world: World
  sampleInput: ((world: World) => void) | null
  advance(delta: number): number
  applyRunContext(context: RunContext): void
  startRun(endless?: boolean): void
  skipBriefing(): void
  advanceWave(): void
  captureWaveSummary(): unknown
}

/** Local copy of `FIXED_DT`, so this module does not import the constants table. */
const FIXED_DT_LOCAL = 1 / 120

/* ------------------------------------------------------------------ */
/* The wire form                                                       */
/* ------------------------------------------------------------------ */

/**
 * A packed binary encoding, base64'd — this is what actually crosses the wire.
 *
 * The structured form above is convenient and far too large to send. Run-length
 * encoding only helps when input is *constant*, and for anyone flying with a
 * mouse it very nearly never is: the virtual stick decays exponentially toward
 * centre every step, so the quantised axis changes on most of them. Measured on
 * a mouse-flown run, about 90% of steps produce a new frame — so a twelve-wave
 * run is on the order of 65,000 frames, which as an array of JSON objects is
 * several megabytes.
 *
 * Packed, the same run is around 500 KB, and gzips to a fraction of that. Eight
 * bytes for the common frame:
 *
 * ```
 *   varint  steps          1 byte for runs under 128, which is nearly all of them
 *   int8    steerX steerY strafe climb
 *   uint8   throttle
 *   uint8   buttons        all 8 bits used
 *   varint  lockTarget+1   1 byte for -1, which is nearly always
 * ```
 *
 * Deliberately not a general-purpose serialiser: a fixed layout with no field
 * names is what makes it small, and the format number is what makes changing it
 * safe.
 */
export function encodeReplay(replay: Replay): string {
  // Worst case per frame: 5 varint bytes for steps, 7 fixed, 5 for lockTarget.
  const bytes = new Uint8Array(replay.frames.length * 17 + 16)
  let offset = 0

  const writeVarint = (value: number): void => {
    let remaining = value >>> 0
    while (remaining >= 0x80) {
      bytes[offset++] = (remaining & 0x7f) | 0x80
      remaining >>>= 7
    }
    bytes[offset++] = remaining
  }

  for (const frame of replay.frames) {
    writeVarint(frame.steps)
    // `& 0xff` folds the signed byte into its unsigned representation.
    bytes[offset++] = frame.steerX & 0xff
    bytes[offset++] = frame.steerY & 0xff
    bytes[offset++] = frame.strafe & 0xff
    bytes[offset++] = frame.climb & 0xff
    bytes[offset++] = frame.throttle & 0xff
    bytes[offset++] = frame.buttons & 0xff
    writeVarint(frame.lockTarget + 1)
  }

  return toBase64(bytes.subarray(0, offset))
}

/**
 * Decodes the packed form. Bounded and total, because a server runs this on a
 * payload a player controls.
 */
export function decodeReplayFrames(
  encoded: string,
  limits: { maxSteps: number; maxFrames: number },
): { frames: InputFrame[]; steps: number } | null {
  if (typeof encoded !== 'string' || encoded.length > limits.maxFrames * 24 + 64) return null

  let bytes: Uint8Array
  try {
    bytes = fromBase64(encoded)
  } catch {
    return null
  }

  const frames: InputFrame[] = []
  let offset = 0
  let total = 0

  const readVarint = (): number | null => {
    let result = 0
    let shift = 0
    for (let i = 0; i < 5; i++) {
      if (offset >= bytes.length) return null
      const byte = bytes[offset++] as number
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result >>> 0
      shift += 7
    }
    return null
  }

  const readSigned = (): number | null => {
    if (offset >= bytes.length) return null
    const byte = bytes[offset++] as number
    const value = byte > 127 ? byte - 256 : byte
    return value < -AXIS_SCALE || value > AXIS_SCALE ? null : value
  }

  while (offset < bytes.length) {
    if (frames.length >= limits.maxFrames) return null

    const steps = readVarint()
    if (steps === null || steps < 1) return null
    total += steps
    if (total > limits.maxSteps) return null

    const steerX = readSigned()
    const steerY = readSigned()
    const strafe = readSigned()
    const climb = readSigned()
    if (steerX === null || steerY === null || strafe === null || climb === null) return null

    if (offset >= bytes.length) return null
    const throttle = bytes[offset++] as number
    if (throttle > AXIS_SCALE) return null
    if (offset >= bytes.length) return null
    const buttons = bytes[offset++] as number
    if (buttons > 7) return null

    const lock = readVarint()
    if (lock === null || lock > 4096) return null

    frames.push({ steps, steerX, steerY, strafe, climb, throttle, buttons, lockTarget: lock - 1 })
  }

  return { frames, steps: total }
}

/** Base64 without depending on either `btoa` or `Buffer` being the one present. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number)
  if (typeof btoa === 'function') return btoa(binary)
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(text: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(Buffer.from(text, 'base64'))
}

/**
 * Rebuilds a `Replay` from untrusted JSON.
 *
 * Every field is validated and every count is bounded, because this runs on a
 * server against a payload a player controls. Replay is CPU-bound work on
 * somebody else's infrastructure, so an unbounded `steps` is a denial-of-service
 * vector, not merely bad data.
 *
 * Returns `null` rather than throwing: a malformed submission is an expected
 * condition, not an exception.
 */
/**
 * Validates a submitted `RunContext`.
 *
 * Shape and bounds only — this module is a leaf and does not know the world or
 * part registries. Meaning is checked where the registries live: `resolveLoadout`
 * already discards a part that is unknown or in the wrong slot, and
 * `applyRunContext` falls back to the default world for an unknown id. So the
 * job here is to guarantee the *shape* is safe to hand on: no prototype
 * pollution through a crafted key, and no unbounded map.
 */
export function parseRunContext(value: unknown): RunContext | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  if (typeof raw.worldId !== 'string' || raw.worldId.length === 0 || raw.worldId.length > 64) return null

  if (typeof raw.equipped !== 'object' || raw.equipped === null) return null
  const source = raw.equipped as Record<string, unknown>

  const equipped: Record<string, string> = {}
  // `Object.keys` rather than `for…in`, so an inherited key cannot appear, and
  // a hard cap so a submission cannot arrive with a hundred thousand slots.
  const keys = Object.keys(source)
  if (keys.length > 16) return null
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return null
    if (key.length > 32) return null
    const id: unknown = source[key]
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
    equipped[key] = id
  }

  return { worldId: raw.worldId, equipped }
}

export function parseReplay(value: unknown, limits: { maxSteps: number; maxFrames: number }): Replay | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  if (raw.format !== REPLAY_FORMAT) return null
  if (typeof raw.simVersion !== 'number' || !Number.isInteger(raw.simVersion)) return null
  if (typeof raw.seed !== 'string' || raw.seed.length === 0 || raw.seed.length > 64) return null
  if (typeof raw.steps !== 'number' || !Number.isInteger(raw.steps)) return null
  if (raw.steps < 0 || raw.steps > limits.maxSteps) return null
  if (!Array.isArray(raw.frames) || raw.frames.length > limits.maxFrames) return null

  const frames: InputFrame[] = []
  let counted = 0
  for (const entry of raw.frames) {
    if (typeof entry !== 'object' || entry === null) return null
    const frame = entry as Record<string, unknown>
    const steps = frame.steps
    if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1) return null
    counted += steps
    if (counted > limits.maxSteps) return null

    const axis = (key: string, min: number): number | null => {
      const raw = frame[key]
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return null
      return raw < min || raw > AXIS_SCALE ? null : raw
    }
    const steerX = axis('steerX', -AXIS_SCALE)
    const steerY = axis('steerY', -AXIS_SCALE)
    const strafe = axis('strafe', -AXIS_SCALE)
    const climb = axis('climb', -AXIS_SCALE)
    const throttle = axis('throttle', 0)
    if (steerX === null || steerY === null || strafe === null || climb === null || throttle === null) {
      return null
    }

    const buttons = frame.buttons
    if (typeof buttons !== 'number' || !Number.isInteger(buttons) || buttons < 0 || buttons > 7) return null

    const lockTarget = frame.lockTarget
    if (typeof lockTarget !== 'number' || !Number.isInteger(lockTarget) || lockTarget < -1 || lockTarget > 4095) {
      return null
    }

    frames.push({ steps, steerX, steerY, strafe, climb, throttle, buttons, lockTarget })
  }

  // The declared total has to match what the frames actually add up to, or a
  // submission could claim a short run and then replay a long one.
  if (counted !== raw.steps) return null

  const context = parseRunContext(raw.context)
  if (context === null) return null

  return {
    format: REPLAY_FORMAT,
    simVersion: raw.simVersion,
    seed: raw.seed,
    endless: raw.endless === true,
    context,
    frames,
    steps: raw.steps,
  }
}
