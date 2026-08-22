import { expect, test } from '@playwright/test';

/** 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 */
const COLUMNS = ['total', 'ministry', 'organization', 'subAccount', 'section', 'item'];

test.describe('mof-hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mof-hierarchy');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
  });

  test('renders the six-column hierarchy without collapsing empty columns', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await expect(page.getByTestId('hierarchy-canvas')).toBeVisible();

    // 値を持たない列は素通りさせるだけで畳まない。6列すべてにノードが立つ
    const columns = await page
      .getByTestId('hierarchy-node')
      .evaluateAll(els => [...new Set(els.map(el => el.getAttribute('data-column')))]);
    expect(columns.sort()).toEqual([...COLUMNS].sort());

    expect(pageErrors).toEqual([]);
  });

  test('selecting a node is kept in the URL and can be undone with the back button', async ({ page }) => {
    await expect(page).not.toHaveURL(/sel=/);

    await page.getByTestId('hierarchy-node').first().click();
    await expect(page).toHaveURL(/sel=/);

    // 選択は「辿った操作」なので履歴に積む。1回の戻るで1つ前に戻れること
    await page.goBack();
    await expect(page).not.toHaveURL(/sel=/);
  });

  test('switching the budget type reloads the graph', async ({ page }) => {
    const before = await page.getByTestId('hierarchy-node').count();
    expect(before).toBeGreaterThan(0);

    const select = page.getByLabel('予算種別');
    const options = await select.locator('option').allTextContents();
    test.skip(options.length < 2, '当該年度に予算種別が1つしかない');

    await select.selectOption(options[1]);
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('hierarchy-node')).not.toHaveCount(0);
  });

  test('label font size can be enlarged without labels overlapping', async ({ page }) => {
    const label = page.getByTestId('hierarchy-label').first();
    const before = await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize));

    await page.getByLabel('文字サイズ').selectOption('16');

    await expect
      .poll(() => label.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))
      .toBeGreaterThan(before);

    // 大きくしてもラベル同士が重ならない。重なりは描画側が検出して印を出す
    await expect(page.getByTestId('hierarchy-label-overlap')).toHaveCount(0);
  });

  test('labels do not overlap at the default font size', async ({ page }) => {
    await expect(page.getByTestId('hierarchy-label-overlap')).toHaveCount(0);
  });

  test('label density can be switched between major nodes and all nodes', async ({ page }) => {
    const labels = page.getByTestId('hierarchy-label');
    const density = page.getByLabel('ラベル表示');

    await density.selectOption('major');
    const few = await labels.count();
    expect(few).toBeGreaterThan(0);

    await density.selectOption('all');
    await expect.poll(() => labels.count()).toBeGreaterThan(few);

    // 間引いても、名前が出ていないノード自体は消えない
    const nodes = await page.getByTestId('hierarchy-node').count();
    await density.selectOption('major');
    await expect(page.getByTestId('hierarchy-node')).toHaveCount(nodes);

    // major は1行分の場所を確保せず値どおりに詰めるので、
    // 出したラベルが重なっていないことを別に確かめる
    await expect(page.getByTestId('hierarchy-label-overlap')).toHaveCount(0);
  });
});
