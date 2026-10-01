/**
 * 概算要求PDFのdownloader core（manifest → target展開 → fetch → PDF検証 → canonical pathへatomic write）。
 *
 * 取得順: canonical URLをdirect fetch → manifestに明示されたacquisitionFallbacks（manifest順）
 *         → すべて失敗かつallowPlaywrightFallbackなら browser acquisition（canonical URL）。
 *         browser acquisitionが注入されていなければ 'playwright-required' を返す。
 * acquisitionPolicy=manual-required のtargetは、valid cacheが無ければnetworkへ出ず 'manual-required'。
 * WARP fallback: WARPのsnapshot URLはreplay用HTML（iframe）を返す。HTMLがpywbのreplay frame
 * （`<iframe id="pywb-frame" src=...>`）を持つ場合に限り、そのsrc（WARP公式ページが提示するURL）を
 * 同一hostで1回だけ辿ってPDFを取得する（URLの推測・生成はしない）。
 * 保存先は常にcanonical URL由来（`data/download/{publisherDomain}/{URL path}`）。fallback URLからは作らない。
 *
 * 注意: 大容量PDF（法務省 約147MB、厚労省 1,723頁）も既存方式どおり arrayBuffer → Buffer → atomic write で
 * 扱う。実走でメモリ問題が出た場合にのみstreaming化を検討する。
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic } from './atomic-write';
import type { BudgetRequestAcquisitionFallback, BudgetRequestManifest } from './budget-request-manifest';
import { stripWww } from './budget-request-manifest';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_THROTTLE_MS = 1_000;
export const DEFAULT_BASE_DIR = path.join('data', 'download');
const PDF_MAGIC = '%PDF-';

export interface BudgetRequestDownloadTarget {
  fiscalYear: number;
  /** browser acquisition時に先に訪問するlanding page（WAFの状態を満たすため）。sourceのlandingPageUrl */
  landingPageUrl?: string;
  kind: 'document' | 'reference';
  publisherAuthority: string;
  publisherDomain: string;
  canonicalUrl: string;
  acquisitionFallbacks?: BudgetRequestAcquisitionFallback[];
  allowPlaywrightFallback?: boolean;
  acquisitionPolicy?: 'auto' | 'manual-required';
  timeoutMs?: number;
  // document
  accountType?: 'general' | 'special';
  account?: string;
  logicalAuthority?: string;
  role?: string;
  // reference
  purpose?: 'validation';
  title?: string;
}

/** どのsource routeから取得したか */
export type AcquisitionMethod = 'direct' | 'warp' | 'alternate-live-url' | 'none';
/** 何で取得したか（method=direct, transport=playwright は「canonicalをブラウザで取得」） */
export type AcquisitionTransport = 'fetch' | 'playwright';

export interface BudgetRequestAttempt {
  method: Exclude<AcquisitionMethod, 'none'>;
  transport: AcquisitionTransport;
  url: string;
  kind: 'http' | 'timeout' | 'network' | 'non-pdf' | 'write';
  httpStatus?: number;
  contentType?: string;
  error: string;
}

export interface BudgetRequestDownloadResult {
  canonicalUrl: string;
  /** 実際にbytesを取得したURL。取得できなかった場合はcanonicalUrl */
  acquisitionUrl: string;
  localPath: string;
  status: 'downloaded' | 'cached' | 'manual-required' | 'failed' | 'playwright-required';
  acquisitionMethod: AcquisitionMethod;
  /** 取得成功時のみ */
  transport?: AcquisitionTransport;
  bytes?: number;
  httpStatus?: number;
  contentType?: string;
  /** redirect後の最終URL（取得成功時のみ） */
  finalUrl?: string;
  /** 既存ファイルがあったがPDFとして不正（0 byte / %PDF-でない）で再取得した */
  invalidCache?: boolean;
  /** 失敗した取得試行（fallback exhaustedの判断材料） */
  attempts?: BudgetRequestAttempt[];
  error?: string;
}

/** テストでmockできるよう最小限だけinjectする（DI frameworkは使わない） */
export interface BudgetRequestFs {
  /** ファイルサイズ。存在しなければundefined */
  size(p: string): number | undefined;
  readHead(p: string, n: number): Buffer;
  mkdirp(dir: string): void;
  writeAtomic(p: string, data: Buffer): void;
}

export type BrowserAcquireOutcome =
  | { ok: true; buf: Buffer; finalUrl?: string; httpStatus?: number }
  | { ok: false; kind: Exclude<BudgetRequestAttempt['kind'], 'write'>; httpStatus?: number; error: string };

/** ブラウザ取得（実装は budget-request-browser.ts。テストではmockする） */
export type BrowserAcquire = (req: { url: string; landingPageUrl?: string; timeoutMs: number }) => Promise<BrowserAcquireOutcome>;

