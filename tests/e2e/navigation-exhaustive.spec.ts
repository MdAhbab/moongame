/**
 * Every menu route, and every way back out of one.
 *
 * This codebase has one failure mode it keeps rediscovering: **a screen with no
 * route out.** `Results` rendered `null` when it had no summary. `Debrief` did
 * the same. Abort walked players into both. `Canvas.tsx` replaced the entire
 * scene with a panel that could never dismiss itself. `Account` was a union
 * member with a router case and no entry point, so nobody had ever seen it.
 *
 * Each of those passed every unit test that existed at the time, because none of
 * them are unit-level faults — they are faults of *composition*, and the only
 * thing that catches them is driving the real build and asserting that a player
 * is never stranded.
 *
 * The core assertion in this file is `expectNotStranded`: whatever is on screen,
 * there is something visible and enabled to press.
 */
import { expect, test, type Page } from '@playwright/test'

/** Boots the built game to the Title screen. */
async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2000)
  await expect(page.locator('h1')).toContainText('MARE NOCTIS')
}

/**
 * There is a way out of here.
 *
 * The whole point of the suite. A screen that renders nothing is not "nothing to
 * show" — it is a transparent overlay over a live game with no route back, and
 * it is indistinguishable from a crash to the person holding the keyboard.
 */
async function expectNotStranded(page: Page, where: string): Promise<void> {
  const buttons = page.locator('button:visible:not([disabled])')
  await expect(buttons.first(), `no way out of ${where}`).toBeVisible({ timeout: 10_000 })
  expect(await buttons.count(), `no enabled control on ${where}`).toBeGreaterThan(0)
}

/** Title → screen → back to Title, asserting something specific on the way. */
async function roundTrip(page: Page, entry: RegExp, marker: RegExp, name: string): Promise<void> {
  await page.getByRole('button', { name: entry }).first().click()
  await expect(page.getByText(marker).first(), `${name} did not render`).toBeVisible({ timeout: 15_000 })
  await expectNotStranded(page, name)
  await page.getByRole('button', { name: /back/i }).first().click()
  await expect(page.locator('h1'), `no route back from ${name}`).toContainText('MARE NOCTIS', { timeout: 10_000 })
}

test.describe('every menu route works and every one comes back', () => {
  test.beforeEach(async ({ page }) => { await boot(page) })

  test('Settings', async ({ page }) => {
    await roundTrip(page, /^settings$/i, /Auto Fire/i, 'Settings')
  })

  test('Hangar', async ({ page }) => {
    await roundTrip(page, /^hangar$/i, /LVL 1|WEAPON|HULL/i, 'Hangar')
  })

  test('Pilot Record', async ({ page }) => {
    await roundTrip(page, /pilot record/i, /PILOT RECORD/i, 'Profile')
  })

  test('Credits', async ({ page }) => {
    await roundTrip(page, /^credits$/i, /ZERO ASSETS POLICY|MARE NOCTIS/i, 'Credits')
  })

  /**
   * The two backend screens, on a build with no backend.
   *
   * This is the normal case, not an edge case: the game ships as a static SPA
   * and `api/` is a separate deployment. Both screens must say so plainly. They
   * used to surface `Error: leaderboard: 404` to a player who had done nothing
   * wrong.
   */
  test('Leaderboard says why it is empty rather than throwing', async ({ page }) => {
    await page.getByRole('button', { name: /leaderboard/i }).first().click()
    await expect(page.getByText(/LEADERBOARD/i).first()).toBeVisible({ timeout: 15_000 })
    await expectNotStranded(page, 'Leaderboard')
    await expect(page.getByText(/not enabled in this build|no verified scores/i).first()).toBeVisible()
    await expect(page.getByText(/Error:/).first()).toBeHidden()
    await page.getByRole('button', { name: /back/i }).first().click()
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')
  })

  test('Account is reachable and explains itself', async ({ page }) => {
    // It was not reachable at all until this suite went looking: a union member
    // and a router case with no button anywhere pointing at them.
    await page.getByRole('button', { name: /^account$/i }).first().click()
    await expect(page.getByText(/not enabled in this build|Sign in|passkey/i).first())
      .toBeVisible({ timeout: 15_000 })
    await expectNotStranded(page, 'Account')
    await page.getByRole('button', { name: /back/i }).first().click()
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')
  })
})

