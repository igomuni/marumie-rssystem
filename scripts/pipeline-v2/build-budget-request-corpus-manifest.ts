/**
 * FY2024 概算要求 corpus（82 PDF）の manifest と実行計画の生成。原本のメタデータ（hash・bytes・ページ数）と既存の contract だけを使い、抽出・照合の結果は見ない。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-corpus-manifest.ts
 * 出力: tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { FIELD_RESOLVER_RUNS } from './lib/budget-request-field-resolver-runs';
import { planCorpusDocument } from './lib/budget-request-corpus-plan';

const OUT = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024', 'corpus-manifest.json');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function pageCountOf(file: string): number | null {
  try { const m = /^Pages:\s+(\d+)/m.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' })); return m ? Number(m[1]) : null; } catch { return null; }
}

function main() {
  const manifest = getBudgetRequestManifest(2024);
  const targets = listExtractionTargets(manifest);
  const heldoutDir = path.join('data', 'work', 'budget-request-field-resolver', 'heldout-v0');
  const heldoutDocs = new Set<string>();
  if (fs.existsSync(heldoutDir)) for (const d of fs.readdirSync(heldoutDir)) { const f = path.join(heldoutDir, d, 'field-resolution.json'); if (fs.existsSync(f)) heldoutDocs.add((JSON.parse(fs.readFileSync(f, 'utf8')) as { source: { canonicalUrl: string } }).source.canonicalUrl); }
  const existingRunUrls = new Map(FIELD_RESOLVER_RUNS.map(r => [r.canonicalUrl, r]));

  const docs = targets.map(t => {
    const state = inspectTarget(t, nodeBudgetRequestFs).state;
    const bytes = state === 'FOUND' ? fs.readFileSync(t.localPath) : null;
    const pages = state === 'FOUND' ? pageCountOf(t.localPath) : null;
    const plan = planCorpusDocument(t.canonicalUrl, pages, state);
    const run = existingRunUrls.get(t.canonicalUrl);
    return {
      canonicalUrl: t.canonicalUrl, publisherAuthority: t.publisherAuthority, publisherDomain: t.publisherDomain, accountType: t.accountType, account: t.account,
      localPath: t.localPath, state, bytes: bytes?.length ?? null, sha256: bytes ? sha(bytes) : null, pages,
      existingExtraction: { fieldResolverRun: run ? { documentKey: run.documentKey, pages: run.pages, hierarchy: run.hierarchy !== null } : null, heldoutPages: heldoutDocs.has(t.canonicalUrl), fullDocument: false },
      plan,
    };
  }).sort((a, b) => cmp(a.localPath, b.localPath));

  const digest = sha(docs.map(d => `${d.sha256} ${d.localPath}`).join('\n'));
  const byClass = (c: string) => docs.filter(d => d.plan.executionClass === c);
  const sum = (ds: typeof docs) => ds.reduce((n, d) => n + (d.pages ?? 0), 0);
  const out = {
    schema: 'budget-request-full-corpus-baseline-manifest/v0',
    scope: 'FY2024 概算要求書 PDF（manifest の document PDF）。原本のメタデータと既存 contract だけから作る。抽出・照合の結果は含まない',
    generator: 'scripts/pipeline-v2/build-budget-request-corpus-manifest.ts',
    corpus: { pdfs: docs.length, found: docs.filter(d => d.state === 'FOUND').length, totalPages: sum(docs), totalBytes: docs.reduce((n, d) => n + (d.bytes ?? 0), 0), digestSha256: digest, digestRule: 'sha256(各 PDF の "{sha256} {localPath}" を localPath 昇順に改行連結)' },
    executionClasses: Object.fromEntries(['runnable_existing_contract', 'unrunnable_missing_hierarchy', 'unrunnable_missing_layout_contract', 'unrunnable_other'].map(c => [c, { pdfs: byClass(c).length, pages: sum(byClass(c)) }])),
    byAccountType: Object.fromEntries(['general', 'special'].map(a => [a, { pdfs: docs.filter(d => d.accountType === a).length, pages: sum(docs.filter(d => d.accountType === a)) }])),
    documents: docs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(OUT, text);
  console.log(JSON.stringify({ sha256: sha(text), corpus: out.corpus, executionClasses: out.executionClasses, byAccountType: out.byAccountType }, null, 1));
}

main();
