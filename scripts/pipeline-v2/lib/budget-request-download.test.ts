import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  checkCache,
  downloadAll,
  downloadTarget,
  expandTargets,
  extractWarpReplayUrl,
  isPdfHead,
  localPathFor,
  summarizeResults,
  type BrowserAcquire,
  type BudgetRequestDownloadDeps,
  type BudgetRequestDownloadTarget,
  type BudgetRequestFs,
} from './budget-request-download';
import { getBudgetRequestManifest } from './budget-request-manifest';

const PDF_BYTES = Buffer.from('%PDF-1.4\nbody');
const BASE = 'data/download';
const NDL = 'https://www.ndl.go.jp/jp/aboutus/outline/r06_budgetrequest.pdf';
const WARP = `https://warp.ndl.go.jp/web/20231004165212/${NDL}`;

/** メモリ上のfs。files: path → bytes */
function memFs(initial: Record<string, Buffer> = {}): BudgetRequestFs & { files: Map<string, Buffer> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    size: p => files.get(p)?.length,
    readHead: (p, n) => files.get(p)!.subarray(0, n),
    mkdirp: () => undefined,
    writeAtomic: (p, data) => void files.set(p, data),
  };
}

type Responder = (url: string) => Response | Error;
function mockDeps(responder: Responder, fsImpl = memFs()): BudgetRequestDownloadDeps & { calls: string[]; fs: ReturnType<typeof memFs> } {
  const calls: string[] = [];
  return {
    calls,
    fs: fsImpl,
    fetch: async url => {
      calls.push(url);
      const r = responder(url);
      if (r instanceof Error) throw r;
      return r;
    },
    sleep: async () => undefined,
  };
}
const pdfRes = (type = 'application/pdf') => new Response(PDF_BYTES, { status: 200, headers: { 'content-type': type } });
const htmlRes = () => new Response('<html>WAF challenge</html>', { status: 200, headers: { 'content-type': 'text/html' } });
const statusRes = (status: number) => new Response('x', { status });

const target = (over: Partial<BudgetRequestDownloadTarget> = {}): BudgetRequestDownloadTarget => ({
  fiscalYear: 2024,
  kind: 'document',
  publisherAuthority: '国立国会図書館',
  publisherDomain: 'ndl.go.jp',
  canonicalUrl: NDL,
  ...over,
});
const ndlPath = path.join(BASE, 'ndl.go.jp', 'jp', 'aboutus', 'outline', 'r06_budgetrequest.pdf');

describe('expandTargets', () => {
  it('FY2024: 82 document PDF + 1 reference = 83 targets', () => {
    const targets = expandTargets(getBudgetRequestManifest(2024));
    expect(targets.filter(t => t.kind === 'document')).toHaveLength(82);
    expect(targets.filter(t => t.kind === 'reference')).toHaveLength(1);
    expect(targets).toHaveLength(83);
  });

  it('document metadata・fallback・Playwright許可を保持し、referenceはpurpose/titleを持つ', () => {
    const targets = expandTargets(getBudgetRequestManifest(2024));
    const ndl = targets.find(t => t.publisherDomain === 'ndl.go.jp')!;
    expect(ndl.acquisitionFallbacks?.[0].type).toBe('warp');
    expect(ndl.logicalAuthority).toBe('国立国会図書館');
    expect(targets.filter(t => t.allowPlaywrightFallback)).toHaveLength(1); // 経産省6件はmanual-requiredに移行し外務省のみ
    const ref = targets.find(t => t.kind === 'reference')!;
    expect(ref.purpose).toBe('validation');
    expect(ref.title).toContain('財政投融資計画要求額');
  });

  it('manual-required targetは経産省6件のみ、Playwright許可は外務省1件のみ', () => {
    const targets = expandTargets(getBudgetRequestManifest(2024));
    const manual = targets.filter(t => t.acquisitionPolicy === 'manual-required');
    expect(manual).toHaveLength(6);
    expect(manual.every(t => t.publisherDomain === 'meti.go.jp' && !t.allowPlaywrightFallback)).toBe(true);
    expect(targets.filter(t => t.allowPlaywrightFallback).map(t => t.publisherDomain)).toEqual(['mofa.go.jp']);
  });

  it('全targetのlocal pathが一意で、throwしない', () => {
    const targets = expandTargets(getBudgetRequestManifest(2024));
    const paths = targets.map(t => localPathFor(t.canonicalUrl, t.publisherDomain, BASE));
    expect(new Set(paths).size).toBe(targets.length);
  });
});

