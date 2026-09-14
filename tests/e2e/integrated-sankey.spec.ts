/**
 * /integrated-sankey（MOF項・RS事業の2列ノード一覧）の実画面検証。
 *
 * 仕様の正: docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md
 * 帯（エッジ）は描かない。対応関係は選択ノードの詳細パネル（一覧）でのみ見せる。
 * 検索（ジャンプ）とフィルタ（絞り込み）は別物という /sankey-svg の設計を踏襲する。
 */
import { expect, test } from '@playwright/test';

const CHO = 1e12;
const EXPECTED = { mofGeneral: 126.51, mofSpecial: 431.96, mofTotal: 558.47, connected: 131.45 };

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
  // unconnectedAmountは補正予算の減額（RS紐づけ無し）分を負のまま含むため、
  // この恒等式は符号込みでちょうど一致する
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
  await expect(canvas.getByText('558.47兆円', { exact: true })).toBeVisible();
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
  await expect(detail.getByRole('button', { name: 'サマリー', exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '目', exact: false }).first()).toBeVisible();
  await expect(detail.getByRole('button', { name: 'RS事業', exact: false })).toBeVisible();

  await detail.getByLabel('閉じる（選択解除）').click();
  await expect(detail).toBeHidden();
});

test('MOF項の目タブは目レコード単位でRS事業件数バッジを出し、RS事業タブは予算種別×件数を出す', async ({ page }) => {
  // 1目が複数RS事業に按分されているケース（生活保護等対策費）で、目タブが
  // エッジ単位（按分先ごとに1行）ではなく目レコード単位（1目1行＋接続件数バッジ）に
  // なっていること、RS事業タブが予算種別ごとの接続件数を「補正1×1件」のように
  // 区切り付きで出すこと（区切りが無いと「補正1」+「1件」が「補正11件」に読めて
  // しまう誤読バグがあった）を確認する（2026-09-15指摘・修正）
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });
  await page.locator('input[placeholder*="項名"]').fill('生活保護等対策費');
  await page.getByText('生活保護等対策費', { exact: false }).first().click();
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: '目', exact: false }).click();
  await expect(detail.getByText(/^RS事業\d+件$/).first()).toBeVisible();

  await detail.getByRole('button', { name: 'RS事業', exact: false }).click();
  const rsText = await detail.innerText();
  expect(rsText).toMatch(/(当初|補正\d+)×\d+件/);
  expect(rsText).not.toMatch(/補正\d+\d+件/); // 「補正11件」のような区切り無し誤読表記が無いこと

  await detail.getByRole('button', { name: 'サマリー', exact: true }).click();
  await expect(detail.getByText('RS接続額', { exact: true })).toBeVisible();
  await expect(detail.getByText('目数', { exact: true })).toBeVisible();
  await expect(detail.getByText('接続RS事業数', { exact: true })).toBeVisible();
});

test('サイドパネル表示時にサンキー図はPanせずパネルがオーバーレイする', async ({ page }) => {
  // /sankey-svg と同じく、パネルは図の上にオーバーレイするだけで、図自体の
  // viewBox（幅・位置）は変えない（2026-09-15指摘: 以前はコンテナの左端を
  // パネル幅ぶん動かしており、図がPanして見えていた）
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  const canvas = page.getByTestId('integrated-canvas');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });
  const viewBoxBefore = await canvas.getAttribute('viewBox');

  await page.getByTestId('sankey-node').first().click({ force: true });
  await expect(page.getByTestId('integrated-detail')).toBeVisible();
  expect(await canvas.getAttribute('viewBox')).toBe(viewBoxBefore);
});

test('MOF項ヘッダーの増減額は本年度額と前年度額の差に一致する（当初のみの差額とはズレる）', async ({ page, request }) => {
  // section.difference（当初予算行のみのYoY差額）ではなく、実際に表示している
  // 本年度額（当初＋補正の合計）と前年度額の差から増減を出す必要がある
  // （当初だけを基準にするとズレる、2026-09-15指摘）
  const graph = await (await request.get('/api/integrated-sankey?year=2025')).json();
  const target = graph.sections.find((s: { amount: number; previousAmount: number; difference: number }) =>
    Math.abs(s.amount - s.previousAmount - s.difference) > 1);
  expect(target, '当初のみの差額とamount-previousAmountがズレる項が見つからない').toBeTruthy();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });
  await page.locator('input[placeholder*="項名"]').fill(target.name);
  await page.getByText(target.name, { exact: false }).first().click();

  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  const expectedDiff = target.amount - target.previousAmount;
  const money = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
    if (abs >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
    if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}万円`;
    return `${v.toLocaleString()}円`;
  };
  const expectedText = `${expectedDiff >= 0 ? '+' : ''}${money(expectedDiff)}`;
  await expect(detail.getByText(expectedText, { exact: false })).toBeVisible();
});

test('RS事業を選択すると予算サマリ・予算執行・MOF項タブが出て、接続先のMOF項が確認できる', async ({ page, request }) => {
  const graph = await (await request.get('/api/integrated-sankey?year=2025')).json();
  const withLinked = graph.projects.find((p: { linkedAmount: number }) => p.linkedAmount > 0);
  expect(withLinked, 'MOF項に接続しているRS事業が見つからない').toBeTruthy();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  // withLinked自身を検索してクリックする（先頭事業ではなく、実際にMOF項へ接続している
  // 事業を選んで検証する）
  await page.locator('input[placeholder*="項名"]').fill(withLinked.name);
  await page.getByText(withLinked.name, { exact: false }).first().click();

  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('予算額', { exact: true })).toBeVisible();
  await expect(detail.getByText('支出額', { exact: true })).toBeVisible();
  await expect(detail.getByText('事業', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '予算サマリ', exact: false })).toBeVisible();
  await expect(detail.getByRole('button', { name: '予算執行', exact: false })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'MOF項', exact: false })).toBeVisible();
  // RS事業自身の目一覧タブは廃止済み（MOF項タブへ一本化）
  await expect(detail.getByRole('button', { name: '目', exact: false })).toHaveCount(0);
  await detail.getByRole('button', { name: 'MOF項', exact: false }).click();
  await expect(detail.locator('text=接続しているMOF項がありません')).toHaveCount(0);
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

  // 府省庁（RS事業の所管）フィルタはMOF項側の所管とは独立にRS事業側の母集合だけを絞る
  const beforeProject = await universeOf('RS事業');
  await page.getByRole('button', { name: '府省庁', exact: true }).click();
  const firstProjectMinistry = await page.getByRole('listbox', { name: '府省庁' }).locator('label').nth(1).innerText();
  await page.getByRole('checkbox', { name: firstProjectMinistry }).uncheck();
  await expect.poll(() => universeOf('RS事業')).toBeLessThan(beforeProject);
  await page.mouse.click(900, 500);
  await page.getByLabel('フィルタを解除').click();
  await expect.poll(() => universeOf('RS事業')).toBe(beforeProject);

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

  // ノードの可視性（切替前から既に真）ではなく、年度固有の値（紐づけ率バッジ）が
  // 実際に更新されたことを確認する。RS2025×MOF2024とRS2024×MOF2023は紐づけ品質が
  // 大きく異なるため、テキストが変わることが「新年度のデータで再描画された」証拠になる
  const linkageBadge = page.getByText('紐づけ率', { exact: false });
  const before = await linkageBadge.textContent();

  await page.getByTestId('year-select').selectOption('2024');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });
  await expect(linkageBadge).not.toHaveText(before ?? '');
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
