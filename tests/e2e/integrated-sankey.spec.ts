/**
 * /integrated-sankey（MOF項・RS事業の2列ノード一覧）の実画面検証。
 *
 * 仕様の正: docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md
 * 帯（エッジ）は描かない。対応関係は選択ノードの詳細パネル（一覧）でのみ見せる。
 * 検索（ジャンプ）とフィルタ（絞り込み）は別物という /sankey-svg の設計を踏襲する。
 */
import { expect, test } from '@playwright/test';

const CHO = 1e12;
const EXPECTED = { mofGeneral: 112.57, mofSpecial: 436.04, mofTotal: 548.61, connected: 119.37 };

test('API集計が仕様書の基準実測値と一致する（RS2025×MOF2024）', async ({ request }) => {
  const res = await request.get('/api/integrated-sankey?year=2025');
  expect(res.ok()).toBe(true);
  const graph = await res.json();
  const { metadata, sections } = graph;

  expect(metadata.budgetYear).toBe(2024);
  expect(metadata.rsYear).toBe(2025);

  const sum = (type: string) =>
    sections.filter((s: { accountType: string }) => s.accountType === type)
      .reduce((a: number, s: { amount: number }) => a + s.amount, 0) / CHO;
  expect(sum('general')).toBeCloseTo(EXPECTED.mofGeneral, 2);
  expect(sum('special')).toBeCloseTo(EXPECTED.mofSpecial, 2);
  expect(metadata.mofAmount / CHO).toBeCloseTo(EXPECTED.mofTotal, 2);
  expect(metadata.connectedAmount / CHO).toBeCloseTo(EXPECTED.connected, 2);
  expect(metadata.connectedAmount + metadata.unconnectedAmount - metadata.excessAmount).toBe(metadata.mofAmount);

  expect(graph.linkageQuality).toBeTruthy();
  expect(graph.linkageQuality.counts.projectLinked / graph.linkageQuality.counts.projectTotal).toBeGreaterThan(0.9);
});

test('RS2024×MOF2023は紐づけ品質が低いことがAPIから分かる', async ({ request }) => {
  const res = await request.get('/api/integrated-sankey?year=2024');
  expect(res.ok()).toBe(true);
  const graph = await res.json();
  expect(graph.metadata.budgetYear).toBe(2023);
  expect(graph.linkageQuality.counts.projectLinked / graph.linkageQuality.counts.projectTotal).toBeLessThan(0.5);
});

test('サポート外の年度はエラーを返す', async ({ request }) => {
  const res = await request.get('/api/integrated-sankey?year=2023');
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain('対応年度');
});

test('2列のノード一覧が表示され、帯（エッジ）は描かれない', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const canvas = page.getByTestId('integrated-canvas');
  await expect(canvas.getByText('MOF項', { exact: true })).toBeVisible();
  await expect(canvas.getByText('RS事業', { exact: true })).toBeVisible();
  // 項と事業を結ぶ帯は存在しない（RS事業ノード自体は予算/支出の統合ノードとしてpathで
  // 描くため、pathの有無ではなく専用のtestidで判定する）
  await expect(page.locator('[data-testid="integrated-edge"]')).toHaveCount(0);

  await page.screenshot({ path: 'test-results/integrated-sankey.png' });
  expect(errors).toEqual([]);
});

test('ノードに名前と金額が併記される（/sankey-svgと同じtrunc方式）', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const text = await page.getByTestId('sankey-node').first().locator('text').first().textContent();
  expect(text).toMatch(/（.+円）/);
});

test('列見出しに列ごとの合計金額が表示される', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const canvas = page.getByTestId('integrated-canvas');
  await expect(canvas.getByText('548.61兆円', { exact: true })).toBeVisible();
});

test('MOF項を選択すると左パネルに目・RS事業タブとバッジ付きヘッダーが出る', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  await page.getByTestId('sankey-node').first().click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  // パネルは左側
  const box = (await detail.boundingBox())!;
  expect(box.x).toBeLessThan(100);

  await expect(detail.getByText('本年度額', { exact: true })).toBeVisible();
  await expect(detail.getByText('前年度額', { exact: true })).toBeVisible();
  await expect(detail.getByText('項', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '目', exact: false }).first()).toBeVisible();
  await expect(detail.getByRole('button', { name: 'RS事業', exact: false })).toBeVisible();

  await detail.getByLabel('閉じる（選択解除）').click();
  await expect(detail).toBeHidden();
});

test('RS事業を選択すると予算執行・目タブが出て、MOF未接続項目も確認できる', async ({ page, request }) => {
  const graph = await (await request.get('/api/integrated-sankey?year=2025')).json();
  const withUnlinked = graph.projects.find((p: { budgetItems: { connected: boolean }[] }) => p.budgetItems.some(i => !i.connected));
  expect(withUnlinked, 'MOF未接続の歳出予算項目を持つRS事業が見つからない').toBeTruthy();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  await page.locator('[data-testid="sankey-node"][data-kind="project"]').first().click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('予算額', { exact: true })).toBeVisible();
  await expect(detail.getByText('支出額', { exact: true })).toBeVisible();
  await expect(detail.getByText('事業', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '予算執行', exact: false })).toBeVisible();
  await expect(detail.getByRole('button', { name: '予算サマリ', exact: false })).toBeVisible();
  await expect(detail.getByRole('button', { name: '目', exact: false })).toBeVisible();
  await detail.getByRole('button', { name: '目', exact: false }).click();
  await expect(detail.getByText('MOF接続済み', { exact: true }).first()).toBeVisible();
});

