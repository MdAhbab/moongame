/**
 * The controls actually reach the simulation (gameplan §8, §31.1).
 *
 * This file exists because of a bug that every other kind of test passed
 * through happily. `RenderBridge` owned a private `Loop` and called
 * `stepWorld(world, dt)` directly, which stepped the world correctly and
 * bypassed `Simulation` — and with it `Simulation.sampleInput`, the hook that
 * folds device state into `world.input` at the head of each fixed step. The
 * world drained, spawned, scored and rendered perfectly while ignoring the
 * player entirely.
 *
 * No unit test could see it: the simulation was correct, the input adapter was
 * correct, and nothing in between was covered. Only driving the built game
 * through a real browser and reading the instruments catches a seam like that,
 * so the assertions here are deliberately about *observable flight*, not about
 * which functions were called.
 *
 * The expected values are not arbitrary. Terminal velocity is `v = √(F/k)`
 * (§22.3), so a throttle of `t` settles at `√t · V_CRUISE`:
 *
 *   full throttle   → √1.0 × 26.02 = 26.0 u/s
 *   brake (t = 0.3) → √0.3 × 26.02 = 14.3 u/s
 *
 * ## The control scheme these assert
 *
 * ```
 *   BARE                MODIFIED (⌃ mac · Alt win/linux)   ARROWS
 *   W   boost           ⌃W  climb                          ↑   climb
 *   S   brake           ⌃S  dive                           ↓   dive
 *   A   turn left       ⌃A  slide left                     ←   slide left
 *   D   turn right      ⌃D  slide right                    →   slide right
 *
 *   Space  fire   Shift  missile lock   Tab  map   Esc  pause
 * ```
 */
import { expect, test, type Page } from '@playwright/test'

/** Mirrors `V_CRUISE = √(F_CRUISE / K_DRAG)` = √(88 / 0.13). */
const V_CRUISE = 26.02

/** Reads the right-edge instrument stack the HUD writes through DOM refs. */
async function readInstruments(page: Page): Promise<{ altitude: number; speed: number; wave: number }> {
  return page.evaluate(() => {
    const labelled = (label: string): number => {
      const node = Array.from(document.querySelectorAll('div')).find(
        (element) => element.textContent?.trim() === label,
      )
      return Number(node?.previousElementSibling?.textContent?.trim() ?? NaN)
    }
    const waveNode = Array.from(document.querySelectorAll('div')).find((element) =>
      (element.textContent ?? '').startsWith('WAVE '),
    )
    return {
      altitude: labelled('ALT'),
      speed: labelled('U/S'),
      wave: Number((waveNode?.textContent ?? '').replace('WAVE', '').trim()),
    }
  })
}

/** Boots the built game and flies wave 1. */
async function launchRun(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2500)

  await page.getByRole('button', { name: /start run|new run|launch|continue/i }).first().click()
  await page.waitForTimeout(1200)

  const launch = page.getByRole('button', { name: /launch|begin|skip/i }).first()
  if ((await launch.count()) > 0) await launch.click()

  // Past the Briefing beat and settled at terminal velocity.
  await page.waitForTimeout(4000)
}

test('the craft cruises at terminal velocity with no input', async ({ page }) => {
  await launchRun(page)
  const { speed, wave } = await readInstruments(page)

  // Neutral throttle is cruise, not idle. Every deadline the game quotes — the
  // Briefing's seconds-to-outpost, the Debrief's "you were N seconds away" — is
  // computed from this number, so a craft that idles makes all of them lies.
  expect(speed).toBeGreaterThan(V_CRUISE * 0.9)
  expect(speed).toBeLessThan(V_CRUISE * 1.1)
  expect(wave).toBe(1)
})

test('the arrow keys move the craft through the altitude shell', async ({ page }) => {
  await launchRun(page)
  const start = await readInstruments(page)

  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(2500)
  await page.keyboard.up('ArrowUp')
  const climbed = await readInstruments(page)
  expect(climbed.altitude, '↑ must climb').toBeGreaterThan(start.altitude + 10)

  await page.keyboard.down('ArrowDown')
  await page.waitForTimeout(2500)
  await page.keyboard.up('ArrowDown')
  const dived = await readInstruments(page)
  expect(dived.altitude, '↓ must descend').toBeLessThan(climbed.altitude - 10)
})

