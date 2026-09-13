import { expect, test } from '@playwright/test';

test('sankey-svg baseline interactions and MOF join', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/sankey-svg');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: '/private/tmp/sankey-baseline.png' });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30000 });
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-out').click();
  await page.getByTestId('search-input').fill('年金');
  await expect(page.getByTestId('search-result').first()).toBeVisible();
  await page.getByTestId('search-result').first().click();
  await page.getByTestId('search-input').fill('');
  await page.screenshot({ path: '/private/tmp/sankey-integrated.png' });
  await page.getByLabel('MOFの項').selectOption({ index: 1 });
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: '/private/tmp/sankey-integrated-section.png' });
  expect(errors).toEqual([]);
});