export interface BudgetRequestDownloadDeps {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** 未指定ならallowPlaywrightFallbackのtargetは 'playwright-required' を返す */
  browserAcquire?: BrowserAcquire;
  fs: BudgetRequestFs;
  sleep: (ms: number) => Promise<void>;
  baseDir?: string;
  throttleMs?: number;
  defaultTimeoutMs?: number;
}

export const nodeBudgetRequestFs: BudgetRequestFs = {
  size: p => (fs.existsSync(p) ? fs.statSync(p).size : undefined),
  readHead: (p, n) => {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(n);
      const read = fs.readSync(fd, buf, 0, n, 0);
      return buf.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  },
  mkdirp: dir => void fs.mkdirSync(dir, { recursive: true }),
  writeAtomic: writeFileAtomic,
};

export function defaultDeps(): BudgetRequestDownloadDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    fs: nodeBudgetRequestFs,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

/** manifestのdocument filesとreferenceFilesを、1 PDF = 1 targetへ展開する */
export function expandTargets(manifest: BudgetRequestManifest): BudgetRequestDownloadTarget[] {
  const targets: BudgetRequestDownloadTarget[] = [];
  for (const src of manifest.sources) {
    for (const doc of src.logicalDocuments) {
      for (const f of doc.files) {
        targets.push({
          fiscalYear: manifest.fiscalYear,
          landingPageUrl: src.landingPageUrl,
          kind: 'document',
          publisherAuthority: src.publisherAuthority,
          publisherDomain: src.publisherDomain,
          canonicalUrl: f.url,
          acquisitionFallbacks: f.acquisitionFallbacks,
          allowPlaywrightFallback: f.allowPlaywrightFallback,
          acquisitionPolicy: f.acquisitionPolicy,
          timeoutMs: f.timeoutMs,
          accountType: doc.accountType,
          account: doc.account,
          logicalAuthority: doc.logicalAuthority,
          role: f.role,
        });
      }
    }
  }
  for (const ref of manifest.referenceFiles ?? []) {
    targets.push({
      fiscalYear: manifest.fiscalYear,
      kind: 'reference',
      publisherAuthority: ref.publisherAuthority,
      publisherDomain: ref.publisherDomain,
      canonicalUrl: ref.url,
      purpose: ref.purpose,
      title: ref.title,
    });
  }
  return targets;
}

/**
 * canonical URLから保存先を決める: `{baseDir}/{publisherDomain}/{URL path}`。
 * query/fragmentは含めない。pathの各segmentはdecodeして検査し、`$`と`%`だけ`%24`/`%25`へ
 * 再エンコードする（`$File` と `%24File` は同じlocal pathになる）。URL自体は書き換えない。
 */
export function localPathFor(
  canonicalUrl: string,
  publisherDomain: string,
  baseDir: string = DEFAULT_BASE_DIR,
): string {
  const u = new URL(canonicalUrl);
  if (u.protocol !== 'https:') throw new Error(`https以外のURLは保存先にできません: ${canonicalUrl}`);
  if (stripWww(u.hostname) !== publisherDomain) {
    throw new Error(`canonical hostがpublisherDomainと不一致: ${canonicalUrl} (publisherDomain=${publisherDomain})`);
  }
  const segments = u.pathname.split('/').filter(s => s !== '');
  if (segments.length === 0 || u.pathname.endsWith('/')) {
    throw new Error(`ファイル名を持たないURLは保存先にできません: ${canonicalUrl}`);
  }
  const safe = segments.map(seg => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      throw new Error(`pathのdecodeに失敗: ${canonicalUrl}`);
    }
    if (decoded === '.' || decoded === '..' || /[/\\\0]/.test(decoded)) {
      throw new Error(`不正なpath segment "${seg}": ${canonicalUrl}`);
    }
    return decoded.replace(/%/g, '%25').replace(/\$/g, '%24');
  });
  const root = path.resolve(baseDir, publisherDomain);
  const result = path.join(baseDir, publisherDomain, ...safe);
  if (!path.resolve(result).startsWith(root + path.sep)) {
    throw new Error(`保存先が{baseDir}/{publisherDomain}の外に出ます: ${canonicalUrl}`);
  }
  return result;
}

export function isPdfHead(head: Buffer): boolean {
  return head.length >= PDF_MAGIC.length && head.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC;
}

type Cache = { state: 'valid'; bytes: number } | { state: 'invalid' } | { state: 'none' };

