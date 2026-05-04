import { expect, test } from '@playwright/test';

test('home exposes the main navigation targets', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: '行政事業レビュー サンキー図' })).toBeVisible();
  await expect(page.getByRole('link', { name: /直接支出サンキー図/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /支出先ブラウザ/ })).toBeVisible();
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