describe('localPathFor', () => {
  it('www除去済みdomain + nested path', () => {
    expect(localPathFor('https://www.mof.go.jp/about_mof/mof_budget/budget/fy2024/2024ippan_2.pdf', 'mof.go.jp', BASE)).toBe(
      path.join(BASE, 'mof.go.jp', 'about_mof', 'mof_budget', 'budget', 'fy2024', '2024ippan_2.pdf'),
    );
  });

  it('query/fragmentを含めない', () => {
    expect(localPathFor('https://www.example.go.jp/a/b.pdf?x=1#p2', 'example.go.jp', BASE)).toBe(path.join(BASE, 'example.go.jp', 'a', 'b.pdf'));
  });

  it('$File と %24File は同じ安全なlocal pathになる', () => {
    const a = localPathFor('https://www.shugiin.go.jp/x/k.pdf/$File/k.pdf', 'shugiin.go.jp', BASE);
    const b = localPathFor('https://www.shugiin.go.jp/x/k.pdf/%24File/k.pdf', 'shugiin.go.jp', BASE);
    expect(a).toBe(path.join(BASE, 'shugiin.go.jp', 'x', 'k.pdf', '%24File', 'k.pdf'));
    expect(b).toBe(a);
  });

  it('NDL: canonical URLから決まる（WARP URLではない）', () => {
    expect(localPathFor(NDL, 'ndl.go.jp', BASE)).toBe(ndlPath);
  });

  it('path traversal・不正入力を拒否する', () => {
    expect(() => localPathFor('https://www.example.go.jp/a/%2e%2e/%2e%2e/x.pdf', 'example.go.jp', BASE)).not.toThrow(); // URL parserが正規化
    expect(() => localPathFor('https://www.example.go.jp/a/..%2f..%2fx.pdf', 'example.go.jp', BASE)).toThrow(/不正なpath segment/);
    expect(() => localPathFor('https://www.example.go.jp/a/%5c..%5cx.pdf', 'example.go.jp', BASE)).toThrow(/不正なpath segment/);
    expect(() => localPathFor('http://www.example.go.jp/a.pdf', 'example.go.jp', BASE)).toThrow(/https/);
    expect(() => localPathFor('https://www.other.go.jp/a.pdf', 'example.go.jp', BASE)).toThrow(/不一致/);
    expect(() => localPathFor('https://www.example.go.jp/dir/', 'example.go.jp', BASE)).toThrow(/ファイル名/);
  });
});

describe('cache判定', () => {
  it('valid PDF → valid', () => {
    expect(checkCache('p', memFs({ p: PDF_BYTES }))).toEqual({ state: 'valid', bytes: PDF_BYTES.length });
  });
  it('0 byte → invalid', () => {
    expect(checkCache('p', memFs({ p: Buffer.alloc(0) }))).toEqual({ state: 'invalid' });
  });
  it('HTML → invalid', () => {
    expect(checkCache('p', memFs({ p: Buffer.from('<html>') }))).toEqual({ state: 'invalid' });
  });
  it('無ければnone', () => {
    expect(checkCache('p', memFs())).toEqual({ state: 'none' });
  });
  it('isPdfHead', () => {
    expect(isPdfHead(Buffer.from('%PDF-'))).toBe(true);
    expect(isPdfHead(Buffer.from('%PDF'))).toBe(false);
  });
});

