/**
 * FY2024 概算要求 82 PDF 全体への item-shaped row candidate detector の適用（事前登録した規則を無修正で使う）。
 * 入力は hierarchy=null の row-local 出力のみ: baseline の records artifact（null 区間はそのまま、8 PDF の hierarchy 区間は hierarchy-isolation の OFF 出力に置き換える）。
 * 新たな PDF 抽出・production code の変更・rotate=90 の対応はしない。MOF・DocumentHierarchy・金額は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/scan-budget-request-item-candidates.ts
 * 出力: tests/fixtures/budget-request-pdf-item-candidate-count/2024/candidate-count.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { countCandidates, decideItemCandidate, detectCandidates, referenceX, ITEM_INDENT_STEP, ITEM_X_TOLERANCE, MIN_REFERENCE_REQUESTS, type CandidateSourceRecord, type ItemCandidate } from './lib/budget-request-item-candidate';

const ISO = path.join('tests', 'fixtures', 'budget-request-hierarchy-failure-isolation', '2024');
const BASE_FIX = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const OUT_DIR = path.join('tests', 'fixtures', 'budget-request-pdf-item-candidate-count', '2024');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const FROZEN: Record<string, string> = {
  [path.join(ISO, 'paired-manifest.json')]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [path.join(BASE_FIX, 'corpus-manifest.json')]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  [path.join(BASE_FIX, 'extraction-baseline.json')]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f',
  [path.join(BASE_FIX, 'reconciliation-result.json')]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  [path.join(ISO, 'transition-evaluation.json')]: 'b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd',
  [path.join(ISO, 'off-diagnostic.json')]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface Doc { localPath: string; publisherAuthority: string; accountType: string; pages: number }
interface SegRes { pages: [number, number]; mode: string; status: string; error: string | null; outputs: { records: { path: string; sha256: string } } | null; summary: { pages: { processed: number } } | null }
interface DocRes { status: string; segments: SegRes[] }
type Scan = 'scannable' | 'unscannable_rotate90' | 'unscannable_missing_upstream_artifact' | 'unscannable_other';

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (sha(fs.readFileSync(p)) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const docs = (JSON.parse(fs.readFileSync(path.join(BASE_FIX, 'corpus-manifest.json'), 'utf8')) as { documents: Doc[] }).documents;
  const paired = new Set((JSON.parse(fs.readFileSync(path.join(ISO, 'paired-manifest.json'), 'utf8')) as { documents: { localPath: string; class: string }[] }).documents.filter(d => d.class === 'paired_evaluable').map(d => d.localPath));
  const off = JSON.parse(fs.readFileSync(path.join(ISO, 'off-diagnostic.json'), 'utf8')) as { documents: { localPath: string; recordsSha256: string }[] };

  const per: Record<string, unknown>[] = [];
  const coverage: Record<string, { pdfs: number; pages: number }> = {};
  const cov = (k: string, pages: number) => { (coverage[k] ??= { pdfs: 0, pages: 0 }); coverage[k].pdfs++; coverage[k].pages += pages; };
  const keyOwners = new Map<string, Set<string>>();
  const allCands: { doc: Doc; c: ItemCandidate }[] = [];

  for (const d of docs) {
    const slug = slugOf(d.localPath);
    const f = path.join(BASE_WORK, slug, 'result.json');
    if (!fs.existsSync(f)) { cov('unscannable_missing_upstream_artifact', d.pages); per.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, scan: 'unscannable_missing_upstream_artifact' as Scan, pages: d.pages }); continue; }
    const res = JSON.parse(fs.readFileSync(f, 'utf8')) as DocRes;
    const hierarchyGroup = paired.has(d.localPath) ? 'hierarchy_contract_pdf' : 'hierarchy_less_pdf';
    if (res.status !== 'success') {
      const rotate = res.segments.some(s => s.error?.includes('rotate=90'));
      const scan: Scan = rotate ? 'unscannable_rotate90' : 'unscannable_other';
      cov(scan, d.pages);
      per.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, group: hierarchyGroup, scan, pages: d.pages, status: res.status });
      continue;
    }
    const recs: CandidateSourceRecord[] = [];
    let pagesScanned = 0;
    for (const s of res.segments) {
      if (!s.outputs) throw new Error(`成功区間に records が無い: ${d.localPath}`);
      let file = s.outputs.records.path;
      if (s.mode === 'hierarchy_enabled') {
        if (!paired.has(d.localPath)) throw new Error(`paired でない PDF に hierarchy 区間がある: ${d.localPath}`);
        file = path.join(OFF_WORK, slug, `seg-${s.pages[0]}-${s.pages[1]}.records.jsonl.gz`);
        if (sha(fs.readFileSync(file)) !== off.documents.find(x => x.localPath === d.localPath)?.recordsSha256) throw new Error(`OFF artifact の hash 不一致: ${file}`);
      } else if (sha(fs.readFileSync(file)) !== s.outputs.records.sha256) throw new Error(`baseline artifact の hash 不一致: ${file}`);
      recs.push(...readGz<CandidateSourceRecord>(file));
      pagesScanned += s.summary?.pages.processed ?? 0;
    }
    cov('scannable', d.pages);
    const { refX, requests } = referenceX(recs);
    const base = { localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, group: hierarchyGroup, scan: 'scannable' as Scan, pages: d.pages, pagesScanned, requestsForReference: requests, referenceX: refX };
    if (refX === null) { per.push({ ...base, reference: 'no_reference', candidates: null }); continue; }
    const cands = detectCandidates(recs, refX);
    for (const c of cands) { allCands.push({ doc: d, c }); if (c.key) { if (!keyOwners.has(c.key)) keyOwners.set(c.key, new Set()); keyOwners.get(c.key)!.add(d.localPath); } }
    per.push({ ...base, reference: 'available', candidates: countCandidates(cands) });
  }

  type Agg = { pdfs: number; rows: number; withinDocumentUnique: number; duplicateRows: number; ambiguous: number };
  const agg = (pred: (p: Record<string, unknown>) => boolean): Agg => {
    const a: Agg = { pdfs: 0, rows: 0, withinDocumentUnique: 0, duplicateRows: 0, ambiguous: 0 };
    for (const p of per) if (pred(p) && p.candidates) { const c = p.candidates as { rows: number; withinDocumentUnique: number; duplicateRows: number; ambiguous: number }; a.pdfs++; a.rows += c.rows; a.withinDocumentUnique += c.withinDocumentUnique; a.duplicateRows += c.duplicateRows; a.ambiguous += c.ambiguous; }
    return a;
  };
  const byAccount = Object.fromEntries(['general', 'special'].map(a => [a, agg(p => p.accountType === a)]));
  const byGroup = Object.fromEntries(['hierarchy_contract_pdf', 'hierarchy_less_pdf'].map(g => [g, agg(p => p.group === g)]));
  const byGroupAccount: Record<string, Agg> = {};
  for (const g of ['hierarchy_contract_pdf', 'hierarchy_less_pdf']) for (const a of ['general', 'special']) byGroupAccount[`${g}|${a}`] = agg(p => p.group === g && p.accountType === a);
  const pubs: Record<string, Agg> = {};
  for (const pub of [...new Set(docs.map(d => d.publisherAuthority))].sort(cmp)) pubs[pub] = agg(p => p.publisherAuthority === pub);
  const noReference = per.filter(p => p.reference === 'no_reference').length;
  const pagesByAccount: Record<string, number> = {};
  for (const p of per) if (p.scan === 'scannable') inc(pagesByAccount, p.accountType as string, p.pages as number);
  const crossDocUnique = keyOwners.size;
  const crossDocKeysInMultiplePdfs = [...keyOwners.values()].filter(s => s.size > 1).length;
  const crossDocGeneral = new Set(allCands.filter(x => x.doc.accountType === 'general' && x.c.key).map(x => x.c.key)).size;

  const dev = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'development-comparison.json'), 'utf8')) as { totals: { existingItems: number; itemsInCandidates: number } };
  const less = byGroup.hierarchy_less_pdf;
  const lessPubs = new Set(per.filter(p => p.group === 'hierarchy_less_pdf' && p.candidates && (p.candidates as { rows: number }).rows > 0).map(p => p.publisherAuthority)).size;
  const facts = {
    developmentConsistent: dev.totals.itemsInCandidates === dev.totals.existingItems, scannablePdfs: coverage.scannable?.pdfs ?? 0,
    unscannablePdfs: docs.length - (coverage.scannable?.pdfs ?? 0), hierarchyLessPdfsWithReference: less.pdfs,
    hierarchyLessRows: less.rows, hierarchyLessUnique: less.withinDocumentUnique, hierarchyLessDuplicates: less.duplicateRows, hierarchyLessAmbiguous: less.ambiguous,
    hierarchyLessPublishersWithCandidates: lessPubs, productionItemRecords: 97,
  };
  const out = {
    schema: 'budget-request-item-candidate-count/v0',
    scope: 'item-shaped row 候補の population diagnostic。候補は正式な項 GT ではなく、MOF 784 件も PDF 側の正解母数ではない',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, sha(fs.readFileSync(p))])), rule: { step: ITEM_INDENT_STEP, tolerance: ITEM_X_TOLERANCE, minReferenceRequests: MIN_REFERENCE_REQUESTS } },
    coverage, scannablePagesByAccount: pagesByAccount, scannableWithoutReference: noReference,
    totals: agg(() => true), byAccount, byGroup, byGroupAccount, byPublisher: pubs,
    crossDocumentReference: { note: '組織を特定できない参考値。異なる組織の同名項を同一とは扱わない', uniqueCodeNameKeys: crossDocUnique, keysInMultiplePdfs: crossDocKeysInMultiplePdfs, uniqueCodeNameKeysGeneralAccount: crossDocGeneral },
    decisionFacts: facts, decision: decideItemCandidate(facts),
    perPdf: per.sort((a, b) => cmp(a.localPath as string, b.localPath as string)),
    candidates: allCands.map(x => ({ localPath: x.doc.localPath, accountType: x.doc.accountType, page: x.c.anchor.page, logicalRowIndex: x.c.anchor.logicalRowIndex, code: x.c.code, nameStatus: x.c.nameStatus, nameRaw: x.c.nameRaw, key: x.c.key })).sort((a, b) => cmp(a.localPath, b.localPath) || a.page - b.page || a.logicalRowIndex - b.logicalRowIndex),
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'candidate-count.json'), text);
  console.log(JSON.stringify({ sha256: sha(text), coverage, noReference, totals: out.totals, byAccount, byGroup, byGroupAccount, cross: out.crossDocumentReference, facts, decision: out.decision }, null, 1));
}

main();
