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
    const select = page.getByLabel('予算種別');
    const options = await select.locator('option').allTextContents();
    test.skip(options.length < 2, '当該年度に予算種別が1つしかない');

    const current = await select.inputValue();
    const next = options.find(o => o !== current);
    expect(next).toBeTruthy();

    // 「ノードが0でない」だけだと、取得が走らなくても通ってしまう。
    // 選択・URL・図の中身の3つが揃って変わったことを見る
    const before = await page
      .getByTestId('hierarchy-node')
      .evaluateAll(els => els.map(el => el.textContent).join('|'));

    await select.selectOption(next!);

    await expect(select).toHaveValue(next!);
    await expect(page).toHaveURL(new RegExp(`bt=${encodeURIComponent(next!)}`));
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          page
            .getByTestId('hierarchy-node')
            .evaluateAll(els => els.map(el => el.textContent).join('|')),
        { timeout: 30_000 }
      )
      .not.toBe(before);
  });

  test('label font size can be enlarged without labels overlapping', async ({ page }) => {
    const label = page.getByTestId('hierarchy-label').first();
    const before = await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize));

    await page.getByLabel('表示設定').click();
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
    await page.getByLabel('表示設定').click();
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

  test('the search box stays operable and is not covered by the controls', async ({ page }) => {
    // 浮かせた部品どうしが重なると、見えているのに押せないという形で壊れる。
    // 「見える」だけでは足りないので、実際に打って絞り込めるところまで見る
    const input = page.getByPlaceholder(/検索/);
    await input.click();
    await page.keyboard.type('厚生');

    await expect(input).toHaveValue('厚生');
    const results = page.getByRole('button').filter({ hasText: '厚生' });
    await expect(results.first()).toBeVisible({ timeout: 10_000 });

    await results.first().click();
    await expect(page).toHaveURL(/sel=/);
  });

  test('floating controls do not overlap each other', async ({ page }) => {
    // 検索ボックスだけを守っても、次に足した部品が別の何かを覆う。
    // 図の上に浮かせている部品どうしが重なっていないことを面で確かめる
    await expect(page.getByLabel('表示設定')).toBeVisible();

    const boxes = await page.evaluate(() => {
      const targets = [
        ['検索', 'input[type="search"]'],
        ['予算種別', 'select[aria-label="予算種別"]'],
        ['表示設定', '[aria-label="表示設定"]'],
        ['年度', 'select[aria-label="年度"]'],
      ] as const;
      return targets.flatMap(([name, sel]) => {
        const el = document.querySelector(sel);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ name, left: r.left, right: r.right, top: r.top, bottom: r.bottom }];
      });
    });
    expect(boxes.length).toBe(4);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `${a.name} と ${b.name} が重なっている`).toBe(false);
      }
    }
  });

  test('changing TopN refetches with the new value', async ({ page }) => {
    // 予算種別と同じ経路（buildUrl の変化）で取り直す。
    // 年度が確定したあとの取り直しが効かないと、ここも黙って無反応になる。
    //
    // セレクタの値は応答の metadata.topN を映すので、5 に変わったことが
    // 「サーバまで往復して適用された」証拠になる（選んだ値をそのまま
    // 表示しているのではない）。
    //
    // 図の中身は見ない。列の上限（maxPerColumn=40）が先に効くため、
    // 既定の年度では TopN を変えても描画結果が変わらない。
    await page.getByLabel('表示設定').click();

    await page.getByLabel('事項の表示数').selectOption('5');

    await expect(page).toHaveURL(/ti=5/);
    await expect(page.getByLabel('事項の表示数')).toHaveValue('5', { timeout: 30_000 });
    await expect(page.getByTestId('hierarchy-node')).not.toHaveCount(0);
  });
});
