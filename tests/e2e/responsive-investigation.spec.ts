import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve(__dirname, '../../docs/tasks/_assets/20260528_responsive');

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'tablet-portrait-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
];

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

for (const vp of VIEWPORTS) {
  test(`capture sankey-svg @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/sankey-svg');
    await page.waitForSelector('[data-testid="sankey-node"]', { timeout: 30_000 });
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: path.join(OUT_DIR, `${vp.name}.png`),
      fullPage: false,
    });

    const overlaps = await page.evaluate(() => {
      const find = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const header = find('header') ?? find('[data-testid="top-toolbar"]');
      const columnHeader = document.querySelector('[data-testid="column-header"]');
      const columnHeaderRect = columnHeader?.getBoundingClientRect() ?? null;
      const sankey = document.querySelector('svg');
      const sankeyRect = sankey?.getBoundingClientRect() ?? null;
      const sidePanel = document.querySelector('[data-testid="side-panel"]');
      const sidePanelRect = sidePanel?.getBoundingClientRect() ?? null;

      const documentWidth = document.documentElement.scrollWidth;
      const documentHeight = document.documentElement.scrollHeight;
      const horizontalOverflow = documentWidth > window.innerWidth;

      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        documentSize: { w: documentWidth, h: documentHeight },
        horizontalOverflow,
        header: header ? { top: header.top, bottom: header.bottom, left: header.left, right: header.right, height: header.height } : null,
        columnHeader: columnHeaderRect,
        sankey: sankeyRect ? { top: sankeyRect.top, left: sankeyRect.left, width: sankeyRect.width, height: sankeyRect.height } : null,
        sidePanel: sidePanelRect,
      };
    });

    fs.writeFileSync(
      path.join(OUT_DIR, `${vp.name}.json`),
      JSON.stringify({ viewport: vp, overlaps }, null, 2)
    );
  });
}
