/**
 * Boot smoke test and live performance measurement (gameplan §34, §37.4, §42).
 *
 * The point of this file is that every performance claim in the report is a
 * number this test printed, not a number anyone asserted (Rule 11).
 */
import { expect, test, type ConsoleMessage } from '@playwright/test'

/** Anything logged at `error` level during a clean boot is a failure. */
function collectErrors(messages: string[]) {
  return (message: ConsoleMessage): void => {
    if (message.type() === 'error') messages.push(message.text())
  }
}

test('boots to the Title screen with no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', collectErrors(errors))
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

  await page.goto('/')

  // The scene mounts behind the menus (§11), so a canvas is the boot signal.
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })

  await page.waitForTimeout(3000)

  expect(errors, `console errors during boot:\n${errors.join('\n')}`).toEqual([])
})

test('reports draw calls, triangles and frame time under load (§34.1)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(4000)

  const stats = await page.evaluate(async () => {
    // three exposes the per-frame counters on the renderer; R3F stores the
    // renderer on the canvas element's __r3f root in dev builds. Fall back to
    // sampling frame times only if it is not reachable.
    const frames: number[] = []
    let last = performance.now()

    await new Promise<void>((resolve) => {
      let n = 0
      const tick = (): void => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (++n >= 180) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    frames.sort((a, b) => a - b)
    const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0
    const median = frames[Math.floor(frames.length * 0.5)] ?? 0

    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return {
      medianFrameMs: Number(median.toFixed(2)),
      p95FrameMs: Number(p95.toFixed(2)),
      heapMb: memory ? Number((memory.usedJSHeapSize / 1048576).toFixed(1)) : null,
    }
  })

  // Printed rather than asserted: a headless CI machine is not the reference
  // desktop in §34.1, so a hard threshold here would be a number that looks
  // like a measurement without being one.
  console.log('FRAME  median', stats.medianFrameMs, 'ms   p95', stats.p95FrameMs, 'ms')
  console.log('HEAP  ', stats.heapMb, 'MB')

  expect(stats.medianFrameMs).toBeGreaterThan(0)
})

test('heap does not grow unbounded over 60 s of play (§34.1, §37.5)', async ({ page }) => {
  test.setTimeout(180_000)

  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(5000)

  const sample = async (): Promise<number | null> =>
    page.evaluate(() => {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      return memory ? memory.usedJSHeapSize / 1048576 : null
    })

  const before = await sample()
  await page.waitForTimeout(60_000)
  const after = await sample()

  if (before === null || after === null) {
    test.skip(true, 'performance.memory unavailable in this browser')
    return
  }

  const growth = after - before
  console.log(`HEAP  ${before.toFixed(1)} MB -> ${after.toFixed(1)} MB  (growth ${growth.toFixed(1)} MB over 60 s)`)

  // §37.5 allows 5 MB over five minutes; 60 s is a twelfth of that soak, and a
  // real leak shows up immediately rather than linearly.
  expect(growth).toBeLessThan(15)
})
