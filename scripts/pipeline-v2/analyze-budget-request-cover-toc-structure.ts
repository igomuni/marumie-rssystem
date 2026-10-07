/**
 * PR-3A: Page Classification v0 が COVER / TOC と routing した page の machine inventory と development sample 選定（observation のみ）。
 * parser ではない。logical row・semantic field は確定しない。label-independent に計測できる量だけを保存する。
 * OCR・Route C・MOF・manifest role の section semantics 利用なし。manifest は acquisition metadata（publisher / account / jurisdiction / file 数）にだけ使う。
 *
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-cover-toc-structure.ts [--freeze-fixture]
 * 入力: data/work の Raw Text pages・Page Classification 出力（frozen implementation builder の出力）、Raw Text manifest
 * 出力: tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json（--freeze-fixture のとき）
 *       tests/fixtures/budget-request-cover-toc-structure/2024/development-sample-selection.json（同上）
 *       data/work/budget-request-cover-toc-structure/2024/sample-pages.json（目視用の page text。git 管理外）
 */
import * as fs from 'fs';
import * as path from 'path';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { localPathFor, DEFAULT_BASE_DIR } from './lib/budget-request-download';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageClassificationRecord } from './lib/budget-request-page-classification';

const FREEZE = process.argv.includes('--freeze-fixture');
const OUT_DIR = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024');
const WORK_DIR = path.join('data', 'work', 'budget-request-cover-toc-structure', '2024');
const CLS = path.join('data', 'work', 'budget-request-page-classification', '2024', 'page-classification.jsonl');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024', 'pages');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const CLS_MANIFEST = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-implementation-manifest.json');
const FROZEN_RAW_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const FROZEN_CLS_DIGEST = '39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc';
export const SAMPLE_SEED = 'budget-request-cover-toc-structure-dev-exploration-20261007';
const PER_STRATUM = 2;
/** 作業者が実際に render 画像まで確認した sample page（sample の昇順 1-based index）。それ以外は Raw Text（先頭の最大 12〜14 line）のみ確認 */
const RENDER_INSPECTED_INDEXES = new Set([3, 7, 12, 16]);

const slug = (p: string) => p.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const PUA = /[-]/;
const MARKERS: Record<string, RegExp> = { 組織: /[（(]\s*組織\s*[）)]/g, 会計: /[（(]\s*会計\s*[）)]/g, 所管: /[（(]\s*所管\s*[）)]/g, 項: /[（(]\s*項\s*[）)]/g, 勘定: /[（(]\s*勘定\s*[）)]/g };
const countMatches = (s: string, re: RegExp) => (s.match(re) ?? []).length;

interface RawPage { page: number; text: string; textSha256: string; status: string; nonEmptyLines: { lineIndex: number; text: string }[] }

