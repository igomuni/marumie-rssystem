import { expect, test } from '@playwright/test';

test('実データの検索、原典、年度、同一コードの別項を確認する', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/budget-flow');
  await expect(page.getByRole('heading', { name: 'Budget Event タイムライン' })).toBeVisible();
  await page.getByRole('searchbox').fill('科学技術イノベーション創造推進費');
  await expect(page.getByRole('heading', { name: '科学技術イノベーション創造推進費', exact: true })).toBeVisible();
  const evidence = page.getByRole('region', { name: 'Evidence / 原典' });
  await evidence.locator('summary').first().click();
  await expect(evidence.getByText('raw record:', { exact: false }).first()).toBeVisible();
  await expect(evidence.getByText('SHA-256:', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Identity / RS', exact: true }).click();
  await expect(page.getByText('canonical ID:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '現行モデルとの差分', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('会計', { exact: true }).selectOption('special');
  await page.getByRole('searchbox').fill('復興');
  await expect(page.getByRole('button', { name: /^復興債費/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^復興庁共通費/ }).first()).toBeVisible();
  await page.getByLabel('予算年度 · fiscalYear').selectOption('2025');
  await page.getByLabel('モード').selectOption('settlement');
  await expect(page.getByText('このフルデータには2025年度のMOF決算イベントがありません。')).toBeVisible();
  await page.getByRole('button', { name: '条件をリセット' }).click();
  await page.getByRole('searchbox').fill('科学技術イノベーション創造推進費');
  await page.getByRole('button', { name: 'Budget Events', exact: true }).click();
  await expect(page.getByRole('button', { name: /当初予算・提出案/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /当初予算・成立/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('狭い画面と読込エラーを扱う', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/budget-flow');
  await expect(page.getByRole('heading', { name: 'Budget Event タイムライン' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/budget-flow-v2/2025.json.gz', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.getByLabel('予算年度 · fiscalYear').selectOption('2025');
  await expect(page.locator('main').getByRole('alert')).toContainText('503');
  await page.unroute('**/budget-flow-v2/2025.json.gz');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByRole('heading', { name: 'Budget Event タイムライン' })).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
});