/**
 * The chorded WASD set does what the arrows do.
 *
 * The modifier is platform-dependent by necessity — `Ctrl+W` closes the tab on
 * Windows and Linux and no page can intercept it — so the test asks the running
 * game which modifier it actually chose rather than assuming one. A test that
 * hardcoded `Control` would pass on a Mac and silently stop testing anything at
 * all on CI.
 */
/**
 * The chord modifier is `Control` on every platform — see `keys.ts`.
 *
 * This used to interrogate the stored save and fall back to `'Alt'`. Two things
 * were wrong with that: nothing writes `keybinds` to localStorage until the
 * player rebinds something, so the lookup returned `null` on essentially every
 * run and the fallback was the *only* branch that ever executed; and a fallback
 * that silently picks a modifier turns "the chord is broken" into "the test
 * pressed the wrong key", which is a much harder failure to read.
 */
const CHORD_MODIFIER = 'Control'

test('the modified arrows mirror WASD', async ({ page }) => {
  await launchRun(page)
  const modifier = CHORD_MODIFIER
  const start = await readInstruments(page)
  expect(start.speed).toBeLessThan(V_CRUISE * 1.05)

  await page.keyboard.down(modifier)
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(2200)
  const boosted = await readInstruments(page)
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up(modifier)

  expect(boosted.speed, `${modifier}+↑ must boost exactly as W does`).toBeGreaterThan(V_CRUISE * 1.15)
})

/**
 * A chord must be exclusive.
 *
 * Bare ↑ is climb; modified ↑ is boost. If the modifier were ignored, holding it
 * would do both — the craft would climb *and* accelerate — and the two verbs
 * would be indistinguishable in play. This is the single most important
 * behaviour of the chord system and the easiest to get wrong.
 */
test('holding the modifier suppresses the bare binding', async ({ page }) => {
  await launchRun(page)
  const modifier = CHORD_MODIFIER
  const start = await readInstruments(page)

  await page.keyboard.down(modifier)
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(1800)
  const during = await readInstruments(page)
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up(modifier)

  expect(during.speed, 'the chord must boost').toBeGreaterThan(V_CRUISE * 1.15)
  expect(during.altitude, 'the chord must NOT also climb').toBeLessThan(start.altitude + 6)
})

/**
 * Translation reaches the simulation.
 *
 * Lateral thrust adds to the velocity vector, so total speed rises above cruise
 * while a slide is held and settles back when it is released. The heading-
 * preservation property — the actual reason the axis exists — is asserted
 * exactly in `tests/unit/strafe.test.ts`, where it can be measured against the
 * craft's own frame rather than inferred from an instrument.
 */
test('the slide keys reach the flight model', async ({ page }) => {
  await launchRun(page)
  const cruising = await readInstruments(page)
  expect(cruising.speed).toBeLessThan(V_CRUISE * 1.05)

  await page.keyboard.down('a')
  await page.waitForTimeout(3000)
  const sliding = await readInstruments(page)
  await page.keyboard.up('a')

  expect(sliding.speed, 'lateral thrust adds to the velocity vector').toBeGreaterThan(V_CRUISE * 1.02)

  await page.waitForTimeout(2500)
  const after = await readInstruments(page)
  expect(after.speed, 'and drag alone brings it back').toBeLessThan(V_CRUISE * 1.02)
})

test('the brake sheds speed and releasing it recovers cruise', async ({ page }) => {
  await launchRun(page)

  await page.keyboard.down('s')
  await page.waitForTimeout(2500)
  const braking = await readInstruments(page)
  await page.keyboard.up('s')

  // √0.3 × 26.02 ≈ 14.3 u/s.
  expect(braking.speed).toBeGreaterThan(V_CRUISE * 0.40)
  expect(braking.speed).toBeLessThan(V_CRUISE * 0.75)

  await page.waitForTimeout(2500)
  const recovered = await readInstruments(page)
  expect(recovered.speed).toBeGreaterThan(V_CRUISE * 0.9)
})

test('boost exceeds cruise, on W and on its alternate', async ({ page }) => {
  await launchRun(page)
  const modifier = CHORD_MODIFIER

  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  const onW = await readInstruments(page)
  await page.keyboard.up('w')
  expect(onW.speed, 'W must boost').toBeGreaterThan(V_CRUISE * 1.15)

  // Boost recharges in 6 s, and both bindings drive the same action. The
  // alternate is the chorded arrow since v7.
  await page.waitForTimeout(7000)
  await page.keyboard.down(modifier)
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(1500)
  const onChord = await readInstruments(page)
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up(modifier)
  expect(onChord.speed, 'the alternate binding must boost too').toBeGreaterThan(V_CRUISE * 1.15)
})