describe('downloadTarget: fetch', () => {
  it('200 + %PDF- → downloaded（canonical pathへ無加工で保存）', async () => {
    const deps = mockDeps(() => pdfRes());
    const r = await downloadTarget(target(), deps);
    expect(r).toMatchObject({ status: 'downloaded', acquisitionMethod: 'direct', acquisitionUrl: NDL, localPath: ndlPath, bytes: PDF_BYTES.length, httpStatus: 200, contentType: 'application/pdf' });
    expect(deps.fs.files.get(ndlPath)).toEqual(PDF_BYTES);
  });

  it('Content-Typeがoctet-streamでも%PDF-ならPDFとして受け入れる', async () => {
    const r = await downloadTarget(target(), mockDeps(() => pdfRes('application/octet-stream')));
    expect(r.status).toBe('downloaded');
  });

  it('404 → failed（HTTP failure）', async () => {
    const deps = mockDeps(() => statusRes(404));
    const r = await downloadTarget(target(), deps);
    expect(r).toMatchObject({ status: 'failed', acquisitionMethod: 'none', httpStatus: 404 });
    expect(r.attempts?.[0]).toMatchObject({ method: 'direct', kind: 'http' });
    expect(deps.fs.files.size).toBe(0);
  });

  it('200 + HTML → non-PDFでfailed、保存しない', async () => {
    const deps = mockDeps(() => htmlRes());
    const r = await downloadTarget(target(), deps);
    expect(r.status).toBe('failed');
    expect(r.attempts?.[0].kind).toBe('non-pdf');
    expect(deps.fs.files.size).toBe(0);
  });

  it('timeout / network error → failed', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    expect((await downloadTarget(target(), mockDeps(() => timeout))).attempts?.[0].kind).toBe('timeout');
    expect((await downloadTarget(target(), mockDeps(() => new Error('ECONNRESET')))).attempts?.[0].kind).toBe('network');
  });

  it('timeoutMsはtarget指定が優先、既定は120秒', async () => {
    const seen: number[] = [];
    const spy = AbortSignal.timeout;
    AbortSignal.timeout = (ms: number) => (seen.push(ms), spy.call(AbortSignal, ms));
    try {
      await downloadTarget(target(), mockDeps(() => pdfRes()));
      await downloadTarget(target({ timeoutMs: 5_000 }), mockDeps(() => pdfRes()));
    } finally {
      AbortSignal.timeout = spy;
    }
    expect(seen).toEqual([120_000, 5_000]);
  });

  it('既存の有効PDFはcached（fetchしない）、不正な既存ファイルは再取得してinvalidCache', async () => {
    const cachedDeps = mockDeps(() => pdfRes(), memFs({ [ndlPath]: PDF_BYTES }));
    expect(await downloadTarget(target(), cachedDeps)).toMatchObject({ status: 'cached', acquisitionMethod: 'none', bytes: PDF_BYTES.length });
    expect(cachedDeps.calls).toEqual([]);

    const badDeps = mockDeps(() => pdfRes(), memFs({ [ndlPath]: Buffer.from('<html>WAF</html>') }));
    const r = await downloadTarget(target(), badDeps);
    expect(r).toMatchObject({ status: 'downloaded', invalidCache: true });
    expect(badDeps.fs.files.get(ndlPath)).toEqual(PDF_BYTES);
  });

  it('local path計算に失敗したtargetはfailed（例外を投げない）', async () => {
    const r = await downloadTarget(target({ canonicalUrl: 'http://www.ndl.go.jp/a.pdf' }), mockDeps(() => pdfRes()));
    expect(r.status).toBe('failed');
    expect(r.error).toContain('https');
  });
});