/** exists + size>0 + 先頭が%PDF- のときだけvalid（先頭数bytesのみ読む） */
export function checkCache(localPath: string, bfs: BudgetRequestFs): Cache {
  const size = bfs.size(localPath);
  if (size === undefined) return { state: 'none' };
  if (size === 0) return { state: 'invalid' };
  return isPdfHead(bfs.readHead(localPath, PDF_MAGIC.length)) ? { state: 'valid', bytes: size } : { state: 'invalid' };
}

type FetchOutcome =
  | { ok: true; buf: Buffer; httpStatus: number; contentType?: string; finalUrl?: string }
  | { ok: false; kind: BudgetRequestAttempt['kind']; httpStatus?: number; contentType?: string; error: string; html?: string };

/**
 * WARP replay page（pywb）のreplay frame URLを取り出す。`<iframe id="pywb-frame" src="...">` のsrcを
 * baseUrlで解決し、https・同一hostの場合のみ返す（それ以外・見つからなければundefined）。
 */
export function extractWarpReplayUrl(html: string, baseUrl: string): string | undefined {
  const tag = /<iframe\b[^>]*\bid="pywb-frame"[^>]*>/i.exec(html)?.[0];
  const src = tag && /\bsrc="([^"]+)"/i.exec(tag)?.[1];
  if (!src) return undefined;
  try {
    const base = new URL(baseUrl);
    const u = new URL(src, base);
    return u.protocol === 'https:' && u.host === base.host && u.href !== base.href ? u.href : undefined;
  } catch {
    return undefined;
  }
}

async function fetchPdf(url: string, timeoutMs: number, deps: BudgetRequestDownloadDeps): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await deps.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, kind: 'timeout', error: `timeout(${timeoutMs}ms): ${msg}` };
    }
    return { ok: false, kind: 'network', error: msg };
  }
  const contentType = res.headers.get('content-type') ?? undefined;
  if (!res.ok) {
    return { ok: false, kind: 'http', httpStatus: res.status, contentType, error: `HTTP ${res.status}` };
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      kind: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      httpStatus: res.status,
      contentType,
      error: msg,
    };
  }
  // HTTP 200だけでは成功にしない（WAF challenge HTML等の誤保存防止）。Content-Typeは補助情報
  if (!isPdfHead(buf)) {
    const html = contentType?.includes('html') ? buf.subarray(0, 512 * 1024).toString('utf8') : undefined;
    return { ok: false, kind: 'non-pdf', httpStatus: res.status, contentType, html, error: `non-PDF response (content-type=${contentType ?? 'n/a'}, ${buf.length}bytes)` };
  }
  return { ok: true, buf, httpStatus: res.status, contentType, finalUrl: res.url || undefined };
}

