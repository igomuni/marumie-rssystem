import { expect, test } from '@playwright/test';

test('root redirects to the sankey view', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');

  // `/` は入口を持たず /sankey-svg へ送る。到達先が描けていることまで見る
  await expect(page).toHaveURL(/\/sankey-svg/);
  await expect(page.getByTestId('sankey-svg-canvas')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('sankey-svg opens and renders graph elements', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/sankey-svg');

  await expect(page.getByTestId('sankey-svg-canvas')).toBeVisible();
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sankey-link').first()).toBeAttached();
  await expect(page.getByText(/Fetch error|Error:/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