describe('downloadTarget: fallback', () => {
  const withWarp = target({ acquisitionFallbacks: [{ type: 'warp', url: WARP, verificationStatus: 'human-confirmed' }] });

  it('NDL型: canonical failure → WARP success → warp / canonical local path', async () => {
    const deps = mockDeps(url => (url === NDL ? statusRes(404) : pdfRes()));
    const r = await downloadTarget(withWarp, deps);
    expect(deps.calls).toEqual([NDL, WARP]);
    expect(r).toMatchObject({ status: 'downloaded', acquisitionMethod: 'warp', acquisitionUrl: WARP, canonicalUrl: NDL, localPath: ndlPath });
    expect(r.attempts).toHaveLength(1);
    expect([...deps.fs.files.keys()]).toEqual([ndlPath]); // warp.ndl.go.jp配下には保存しない
  });

  it('alternate-live-urlも同様', async () => {
    const alt = 'https://mirror.example.com/r06.pdf';
    const t = target({ acquisitionFallbacks: [{ type: 'alternate-live-url', url: alt, verificationStatus: 'url-confirmed' }] });
    const r = await downloadTarget(t, mockDeps(url => (url === NDL ? htmlRes() : pdfRes())));
    expect(r).toMatchObject({ status: 'downloaded', acquisitionMethod: 'alternate-live-url', acquisitionUrl: alt, localPath: ndlPath });
  });

  it('fallbackはmanifest順に試し、canonicalが成功すれば試さない', async () => {
    const deps = mockDeps(() => pdfRes());
    await downloadTarget(withWarp, deps);
    expect(deps.calls).toEqual([NDL]);
  });

  it('fallback exhausted → failed（全attemptを保持）', async () => {
    const r = await downloadTarget(withWarp, mockDeps(() => statusRes(404)));
    expect(r.status).toBe('failed');
    expect(r.attempts?.map(a => a.method)).toEqual(['direct', 'warp']);
    expect(r.error).toContain('fallback exhausted');
  });

  it('WARP URLを自動生成しない（fallback未指定ならcanonicalだけ）', async () => {
    const deps = mockDeps(() => statusRes(404));
    await downloadTarget(target(), deps);
    expect(deps.calls).toEqual([NDL]);
  });
});

describe('Playwright許可', () => {
  it('direct/fallback exhausted + allowPlaywrightFallback → playwright-required', async () => {
    const r = await downloadTarget(target({ allowPlaywrightFallback: true }), mockDeps(() => htmlRes()));
    expect(r.status).toBe('playwright-required');
    expect(r.attempts?.[0].kind).toBe('non-pdf');
  });

  it('未許可なら failed', async () => {
    expect((await downloadTarget(target(), mockDeps(() => htmlRes()))).status).toBe('failed');
  });

  it('許可があってもdirectで成功すればdownloaded', async () => {
    expect((await downloadTarget(target({ allowPlaywrightFallback: true }), mockDeps(() => pdfRes()))).status).toBe('downloaded');
  });
});

describe('downloadAll / summarize', () => {
  it('逐次取得して集計し、各requestの前にthrottle(sleep)を呼ぶ', async () => {
    const sleeps: number[] = [];
    const deps = mockDeps(url => (url.includes('bad') ? statusRes(500) : pdfRes()));
    deps.sleep = async ms => void sleeps.push(ms);
    const ts = [
      target({ canonicalUrl: 'https://www.ndl.go.jp/a.pdf' }),
      target({ canonicalUrl: 'https://www.ndl.go.jp/bad.pdf' }),
      target({ canonicalUrl: 'https://www.ndl.go.jp/c.pdf', allowPlaywrightFallback: true }),
    ];
    const seen: string[] = [];
    const results = await downloadAll(ts, deps, (_t, r) => seen.push(r.status));
    expect(seen).toEqual(['downloaded', 'failed', 'downloaded']);
    expect(summarizeResults(results)).toEqual({ downloaded: 2, cached: 0, 'manual-required': 0, failed: 1, 'playwright-required': 0 });
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });
});

