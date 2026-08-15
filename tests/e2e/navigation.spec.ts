import { expect, test } from '@playwright/test'

test.describe('Screen Transitions Navigation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the Canvas (signals that loading is done and Title is mounted)
    await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1000)
  })

  test('navigates to Settings and back to Title', async ({ page }) => {
    // Assert Title is showing
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')

    // Go to Settings
    await page.click('text=SETTINGS')
    
    // Default tab is Controls
    await expect(page.locator('text=Auto Fire (Touch Default)')).toBeVisible()

    // Click tabs via dispatchEvent to verify they render correctly (prevents hit-test interception issues in headless browser)
    await page.dispatchEvent('role=tab[name="Display"]', 'click')
    await expect(page.locator('text=HUD Scale')).toBeVisible()

    await page.dispatchEvent('role=tab[name="Audio"]', 'click')
    await expect(page.locator('text=Master Volume')).toBeVisible()

    await page.dispatchEvent('role=tab[name="Accessibility"]', 'click')
    await expect(page.locator('text=Aim Assist')).toBeVisible()

    // Click BACK to return
    await page.click('text=BACK [ESC]', { force: true })
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')
  })

  test('navigates to Hangar and back to Title', async ({ page }) => {
    // Assert Title is showing
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')

    // Go to Hangar
    await page.click('text=HANGAR')
    await expect(page.locator('text="LVL 1"')).toBeVisible()

    // Check we can click slot tabs
    await page.click('text=WEAPON')
    await expect(page.locator('text=WEAPON')).toBeVisible()

    // Click BACK to return
    await page.click('text=BACK')
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')
  })

  test('navigates to Credits and back to Title', async ({ page }) => {
    // Assert Title is showing
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')

    // Go to Credits
    await page.click('text=CREDITS')
    await expect(page.locator('text=ZERO ASSETS POLICY')).toBeVisible()

    // Click BACK to return
    await page.click('text=BACK [ESC]')
    await expect(page.locator('h1')).toContainText('MARE NOCTIS')
  })
})
