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

test('does not switch to V2 until the settlement.json.gz payload for the new review year arrives (B3b review fix)', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  let releaseReview2024Settlement!: () => void;
  const review2024SettlementRequest = new Promise<void>(resolve => {
    releaseReview2024Settlement = resolve;
  });
  await page.route('**/data/v2/links/review-2024-fy2024/settlement.json.gz', async route => {
    await review2024SettlementRequest;
    await route.continue();
  });

  await page.goto('/mof-kou');
  await page.getByLabel('年度', { exact: true }).selectOption('2024');
  await expect(page.getByLabel('RS review')).toHaveValue('2025', { timeout: 30_000 });
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('RS review').selectOption('2024');

  // links.json.gzは既に届いていても、settlement.json.gzが新しいreview yearでまだ届いていなければ
  // V1/V2混在にならないよう「V2」へ切り替わってはいけない（v2Activeはv2SettlementCurrentも要求する）。
  await expect(page.getByText('旧集計', { exact: true })).toBeVisible();

  releaseReview2024Settlement();
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
  // RS件数は文字列"0"を含みうる（settlementSectionIdに実際の決算identityが無いsectionは
  // 正しく0になる、B3b）。プレースホルダ('—')ではなく正の整数であることを厳密に要求する。
  const settlementIndex = await rows.evaluateAll(tableRows =>
    tableRows.findIndex(row =>
      row instanceof HTMLTableRowElement &&
      Number(row.cells[0]?.textContent?.trim()) > 0 &&
      row.cells[1]?.textContent?.trim() === '決算'
    )
  );
  expect(settlementIndex).toBeGreaterThanOrEqual(0);
  await rows.nth(settlementIndex).click();

  await page.getByRole('button', { name: /^関連RS事業 \([1-9]/ }).click();
  // B3b: settlement identityの表示evidenceはv2KouMokuLinkage.identityRelations由来
  // （目×PID粒度、budget側rsLinksからの再構成ではない）。列は根拠/決算目/RS事業/府省庁/RS事業額/リンク元。
  await expect(page.getByText('決算目', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('リンク元', { exact: true })).toBeVisible();
  await expect(page.getByText('根拠', { exact: true })).toBeVisible();
  await expect(page.getByText('RSリンク額（group）', { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('legacy V1 evidence-gap golden: shows PID evidence for a settlement section whose budget item was ambiguous in the legacy dataset (review fix)', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/mof-kou');
  await page.getByLabel('年度', { exact: true }).selectOption('2024');
  await page.getByLabel('RS review').selectOption('2024');
  await expect(page.getByText('V2', { exact: true })).toBeVisible({ timeout: 30_000 });

  const filterButton = page.getByRole('button', { name: 'フィルタ' });
  if ((await filterButton.getAttribute('aria-expanded')) !== 'true') await filterButton.click();
  await page.getByLabel('項名', { exact: true }).fill('観測予報等業務費');

  const rows = page.locator('tbody tr');
  const settlementIndex = await rows.evaluateAll(tableRows =>
    tableRows.findIndex(row => row instanceof HTMLTableRowElement && row.cells[1]?.textContent?.trim() === '決算')
  );
  expect(settlementIndex).toBeGreaterThanOrEqual(0);
  await rows.nth(settlementIndex).click();

  // このsectionは、settlementProjectionLegacyEvidenceGapCount>0の原因となった2目
  // （世界気象機関等分担金・政府開発援助世界気象機関分担金）を含む。budget projection groupが
  // legacy V1側で作れなかったsourceでも、PID evidence（project/stage/RS金額）が
  // identityRelations経由で正しく届いていることを確認する。
  await page.getByRole('button', { name: /^関連RS事業/ }).click();
  await expect(page.getByText('国際機関への分担金・拠出金').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('当初', { exact: true }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