test.describe('the run lifecycle strands nobody', () => {
  test('pause, and every route out of it', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: /start run/i }).first().click()
    await page.waitForTimeout(1200)
    const launch = page.getByRole('button', { name: /launch|begin|skip/i }).first()
    if ((await launch.count()) > 0) await launch.click()
    await page.waitForTimeout(2500)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /resume/i })).toBeVisible({ timeout: 10_000 })
    await expectNotStranded(page, 'Paused')

    // Settings from inside the pause menu, and back to the pause menu — not to
    // Title, and not to a live game the player cannot see.
    await page.getByRole('button', { name: /^settings$/i }).click()
    await expect(page.getByText(/Auto Fire/i).first()).toBeVisible()
    await page.click('text=BACK [ESC]', { force: true })
    await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()

    await page.getByRole('button', { name: /resume/i }).click()
    await expect(page.getByRole('button', { name: /resume/i })).toBeHidden()
  })

  test('abort, confirm, and a second run really starts', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: /start run/i }).first().click()
    await page.waitForTimeout(1200)
    const launch = page.getByRole('button', { name: /launch|begin|skip/i }).first()
    if ((await launch.count()) > 0) await launch.click()
    await page.waitForTimeout(2500)

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /abort run/i }).click()
    await expectNotStranded(page, 'Abort confirmation')
    await page.getByRole('button', { name: /abort|confirm|yes/i }).last().click()
    await page.waitForTimeout(1500)
    await expectNotStranded(page, 'post-abort screen')

    await page.getByRole('button', { name: /menu|title|continue/i }).first().click()
    await expect(page.locator('h1')).toContainText('MARE NOCTIS', { timeout: 10_000 })

    // A session used to be worth exactly one run: `startRun` was gated on
    // `wave.number === 0`, so the second attempt found a finished world and
    // bounced straight to the Debrief.
    await page.getByRole('button', { name: /start run/i }).first().click()
    await page.waitForTimeout(1200)
    const launch2 = page.getByRole('button', { name: /launch|begin|skip/i }).first()
    if ((await launch2.count()) > 0) await launch2.click()
    await page.waitForTimeout(2500)
    const outposts = await page.getByText(/100%/).count()
    expect(outposts, 'a second run starts with its outposts intact').toBeGreaterThan(4)
  })

  test('the tutorial has a way out at its first beat', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: /tutorial/i }).first().click()
    await page.waitForTimeout(3000)
    await expectNotStranded(page, 'Tutorial')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    await expectNotStranded(page, 'Tutorial after Escape')
  })
})

test.describe('hostile and degenerate entry states', () => {
  test('boots with localStorage cleared', async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear() })
    await boot(page)
    await expectNotStranded(page, 'Title after a cleared cache')
  })

  test('boots with a corrupt save rather than dying on it', async ({ page }) => {
    // `persistence.ts` is written to be *total*: every field either validates or
    // falls back, so a partially corrupt payload loses only the corrupt fields.
    // This asserts that claim end to end rather than at the unit level.
    await page.addInitScript(() => {
      localStorage.setItem('mare_noctis_v2', '{"version":6,"settings":42,"progress":null,"keybinds":[]}')
    })
    await boot(page)
    await expectNotStranded(page, 'Title after a corrupt save')
  })

  test('boots with a save from an impossible future version', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mare_noctis_v2', '{"version":9999}')
    })
    await boot(page)
    await expectNotStranded(page, 'Title after a future-version save')
  })

  test('boots with a payload that is not JSON at all', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mare_noctis_v2', 'not json {{{')
    })
    await boot(page)
    await expectNotStranded(page, 'Title after a non-JSON save')
  })

  test('survives being clicked faster than it can navigate', async ({ page }) => {
    await boot(page)
    // Double-clicking a menu entry used to be the sort of thing that pushed two
    // history frames and made BACK go only half way.
    const settings = page.getByRole('button', { name: /^settings$/i }).first()
    await settings.click()
    await page.waitForTimeout(60)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    await expectNotStranded(page, 'Title after a double Escape')
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')
  })

  test('Escape from the Title screen does not strand the player', async ({ page }) => {
    await boot(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await expectNotStranded(page, 'Title after Escape')
  })
})