function main() {
  const rawManifest = readJson<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageCount: number; artifactPath: string; pageTextSha256: string[]; publisherDomain: string; logicalDocumentIndex: number }[] }>(RAW_MANIFEST);
  if (rawManifest.frozenInput.corpusDigestSha256 !== FROZEN_RAW_DIGEST) throw new Error('raw text digest mismatch');
  const clsManifest = readJson<{ summary: { corpusClassificationDigestSha256: string } }>(CLS_MANIFEST);
  const clsBody = fs.readFileSync(CLS, 'utf8');
  if (clsManifest.summary.corpusClassificationDigestSha256 !== FROZEN_CLS_DIGEST || sha256Hex(clsBody) !== FROZEN_CLS_DIGEST) throw new Error('classification digest mismatch');
  const cls = clsBody.split('\n').filter(l => l).map(l => JSON.parse(l) as PageClassificationRecord);
  const docs = new Map(rawManifest.documents.map(d => [d.localPdfPath, d]));

  // acquisition metadata（manifest）: physical file ごと
  const meta = new Map<string, { publisherAuthority: string; accountType: string; account: string; budgetJurisdiction: string | null; logicalAuthority: string | null; filesInLogicalDocument: number; logicalDocumentIndex: number }>();
  let li = 0;
  for (const src of getBudgetRequestManifest(2024).sources) for (const ld of src.logicalDocuments) {
    const idx = li++;
    for (const f of ld.files) meta.set(localPathFor(f.url, src.publisherDomain, DEFAULT_BASE_DIR).split(path.sep).join('/'), { publisherAuthority: src.publisherAuthority, accountType: ld.accountType, account: ld.account, budgetJurisdiction: ld.budgetJurisdiction ?? null, logicalAuthority: ld.logicalAuthority ?? null, filesInLogicalDocument: ld.files.length, logicalDocumentIndex: idx });
  }

  const rawCache = new Map<string, RawPage[]>();
  const rawPages = (p: string) => { let r = rawCache.get(p); if (!r) { r = fs.readFileSync(path.join(PAGES_DIR, slug(p) + '.jsonl'), 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l) as RawPage); rawCache.set(p, r); } return r; };

  const byPdf = new Map<string, PageClassificationRecord[]>();
  for (const r of cls) (byPdf.get(r.localPdfPath) ?? byPdf.set(r.localPdfPath, []).get(r.localPdfPath)!).push(r);

  const inventory: Record<string, unknown>[] = [];
  const perPdf: Record<string, unknown>[] = [];
  let tocContinuationDistances: number[] = [];
  const stratumPool = new Map<string, Record<string, unknown>[]>();
  const addPool = (s: string, row: Record<string, unknown>) => (stratumPool.get(s) ?? stratumPool.set(s, []).get(s)!).push(row);

  for (const [pdf, recs] of [...byPdf.entries()].sort(([a], [b]) => cmp(a, b))) {
    const d = docs.get(pdf)!;
    const pages = rawPages(pdf);
    const m = meta.get(pdf)!;
    // TOC run 構造（page classification 出力の page 列から機械的に）
    const runs: { start: number; end: number; startSource: string | null }[] = [];
    let cur: { start: number; end: number; startSource: string | null } | null = null;
    recs.forEach(r => {
      const isToc = r.classification.pageType === 'TOC';
      if (isToc && cur && r.physicalPage === cur.end + 1) cur.end = r.physicalPage;
      else if (isToc) { cur = { start: r.physicalPage, end: r.physicalPage, startSource: r.classification.source }; runs.push(cur); }
      else cur = null;
    });
    const covers = recs.filter(r => r.classification.pageType === 'COVER').map(r => r.physicalPage);
    const tocPages = recs.filter(r => r.classification.pageType === 'TOC');
    // 隣接する COVER/TOC run と UNRESOLVED / NO_TEXT の関係
    const adjacentUnresolved = recs.filter((r, i) => (r.classification.pageType === 'COVER' || r.classification.pageType === 'TOC') && [recs[i - 1], recs[i + 1]].some(n => n && (n.classification.status === 'UNRESOLVED' || n.classification.status === 'NO_TEXT'))).length;
    const emptyInsideTocRun = runs.filter(run => recs.some(r => r.physicalPage > run.start && r.physicalPage < run.end && r.classification.status === 'NO_TEXT')).length;
    if (covers.length || runs.length) perPdf.push({ localPdfPath: pdf, publisherDomain: d.publisherDomain, logicalDocumentIndex: m.logicalDocumentIndex, accountType: m.accountType, filesInLogicalDocument: m.filesInLogicalDocument, pageCount: d.pageCount, coverPages: covers, tocRuns: runs.map(r => ({ start: r.start, end: r.end, length: r.end - r.start + 1, startSource: r.startSource })), tocRunCount: runs.length, adjacentUnresolvedOrNoTextCount: adjacentUnresolved, tocRunsWithNoTextInside: emptyInsideTocRun });

    for (const r of recs) {
      const t = r.classification.pageType;
      if (t !== 'COVER' && t !== 'TOC') continue;
      const rp = pages[r.physicalPage - 1];
      if (rp.textSha256 !== r.rawText.textSha256) throw new Error(`text hash mismatch ${pdf}#${r.physicalPage}`);
      const lines = rp.text.split('\n').filter(l => l.trim() !== '');
      const run = runs.find(x => r.physicalPage >= x.start && r.physicalPage <= x.end);
      const distance = t === 'TOC' && run ? r.physicalPage - run.start : null;
      if (t === 'TOC' && distance !== null && distance > 0) tocContinuationDistances.push(distance);
      const trailingNum = /[\s　]\d{1,4}\s*$/;
      const markerCounts = Object.fromEntries(Object.entries(MARKERS).map(([k, re]) => [k, countMatches(rp.text, new RegExp(re.source, 'g'))]));
      const features = {
        nonEmptyLineCount: lines.length,
        charCount: rp.text.length,
        privateUseCharacterPresent: PUA.test(rp.text),
        nonBreakingHyphenPresent: /[‐‑]/.test(rp.text),
        markerCounts,
        trailingPageNumberLineCount: lines.filter(l => trailingNum.test(l)).length,
        leaderDotLineCount: lines.filter(l => /[・.]{6,}/.test(l)).length,
        pageHeaderTokenCount: countMatches(rp.text, /ページ/g),
        linesWithoutTrailingNumberOrLeader: lines.filter(l => !trailingNum.test(l) && !/[・.]{6,}/.test(l)).length,
        largeWhitespaceGapLineCount: lines.filter(l => /\S\s{8,}\S/.test(l)).length,
        twoTrailingNumberTokenLineCount: lines.filter(l => /\d{1,4}\s{2,}\S.*\s\d{1,4}\s*$/.test(l)).length,
        staffingReferenceTextPresent: /概算要求定員表/.test(rp.text),
        headerLeadingCodeDigits: ((lines[0] ?? '').trim().match(/^(\d+)/) ?? [null, ''])[1]?.length || null,
      };
      const row = {
        localPdfPath: pdf, pdfSha256: r.pdfSha256, physicalPage: r.physicalPage, textSha256: rp.textSha256,
        classifierPageType: t, classifierSource: r.classification.source, rawStatus: r.rawText.status,
        publisherDomain: d.publisherDomain, logicalDocumentIndex: m.logicalDocumentIndex,
        accountType: m.accountType, filesInLogicalDocument: m.filesInLogicalDocument,
        budgetJurisdiction: m.budgetJurisdiction, logicalAuthority: m.logicalAuthority,
        tocRunStart: run?.start ?? null, tocRunLength: run ? run.end - run.start + 1 : null, tocDistanceFromRunStart: distance,
        explicitTitleObserved: r.classification.source === 'DIRECT',
        firstNonEmptyLines: rp.nonEmptyLines.slice(0, 5).map(l => l.text),
        ...features,
      };
      inventory.push(row);
      // sample stratum（machine feature のみ。内容の良し悪しでは選ばない）
      if (t === 'COVER') {
        addPool(`COVER|account:${m.accountType}`, row);
        if (covers.length > 1) addPool('COVER|multi-cover-pdf', row);
        if (m.filesInLogicalDocument > 1) addPool('COVER|split-pdf-logical-document', row);
        if (m.budgetJurisdiction || m.logicalAuthority) addPool('COVER|publisher-differs-from-jurisdiction-metadata', row);
        if (features.staffingReferenceTextPresent) addPool('COVER|staffing-reference-text:present', row); else addPool('COVER|staffing-reference-text:absent', row);
        if (features.linesWithoutTrailingNumberOrLeader >= 3) addPool('COVER|many-non-leader-lines(multiline-name-candidate)', row);
      } else {
        addPool(r.classification.source === 'DIRECT' ? 'TOC|explicit-title-start' : 'TOC|continuation', row);
        if (run && run.end - run.start + 1 === 1) addPool('TOC|single-page-run', row);
        if (run && run.end - run.start + 1 >= 2) addPool('TOC|multi-page-run', row);
        if (distance !== null && distance >= 1 && distance <= 2) addPool('TOC|short-continuation-distance(1-2)', row);
        if (distance !== null && distance >= 5) addPool('TOC|long-continuation-distance(>=5)', row);
        if (features.nonEmptyLineCount >= 40) addPool('TOC|high-line-count(>=40)', row);
        if (features.nonEmptyLineCount <= 8) addPool('TOC|low-line-count(<=8)', row);
        // 全 TOC page で header の「ページ」token が 2 つ（pageHeaderTokenCount は非判別）のため、同一 line に page 参照が 2 つ並ぶ line が多い page を suspected とする（分布から決めた閾値。label は見ていない）
        if (features.twoTrailingNumberTokenLineCount >= 17) addPool('TOC|multi-column-suspected(two-ref-lines>=17)', row);
        if (features.linesWithoutTrailingNumberOrLeader >= 6) addPool('TOC|wrapped-name-suspected', row);
        if (features.privateUseCharacterPresent) addPool('TOC|private-use-character', row);
      }
    }
  }
  tocContinuationDistances = tocContinuationDistances.sort((a, b) => a - b);

  // 重複 key / hash 検査
  const keys = inventory.map(r => `${r.localPdfPath}#${r.physicalPage}`);
  if (new Set(keys).size !== keys.length) throw new Error('duplicate target key');

  // development sample: stratum ごとに hash 順の先頭 PER_STRATUM（同一 page は 1 回だけ ledger に載せ、strata を配列で保持）
  const picked = new Map<string, { row: Record<string, unknown>; strata: string[] }>();
  const poolSizes: Record<string, number> = {};
  for (const [s, pool] of [...stratumPool.entries()].sort(([a], [b]) => cmp(a, b))) {
    poolSizes[s] = pool.length;
    const sorted = [...pool].sort((a, b) => cmp(sha256Hex(`${SAMPLE_SEED}|${s}|${a.localPdfPath}|${a.physicalPage}`), sha256Hex(`${SAMPLE_SEED}|${s}|${b.localPdfPath}|${b.physicalPage}`)));
    for (const row of sorted.slice(0, PER_STRATUM)) { const k = `${row.localPdfPath}#${row.physicalPage}`; const e = picked.get(k) ?? { row, strata: [] }; e.strata.push(s); picked.set(k, e); }
  }
  const sample = [...picked.values()].map(({ row, strata }) => ({
    localPdfPath: row.localPdfPath, pdfSha256: row.pdfSha256, physicalPage: row.physicalPage, textSha256: row.textSha256, classifierPageType: row.classifierPageType,
    selectionStratum: strata.sort(), selectionReason: `deterministic hash 順で各 stratum の先頭 ${PER_STRATUM}（seed ${SAMPLE_SEED}）`, inspectionRole: 'DEVELOPMENT_EXPLORATION',
  })).sort((a, b) => cmp(String(a.localPdfPath), String(b.localPdfPath)) || Number(a.physicalPage) - Number(b.physicalPage));

  const count = (rows: Record<string, unknown>[], f: (r: Record<string, unknown>) => string) => { const o: Record<string, number> = {}; for (const r of rows) o[f(r)] = (o[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b))); };
  const covers = inventory.filter(r => r.classifierPageType === 'COVER');
  const tocs = inventory.filter(r => r.classifierPageType === 'TOC');
  const pdfsWith = (t: string) => new Set(inventory.filter(r => r.classifierPageType === t).map(r => r.localPdfPath)).size;
  const summary = {
    coverRouted: covers.length, tocRouted: tocs.length,
    coverBySource: count(covers, r => String(r.classifierSource)), tocBySource: count(tocs, r => String(r.classifierSource)),
    tocExplicitTitleStarts: tocs.filter(r => r.explicitTitleObserved).length, tocContinuationPages: tocs.filter(r => !r.explicitTitleObserved).length,
    physicalPdfsWithCover: pdfsWith('COVER'), physicalPdfsWithToc: pdfsWith('TOC'),
    logicalDocumentsWithCover: new Set(covers.map(r => r.logicalDocumentIndex)).size, logicalDocumentsWithToc: new Set(tocs.map(r => r.logicalDocumentIndex)).size,
    coverByPublisher: count(covers, r => String(r.publisherDomain)), tocByPublisher: count(tocs, r => String(r.publisherDomain)),
    coverByAccountType: count(covers, r => String(r.accountType)),
    pdfsWithMultipleCovers: perPdf.filter(p => (p.coverPages as number[]).length > 1).length,
    maxCoversInOnePdf: Math.max(0, ...perPdf.map(p => (p.coverPages as number[]).length)),
    tocRunCountDistribution: count(perPdf.filter(p => (p.tocRunCount as number) > 0), p => String(p.tocRunCount)),
    tocRunLengthDistribution: count(perPdf.flatMap(p => p.tocRuns as Record<string, unknown>[]), r => String(r.length)),
    tocRunStartSource: count(perPdf.flatMap(p => p.tocRuns as Record<string, unknown>[]), r => String(r.startSource)),
    tocContinuationDistance: { count: tocContinuationDistances.length, max: Math.max(0, ...tocContinuationDistances), distribution: Object.fromEntries(Object.entries(tocContinuationDistances.reduce<Record<string, number>>((o, d) => ((o[String(d)] = (o[String(d)] ?? 0) + 1), o), {})).sort(([a], [b]) => Number(a) - Number(b))) },
    tocRunsWithNoTextInside: perPdf.reduce((n, p) => n + (p.tocRunsWithNoTextInside as number), 0),
    coverTocPagesAdjacentToUnresolvedOrNoText: perPdf.reduce((n, p) => n + (p.adjacentUnresolvedOrNoTextCount as number), 0),
    privateUseCharacterPages: { COVER: covers.filter(r => r.privateUseCharacterPresent).length, TOC: tocs.filter(r => r.privateUseCharacterPresent).length },
    nonBreakingHyphenPages: { COVER: covers.filter(r => r.nonBreakingHyphenPresent).length, TOC: tocs.filter(r => r.nonBreakingHyphenPresent).length },
    tocPageHeaderTokenCountDistribution: count(tocs, r => String(r.pageHeaderTokenCount)),
    tocWithTwoTrailingNumberTokenLines: tocs.filter(r => (r.twoTrailingNumberTokenLineCount as number) > 0).length,
    coverStaffingReferenceTextPresent: covers.filter(r => r.staffingReferenceTextPresent).length,
    coverHeaderLeadingCodeDigits: count(covers, r => String(r.headerLeadingCodeDigits)),
  };
  const ledger = {
    schema: 'budget-request-cover-toc-structure-development-explored-pages/v0',
    inspectionRole: 'DEVELOPMENT_EXPLORATION（future frozen evaluation の候補から除外すべき page。semantic GT ではない）',
    seed: SAMPLE_SEED,
    pages: sample.map((s, i) => ({ ...s, inspection: { rawTextViewed: true, renderViewed: RENDER_INSPECTED_INDEXES.has(i + 1) } })),
  };
  const out = {
    schema: 'budget-request-cover-toc-structure-inventory/v0',
    scope: 'Page Classification v0 が COVER / TOC と routing した page の machine inventory。parser output ではない。logical row・semantic field は確定していない',
    generator: 'scripts/pipeline-v2/analyze-budget-request-cover-toc-structure.ts',
    frozenInput: { rawTextCorpusDigestSha256: FROZEN_RAW_DIGEST, pageClassificationCorpusDigestSha256: FROZEN_CLS_DIGEST },
    summary, perPdf, pages: inventory,
  };
  const sel = {
    schema: 'budget-request-cover-toc-structure-development-sample/v0',
    inspectionRole: 'DEVELOPMENT_EXPLORATION（future frozen evaluation ではない）',
    seed: SAMPLE_SEED, hashRule: 'sha256("{seed}|{stratum}|{localPdfPath}|{physicalPage}") 昇順の先頭 N', perStratum: PER_STRATUM,
    poolSizes, sampleSize: sample.length, sample,
  };
  if (FREEZE) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'structure-inventory.json'), `${JSON.stringify(out, null, 1)}\n`);
    fs.writeFileSync(path.join(OUT_DIR, 'development-sample-selection.json'), `${JSON.stringify(sel, null, 1)}\n`);
    fs.writeFileSync(path.join(OUT_DIR, 'development-explored-pages.json'), `${JSON.stringify(ledger, null, 1)}\n`);
  }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.writeFileSync(path.join(WORK_DIR, 'sample-pages.json'), JSON.stringify(sample.map(s => ({ ...s, text: rawPages(String(s.localPdfPath))[Number(s.physicalPage) - 1].text }))));
  console.log(JSON.stringify({ summary, poolSizes, sampleSize: sample.length }, null, 1));
}
main();
