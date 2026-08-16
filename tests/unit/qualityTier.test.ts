/**
 * Device-driven quality selection (§17.6).
 *
 * This file exists because the detection §17.6 specifies was never built, and
 * the gap was invisible on every machine the game was developed on. The shipped
 * default for `display.quality` was `'high'`, the shell mapped that straight to
 * the High tier, and nothing anywhere asked the device a question.
 *
 * On a Pixel 7 that produced **1.4 fps against Low tier's 30 on the same
 * handset**, with no CPU throttling involved — a 20× gap that made the game
 * unplayable on phones while every desktop test passed.
 *
 * The assertions below are about the *decision*, not the thresholds, so
 * retuning a core count or a memory figure leaves them quiet. What they will
 * not let pass is a touch device being handed the High tier again.
 */
import { describe, expect, it } from 'vitest'
import { tierForDevice, resolveInitialTier, type DeviceHints } from '@/render/qualityTier'

function hints(overrides: Partial<DeviceHints> = {}): DeviceHints {
  return {
    renderer: '',
    memoryGb: 8,
    cores: 8,
    touchPrimary: false,
    pixels: 1_920_000,
    ...overrides,
  }
}

describe('a phone never starts on High', () => {
  it('never returns High for a touch-primary device, whatever else it reports', () => {
    // The single assertion this whole file exists for. Every combination of
    // memory, cores and pixel count that a handset could plausibly report.
    for (const memoryGb of [0, 2, 4, 6, 8]) {
      for (const cores of [0, 2, 4, 6, 8, 12]) {
        for (const pixels of [800_000, 1_380_000, 2_600_000, 4_000_000]) {
          const tier = tierForDevice(hints({ touchPrimary: true, memoryGb, cores, pixels }))
          expect(tier, `mem=${memoryGb} cores=${cores} px=${pixels}`).not.toBe('High')
        }
      }
    }
  })

  it('puts every touch device on Low, flagship or not', () => {
    // Deliberately not "a weak phone" — every phone. Medium still runs the
    // composer, and core count and memory say nothing about a GPU's fill rate.
    // Guessing capability from numbers that do not describe it is the guess
    // that produced this bug in the first place.
    expect(tierForDevice(hints({ touchPrimary: true, cores: 4, memoryGb: 4 }))).toBe('Low')
    expect(tierForDevice(hints({ touchPrimary: true, cores: 8, memoryGb: 8 }))).toBe('Low')
    expect(tierForDevice(hints({ touchPrimary: true, cores: 16, memoryGb: 16, pixels: 900_000 }))).toBe('Low')
  })

  it('recognises a mobile GPU even when the pointer looks like a desktop', () => {
    for (const renderer of ['Adreno (TM) 730', 'Mali-G710', 'Apple GPU', 'PowerVR B-Series']) {
      expect(tierForDevice(hints({ renderer })), renderer).not.toBe('High')
    }
  })

  it('sends a software rasteriser straight to Low', () => {
    // No GPU at all. The composer is not affordable at any resolution.
    expect(tierForDevice(hints({ renderer: 'Google SwiftShader' }))).toBe('Low')
    expect(tierForDevice(hints({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }))).toBe('Low')
  })
})

describe('a desktop is not punished for the fix', () => {
  it('gives an ordinary desktop High', () => {
    expect(tierForDevice(hints())).toBe('High')
  })

  it('gives a high-DPI desktop High — pixels alone are not evidence of weakness', () => {
    // A 4K monitor has plenty of pixels and the GPU to fill them. Only a device
    // already identified as mobile has its pixel count held against it.
    expect(tierForDevice(hints({ pixels: 8_294_400 }))).toBe('High')
  })

  it('gives a touchscreen laptop High, because hover distinguishes it from a tablet', () => {
    // `pointer: coarse` alone is true of a touchscreen laptop, which is a
    // desktop GPU. `touchPrimary` requires coarse *and* no hover.
    expect(tierForDevice(hints({ touchPrimary: false }))).toBe('High')
  })

  it('steps a genuinely small machine down to Medium', () => {
    expect(tierForDevice(hints({ memoryGb: 2 }))).toBe('Medium')
    expect(tierForDevice(hints({ cores: 2 }))).toBe('Medium')
  })

  it('treats unreported capabilities as unknown rather than as weak', () => {
    // Safari and Firefox do not expose `deviceMemory`. Reading 0 as "2 GB or
    // less" would put every Safari desktop on Medium for no reason.
    expect(tierForDevice(hints({ memoryGb: 0, cores: 0 }))).toBe('High')
  })
})

describe('an explicit choice always beats detection', () => {
  it('honours low and high without consulting the device', () => {
    expect(resolveInitialTier('low')).toBe('Low')
    expect(resolveInitialTier('high')).toBe('High')
  })

  it('resolves auto to something valid in a headless environment', () => {
    // `readDeviceHints` touches `window`, `navigator` and a WebGL context, all
    // of which are absent or stubbed here. It must return a tier rather than
    // throw: a detection routine that throws takes the first paint with it,
    // which is a far worse failure than a wrong guess.
    expect(['High', 'Medium', 'Low']).toContain(resolveInitialTier('auto'))
  })
})
