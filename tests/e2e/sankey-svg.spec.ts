import { expect, test } from '@playwright/test';

async function visibleNodeCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('[data-testid="sankey-node"]').evaluateAll(nodes => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < viewportWidth &&
        rect.top < viewportHeight
      );
    }).length;
  });
}

async function selectSearchResultByTitle(page: import('@playwright/test').Page, title: string): Promise<void> {
  const result = page.getByTestId('search-result').filter({
    has: page.locator(`[title="${title}"]`),
  }).first();
  await expect(result).toBeVisible({ timeout: 30_000 });
  await result.click();
}

test.describe('sankey-svg interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sankey-svg');
    await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30_000 });
  });

  test('offset controls keep the graph in view', async ({ page }) => {
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('recipient-offset-next').click();
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('reset-viewport').click();
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('recipient-offset-prev').click();
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
  });

  test('zoom controls keep rendered nodes available', async ({ page }) => {
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-out').click();

    await expect(page.getByTestId('sankey-node')).not.toHaveCount(0);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
  });

  test('year selector can switch fiscal years', async ({ page }) => {
    await page.getByTestId('year-select').selectOption('2024');

    await expect(page.getByTestId('year-select')).toHaveValue('2024');
    await expect(page.getByTestId('sankey-node').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
  });

  test('debug scenario: select post-5G project, select NEDO recipient, filter project text, and switch year', async ({ page }) => {
    const projectName = 'ポスト5G情報通信システム基盤強化研究開発事業(AI基盤モデル及び先端半導体関連技術開発事業)';
    const recipientName = '国立研究開発法人新エネルギー・産業技術総合開発機構';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.getByTestId('search-input').fill(projectName);
    await selectSearchResultByTitle(page, projectName);
    await expect(page).toHaveURL(/sel=project-spending-3522/);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('search-input').fill(recipientName);
    await selectSearchResultByTitle(page, recipientName);
    await expect(page).toHaveURL(/sel=r-10/);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('search-input').fill('ポスト');
    await page.getByTestId('search-mode-toggle').click();
    await page.getByTestId('filter-target-select').selectOption('project');
    await page.getByTestId('year-select').selectOption('2024');

    await expect(page.getByTestId('search-input')).toHaveValue('ポスト');
    await expect(page.getByTestId('filter-target-select')).toHaveValue('project');
    await expect(page.getByTestId('year-select')).toHaveValue('2024');
    await expect(page).toHaveURL(/yr=2024/);
    await expect(page).toHaveURL(/sel=r-6/);
    await expect(page.getByTestId('sankey-node')).not.toHaveCount(0);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);

    await page.getByTestId('year-select').selectOption('2025');
    await expect(page.getByTestId('year-select')).toHaveValue('2025');
    await expect(page).toHaveURL(/sel=r-10/);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('sankey-svg deep links', () => {
  test('filtered deep link restores year, filter target, selection, and visible graph', async ({ page }) => {
    const recipientName = '国立研究開発法人新エネルギー・産業技術総合開発機構';
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/sankey-svg?yr=2024&f=1&nft=p&nf=%E3%83%9D%E3%82%B9%E3%83%88&sel=r-6');

    await expect(page.getByTestId('year-select')).toHaveValue('2024');
    await expect(page.getByTestId('search-input')).toHaveValue('ポスト');
    await expect(page.getByTestId('filter-target-select')).toHaveValue('project');
    await expect(page).toHaveURL(/sel=r-6/);
    await expect(page.getByText(recipientName).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sankey-node')).not.toHaveCount(0);
    await expect.poll(() => visibleNodeCount(page)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });
});