/** 1 targetを取得する。例外は投げず、必ずresultを返す */
export async function downloadTarget(
  target: BudgetRequestDownloadTarget,
  deps: BudgetRequestDownloadDeps,
): Promise<BudgetRequestDownloadResult> {
  const baseDir = deps.baseDir ?? DEFAULT_BASE_DIR;
  const base = { canonicalUrl: target.canonicalUrl, acquisitionUrl: target.canonicalUrl };

  let localPath: string;
  try {
    localPath = localPathFor(target.canonicalUrl, target.publisherDomain, baseDir);
  } catch (e) {
    return { ...base, localPath: '', status: 'failed', acquisitionMethod: 'none', error: e instanceof Error ? e.message : String(e) };
  }

  const cache = checkCache(localPath, deps.fs);
  if (cache.state === 'valid') {
    return { ...base, localPath, status: 'cached', acquisitionMethod: 'none', bytes: cache.bytes };
  }
  const invalidCache = cache.state === 'invalid' ? true : undefined;

  if (target.acquisitionPolicy === 'manual-required') {
    return {
      ...base,
      localPath,
      status: 'manual-required',
      acquisitionMethod: 'none',
      invalidCache,
      error: `manual acquisition required: ブラウザで取得したPDFを ${localPath} へ配置してください`,
    };
  }

  const timeoutMs = target.timeoutMs ?? deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const routes: { method: Exclude<AcquisitionMethod, 'none'>; url: string }[] = [
    { method: 'direct', url: target.canonicalUrl },
    ...(target.acquisitionFallbacks ?? []).map(fb => ({ method: fb.type, url: fb.url })),
  ];

  const attempts: BudgetRequestAttempt[] = [];
  const succeed = async (
    method: Exclude<AcquisitionMethod, 'none'>,
    transport: AcquisitionTransport,
    acquisitionUrl: string,
    buf: Buffer,
    extra: { httpStatus?: number; contentType?: string; finalUrl?: string },
  ): Promise<BudgetRequestDownloadResult | undefined> => {
    try {
      deps.fs.mkdirp(path.dirname(localPath));
      deps.fs.writeAtomic(localPath, buf);
    } catch (e) {
      attempts.push({ method, transport, url: acquisitionUrl, kind: 'write', error: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
    return {
      ...base,
      acquisitionUrl,
      localPath,
      status: 'downloaded',
      acquisitionMethod: method,
      transport,
      bytes: buf.length,
      ...extra,
      invalidCache,
      attempts: attempts.length > 0 ? attempts : undefined,
    };
  };
  const fail = (method: Exclude<AcquisitionMethod, 'none'>, url: string, out: Extract<FetchOutcome, { ok: false }>): void => {
    attempts.push({ method, transport: 'fetch', url, kind: out.kind, httpStatus: out.httpStatus, contentType: out.contentType, error: out.error });
  };

  for (const route of routes) {
    await deps.sleep(deps.throttleMs ?? DEFAULT_THROTTLE_MS);
    const out = await fetchPdf(route.url, timeoutMs, deps);
    if (out.ok) {
      const done = await succeed(route.method, 'fetch', route.url, out.buf, { httpStatus: out.httpStatus, contentType: out.contentType, finalUrl: out.finalUrl });
      if (done) return done;
      break; // 書き込み失敗は取得経路の問題ではないのでfallbackへ進まない
    }
    fail(route.method, route.url, out);

    // WARP: replay page(HTML)が提示するreplay frameのURLを1回だけ辿る
    const replayUrl = route.method === 'warp' && out.kind === 'non-pdf' && out.html ? extractWarpReplayUrl(out.html, route.url) : undefined;
    if (replayUrl) {
      await deps.sleep(deps.throttleMs ?? DEFAULT_THROTTLE_MS);
      const replay = await fetchPdf(replayUrl, timeoutMs, deps);
      if (replay.ok) {
        attempts.pop(); // replay page自体は取得経路の途中段階。最終的に取得できたのでfailureとして残さない
        const done = await succeed('warp', 'fetch', route.url, replay.buf, { httpStatus: replay.httpStatus, contentType: replay.contentType, finalUrl: replayUrl });
        if (done) return done;
        break;
      }
      fail('warp', replayUrl, replay);
    }
  }

  // browser acquisition: direct/fallbackがすべて失敗し、許可されたtargetのcanonical URLのみ（1回）
  const wroteFailed = attempts[attempts.length - 1]?.kind === 'write';
  if (target.allowPlaywrightFallback && deps.browserAcquire && !wroteFailed) {
    const out = await deps.browserAcquire({ url: target.canonicalUrl, landingPageUrl: target.landingPageUrl, timeoutMs });
    if (out.ok && isPdfHead(out.buf)) {
      const done = await succeed('direct', 'playwright', target.canonicalUrl, out.buf, { httpStatus: out.httpStatus, finalUrl: out.finalUrl });
      if (done) return done;
    } else if (out.ok) {
      attempts.push({ method: 'direct', transport: 'playwright', url: target.canonicalUrl, kind: 'non-pdf', httpStatus: out.httpStatus, error: `non-PDF response via browser (${out.buf.length}bytes)` });
    } else {
      attempts.push({ method: 'direct', transport: 'playwright', url: target.canonicalUrl, kind: out.kind, httpStatus: out.httpStatus, error: out.error });
    }
  }

  const last = attempts[attempts.length - 1];
  const needsPlaywright = target.allowPlaywrightFallback === true && !deps.browserAcquire && last?.kind !== 'write';
  const summary = attempts.map(a => `${a.method}/${a.transport}: ${a.error}`).join(' → ');
  return {
    ...base,
    localPath,
    status: needsPlaywright ? 'playwright-required' : 'failed',
    acquisitionMethod: 'none',
    httpStatus: last?.httpStatus,
    contentType: last?.contentType,
    invalidCache,
    attempts,
    error: attempts.length > 1 ? `fallback exhausted (${summary})` : summary,
  };
}

/** 逐次取得（1 request at a time）。進捗はonResultで受ける */
export async function downloadAll(
  targets: BudgetRequestDownloadTarget[],
  deps: BudgetRequestDownloadDeps,
  onResult?: (target: BudgetRequestDownloadTarget, result: BudgetRequestDownloadResult) => void,
): Promise<BudgetRequestDownloadResult[]> {
  const results: BudgetRequestDownloadResult[] = [];
  for (const target of targets) {
    const result = await downloadTarget(target, deps);
    results.push(result);
    onResult?.(target, result);
  }
  return results;
}

export function summarizeResults(results: BudgetRequestDownloadResult[]): Record<BudgetRequestDownloadResult['status'], number> {
  const s = { downloaded: 0, cached: 0, 'manual-required': 0, failed: 0, 'playwright-required': 0 };
  for (const r of results) s[r.status]++;
  return s;
}
