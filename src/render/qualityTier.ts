/**
 * Picking a starting quality tier from the device (gameplan §17.6).
 *
 * ## Why this file exists
 *
 * §17.6 has always specified automatic detection — "renderer string,
 * `deviceMemory`, `hardwareConcurrency`, and a startup frame-time probe" — and
 * it was never built. Every device started on **High**, because the shipped
 * default for `settings.display.quality` is `'high'` and the shell mapped that
 * straight onto the tier.
 *
 * On a phone that is not a small regression, it is the whole game:
 *
 * | tier | Pixel 7, measured | draw calls | backbuffer |
 * |------|-------------------|-----------|------------|
 * | High | **1.4 fps**       | 50        | 824 × 1678 |
 * | Low  | **30 fps**        | 28        | 412 × 839  |
 *
 * That is not a CPU problem — 1.4 fps was measured with *no* CPU throttling at
 * all. It is fill rate. High tier asks a phone GPU for a 1.38-megapixel
 * backbuffer, a full-resolution bloom pass with a large kernel, god rays, and a
 * 2048² shadow map. Low tier drops the composer entirely, halves the DPR to 1.0
 * and quarters the shadow work, and the same device runs the same scene at 30.
 *
 * The adaptive downgrade in `App` cannot rescue this. It gates on a full
 * 180-frame window, and at 1.4 fps a window takes **over two minutes** to fill —
 * then drops a single tier, so reaching Low from High is four minutes of
 * slideshow. A player has closed the tab in five seconds.
 *
 * ## Detection is a heuristic, so the player always outranks it
 *
 * There is no honest way to ask a browser "will this run at 60?" before drawing
 * anything, so everything below is a guess from proxies. It is deliberately
 * *pessimistic*: the cost of guessing Low on a device that could have managed
 * High is a slightly plainer picture, and the cost of guessing High on a device
 * that cannot is an unplayable game. Those are not symmetrical.
 *
 * Which is why `settings.display.quality` has an explicit `'low'` and `'high'`
 * alongside `'auto'`, and an explicit choice is never second-guessed by this
 * file. Being wrong about someone's hardware is forgivable; being wrong and
 * unfixable is not — the same rule `deviceProfile.ts` follows for trackpads.
 */

export type QualityTier = 'High' | 'Medium' | 'Low'

/**
 * GPU families that are mobile parts whatever the device claims to be.
 *
 * Matched against `WEBGL_debug_renderer_info`'s unmasked renderer, which most
 * browsers still expose. Chrome ≥ 119 and Safari return a *masked* generic
 * string to reduce fingerprinting, so this check silently finds nothing on many
 * modern browsers — it is a bonus signal, never the only one, and the pointer
 * and memory tests below carry the decision on their own.
 */
const MOBILE_GPU = /adreno|mali|powervr|apple\s*gpu|apple\s*a\d|videocore|immortalis|xclipse/i

/** Software rasterisers. Anything here cannot afford a composer at any size. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render|microsoft basic/i

export interface DeviceHints {
  /** `WEBGL_debug_renderer_info` unmasked renderer, when the browser gives one. */
  renderer: string
  /** `navigator.deviceMemory` in GB, or 0 when unreported (Safari, Firefox). */
  memoryGb: number
  /** `navigator.hardwareConcurrency`, or 0 when unreported. */
  cores: number
  /** True when the primary pointer is coarse and cannot hover — a touch device. */
  touchPrimary: boolean
  /** Physical backbuffer pixels the display would ask for at full DPR. */
  pixels: number
}

/**
 * Reads the device signals, defensively.
 *
 * Every lookup here is optional in some browser, so all of them are guarded and
 * the whole thing is wrapped: a detection routine that throws would take the
 * game's first paint with it, which is a far worse failure than a wrong guess.
 */
export function readDeviceHints(): DeviceHints {
  const hints: DeviceHints = { renderer: '', memoryGb: 0, cores: 0, touchPrimary: false, pixels: 0 }
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return hints

  try {
    const nav = navigator as Navigator & { deviceMemory?: number }
    hints.memoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 0
    hints.cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0

    // `(hover: none)` alongside `(pointer: coarse)` rather than either alone. A
    // touchscreen laptop reports a coarse pointer *and* hover, and it is a
    // desktop GPU that should get the desktop tier.
    hints.touchPrimary =
      window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches

    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    hints.pixels = Math.round(window.innerWidth * dpr) * Math.round(window.innerHeight * dpr)
  } catch {
    // Leave the defaults. Every one of them is the conservative answer.
  }

  try {
    // A throwaway context: creating one costs a few milliseconds at boot and is
    // released immediately, and it must not be the game's canvas — asking for a
    // second context on the same element returns null and would poison the scene.
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
    if (gl !== null) {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      if (info !== null) {
        hints.renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '')
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    // Renderer string is the least load-bearing signal here. Carry on without it.
  }

  return hints
}

/**
 * The tier a device should *start* on.
 *
 * Ordered so the cheapest and most reliable signals decide first. Note that a
 * high pixel count on its own is not evidence of a weak device — a 4K desktop
 * has plenty of pixels and the GPU to fill them — so it only counts once the
 * device has already been identified as mobile.
 */
export function tierForDevice(hints: DeviceHints): QualityTier {
  if (SOFTWARE_GPU.test(hints.renderer)) return 'Low'

  const mobile = hints.touchPrimary || MOBILE_GPU.test(hints.renderer)

  /*
   * A phone or tablet gets Low. Not "a weak phone" — every phone.
   *
   * The tempting version of this branch promotes a flagship to Medium on core
   * count and memory. I measured High at 1.4 fps and Low at 30 on the same
   * handset and have no measurement of Medium on real mobile silicon at all,
   * and Medium still runs the composer: a half-resolution bloom, a 1024² shadow
   * map and a 1.5× backbuffer. Guessing that a device can afford a composer,
   * from numbers that do not describe its GPU, is exactly the guess that
   * produced this bug.
   *
   * The asymmetry decides it. Guessing Low on a phone that could have managed
   * Medium costs a bloom pass. Guessing Medium on one that cannot costs the
   * game. A player whose phone handles more can say so in Settings, and that
   * choice is honoured outright.
   */
  if (mobile) return 'Low'

  // Desktop-ish. `deviceMemory` caps at 8 in every browser that reports it, so
  // "≤ 2 GB" means a genuinely small machine rather than a big one being modest,
  // and an unreported 0 is not treated as evidence of anything.
  if (hints.memoryGb > 0 && hints.memoryGb <= 2) return 'Medium'
  if (hints.cores > 0 && hints.cores <= 2) return 'Medium'

  return 'High'
}

/** Convenience wrapper: read the device and pick a tier in one call. */
export function detectTier(): QualityTier {
  return tierForDevice(readDeviceHints())
}

/**
 * Resolves the setting and the device into the tier to start on.
 *
 * `'auto'` defers to detection. An explicit `'low'` or `'high'` is the player
 * talking, and wins outright — including a player on a phone who would rather
 * have the picture than the frame rate, which is their call to make.
 */
export function resolveInitialTier(setting: 'auto' | 'low' | 'high'): QualityTier {
  if (setting === 'low') return 'Low'
  if (setting === 'high') return 'High'
  return detectTier()
}