describe('browser acquisition', () => {
  const allowed = target({
    publisherDomain: 'meti.go.jp',
    canonicalUrl: 'https://www.meti.go.jp/main/a.pdf',
    landingPageUrl: 'https://www.meti.go.jp/main/index.html',
    allowPlaywrightFallback: true,
  });
  const metiPath = path.join(BASE, 'meti.go.jp', 'main', 'a.pdf');
  const withBrowser = (deps: ReturnType<typeof mockDeps>, browser: BrowserAcquire) => Object.assign(deps, { browserAcquire: browser });

  it('direct 403 → browser成功 → %PDF- → canonical pathへ保存 (method=direct, transport=playwright)', async () => {
    const calls: unknown[] = [];
    const deps = withBrowser(mockDeps(() => statusRes(403)), async req => {
      calls.push(req);
      return { ok: true, buf: PDF_BYTES, finalUrl: 'https://www.meti.go.jp/main/a.pdf', httpStatus: 200 };
    });
    const r = await downloadTarget(allowed, deps);
    expect(r).toMatchObject({ status: 'downloaded', acquisitionMethod: 'direct', transport: 'playwright', localPath: metiPath, bytes: PDF_BYTES.length });
    expect(r.attempts?.[0]).toMatchObject({ method: 'direct', transport: 'fetch', httpStatus: 403 });
    expect(deps.fs.files.get(metiPath)).toEqual(PDF_BYTES);
    expect(calls).toEqual([{ url: allowed.canonicalUrl, landingPageUrl: allowed.landingPageUrl, timeoutMs: 120_000 }]);
  });

  it('browserがHTMLを返す → failed（保存しない）', async () => {
    const deps = withBrowser(mockDeps(() => statusRes(403)), async () => ({ ok: true, buf: Buffer.from('<html>Human Verification</html>'), httpStatus: 202 }));
    const r = await downloadTarget(allowed, deps);
    expect(r.status).toBe('failed');
    expect(r.attempts?.at(-1)).toMatchObject({ method: 'direct', transport: 'playwright', kind: 'non-pdf' });
    expect(deps.fs.files.size).toBe(0);
  });

  it('browser timeout → failed', async () => {
    const deps = withBrowser(mockDeps(() => statusRes(403)), async () => ({ ok: false, kind: 'timeout', error: 'timeout' }));
    const r = await downloadTarget(allowed, deps);
    expect(r.status).toBe('failed');
    expect(r.attempts?.at(-1)).toMatchObject({ transport: 'playwright', kind: 'timeout' });
  });

  it('Playwright未許可ならbrowserを呼ばない', async () => {
    let called = false;
    const deps = withBrowser(mockDeps(() => statusRes(403)), async () => ((called = true), { ok: false, kind: 'network', error: 'x' }));
    const r = await downloadTarget({ ...allowed, allowPlaywrightFallback: false }, deps);
    expect(called).toBe(false);
    expect(r.status).toBe('failed');
  });

  it('directが成功すればbrowserを呼ばない', async () => {
    let called = false;
    const deps = withBrowser(mockDeps(() => pdfRes()), async () => ((called = true), { ok: false, kind: 'network', error: 'x' }));
    expect((await downloadTarget(allowed, deps)).transport).toBe('fetch');
    expect(called).toBe(false);
  });

  it('browser未注入ならplaywright-required', async () => {
    expect((await downloadTarget(allowed, mockDeps(() => statusRes(403)))).status).toBe('playwright-required');
  });
});

