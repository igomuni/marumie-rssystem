/**
 * FY2024 概算要求 corpus baseline の research runner（orchestration のみ）。既存関数を extract-budget-request-field-resolver.ts と同じ順序・同じオプションで
 * PDF ごと・区間ごとに呼び、status・件数・hash を記録する。recordKind の補正・hierarchy の推測・名称の補完・ページの選別・結果の書き換えはしない。
 * 計画は凍結済みの corpus manifest（plan.segments）に従う。失敗した PDF を修正して再実行しない（transient な I/O エラーだけ同一条件で 1 回再試行して記録）。
 *
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-corpus-baseline.ts [--shard=i/n] [--only=<localPath>[,..]] [--out-root=<dir>] [--resume]
 * 出力: data/work/budget-request-corpus-baseline/2024/<slug>/{result.json, seg-<from>-<to>.records.jsonl.gz, seg-<from>-<to>.meta.json}（git 管理外）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { observeDocumentHierarchyV2, type DocumentHierarchyV2Result } from './lib/budget-request-document-hierarchy-v2';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { documentStatus, emptySummary, addSummaries, summarizeSegment, type RunStatus, type SegmentSummary } from './lib/budget-request-corpus-baseline';

const MANIFEST = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024', 'corpus-manifest.json');
const MANIFEST_SHA = '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const TRANSIENT = new Set(['EBUSY', 'EAGAIN', 'EIO', 'EMFILE', 'ENFILE']);

interface Doc { canonicalUrl: string; publisherAuthority: string; accountType: string; localPath: string; sha256: string; pages: number; plan: { executionClass: string; segments: { pages: [number, number]; mode: string; experimentId: string | null }[] } }

async function extractWithRetry(file: string, page: number, retries: string[]) {
  try { return await extractPageTokens(file, page); } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code && TRANSIENT.has(code)) { retries.push(`${file}#${page}: ${code}`); return await extractPageTokens(file, page); }
    throw e;
  }
}

async function runDocument(doc: Doc, outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const retries: string[] = [];
  const segResults: Record<string, unknown>[] = [];
  const statuses: RunStatus[] = [];
  let total: SegmentSummary = emptySummary();
  if (doc.plan.segments.length === 0) statuses.push('not_runnable');
  for (const seg of doc.plan.segments) {
    const [from, to] = seg.pages;
    const s0 = Date.now();
    let status: RunStatus = 'success';
    let error: string | null = null;
    let stage = 'extract';
    let summary: SegmentSummary | null = null;
    let outputs: { records: { path: string; sha256: string; bytes: number } } | null = null;
    try {
      const pages: FieldResolverPageInput[] = [];
      for (let n = from; n <= to; n++) {
        stage = `extract:p${n}`;
        const ex = await extractWithRetry(doc.localPath, n, retries);
        stage = `geometry:p${n}`;
        const geometry = buildTableGeometry(ex.tokens, ex.page);
        stage = `logical-row:p${n}`;
        pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
      }
      let hierarchy: DocumentHierarchyV2Result | null = null;
      if (seg.mode === 'hierarchy_enabled') {
        stage = 'hierarchy';
        hierarchy = observeDocumentHierarchyV2('detail', pages.map(p => ({ meta: p.meta, tokens: p.tokens, geometry: p.geometry, logical: p.logical })), HIERARCHY_B_ONLY_OPTIONS);
      }
      stage = 'field-resolver';
      const result = resolveFields({ pages, hierarchy });
      const stageCounts = { sourceTokens: pages.reduce((n, p) => n + p.tokens.length, 0), logicalRowCandidates: pages.reduce((n, p) => n + p.logical.logicalRowCandidates.length, 0) };
      summary = summarizeSegment(result, to - from + 1, stageCounts);
      stage = 'write';
      const lines = result.records.map(r => JSON.stringify(r, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))).join('\n');
      const gz = zlib.gzipSync(Buffer.from(lines + '\n', 'utf8'), { level: 9 });
      const recPath = path.join(outDir, `seg-${from}-${to}.records.jsonl.gz`);
      fs.writeFileSync(recPath, gz);
      outputs = { records: { path: recPath, sha256: sha(gz), bytes: gz.length } };
      fs.writeFileSync(path.join(outDir, `seg-${from}-${to}.meta.json`), `${JSON.stringify({ parameters: result.parameters, pageDiagnostics: result.pageDiagnostics }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))}\n`);
      total = addSummaries(total, summary);
    } catch (e) {
      error = `${stage}: ${e instanceof Error ? e.message : String(e)}`;
      status = stage.startsWith('extract') ? 'hard_failure' : 'exception';
      total = addSummaries(total, { ...emptySummary(), pages: { attempted: to - from + 1, processed: 0 } });
    }
    statuses.push(status);
    segResults.push({ pages: seg.pages, mode: seg.mode, experimentId: seg.experimentId, status, error, summary, outputs, timingMs: Date.now() - s0 });
    console.log(`  [${path.basename(doc.localPath)}] ${seg.mode} p${from}-${to}: ${status}${error ? ` (${error})` : ''} ${((Date.now() - s0) / 1000).toFixed(1)}s`);
  }
  const result = { localPath: doc.localPath, sha256: doc.sha256, publisherAuthority: doc.publisherAuthority, accountType: doc.accountType, executionClass: doc.plan.executionClass, pages: doc.pages, status: documentStatus(statuses), segments: segResults, total, transientRetries: retries, timingMs: Date.now() - t0 };
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const manifestBytes = fs.readFileSync(MANIFEST);
  if (sha(manifestBytes) !== MANIFEST_SHA) throw new Error('corpus manifest が frozen 値と一致しない');
  const docs = (JSON.parse(manifestBytes.toString('utf8')) as { documents: Doc[] }).documents;
  const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const shard = args.find(a => a.startsWith('--shard='))?.slice(8).split('/').map(Number);
  const outRoot = args.find(a => a.startsWith('--out-root='))?.slice(11) ?? path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
  const resume = args.includes('--resume');
  let n = 0;
  for (const [i, doc] of docs.entries()) {
    if (only && !only.includes(doc.localPath)) continue;
    if (shard && i % shard[1] !== shard[0]) continue;
    const slug = doc.localPath.replace(/^data\/download\//, '').replace(/[/]/g, '__');
    const outDir = path.join(outRoot, slug);
    if (resume && fs.existsSync(path.join(outDir, 'result.json'))) { console.log(`skip (resume) ${doc.localPath}`); continue; }
    if (sha(fs.readFileSync(doc.localPath)) !== doc.sha256) throw new Error(`原本の hash が manifest と一致しない: ${doc.localPath}`);
    console.log(`[${i + 1}/${docs.length}] ${doc.localPath} (${doc.pages} pages, ${doc.plan.executionClass})`);
    const r = await runDocument(doc, outDir);
    console.log(`  => ${r.status} records=${r.total.records} ${((r.timingMs as number) / 1000).toFixed(1)}s`);
    n++;
  }
  console.log(`done: ${n} documents`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
