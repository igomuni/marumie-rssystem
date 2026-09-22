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

test('shows an empty RS tab for a V2 row with no linked projects', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/mof-kou');
  await page.getByLabel('年度', { exact: true }).selectOption('2025');
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });

  const tableRows = page.locator('tbody tr');
  const zeroIndex = await tableRows.evaluateAll(rows =>
    rows.findIndex(row => row instanceof HTMLTableRowElement && row.cells[0]?.textContent?.trim() === '0')
  );
  expect(zeroIndex).toBeGreaterThanOrEqual(0);

  await tableRows.nth(zeroIndex).click();
  await page.getByRole('button', { name: /^RS \(0\)$/ }).click();
  await expect(page.getByText('紐づく RS 事業は見つかりませんでした。')).toBeVisible({ timeout: 30_000 });
  expect(pageErrors).toEqual([]);
});

test('shows settlement section identities without budget amounts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/mof-kou');
  await page.getByLabel('年度', { exact: true }).selectOption('2024');
  await page.getByLabel('RS review').selectOption('2025');
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });

  const rows = page.locator('tbody tr');
  const settlementIndex = await rows.evaluateAll(tableRows =>
    tableRows.findIndex(row =>
      row instanceof HTMLTableRowElement &&
      row.cells[0]?.textContent?.trim() !== '—' &&
      row.cells[1]?.textContent?.trim() === '決算'
    )
  );
  expect(settlementIndex).toBeGreaterThanOrEqual(0);
  await rows.nth(settlementIndex).click();

  await page.getByRole('button', { name: /^関連RS事業 \([1-9]/ }).click();
  await expect(page.getByText('関連する目', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('リンク元', { exact: true })).toBeVisible();
  await expect(page.getByText('元リンク根拠', { exact: true })).toBeVisible();
  await expect(page.getByText('RSリンク額（group）', { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