test('rebinding a control persists and takes effect', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2000)

  await page.getByRole('button', { name: /settings/i }).first().click()
  await page.waitForTimeout(800)

  // Matched on the aria-label rather than the visible text, because the visible
  // text is platform-dependent by design — a Mac prints ⌃ where Windows prints
  // Ctrl — and a test that pinned the glyph would fail on the wrong machine for
  // the right reason.
  const boost = page.getByRole('button', { name: /^Boost: slot 1/i }).first()
  await expect(boost).toHaveText('W')
  await boost.click()
  await expect(boost).toHaveText('PRESS A KEY…')
  await page.keyboard.press('q')
  await expect(boost).toHaveText('Q')

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('mare_noctis_v2')
    return raw === null ? null : (JSON.parse(raw) as { version: number; keybinds: Record<string, string[]> })
  })
  expect(stored?.version).toBe(7)
  expect(stored?.keybinds.boost?.[0]).toBe('KeyQ')
  // The alternate survives a rebind of the primary — the chorded arrow, since
  // v7 moved the mirrored set from WASD onto the arrows.
  expect(stored?.keybinds.boost?.some((b) => b.endsWith('+ArrowUp'))).toBe(true)
})

test('a version 2 save is migrated rather than discarded', async ({ page }) => {
  await page.goto('/')

  // A realistic v2 payload: no skinId, no achievements, no mouse settings, and
  // a set of rebound keys the player would be furious to lose.
  await page.evaluate(() => {
    localStorage.setItem(
      'mare_noctis_v2',
      JSON.stringify({
        version: 2,
        settings: {
          audio: { master: 40, music: 10, sfx: 90 },
          display: { quality: 'low', hudScale: 120, colorMode: 'high-contrast' },
          controls: { autoFire: true, toggleFire: false },
          accessibility: {
            reducedMotion: true, aimAssist: 60, enemyDamage: 80,
            drainRate: 90, enemySpeed: 110, infiniteBoost: false, ddaEnabled: false,
          },
        },
        progress: {
          bestScore: 123456, bestWave: 9, tutorialCompleted: true,
          pilotXp: 7777, equippedLoadout: { Hull: 'hull-bulwark-composite' },
        },
        keybinds: {
          steer: 'Mouse', throttleUp: 'i', throttleDown: 'k', rollLeft: 'j', rollRight: 'l',
          ascend: ' ', descend: 'Control', fire: 'Mouse0', lock: 'Mouse2',
          boost: 'Shift', map: 'Tab', pause: 'Escape', recentre: 'r',
        },
      }),
    )
  })

  await page.reload()
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2500)

  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('mare_noctis_v2')
    return raw === null ? null : (JSON.parse(raw) as {
      version: number
      settings: { display: { quality: string }; controls: { mouseSensitivity: number } }
      progress: { bestScore: number; pilotXp: number; skinId: string; equippedLoadout: Record<string, string> }
      keybinds: Record<string, string[]>
    })
  })

  expect(after?.version).toBe(7)
  // Everything the player earned survives.
  expect(after?.progress.bestScore).toBe(123456)
  expect(after?.progress.pilotXp).toBe(7777)
  expect(after?.progress.equippedLoadout.Hull).toBe('hull-bulwark-composite')
  // Rebound *non-movement* keys are translated, not dropped: `r` was a
  // character and the physical key that produces it is `KeyR`.
  expect(after?.keybinds.recentre?.[0]).toBe('KeyR')
  // The eight movement bindings are deliberately reset by the v7 layout swap —
  // a stored pre-v7 set is a copy of the old default, not a preference. See
  // ACTIONS_RESET_AT_V7.
  expect(after?.keybinds.turnLeft).toContain('ArrowLeft')
  expect(after?.keybinds.strafeLeft).toContain('KeyA')
  expect(after?.settings.display.quality).toBe('low')
  // Everything new arrives at its default rather than as undefined.
  expect(after?.progress.skinId).toBe('skin-factory')
  expect(after?.settings.controls.mouseSensitivity).toBe(100)
})

/* ------------------------------------------------------------------ */
/* Menu reachability                                                   */
/* ------------------------------------------------------------------ */

