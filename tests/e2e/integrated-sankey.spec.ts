/**
 * /integrated-sankey（統合サンキー ファーストカット）の実画面検証。
 *
 * 仕様書の基準実測値（2024年度当初予算）をAPIレスポンスに対して直接確認し、
 * そのうえで2列表示・選択・詳細パネルが機能することを見る。
 * 画面の基準は /sankey-svg。
 */
import { expect, test } from '@playwright/test';

/** 仕様書の基準実測値。1円単位。誤差は表示桁の丸めを吸収する範囲に留める */
const CHO = 1e12;
const EXPECTED = {
  mofGeneral: 112.57,
  mofSpecial: 436.04,
  mofTotal: 548.61,
  connected: 119.37,
};

test('API集計が仕様書の基準実測値と一致する', async ({ request }) => {
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

  // 金額の恒等式。残差を丸めて隠していないことの確認でもある
  expect(metadata.connectedAmount + metadata.unconnectedAmount - metadata.excessAmount)
    .toBe(metadata.mofAmount);

  // 超過（MOF目金額をRS計上額が上回る分）は0へ丸めず表に出す
  expect(metadata.excessAmount).toBeGreaterThan(0);
  expect(graph.edges.some((e: { status: string }) => e.status === 'excess')).toBe(true);

  // 複数のMOF項から同じRS事業へ収束する構造が保持されている
  const sourcesByProject = new Map<string, Set<string>>();
  for (const e of graph.edges as { source: string; target: string }[]) {
    if (!e.target.startsWith('project:')) continue;
    if (!sourcesByProject.has(e.target)) sourcesByProject.set(e.target, new Set());
    sourcesByProject.get(e.target)!.add(e.source);
  }
  expect([...sourcesByProject.values()].some(s => s.size > 1)).toBe(true);
});

test('サポート外の年度はエラーを返す', async ({ request }) => {
  const res = await request.get('/api/integrated-sankey?year=2024');
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain('ファーストカット');
});

test('2列表示・選択・詳細パネルが機能する', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  // 左列＝MOF項、右列＝RS事業の2列だと読み取れる
  await expect(page.getByText('MOFの項', { exact: true })).toBeVisible();
  await expect(page.getByText('RSの事業', { exact: true })).toBeVisible();

  // 列見出しが浮遊UI（左上カード・右上クラスタ）の裏に隠れないこと
  await expect(page.locator('h1')).toHaveCount(0);
  const leftHead = (await page.getByText('MOFの項', { exact: true }).boundingBox())!;
  const rightHead = (await page.getByText('RSの事業', { exact: true }).boundingBox())!;
  const searchBox = (await page.getByTestId('search-input').boundingBox())!;
  expect(leftHead.x).toBeGreaterThan(0);
  expect(rightHead.y).toBeGreaterThan(searchBox.y + searchBox.height);
  await expect(page.getByTestId('integrated-edge').first()).toBeAttached();

  // 初期表示のまま撮る（パネル退避のアニメーション中に撮らないよう、操作の前に置く）
  await page.screenshot({ path: 'test-results/integrated-sankey.png' });

  // RS未接続ノードがRS事業とは別に存在する
  await expect(page.locator('title', { hasText: 'RS未接続' }).first()).toBeAttached();

  // MOF項を選択すると詳細に目エッジが出る
  await page.getByTestId('sankey-node').first().click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('MOF項', { exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: '目エッジ' })).toBeVisible();
  await detail.getByRole('button', { name: '選択解除' }).click();
  await expect(detail).toBeHidden();

  // 目エッジのホバーで目名・金額・接続状態が読める。
  // サンキー図ではエッジ同士が必然的に重なるため force で重なり判定を外す
  const widest = await page.getByTestId('integrated-edge').evaluateAll(edges => edges.reduce((best, edge, i) => edge.getBoundingClientRect().height > edges[best].getBoundingClientRect().height ? i : best, 0));
  await page.getByTestId('integrated-edge').nth(widest).hover({ force: true });
  await expect(page.getByTestId('integrated-hover')).toBeVisible();

  // 目視確認用。test-results/ は .gitignore 済み
  await page.screenshot({ path: 'test-results/integrated-sankey.png' });
  expect(errors).toEqual([]);
});

