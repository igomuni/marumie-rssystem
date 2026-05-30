import { expect, test, type Page } from '@playwright/test';

// Issue #195 レスポンシブ対応の受け入れ条件を機械検証する（/sankey-svg-next）。
// 設計書: docs/tasks/20260528_1914_sankey-svg_レスポンシブ対応設計.md

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box): boolean {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return ox > 1 && oy > 1; // 1px の許容
}

async function gotoReady(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/sankey-svg-next');
  await page.getByTestId('sankey-node').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

async function selectViaSearch(page: Page) {
  await page.getByTestId('search-input').fill('年金');
  const result = page.getByTestId('search-result').first();
  await result.waitFor({ timeout: 30_000 });
  await result.click();
  await page.waitForTimeout(700);
}

// ── 受け入れ条件: 上部UIと列見出しが重ならない ──
for (const { name, w, h } of [
  { name: 'mobile 390', w: 390, h: 844 },
  { name: 'tablet 768', w: 768, h: 1024 },
  { name: 'desktop 1440', w: 1440, h: 900 },
]) {
  test(`上部UI（検索/年度/⚙）と列見出しが重ならない @${name}`, async ({ page }) => {
    await gotoReady(page, w, h);
    const search = await page.getByTestId('search-input').boundingBox();
    const year = await page.getByTestId('year-select').boundingBox();
    const gear = await page.getByLabel('表示設定を開く').boundingBox();
    expect(search && year && gear).toBeTruthy();

    const headers = await page.getByTestId('column-header').evaluateAll(els =>
      els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));

    // 列見出しが上部UIのいずれとも交差しない
    for (const hd of headers) {
      expect(intersects(hd, search!), `header vs search @${name}`).toBe(false);
      expect(intersects(hd, year!), `header vs year @${name}`).toBe(false);
      expect(intersects(hd, gear!), `header vs gear @${name}`).toBe(false);
    }
    // 検索と年度が水平に重ならない（同段にある狭幅でも）。
    // height>1 にして oy>1 を成立させ、判定を ox（横方向の重なり）で決まるようにする。
    const sx = { x: search!.x, y: 0, width: search!.width, height: 2 };
    const yx = { x: year!.x, y: 0, width: year!.width, height: 2 };
    expect(intersects(sx, yx), `search vs year x-overlap @${name}`).toBe(false);
  });
}

// ── 受け入れ条件: compact-mobile で設定シートが開閉でき各設定にアクセスできる ──
test('compact-mobile: ⚙ 設定シートで font/TopN/表示設定/モードに到達できる @390', async ({ page }) => {
  await gotoReady(page, 390, 844);
  await page.getByLabel('表示設定を開く').click();
  const sheet = page.locator('#sankey-topn-settings');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('基準フォントサイズ')).toBeVisible();
  await expect(sheet.getByLabel('事業の表示件数')).toBeVisible();
  await expect(sheet.getByLabel('支出先の表示件数')).toBeVisible();
  await expect(sheet.getByText('すべてのノードラベルを表示')).toBeVisible();
  await expect(sheet.getByTestId('display-mode-select')).toBeVisible();
  // 閉じる
  await sheet.getByLabel('表示設定を閉じる').click();
  await expect(sheet).toBeHidden();
});

// ── 受け入れ条件: bottom-sheet モードで Sankey 本体がパン可能 ──
test('compact-mobile: 詳細が bottom-sheet で開き、背景 Sankey をパンできる @390', async ({ page }) => {
  await gotoReady(page, 390, 844);
  await selectViaSearch(page);

  const sheet = page.locator('div[data-pan-disabled="true"]').filter({ has: page.getByTitle('閉じる（選択解除）') }).first();
  const sb = await sheet.boundingBox();
  expect(sb!.y + sb!.height).toBeGreaterThanOrEqual(840); // 下端固定

  // 背景（シートより上の領域）をドラッグしてパン
  const before = await page.getByTestId('sankey-node').first().boundingBox();
  await page.mouse.move(120, 230);
  await page.mouse.down();
  await page.mouse.move(250, 235, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.getByTestId('sankey-node').first().boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(20); // 横方向にパンした
});

// ── 受け入れ条件: タッチ環境で主要ボタンが 44px ヒットエリア / タップ操作可能 ──
test.describe('compact-mobile touch (pointer: coarse)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('主要操作が最小 44px のヒットエリアを持つ', async ({ page }) => {
    await page.goto('/sankey-svg-next');
    await page.getByTestId('sankey-node').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);

    const checks: Array<[string, ReturnType<Page['locator']> | ReturnType<Page['getByTestId']>]> = [
      ['search-input', page.getByTestId('search-input')],
      ['year-select', page.getByTestId('year-select')],
      ['gear', page.getByLabel('表示設定を開く')],
      ['zoom-in', page.getByTestId('zoom-in')],
      ['zoom-out', page.getByTestId('zoom-out')],
      ['reset-viewport', page.getByTestId('reset-viewport')],
    ];
    for (const [name, loc] of checks) {
      const b = await loc.boundingBox();
      expect(b, `${name} exists`).not.toBeNull();
      expect(b!.height, `${name} height>=44`).toBeGreaterThanOrEqual(44);
      expect(b!.width, `${name} width>=44`).toBeGreaterThanOrEqual(44);
    }

    // 設定シート内
    await page.getByLabel('表示設定を開く').tap();
    const close = page.getByLabel('表示設定を閉じる');
    const cb = await close.boundingBox();
    expect(cb!.height).toBeGreaterThanOrEqual(44);
    expect(cb!.width).toBeGreaterThanOrEqual(44);
  });

  test('タップで ⚙ 設定シートを開閉できる', async ({ page }) => {
    await page.goto('/sankey-svg-next');
    await page.getByTestId('sankey-node').first().waitFor({ timeout: 30_000 });
    await page.getByLabel('表示設定を開く').tap();
    const sheet = page.locator('#sankey-topn-settings');
    await expect(sheet).toBeVisible();
    await page.getByLabel('表示設定を閉じる').tap();
    await expect(sheet).toBeHidden();
  });
});