/**
 * These exist because of a bug that nothing else could have caught.
 *
 * Three components each registered a global `keydown` listener for Escape —
 * the shell, `PausedScreen`, and the `pause` action in the input layer. They
 * all fired on the same keystroke, and each read the state the previous one had
 * just written: the input layer pushed `Paused`, then the shell read the new
 * state, saw a menu, and called `back()`. The screen returned to `Playing`
 * inside a single keypress, so the pause menu — and Settings and Abort with it
 * — was unreachable for the entire run.
 *
 * Every unit test passed. Every component was individually correct. The defect
 * lived in the composition, which is why it is asserted here, against the built
 * game, by pressing the key and looking at what is on screen.
 */
test('Escape opens the pause menu and it stays open', async ({ page }) => {
  await launchRun(page)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()

  // The bug reverted the screen ~400 ms later, so a second look matters.
  await page.waitForTimeout(1200)
  await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /abort run/i })).toBeVisible()
})

test('every route out of the pause menu works', async ({ page }) => {
  await launchRun(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()

  // Pause → Settings → back lands on the pause menu, not the Title.
  await page.getByRole('button', { name: /^settings$/i }).click()
  await page.waitForTimeout(500)
  await expect(page.getByRole('button', { name: /^back/i })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()

  // Resume returns to the HUD.
  await page.getByRole('button', { name: /resume/i }).click()
  await page.waitForTimeout(600)
  await expect(page.getByRole('button', { name: /resume/i })).toHaveCount(0)
})

/**
 * The arrow keys steer.
 *
 * This test read `a` and `d` until v7 moved turning onto the arrows — and it
 * passed both before and after the swap, which is worth noticing. It asserts
 * only that the map symbols *moved*, and a slide moves the craft's position,
 * which moves every bearing on a heading-up map just as a turn does. So it
 * never actually distinguished the two verbs.
 *
 * It is kept as an end-to-end check that the steering keys reach the
 * simulation at all. The property that separates turning from sliding —
 * heading unchanged by a strafe — is asserted exactly in
 * `tests/unit/strafe.test.ts`, against the craft's own tangent frame rather
 * than inferred from a projection.
 */
test('the arrow keys steer the craft', async ({ page }) => {
  await launchRun(page)

  // Heading is not on the HUD, so it is read from where the outposts sit on the
  // Orbital Map — which is drawn heading-up, so turning moves every symbol.
  const bearings = async () =>
    page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('g[transform^="translate"]'))
      return nodes
        .map((n) => n.getAttribute('transform') ?? '')
        .filter((t) => t.includes('scale(0.62)'))
        .join('|')
    })

  await page.keyboard.down('Tab')
  await page.waitForTimeout(400)
  const before = await bearings()
  await page.keyboard.up('Tab')

  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(2000)
  await page.keyboard.up('ArrowLeft')

  await page.keyboard.down('Tab')
  await page.waitForTimeout(400)
  const after = await bearings()
  await page.keyboard.up('Tab')

  expect(before.length, 'map should be plotting outposts').toBeGreaterThan(0)
  expect(after, 'holding ← must change the heading').not.toBe(before)
})

/**
 * Several controls at once.
 *
 * The input layer used to let each device *override* the last, so a finger on
 * the virtual stick pinned steering to whatever the finger said and the
 * keyboard went quiet — on a touchscreen laptop the game silently ignored half
 * the controls in use. Axes are combined now, and the check that matters is
 * that holding a combination does every part of it, not the last one.
 */
test('holding several controls at once does all of them', async ({ page }) => {
  await launchRun(page)
  const start = await readInstruments(page)

  // Climb, brake and turn simultaneously. Each is a separate subsystem — the
  // altitude PD controller, the throttle, and the yaw damper — so all three
  // moving at once is the evidence that nothing is being dropped.
  //
  // The turn is on → rather than D since v7, and the distinction matters to this
  // assertion rather than being cosmetic: D now *slides*, and lateral thrust
  // adds to the velocity vector, so a braked craft sliding sideways is
  // legitimately faster than a braked craft flying straight. Holding D here
  // measured the strafe axis and called it a broken brake.
  await page.keyboard.down('ArrowUp')
  await page.keyboard.down('s')
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(2500)
  const during = await readInstruments(page)
  await page.keyboard.up('ArrowRight')
  await page.keyboard.up('s')
  await page.keyboard.up('ArrowUp')

  expect(during.altitude, '↑ must still climb while S and → are held').toBeGreaterThan(start.altitude + 8)
  expect(during.speed, 'S must still brake while ↑ and → are held').toBeLessThan(V_CRUISE * 0.8)

  await page.waitForTimeout(2000)
  const after = await readInstruments(page)
  expect(after.speed, 'releasing everything returns to cruise').toBeGreaterThan(V_CRUISE * 0.9)
})

