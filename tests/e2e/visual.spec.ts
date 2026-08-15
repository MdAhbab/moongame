/**
 * Visual confirmation that the art actually reaches the screen.
 *
 * Not a pixel-diff suite — those are brittle against a procedural sky. These
 * assert the two things that silently fail: that an `<img>` slot resolved to a
 * real file rather than a 404, and that the WebGL scene is drawing at all.
 *
 * Both have shipped broken before. Every art slot in this game carries an
 * `onError` that hides the element, which is the right behaviour for a missing
 * file and is also perfect camouflage for a wrong path — the UI looks fine and
 * the art is simply never there.
 */
import { test, expect, type Page } from '@playwright/test'

/** Boots to the Title screen. Mirrors `controls.spec.ts`, deliberately. */
async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2500)
  await expect(page.locator('h1')).toContainText('MARE NOCTIS')
}

/**
 * Every `<img>` on screen resolved to a real image.
 *
 * `naturalWidth === 0` is how a broken image reports itself, and it is the only
 * signal available once `onError` has hidden the element.
 */
async function expectImagesLoaded(page: Page, where: string): Promise<void> {
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute('src') ?? '(no src)'),
  )
  expect(broken, `broken images on ${where}`).toEqual([])
}

test('the loading and title art resolve', async ({ page }) => {
  await boot(page)
  await expectImagesLoaded(page, 'Title')
})

test('the threat cards resolve on the Briefing', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: /start run|new run|launch|continue/i }).first().click()
  // The Briefing names the wave's threats; the cards sit beside them.
  await expect(page.getByText(/HARVESTER/i).first()).toBeVisible({ timeout: 20_000 })
  await expectImagesLoaded(page, 'Briefing')

  const art = page.locator('img[src^="/enemies/"]')
  expect(await art.count(), 'at least one threat card is present').toBeGreaterThan(0)
  // `object-fit: contain` in a 64px box, so a card that loaded has real size.
  const box = await art.first().boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(0)
})

test('the credits art resolves', async ({ page }) => {
  await boot(page)
  await page.click('text=CREDITS')
  await page.waitForTimeout(500)
  await expectImagesLoaded(page, 'Credits')
})

test('the scene keeps its WebGL context through a run', async ({ page }) => {
  const lost: string[] = []
  await page.exposeFunction('__reportContextLost', () => { lost.push('lost') })
  await page.addInitScript(() => {
    // Catch it at the source: the event fires on the canvas whether or not any
    // React state is listening.
    document.addEventListener('webglcontextlost', () => {
      ;(window as unknown as { __reportContextLost: () => void }).__reportContextLost()
    }, true)
  })

  await boot(page)
  await page.getByRole('button', { name: /start run|new run|launch|continue/i }).first().click()
  await page.waitForTimeout(1200)
  const launch = page.getByRole('button', { name: /launch|begin|skip/i }).first()
  if ((await launch.count()) > 0) await launch.click()
  await page.waitForTimeout(3000)
  await page.keyboard.press('Space')
  await page.waitForTimeout(12_000)

  expect(lost, 'the GPU context survived a run').toEqual([])

  // And the scene is actually drawing, rather than presenting a blank canvas.
  const drawing = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return canvas !== null && canvas.width > 0 && canvas.height > 0
  })
  expect(drawing).toBe(true)
})
