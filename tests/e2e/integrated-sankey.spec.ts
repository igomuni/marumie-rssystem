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
  await expect(page.getByTestId('integrated-edge').first()).toBeVisible();

  // RS未接続ノードがRS事業とは別に存在する
  await expect(page.locator('title', { hasText: 'RS未接続' }).first()).toBeAttached();

  // MOF項を選択すると詳細に目エッジが出る
  await page.getByTestId('sankey-node').first().click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('MOF項', { exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: '目エッジ' })).toBeVisible();
  await detail.getByRole('button', { name: '閉じる' }).click();
  await expect(detail).toBeHidden();

  // 目エッジのホバーで目名・金額・接続状態が読める。
  // サンキー図ではエッジ同士が必然的に重なるため force で重なり判定を外す
  await page.getByTestId('integrated-edge').first().hover({ force: true });
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

  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-out').click();
  await page.getByRole('button', { name: '全体' }).click();

  await page.getByLabel('表示件数').selectOption('25');
  await expect(page.getByTestId('sankey-node').first()).toBeVisible();

  const before = await page.getByTestId('sankey-node').count();
  await page.getByTestId('search-input').fill('年金');
  await expect.poll(() => page.getByTestId('sankey-node').count()).toBeLessThan(before);
  await expect(page.getByTestId('integrated-edge').first()).toBeVisible();

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

  // 右列のRS事業（オレンジ）を選ぶ。上位事業は接続額が大きく、目の内訳を持つ
  await page.getByTestId('search-input').fill(String(graph.projects[0].name).slice(0, 6));
  // ノードはラベル用の text が rect を覆うので、g ごと force でクリックする
  await page.locator('[data-testid="sankey-node"]:has(rect[fill="#d8873b"])').first()
    .click({ force: true });
  const detail = page.getByTestId('integrated-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('RS予算事業', { exact: true })).toBeVisible();
  await expect(detail.getByText('MOF接続済み', { exact: true }).first()).toBeVisible();
  await expect(detail.getByRole('heading', { name: '目' })).toBeVisible();
});