test('boost, steer and fire all at once', async ({ page }) => {
  await launchRun(page)

  // The bug this pins: bindings were `KeyboardEvent.key`, so holding a modifier
  // changed every other key's identity mid-combination. `KeyA` with Shift down
  // reports `.key === 'A'`, which matched nothing, and steering died the moment
  // the player boosted. Physical `.code` bindings are immune.
  await page.keyboard.down('Shift')
  await page.keyboard.down('w')
  await page.keyboard.down('a')
  await page.keyboard.down(' ')
  await page.waitForTimeout(1600)
  const boosting = await readInstruments(page)
  await page.keyboard.up(' ')
  await page.keyboard.up('a')
  await page.keyboard.up('w')
  await page.keyboard.up('Shift')

  expect(boosting.speed, 'boost must still apply while locking, steering and firing').toBeGreaterThan(V_CRUISE * 1.15)
})

/* ------------------------------------------------------------------ */
/* Getting back out of a run                                           */
/* ------------------------------------------------------------------ */

/**
 * Abort was a one-way door.
 *
 * It called `goto('Results')` and told the simulation nothing. `ResultsScreen`
 * renders entirely from `runSummary`, which is only ever written when the world
 * itself reaches `RunOver` — so aborting produced `null`: a transparent,
 * buttonless overlay over a still-running game, on a screen `goto` pushes no
 * history for, so Escape had nothing to unwind either. The only way out was a
 * page reload.
 *
 * The unit tests cover `abortRun` ending the run. This covers the thing the
 * player actually experiences: pressing the button and arriving somewhere with
 * a way back to the menu.
 */
test('aborting a run lands on a screen with a way back to the menu', async ({ page }) => {
  await launchRun(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /abort run/i })).toBeVisible()
  await page.getByRole('button', { name: /abort run/i }).click()

  // Two-step, because a mis-click here throws away a whole run.
  const confirm = page.getByRole('button', { name: /confirm/i })
  await expect(confirm).toBeVisible()
  await confirm.click()
  await page.waitForTimeout(800)

  // Something is on screen, and it has the way out.
  const toMenu = page.getByRole('button', { name: /return to menu/i })
  await expect(toMenu).toBeVisible()
  await toMenu.click()
  await page.waitForTimeout(800)
  await expect(page.getByRole('button', { name: /start run/i })).toBeVisible()
})

test('backing out of an abort keeps you flying', async ({ page }) => {
  await launchRun(page)

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /abort run/i }).click()
  await page.getByRole('button', { name: /keep flying/i }).click()
  await page.waitForTimeout(400)

  await expect(page.getByRole('button', { name: /abort run/i })).toBeVisible()
  await page.getByRole('button', { name: /resume/i }).click()
  await page.waitForTimeout(600)

  const { speed } = await readInstruments(page)
  expect(speed, 'the run continues where it left off').toBeGreaterThan(V_CRUISE * 0.5)
})

/**
 * A session used to be worth exactly one run.
 *
 * `startRun` was gated on `wave.number === 0`, true once per page load. The
 * second "START RUN" found a world parked on `RunOver` with its outposts still
 * in ruins, and the 4 Hz phase poll bounced the player straight to the Debrief
 * for a run they had never flown. Every screen navigated correctly throughout,
 * which is exactly why nothing caught it.
 */
test('a second run actually starts', async ({ page }) => {
  await launchRun(page)

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /abort run/i }).click()
  await page.getByRole('button', { name: /confirm/i }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /return to menu/i }).click()
  await page.waitForTimeout(600)

  await page.getByRole('button', { name: /start run/i }).first().click()
  await page.waitForTimeout(5000)

  const second = await readInstruments(page)
  expect(second.wave, 'run two begins at wave 1').toBe(1)
  expect(second.speed, 'run two is a live world, not a frozen one').toBeGreaterThan(V_CRUISE * 0.9)

  // And the pause menu is still reachable, which is the cheapest proof that the
  // screen is `Playing` rather than a Debrief wearing a HUD.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()
})

/**
 * "How do I shoot?" should be answerable without opening Settings.
 */
test('the game says what to do and which key does it', async ({ page }) => {
  await launchRun(page)

  const hint = page.getByRole('note', { name: /how to play/i })
  await expect(hint).toBeVisible()
  await expect(hint).toContainText(/harvesters land/i)
  await expect(hint).toContainText(/SHOOT/)
})