test('「その他の項」集約ノードを選択すると内訳の目一覧が出る', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  await page.locator('[data-testid="sankey-node"][data-kind="other-sections"]').click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('集約', { exact: true })).toBeVisible();
  // 内訳が1件以上リストされる
  await expect(detail.locator('div').filter({ hasText: /兆円|億円|万円/ }).first()).toBeVisible();
});

test('検索は1本のボックスで項名・事業名を横断するジャンプ機能で、グラフを絞り込まない', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const universeOf = async (label: string) => {
    const vt = await page.getByRole('slider', { name: `${label}の表示開始位置` }).getAttribute('aria-valuetext');
    return Number(vt?.split('/').pop()?.replace(/[^0-9]/g, ''));
  };
  const sectionBefore = await universeOf('MOF項');
  const projectBefore = await universeOf('RS事業');

  await page.getByTestId('search-input').fill('年金');
  await expect(page.getByTestId('search-input-result').first()).toBeVisible();
  // 検索結果には項・事業の両方が混在しうる（1本のボックスで横断するため）
  const results = await page.getByTestId('search-input-result').allInnerTexts();
  expect(results.length).toBeGreaterThan(0);

  // ジャンプはグラフを絞り込まない
  expect(await universeOf('MOF項')).toBe(sectionBefore);
  expect(await universeOf('RS事業')).toBe(projectBefore);

  await page.getByTestId('search-input-result').first().click();
  await expect(page.getByTestId('integrated-detail')).toBeVisible();
});

test('不正な正規表現はページをクラッシュさせず該当なしになる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  await page.getByLabel('正規表現で検索').click();
  await page.getByTestId('search-input').fill('[[[invalid');
  await page.waitForTimeout(300);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText('該当なし')).toBeVisible();
  expect(errors).toEqual([]);
});

test('フィルタパネルの会計区分・所管・項/事業名・金額レンジが絞り込む', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const universeOf = async (label: string) => {
    const vt = await page.getByRole('slider', { name: `${label}の表示開始位置` }).getAttribute('aria-valuetext');
    return Number(vt?.split('/').pop()?.replace(/[^0-9]/g, ''));
  };
  const before = await universeOf('MOF項');

  await page.getByTitle('フィルタ を表示').click();
  await page.getByRole('button', { name: '会計', exact: true }).click();
  await page.getByRole('checkbox', { name: '特別会計' }).uncheck();
  await expect.poll(() => universeOf('MOF項')).toBeLessThan(before);
  await page.mouse.click(900, 500); // コンボボックスを外側クリックで閉じる

  await page.getByLabel('フィルタを解除').click();
  await expect.poll(() => universeOf('MOF項')).toBe(before);

  const kokusaiLabel = () => page.locator('[data-testid="sankey-node"] text', { hasText: '国債整理支出' });
  await expect(kokusaiLabel()).toBeVisible();
  await page.getByPlaceholder('例: 1兆、500億').first().fill('1000億');
  await expect(kokusaiLabel()).toHaveCount(0);
  await page.getByPlaceholder('例: 1兆、500億').first().fill('');

  await page.getByPlaceholder('例: 100億、50万').nth(1).fill('1000兆');
  await expect(page.locator('[data-testid="sankey-node"][data-kind="project"]')).toHaveCount(0);
  await page.getByLabel('フィルタを解除').click();
});

test('表示範囲・ズーム・パンが機能する', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const rect = page.getByTestId('sankey-node').first().locator('rect');
  const initialHeight = Number(await rect.getAttribute('height'));
  await page.getByTestId('zoom-in').click();
  expect(Number(await rect.getAttribute('height'))).toBeGreaterThan(initialHeight);
  await page.getByTestId('zoom-out').click();
  await page.getByTestId('reset-viewport').click();

  await page.getByRole('button', { name: 'MOF項の表示件数' }).click();
  await page.getByRole('spinbutton').first().fill('25');
  await page.getByRole('spinbutton').first().press('Enter');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible();

  const canvas = page.getByTestId('integrated-canvas');
  await canvas.hover({ position: { x: 900, y: 500 } });
  await page.mouse.down();
  await page.mouse.move(700, 420);
  await page.mouse.up();

  expect(errors).toEqual([]);
});

test('年度切替でRS2024×MOF2023データに切り替わる', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  await page.getByTestId('year-select').selectOption('2024');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });
});

test('ページ切替メニューが画面内に開き、左パネル展開時に検索・図が右へ退避する', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  await page.getByRole('button', { name: 'ページ切替メニュー' }).click();
  const menu = page.getByRole('link', { name: 'サンキー図' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1920);
  await page.keyboard.press('Escape');
  await page.mouse.click(900, 600);

  const searchBefore = (await page.getByTestId('search-input').boundingBox())!;
  await page.getByTestId('sankey-node').first().click({ force: true });
  await expect(page.getByTestId('integrated-detail')).toBeVisible();
  await page.waitForTimeout(300);
  const searchAfter = (await page.getByTestId('search-input').boundingBox())!;
  expect(searchAfter.x).toBeGreaterThan(searchBefore.x + 300);
});