describe('WARP replay frame', () => {
  const REPLAY = 'https://warp.ndl.go.jp/20231008/20231004075212/https://www.ndl.go.jp/jp/aboutus/outline/r06_budgetrequest.pdf';
  const wrapper = `<html><body><iframe aria-live="polite" id="pywb-frame" class="x" src="/20231008/20231004075212/${NDL}" seamless></iframe></body></html>`;
  const withWarp = target({ acquisitionFallbacks: [{ type: 'warp', url: WARP, verificationStatus: 'human-confirmed' }] });
  const htmlRes2 = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } });

  it('extractWarpReplayUrl: iframeのsrcを同一hostで解決する', () => {
    expect(extractWarpReplayUrl(wrapper, WARP)).toBe(REPLAY);
  });

  it('extractWarpReplayUrl: iframe無し・別host・非httpsはundefined', () => {
    expect(extractWarpReplayUrl('<html></html>', WARP)).toBeUndefined();
    expect(extractWarpReplayUrl('<iframe id="pywb-frame" src="https://evil.example.com/x.pdf">', WARP)).toBeUndefined();
    expect(extractWarpReplayUrl('<iframe id="pywb-frame" src="http://warp.ndl.go.jp/x.pdf">', WARP)).toBeUndefined();
  });

  it('canonical 404 → WARP page(HTML) → replay frame → PDF: method=warp, transport=fetch, canonical path', async () => {
    const deps = mockDeps(url => (url === NDL ? statusRes(404) : url === WARP ? htmlRes2(wrapper) : url === REPLAY ? pdfRes() : statusRes(500)));
    const r = await downloadTarget(withWarp, deps);
    expect(deps.calls).toEqual([NDL, WARP, REPLAY]);
    expect(r).toMatchObject({ status: 'downloaded', acquisitionMethod: 'warp', transport: 'fetch', acquisitionUrl: WARP, finalUrl: REPLAY, canonicalUrl: NDL, localPath: ndlPath });
    expect([...deps.fs.files.keys()]).toEqual([ndlPath]);
  });

  it('replay frameもPDFでなければfailed（attemptsに両方残る）', async () => {
    const deps = mockDeps(url => (url === NDL ? statusRes(404) : url === WARP ? htmlRes2(wrapper) : htmlRes2('<html>x</html>')));
    const r = await downloadTarget(withWarp, deps);
    expect(r.status).toBe('failed');
    expect(r.attempts?.map(a => a.url)).toEqual([NDL, WARP, REPLAY]);
  });

  it('frameの無いHTMLは追加のrequestをしない', async () => {
    const deps = mockDeps(url => (url === NDL ? statusRes(404) : htmlRes2('<html>no frame</html>')));
    await downloadTarget(withWarp, deps);
    expect(deps.calls).toEqual([NDL, WARP]);
  });
});

describe('manual-required', () => {
  const manual = target({
    publisherDomain: 'meti.go.jp',
    canonicalUrl: 'https://www.meti.go.jp/main/a.pdf',
    acquisitionPolicy: 'manual-required',
  });
  const metiPath = path.join(BASE, 'meti.go.jp', 'main', 'a.pdf');

  it('cacheなし → networkへ出ず manual-required（browserも呼ばない）', async () => {
    let browserCalled = false;
    const deps = mockDeps(() => pdfRes());
    const r = await downloadTarget(manual, { ...deps, browserAcquire: async () => ((browserCalled = true), { ok: false, kind: 'network', error: 'x' }) });
    expect(r).toMatchObject({ status: 'manual-required', acquisitionMethod: 'none', localPath: metiPath });
    expect(r.error).toContain(metiPath);
    expect(deps.calls).toEqual([]);
    expect(browserCalled).toBe(false);
    expect(deps.fs.files.size).toBe(0);
  });

  it('valid cache（人手配置）→ cached', async () => {
    const deps = mockDeps(() => pdfRes(), memFs({ [metiPath]: PDF_BYTES }));
    expect(await downloadTarget(manual, deps)).toMatchObject({ status: 'cached', bytes: PDF_BYTES.length });
    expect(deps.calls).toEqual([]);
  });

  it('invalid cache（HTML / 0 byte）→ manual-required、networkへ出ない', async () => {
    for (const bad of [Buffer.from('<html>WAF</html>'), Buffer.alloc(0)]) {
      const deps = mockDeps(() => pdfRes(), memFs({ [metiPath]: bad }));
      const r = await downloadTarget(manual, deps);
      expect(r).toMatchObject({ status: 'manual-required', invalidCache: true });
      expect(deps.calls).toEqual([]);
      expect(deps.fs.files.get(metiPath)).toEqual(bad); // 人手で置いたファイルを上書き・削除しない
    }
  });

  it('acquisitionPolicy=auto は従来どおり取得する', async () => {
    const r = await downloadTarget({ ...manual, acquisitionPolicy: 'auto' }, mockDeps(() => pdfRes()));
    expect(r.status).toBe('downloaded');
  });

  it('summarizeResultsがmanual-requiredを数える', () => {
    expect(summarizeResults([{ status: 'manual-required' } as never, { status: 'cached' } as never])).toEqual({
      downloaded: 0, cached: 1, 'manual-required': 1, failed: 0, 'playwright-required': 0,
    });
  });
});
