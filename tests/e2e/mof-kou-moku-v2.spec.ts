import { expect, test } from '@playwright/test';

test('loads the FY2025 V2 item projection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mof-kou-moku');
  await page.getByLabel('年度', { exact: true }).selectOption('2025');
  await expect(page.getByLabel('RS review')).toHaveValue('2025', { timeout: 30_000 });
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
