/**
 * FY2024 概算要求 PDF の Raw Text corpus を生成する（Layer 1: physical PDF → PageRawText[]）。意味付けはしない。
 * manifest の physical PDF すべてに `pdftotext -layout` を同一条件で適用し、page ごとの raw text を保存する。
 * 抽出に失敗した PDF を別方式で救済しない。page 数が合わない PDF は FAILED として記録する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-raw-text.ts [--out-root=<dir>] [--freeze-fixture]
 * 既定は data/work 側だけを再生成し、frozen fixture（baseCommit を含む）は変更しない。fixture を書くのは明示的な --freeze-fixture のときだけ。
 * 出力:
 *   data/work/budget-request-raw-text/2024/pages/<slug>.jsonl   全 page の PageRawText（git 管理外・~40MB）
 *   tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json   (--freeze-fixture のみ) frozen input record + page 単位 hash（git 管理）
 *   tests/fixtures/budget-request-raw-text/2024/representative-pages.json   (--freeze-fixture のみ) 代表 page の raw text 抜粋（git 管理）
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { localPathFor, DEFAULT_BASE_DIR } from './lib/budget-request-download';
import { buildDocumentPages, documentStatusOf, sha256Hex, type PageRawText } from './lib/budget-request-raw-text';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT_ROOT = arg('out-root') ?? path.join('data', 'work', 'budget-request-raw-text', '2024');
const FIXTURE_DIR = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024');
const WRITE_FIXTURE = process.argv.includes('--freeze-fixture');
const MANIFEST_FILES = [
  path.join('scripts', 'pipeline-v2', 'lib', 'fy2024-budget-request-manifest.ts'),
  path.join('scripts', 'pipeline-v2', 'lib', 'budget-request-manifest.ts'),
];
const PDFTOTEXT_ARGS = ['-layout', '-enc', 'UTF-8'];

const versionOf = (cmd: string) => { const r = spawnSync(cmd, ['-v'], { encoding: 'utf8' }); return (r.stderr + r.stdout).trim().split('\n')[0]; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__');
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim();

// 代表 page: 表紙形式の違い・全 EMPTY 文書・複数 page 文書の先頭を機械的に選ぶ（内容の良し悪しでは選ばない）
const REPRESENTATIVE: { localPdfPath: string; pages: number[] }[] = [
  { localPdfPath: 'data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_01.pdf', pages: [1, 2] },
  { localPdfPath: 'data/download/moj.go.jp/content/001402818.pdf', pages: [1, 3] },
  { localPdfPath: 'data/download/fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf', pages: [1, 2] },
];

function main() {
  const manifest = getBudgetRequestManifest(2024);
  const pagesDir = path.join(OUT_ROOT, 'pages');
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });

  const documents: Record<string, unknown>[] = [];
  const logical = new Set<string>();
  const sourceShaBefore = new Map<string, string>();
  const representative: Record<string, unknown>[] = [];
  const pendingRep = new Map(REPRESENTATIVE.map(r => [r.localPdfPath, r.pages]));
  let logicalIndex = 0;

  for (const src of manifest.sources) {
    src.logicalDocuments.forEach((doc, di) => {
      const logicalDocumentIndex = logicalIndex++;
      logical.add(`${src.publisherDomain}#${di}`);
      doc.files.forEach((f, fi) => {
        const localPdfPath = localPathFor(f.url, src.publisherDomain, DEFAULT_BASE_DIR).split(path.sep).join('/');
        const rec: Record<string, unknown> = {
          logicalDocumentIndex, publisherDomain: src.publisherDomain, logicalDocumentIndexInSource: di, fileIndex: fi,
          sourceUrl: f.url, role: f.role ?? null, localPdfPath,
        };
        if (!fs.existsSync(localPdfPath)) { documents.push({ ...rec, status: 'FAILED', error: 'local PDF missing' }); return; }
        const buf = fs.readFileSync(localPdfPath);
        const pdfSha = sha256Hex(buf);
        sourceShaBefore.set(localPdfPath, pdfSha);
        rec.pdfSha256 = pdfSha;
        let pageCount: number;
        try { pageCount = Number(/^Pages:\s+(\d+)/m.exec(execFileSync('pdfinfo', [localPdfPath], { encoding: 'utf8' }))![1]); } catch (e) {
          documents.push({ ...rec, status: 'FAILED', error: `pdfinfo: ${String(e).slice(0, 200)}` }); return;
        }
        rec.pageCount = pageCount;
        let pages: PageRawText[];
        try {
          const raw = execFileSync('pdftotext', [...PDFTOTEXT_ARGS, localPdfPath, '-'], { encoding: 'utf8', maxBuffer: 1 << 30 });
          pages = buildDocumentPages(raw, pageCount);
        } catch (e) {
          documents.push({ ...rec, status: 'FAILED', error: `${String(e).slice(0, 200)}` }); return;
        }
        const artifactRel = `pages/${slugOf(localPdfPath)}.jsonl`;
        const body = pages.map(p => JSON.stringify(p)).join('\n') + '\n';
        fs.writeFileSync(path.join(OUT_ROOT, artifactRel), body);
        documents.push({
          ...rec,
          status: documentStatusOf(pages),
          artifactPath: artifactRel,
          artifactSha256: sha256Hex(body),
          charCount: pages.reduce((n, p) => n + p.charCount, 0),
          nonWhitespaceCharCount: pages.reduce((n, p) => n + p.nonWhitespaceCharCount, 0),
          emptyPages: pages.filter(p => p.status === 'EMPTY').map(p => p.page),
          pageTextSha256: pages.map(p => p.textSha256),
        });
        const want = pendingRep.get(localPdfPath);
        if (want) for (const n of want) { const p = pages[n - 1]; representative.push({ localPdfPath, page: n, pageCount, text: p.text, textSha256: p.textSha256, status: p.status }); }
      });
    });
  }

  // source PDF が処理中に変わっていないこと
  const changed = [...sourceShaBefore].filter(([p, s]) => sha256Hex(fs.readFileSync(p)) !== s).map(([p]) => p);
  if (changed.length) throw new Error(`source PDF changed during run: ${changed.join(', ')}`);

  const ok = documents.filter(d => d.status !== 'FAILED');
  const count = (s: string) => documents.filter(d => d.status === s).length;
  const sum = (k: string) => ok.reduce((n, d) => n + (d[k] as number), 0);
  const corpusDigest = sha256Hex(documents.map(d => `${d.localPdfPath} ${d.pdfSha256 ?? '-'} ${d.artifactSha256 ?? '-'}`).join('\n'));
  const manifestHashes = Object.fromEntries(MANIFEST_FILES.map(p => [p, sha256Hex(fs.readFileSync(p))]));

  const out = {
    schema: 'budget-request-raw-text-manifest/v0',
    scope: 'FY2024 概算要求 PDF の page 単位 Raw Text（source observation）。意味付け・分類・照合は含まない',
    generator: 'scripts/pipeline-v2/build-budget-request-raw-text.ts',
    frozenInput: {
      baseCommit: git('rev-parse', 'HEAD'),
      manifestFiles: manifestHashes,
      logicalDocuments: logical.size,
      physicalPdfs: documents.length,
      physicalPages: sum('pageCount'),
      pageIndexBase: 1,
      extraction: {
        tool: 'pdftotext (poppler)',
        version: versionOf('pdftotext'),
        pdfinfoVersion: versionOf('pdfinfo'),
        args: PDFTOTEXT_ARGS,
        pageSplit: 'form feed (\\f) の分割。末尾の空要素のみ除去。件数が pdfinfo Pages と不一致なら FAILED',
        platform: `${process.platform}-${process.arch}`,
      },
      status: { EXTRACTED: count('EXTRACTED'), EMPTY: count('EMPTY'), FAILED: count('FAILED') },
      charCount: sum('charCount'),
      nonWhitespaceCharCount: sum('nonWhitespaceCharCount'),
      corpusDigestSha256: corpusDigest,
      corpusDigestRule: 'sha256(manifest 列挙順の各文書について "{localPdfPath} {pdfSha256} {artifactSha256}" を改行連結)',
    },
    documents,
  };
  if (WRITE_FIXTURE) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIXTURE_DIR, 'raw-text-manifest.json'), `${JSON.stringify(out, null, 1)}\n`);
    fs.writeFileSync(path.join(FIXTURE_DIR, 'representative-pages.json'), `${JSON.stringify({ schema: 'budget-request-raw-text-representative/v0', pages: representative }, null, 1)}\n`);
  } else {
    fs.writeFileSync(path.join(OUT_ROOT, 'raw-text-manifest.json'), JSON.stringify(out));
  }
  console.log(JSON.stringify({ ...out.frozenInput, extraction: undefined, manifestFiles: undefined }, null, 1));
}

main();