test('検索・表示件数・ズーム・パンが機能する', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  const rect = page.getByTestId('sankey-node').first().locator('rect');
  const initialWidth = await rect.getAttribute('width');
  const initialHeight = Number(await rect.getAttribute('height'));
  await page.getByTestId('zoom-in').click();
  await expect(rect).toHaveAttribute('width', initialWidth!);
  expect(Number(await rect.getAttribute('height'))).toBeGreaterThan(initialHeight);
  expect(await page.locator('[data-item-count="1"]').count()).toBe(await page.getByTestId('integrated-edge').count());
  await page.getByTestId('zoom-out').click();
  await page.getByRole('button', { name: '全体' }).click();

  // 表示範囲は /sankey-svg と同じ RangeWindowRow（クリックで件数を直接入力）
  await page.getByRole('button', { name: 'MOF項の表示件数' }).click();
  await page.getByRole('spinbutton').first().fill('25');
  await page.getByRole('spinbutton').first().press('Enter');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible();

  const before = await page.getByTestId('sankey-node').count();
  await page.getByTestId('search-input').fill('年金');
  await expect.poll(() => page.getByTestId('sankey-node').count()).toBeLessThan(before);
  await expect(page.getByTestId('integrated-edge').first()).toBeAttached();

  await page.getByTestId('search-input').fill('');
  await expect.poll(() => page.getByTestId('sankey-node').count()).toBe(before);

  // パン（ドラッグ）でエラーが出ない
  const canvas = page.getByTestId('integrated-canvas');
  await canvas.hover({ position: { x: 900, y: 500 } });
  await page.mouse.down();
  await page.mouse.move(700, 420);
  await page.mouse.up();

  expect(errors).toEqual([]);
});

test('RS事業の詳細でMOF未接続の歳出予算項目を確認できる', async ({ page, request }) => {
  const graph = await (await request.get('/api/integrated-sankey?year=2025')).json();
  // MOF未接続の目を持つ事業が実データに存在すること自体を先に確かめる
  const withUnlinked = graph.projects.find(
    (p: { budgetItems: { connected: boolean }[] }) => p.budgetItems.some(i => !i.connected)
  );
  expect(withUnlinked, 'MOF未接続の歳出予算項目を持つRS事業が見つからない').toBeTruthy();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  // 右列のRS事業を選ぶ。上位事業は接続額が大きく、目の内訳を持つ
  await page.getByTestId('search-input').fill(String(graph.projects[0].name).slice(0, 6));
  await page.locator('[data-testid="sankey-node"][data-kind="project"]').first().click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('RS予算事業', { exact: true })).toBeVisible();
  await expect(detail.getByText('MOF接続済み', { exact: true }).first()).toBeVisible();
  await expect(detail.getByRole('heading', { name: '目' })).toBeVisible();
});

test('ページ切替メニューが画面内に開く', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 60000 });

  // ドロップダウンは右端基準で開くので、ボタンが左端にあると画面外へ出る
  await page.getByRole('button', { name: 'ページ切替メニュー' }).click();
  const menu = page.getByRole('link', { name: 'サンキー図' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1920);

  // 詳細パネルを開くと、右上クラスタはパネル幅ぶん左へ退避する
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 600);
  const clusterBefore = (await page.getByTestId('search-input').boundingBox())!;
  await page.getByTestId('sankey-node').first().click({ force: true });
  await expect(page.getByTestId('integrated-detail')).toBeVisible();
  await expect.poll(async () => (await page.getByTestId('search-input').boundingBox())!.x)
    .toBeLessThan(clusterBefore.x - 300);
});

test('目エッジを集約せず、フィルタと縦ラベル間隔を維持する', async ({ page, request }) => {
  const graph = await (await request.get('/api/integrated-sankey?year=2025')).json();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/integrated-sankey');
  await expect(page.getByTestId('integrated-edge')).toHaveCount(graph.edges.length);
  await page.getByTestId('zoom-out').click();
  const labels = await page.locator('[data-kind="section"] > text').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { top:r.top, bottom:r.bottom }; }));
  for (let i=1; i<labels.length; i++) expect(labels[i].top).toBeGreaterThanOrEqual(labels[i-1].bottom);
  await page.getByRole('button', {name:'フィルタ を表示'}).click();
  await page.getByText('会計区分（2件）', {exact:true}).click();
  await page.getByRole('checkbox', {name:'特別会計'}).uncheck();
  await expect.poll(() => page.getByTestId('integrated-edge').count()).toBeLessThan(graph.edges.length);
  await page.getByRole('button', {name:'フィルタを解除'}).click();
  await expect(page.getByTestId('integrated-edge')).toHaveCount(graph.edges.length);
  await page.getByRole('button', {name:'全体', exact:true}).click();
  await page.getByRole('button', {name:'フィルタ を表示'}).click();
  await page.screenshot({path:'test-results/integrated-overview.png'});
  await page.getByTestId('zoom-in').click();
  await page.screenshot({path:'test-results/integrated-zoom.png'});
  await page.goto('/sankey-svg');
  await page.waitForTimeout(3000);
  await page.screenshot({path:'test-results/sankey-svg-baseline.png'});
});
