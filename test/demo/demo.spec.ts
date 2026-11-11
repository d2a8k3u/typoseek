import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEMO_PAGE_URL = pathToFileURL(fileURLToPath(new URL('../../demo/index.html', import.meta.url))).href;

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_PAGE_URL);
});

test('axe reports no violations on the initial page and after a search', async ({ page }) => {
  const initial = await new AxeBuilder({ page }).analyze();
  expect(initial.violations).toEqual([]);

  await page.getByLabel('Search books').fill('tolkein');
  await expect(page.getByRole('listitem')).not.toHaveCount(0);
  const searched = await new AxeBuilder({ page }).analyze();
  expect(searched.violations).toEqual([]);
});

test('keyboard only: Tab reaches the input, typing updates the results and the live region', async ({ page }) => {
  const input = page.getByLabel('Search books');
  const status = page.getByRole('status');
  await expect(status).toHaveText('24 results, showing the first 10');

  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();

  await page.keyboard.type('hobit');
  await expect(status).toHaveText('1 result');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  const results = page.getByRole('listitem');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('The Hobbit');
  await expect(results.first().locator('mark')).toHaveText('Hobbit');
});
