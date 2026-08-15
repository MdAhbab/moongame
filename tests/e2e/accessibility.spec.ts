import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility Audits (axe-core) (§35)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1000)
  })

  test('Title screen passes axe audit', async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })

  test('Settings screen passes axe audit', async ({ page }) => {
    await page.click('text=SETTINGS')
    await expect(page.locator('text=Auto Fire (Touch Default)')).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })

  test('Hangar screen passes axe audit', async ({ page }) => {
    await page.click('text=HANGAR')
    await expect(page.locator('text="LVL 1"')).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })

  test('Credits screen passes axe audit', async ({ page }) => {
    await page.click('text=CREDITS')
    await expect(page.locator('text=ZERO ASSETS POLICY')).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
