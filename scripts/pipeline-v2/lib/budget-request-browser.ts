/**
 * browser acquisition（Playwright/Chromium）。allowPlaywrightFallback付きtargetのcanonical URLだけに使う。
 *
 * marumie-rssystem-research の scripts/source-acquisition/browser-fetch で実証済みの方式を流用:
 *   同一browser contextでlanding pageを先に訪問 → PDF URLへgoto（download eventまたはresponse body）。
 * Playwright/Chromiumの既定設定のまま使う（User-Agent等は変更しない）。CAPTCHA/Human Verificationの突破、
 * cookie偽造、stealth plugin等は行わない（interactiveなverificationが出た場合はnon-PDFとして失敗する）。
 *
 * FY2024ではこのcapabilityを使うtargetは無い（経産省6件はWAFのHuman Verificationのためmanual-required、
 * 外務省・NDLはHTTPだけで取得できる）。将来の別sourceで必要になったときのために残している。
 */
import * as fs from 'fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { BrowserAcquire, BrowserAcquireOutcome } from './budget-request-download';

const DOWNLOAD_EVENT_WAIT_MS = 20_000;

export interface BrowserAcquirer {
  acquire: BrowserAcquire;
  close(): Promise<void>;
}

/** browserは初回利用時に起動し、landing pageごとにcontextを共有する（landingは1回だけ訪問） */
export function createPlaywrightAcquirer(): BrowserAcquirer {
  let browser: Browser | undefined;
  const contexts = new Map<string, BrowserContext>();

  async function contextFor(landingPageUrl: string | undefined, timeoutMs: number): Promise<BrowserContext> {
    const key = landingPageUrl ?? '';
    const existing = contexts.get(key);
    if (existing) return existing;
    browser ??= await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    contexts.set(key, ctx);
    if (landingPageUrl) {
      const page = await ctx.newPage();
      // landingのstatusは問わない（WAFのchallenge応答でも、その後の状態を満たすために訪問する）
      await page.goto(landingPageUrl, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => null);
      await page.close();
    }
    return ctx;
  }

  const acquire: BrowserAcquire = async ({ url, landingPageUrl, timeoutMs }): Promise<BrowserAcquireOutcome> => {
    try {
      const ctx = await contextFor(landingPageUrl, timeoutMs);
      const page = await ctx.newPage();
      try {
        const [download, resp] = await Promise.all([
          page.waitForEvent('download', { timeout: Math.min(DOWNLOAD_EVENT_WAIT_MS, timeoutMs) }).catch(() => null),
          page.goto(url, { waitUntil: 'load', timeout: timeoutMs }).catch(() => null),
        ]);
        if (download) {
          return { ok: true, buf: fs.readFileSync(await download.path()), finalUrl: download.url() };
        }
        if (!resp) return { ok: false, kind: 'network', error: 'browser navigation failed (no response, no download)' };
        if (!resp.ok()) return { ok: false, kind: 'http', httpStatus: resp.status(), error: `HTTP ${resp.status()} (browser)` };
        return { ok: true, buf: await resp.body(), finalUrl: resp.url(), httpStatus: resp.status() };
      } finally {
        await page.close();
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, kind: name === 'TimeoutError' ? 'timeout' : 'network', error: msg };
    }
  };

  return {
    acquire,
    async close() {
      await browser?.close();
      browser = undefined;
      contexts.clear();
    },
  };
}
