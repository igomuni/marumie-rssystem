/**
 * TOC Physical Row Reconstruction の最小 failure isolation（A 層のみ。observation / analysis support であり parser でも preregistration でもない）。
 * Phase A0: PR-3A と #389 の explored ledger を統合（何を既に見たかを追跡）。
 * Phase A1/A2/A3: H-A1（column boundary / right-empty）・H-A2（wrapped fragment ownership）・H-A3（circled request number の representation loss）の
 *   risk candidate を machine で列挙し、render 前に development sample を deterministic に選んで fixture 化する。
 * ここで使う column 位置は「candidate 列挙のための analysis hint」であり、rule・threshold・fixed column index ではない。階層 semantics は扱わない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-physical-row-failures.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-toc-physical-row/2024/candidate-inventory.json・development-sample.json（--freeze-fixture のとき）
 *       data/work/budget-request-toc-physical-row/2024/sample-pages.json（目視用の page text。git 管理外）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const FREEZE = process.argv.includes('--freeze-fixture');
const OUT_DIR = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const WORK_DIR = path.join('data', 'work', 'budget-request-toc-physical-row', '2024');
const COL = path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PR3A_LEDGER = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024', 'development-explored-pages.json');
export const SAMPLE_SEED = 'budget-request-toc-physical-row-failure-isolation-dev-20261008';
const RAW_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const CLS_DIGEST = '39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

const REQUEST_ROW = /^\s*\d{1,3}\s+\d{2}[‐‑-]\d{2}/; // request-number-like visible raw token（意味は解釈しない）
const MARKER_ROW = /^\s*[（(][^）)\s]+[）)]/;
const TITLE_ROW = /^\s*令\s*和/;
const RIGHT_ROW = /\d{1,4}(\s+)((?:\d{1,3}\s+\d{2}[‐‑-]\d{2})|[（(]\S+[）)]\s*\d+)/;
const isRowStart = (s: string) => REQUEST_ROW.test(s) || MARKER_ROW.test(s) || TITLE_ROW.test(s);
const hasTrailingNumber = (s: string) => /\d{1,4}\s*$/.test(s);

interface RawPage { page: number; textSha256: string; nonEmptyLines: { text: string }[] }

function main() {
  const raw = readJson<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; artifactPath: string; pageTextSha256: string[]; publisherDomain: string }[] }>(RAW_MANIFEST);
  if (raw.frozenInput.corpusDigestSha256 !== RAW_DIGEST) throw new Error('raw text digest mismatch');
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  const inv = readJson<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; pages: { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; publisherDomain: string; headerLine2ndYokyuuColumn?: number }[] }>(path.join(COL, 'machine-inventory.json'));
  if (inv.frozenInput.pageClassificationCorpusDigestSha256 !== CLS_DIGEST) throw new Error('classification digest mismatch');
  if (inv.pages.length !== 82) throw new Error('TOC population mismatch');
  const boundary = readJson<{ pages: { localPdfPath: string; physicalPage: number; headerLine2ndYokyuuColumn: number | null; rightRowLineCount: number; rightRowStartColumns: number[] }[] }>(path.join(COL, 'column-boundary-evidence.json'));
  const bmap = new Map(boundary.pages.map(p => [key(p), p]));
  const ledger389 = readJson<{ pages: { localPdfPath: string; physicalPage: number; inspection: { renderViewed: boolean }; failureTags: string[] }[] }>(path.join(COL, 'development-explored-pages.json'));
  const ledger3a = readJson<{ pages: { localPdfPath: string; physicalPage: number; classifierPageType: string; inspection: { renderViewed: boolean } }[] }>(PR3A_LEDGER);
  const e3a = new Map(ledger3a.pages.filter(p => p.classifierPageType === 'TOC').map(p => [key(p), p.inspection.renderViewed]));
  const e389 = new Map(ledger389.pages.map(p => [key(p), p]));

  const cache = new Map<string, RawPage[]>();
  const pagesOf = (p: string) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l) as RawPage); cache.set(p, r); } return r; };

  const pages = inv.pages.map(p => {
    const d = docs.get(p.localPdfPath)!;
    const rp = pagesOf(p.localPdfPath)[p.physicalPage - 1];
    if (rp.textSha256 !== p.textSha256 || d.pageTextSha256[p.physicalPage - 1] !== p.textSha256 || d.pdfSha256 !== p.pdfSha256) throw new Error(`hash mismatch ${key(p)}`);
    const b = bmap.get(key(p))!;
    const lines = rp.nonEmptyLines.map(l => l.text);
    const headerIdx = lines.findIndex(l => /ページ/.test(l));
    // 本文: header 行・その直後の「番号」行・title 行より後の行
    const bodyStart = headerIdx >= 0 ? headerIdx + (/^\s*番号/.test(lines[headerIdx + 1] ?? '') ? 2 : 1) : 0;
    const body = lines.slice(bodyStart);
    const X = b.rightRowStartColumns.length ? Math.min(...b.rightRowStartColumns) : null; // analysis hint（rule ではない）
    let boundaryConflictLines = 0, leftFragmentLines = 0, rightFragmentLines = 0, simultaneousFragmentLines = 0, rightOnlyLines = 0, leftOnlyLines = 0;
    let rightFragmentWithoutOwner = 0, leftFragmentWithoutOwner = 0;
    let leftHasOwner = false, rightHasOwner = false;
    for (const l of body) {
      const left = X === null ? l : l.slice(0, X);
      const right = X === null ? '' : l.slice(X);
      if (X !== null && l.length > X && /\S/.test(l[X - 1] ?? ' ') && /\S/.test(l[X] ?? ' ')) boundaryConflictLines++;
      const lNon = /\S/.test(left), rNon = /\S/.test(right);
      if (lNon && !rNon) leftOnlyLines++;
      if (!lNon && rNon) rightOnlyLines++;
      const lFrag = lNon && !isRowStart(left) && !hasTrailingNumber(left);
      const rFrag = rNon && !isRowStart(right) && !hasTrailingNumber(right);
      if (lNon && isRowStart(left)) leftHasOwner = true;
      if (rNon && isRowStart(right)) rightHasOwner = true;
      if (lFrag) { leftFragmentLines++; if (!leftHasOwner) leftFragmentWithoutOwner++; }
      if (rFrag) { rightFragmentLines++; if (!rightHasOwner) rightFragmentWithoutOwner++; }
      if (lFrag && rFrag) simultaneousFragmentLines++;
    }
    const requestNumbers: number[] = [];
    for (const l of body) for (const m of l.matchAll(/(?:^|\s)(\d{1,3})\s+\d{2}[‐‑-]\d{2}/g)) requestNumbers.push(Number(m[1]));
    const sorted = [...requestNumbers].sort((a, b) => a - b);
    const gaps = sorted.length ? sorted.slice(1).filter((n, i) => n - sorted[i] > 1).length : 0;
    return {
      localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, publisherDomain: p.publisherDomain,
      bodyLineCount: body.length,
      h_a1: {
        rightRowLineCount: b.rightRowLineCount, rightRowStartColumns: b.rightRowStartColumns, multipleRightStartColumns: b.rightRowStartColumns.length > 1,
        headerSecondYokyuuPresent: b.headerLine2ndYokyuuColumn !== null, analysisHintBoundaryColumn: X,
        boundaryConflictLines, leftOnlyLines, rightOnlyLines,
      },
      h_a2: { leftFragmentLines, rightFragmentLines, simultaneousFragmentLines, leftFragmentWithoutOwner, rightFragmentWithoutOwner, fragmentCandidateHeuristic: 'segment に row-start（request-number / marker / title）も末尾 page 番号も無い non-empty segment。column は analysisHintBoundaryColumn で分割（右 row 開始 evidence が無い page は左のみ）' },
      h_a3: { requestNumberTokenCount: requestNumbers.length, requestNumberSequenceGaps: gaps, firstLastRequestNumber: sorted.length ? [sorted[0], sorted[sorted.length - 1]] : null },
      explored: { pr3aExplored: e3a.has(key(p)), pr3aRendered: e3a.get(key(p)) === true, issue389Explored: e389.has(key(p)), issue389Rendered: e389.get(key(p))?.inspection.renderViewed === true, issue389Tags: e389.get(key(p))?.failureTags ?? [] },
    };
  });
  const keys = pages.map(key);
  if (new Set(keys).size !== keys.length) throw new Error('duplicate page');

  // ---- H-A3: #389 で circled request number が確認された 4 case（母集団を ledger の tag から再現） ----
  const h3Cases = pages.filter(p => p.explored.issue389Tags.includes('OTHER:circled-request-number-not-in-raw'));
  if (h3Cases.length !== 4) throw new Error(`H-A3 known cases ${h3Cases.length} != 4`);

  // ---- development sample（新規 render の denominator = 既に render 済みでない page。explored だが render 未の page は新規扱いにしない） ----
  const alreadySeen = (p: (typeof pages)[number]) => p.explored.pr3aExplored || p.explored.issue389Explored;
  const pool = pages.filter(p => !alreadySeen(p));
  const rules: Record<string, (p: (typeof pages)[number]) => boolean> = {
    'H-A1:right-row-evidence+multiple-start-columns+header-2nd-要求-present': p => p.h_a1.rightRowLineCount > 0 && p.h_a1.multipleRightStartColumns && p.h_a1.headerSecondYokyuuPresent,
    'H-A1:right-row-evidence+header-2nd-要求-missing': p => p.h_a1.rightRowLineCount > 0 && !p.h_a1.headerSecondYokyuuPresent,
    'H-A1:no-right-row-evidence+body>=15(false-empty-risk)': p => p.h_a1.rightRowLineCount === 0 && p.bodyLineCount >= 15,
    'H-A1:right-short-asymmetric(right-row-lines<30%-of-body)': p => p.h_a1.rightRowLineCount > 0 && p.h_a1.rightRowLineCount < 0.3 * p.bodyLineCount,
    'H-A1:boundary-conflict-lines>=1(token cut at hint boundary)': p => p.h_a1.boundaryConflictLines >= 1,
    'H-A2:simultaneous-left-right-fragment-line>=1': p => p.h_a2.simultaneousFragmentLines >= 1,
    'H-A2:right-fragment-without-preceding-right-owner>=1': p => p.h_a2.rightFragmentWithoutOwner >= 1,
    'H-A2:right-only-raw-lines>=3(source-order-risk)': p => p.h_a1.rightOnlyLines >= 3,
    'H-A2:right-fragment-line>=1(wrap in right column; both-column wrap candidates are absent by machine)': p => p.h_a2.rightFragmentLines >= 1,
    'H-A2:left-fragment-lines>=2(multiple wraps in a left column)': p => p.h_a2.leftFragmentLines >= 2,
  };
  const pickKey = (s: string, p: (typeof pages)[number]) => sha256Hex(`${SAMPLE_SEED}|${s}|${p.localPdfPath}|${p.physicalPage}`);
  const poolSizes: Record<string, number> = {};
  const picked = new Map<string, { page: (typeof pages)[number]; strata: string[] }>();
  for (const [s, rule] of Object.entries(rules)) {
    const cands = pool.filter(rule);
    poolSizes[s] = cands.length;
    const sorted = [...cands].sort((a, b) => cmp(pickKey(s, a), pickKey(s, b)));
    const chosen: (typeof pages)[number][] = [];
    const pubs = new Set<string>();
    for (const p of sorted) if (chosen.length < 1 && !pubs.has(p.publisherDomain)) { chosen.push(p); pubs.add(p.publisherDomain); }
    for (const p of chosen) { const k = key(p); const e = picked.get(k) ?? { page: p, strata: [] }; e.strata.push(s); picked.set(k, e); }
  }
  // 重複 render 抑制: 同一 stratum 集合の重複は起きにくいが、全 stratum が他 page で満たされる page は落とす（hash 順）
  const ordered = [...picked.entries()].sort(([ka, a], [kb, b]) => b.strata.length - a.strata.length || cmp(sha256Hex(`${SAMPLE_SEED}|prune|${ka}`), sha256Hex(`${SAMPLE_SEED}|prune|${kb}`)));
  const need = new Map(Object.keys(rules).map(s => [s, poolSizes[s] > 0 ? 1 : 0]));
  const kept = new Map<string, { page: (typeof pages)[number]; strata: string[] }>();
  for (const [k, e] of ordered) if (e.strata.some(s => (need.get(s) ?? 0) > 0)) { kept.set(k, e); for (const s of e.strata) need.set(s, 0); }
  const sample = [...kept.values()].map(({ page, strata }) => ({ localPdfPath: page.localPdfPath, pdfSha256: page.pdfSha256, physicalPage: page.physicalPage, textSha256: page.textSha256, classifierPageType: 'TOC', classifierSource: page.classifierSource, publisherDomain: page.publisherDomain, role: 'NEW_DEVELOPMENT', selectionStratum: strata.sort(), inspectionRole: 'DEVELOPMENT_EXPLORATION' }));
  const recheck = h3Cases.map(p => ({ localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierPageType: 'TOC', classifierSource: p.classifierSource, publisherDomain: p.publisherDomain, role: 'RECHECK', selectionStratum: ['H-A3:known-circled-request-number-case(#389)'], recheckReason: 'H-A3: circled request number の row 開始・page 参照・x 位置との関係を、既存 #389 の render evidence と突き合わせるために同 page を再 render する（新規 sample denominator には含めない）', inspectionRole: 'DEVELOPMENT_EXPLORATION' }));
  const all = [...sample, ...recheck].sort((a, b) => cmp(String(a.localPdfPath), String(b.localPdfPath)) || a.physicalPage - b.physicalPage);

  const count = (xs: Record<string, unknown>[], f: (x: Record<string, unknown>) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b))); };
  const summary = {
    pages: pages.length, direct: pages.filter(p => p.classifierSource === 'DIRECT').length, inherited: pages.filter(p => p.classifierSource === 'INHERITED').length, physicalPdfs: new Set(pages.map(p => p.localPdfPath)).size,
    exploredUnion: { pr3aExplored: pages.filter(p => p.explored.pr3aExplored).length, issue389Explored: pages.filter(p => p.explored.issue389Explored).length, either: pages.filter(alreadySeen).length, renderedEither: pages.filter(p => p.explored.pr3aRendered || p.explored.issue389Rendered).length },
    newSampleDenominator: pool.length,
    h_a1: { pagesWithRightRowEvidence: pages.filter(p => p.h_a1.rightRowLineCount > 0).length, pagesWithMultipleStartColumns: pages.filter(p => p.h_a1.multipleRightStartColumns).length, pagesWithRightRowAndHeaderMissing: pages.filter(p => p.h_a1.rightRowLineCount > 0 && !p.h_a1.headerSecondYokyuuPresent).length, pagesWithBoundaryConflictLines: pages.filter(p => p.h_a1.boundaryConflictLines > 0).length, pagesNoRightRowButBodyAtLeast15: pages.filter(p => p.h_a1.rightRowLineCount === 0 && p.bodyLineCount >= 15).length },
    h_a2: { pagesWithSimultaneousFragmentLine: pages.filter(p => p.h_a2.simultaneousFragmentLines > 0).length, pagesWithRightFragmentWithoutOwner: pages.filter(p => p.h_a2.rightFragmentWithoutOwner > 0).length, pagesWithRightOnlyRawLinesAtLeast3: pages.filter(p => p.h_a1.rightOnlyLines >= 3).length, pagesWithAnyFragmentLine: pages.filter(p => p.h_a2.leftFragmentLines + p.h_a2.rightFragmentLines > 0).length },
    h_a3: { knownCircledCases: h3Cases.map(p => ({ file: p.localPdfPath, physicalPage: p.physicalPage, requestNumberTokens: p.h_a3.requestNumberTokenCount, sequenceGaps: p.h_a3.requestNumberSequenceGaps, firstLast: p.h_a3.firstLastRequestNumber })) },
    bySource: count(pages as unknown as Record<string, unknown>[], p => String(p.classifierSource)),
  };
  const out = { schema: 'budget-request-toc-physical-row-candidate-inventory/v0', scope: 'TOC A 層の risk candidate inventory（analysis support。parser ではなく、column 位置は analysis hint で rule / threshold ではない）', generator: 'scripts/pipeline-v2/analyze-budget-request-toc-physical-row-failures.ts', frozenInput: { rawTextCorpusDigestSha256: RAW_DIGEST, pageClassificationCorpusDigestSha256: CLS_DIGEST }, summary, pages };
  const sel = { schema: 'budget-request-toc-physical-row-development-sample/v0', inspectionRole: 'DEVELOPMENT_EXPLORATION（held-out ではない・formal preregistration ではない）', seed: SAMPLE_SEED, hashRule: 'sha256("{seed}|{stratum}|{localPdfPath}|{physicalPage}") 昇順の先頭 1（publisher 重複を避ける）', denominator: 'TOC 82 − PR-3A explored − #389 explored', strataRules: Object.keys(rules), poolSizes, newDevelopment: sample.length, recheck: recheck.length, totalRender: all.length, pages: all };
  if (FREEZE) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, 'candidate-inventory.json'), `${JSON.stringify(out, null, 1)}\n`); fs.writeFileSync(path.join(OUT_DIR, 'development-sample.json'), `${JSON.stringify(sel, null, 1)}\n`); }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.writeFileSync(path.join(WORK_DIR, 'sample-pages.json'), JSON.stringify(all.map(s => ({ ...s, lines: pagesOf(String(s.localPdfPath))[s.physicalPage - 1].nonEmptyLines.map(l => l.text) }))));
  console.log(JSON.stringify({ summary, poolSizes, newDevelopment: sample.length, recheck: recheck.length, picked: all.map(a => `${a.role} ${String(a.localPdfPath).slice(14, 50)} p${a.physicalPage} ${a.selectionStratum.join(',')}`) }, null, 1));
}
main();
