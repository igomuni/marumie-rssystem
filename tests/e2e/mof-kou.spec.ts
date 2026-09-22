import { expect, test } from '@playwright/test';

test('clears V2 linkage while switching the RS review year', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  let releaseReview2024!: () => void;
  const review2024Request = new Promise<void>(resolve => {
    releaseReview2024 = resolve;
  });
  await page.route('**/data/v2/links/review-2024-fy2024/links.json.gz', async route => {
    await review2024Request;
    await route.continue();
  });

  await page.goto('/mof-kou');
  await page.getByLabel('年度', { exact: true }).selectOption('2024');
  await expect(page.getByLabel('RS review')).toHaveValue('2025', { timeout: 30_000 });
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('RS review').selectOption('2024');

  // 新しいpayloadが届くまでは、旧review-2025の件数を表示しない。
  await expect(page.getByText('旧集計', { exact: true })).toBeVisible();

  releaseReview2024();
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(pageErrors).toEqual([]);
});
