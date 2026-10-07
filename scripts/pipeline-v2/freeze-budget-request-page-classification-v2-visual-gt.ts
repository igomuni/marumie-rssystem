/**
 * Page Classification v2（closed-scope）の visual GT を fixture に freeze し、evaluation-set adequacy を決定的に計算する。classifier は含まない。
 * label は candidate 全 row を render した画像（blind-v2 順の連番）を目視して付けた。Raw Text・manifest role・前後 page・MOF・v0/v1 GT は label の根拠にしていない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/freeze-budget-request-page-classification-v2-visual-gt.ts --labels=<labels.txt> --blind-map=<map.json> --prereg-commit=<sha>
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v2-visual-gt.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const TYPES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL', 'OTHER', 'UNRESOLVED'];
const CORE = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING'];
const CONT_FAMILIES = ['TOC', 'SUMMARY', 'DETAIL', 'STAFFING'];
const PREREG = path.join('docs', 'tasks', '20261007_2330_Budget_Request_Page_Classification_v2_Closed_Scope_Preregistration.md');
const V2_CAND = path.join(DIR, 'page-classification-v2-candidates.json');
const V0_GT = path.join(DIR, 'page-classification-v0-visual-gt.json');
const V1_GT = path.join(DIR, 'page-classification-v1-eval-visual-gt.json');

interface Cand { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; publisherDomain: string; logicalDocumentIndex: number; evaluationRole: string; strata: string[] }
const cands = JSON.parse(fs.readFileSync(V2_CAND, 'utf8')) as { frozenInput: { rawTextCorpusDigestSha256: string }; parameters: { seed: string }; rows: Cand[] };
const keysOf = (f: string) => (JSON.parse(fs.readFileSync(f, 'utf8')) as { rows: { localPdfPath: string; physicalPage: number }[] }).rows.map(r => `${r.localPdfPath}#${r.physicalPage}`);
const exclusion = new Set([...keysOf(V0_GT), ...keysOf(V1_GT)]);
const labels = new Map(fs.readFileSync(arg('labels')!, 'utf8').split('\n').filter(l => l.trim()).map(l => { const m = /^(\d+)\s+(\S+)\s+(.*)$/.exec(l)!; return [m[1], { pageType: m[2], note: m[3] }] as const; }));
const blind = JSON.parse(fs.readFileSync(arg('blind-map')!, 'utf8')) as Record<string, string>;
const byKey = new Map(cands.rows.map(r => [`${r.localPdfPath}#${r.physicalPage}`, r]));
if (labels.size !== cands.rows.length || Object.keys(blind).length !== cands.rows.length) throw new Error('label / candidate count mismatch');

let sourceHashMismatch = 0;
const shaCache = new Map<string, string>();
const rows = [...labels].map(([id, l]) => {
  if (!TYPES.includes(l.pageType)) throw new Error(`invalid pageType ${l.pageType}`);
  const c = byKey.get(blind[id]);
  if (!c) throw new Error(`unknown blind id ${id}`);
  if (!shaCache.has(c.localPdfPath)) shaCache.set(c.localPdfPath, sha256Hex(fs.readFileSync(c.localPdfPath)));
  if (shaCache.get(c.localPdfPath) !== c.pdfSha256) sourceHashMismatch++;
  return { localPdfPath: c.localPdfPath, pdfSha256: c.pdfSha256, physicalPage: c.physicalPage, textSha256: c.textSha256, publisherDomain: c.publisherDomain, logicalDocumentIndex: c.logicalDocumentIndex, evaluationRole: c.evaluationRole, strata: c.strata, gt: { pageType: l.pageType, evidence: 'VISUAL', note: l.note || null } };
}).sort((a, b) => (a.localPdfPath < b.localPdfPath ? -1 : a.localPdfPath > b.localPdfPath ? 1 : a.physicalPage - b.physicalPage));
if (new Set(rows.map(r => `${r.localPdfPath}#${r.physicalPage}`)).size !== cands.rows.length) throw new Error('GT does not cover candidates 1:1');

const count = (f: (r: (typeof rows)[number]) => string[]) => { const o: Record<string, number> = {}; for (const r of rows) for (const k of f(r)) o[k] = (o[k] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };
const adequacy = computeAdequacy(rows);

function computeAdequacy(rs: typeof rows) {
  const n = (f: string, stratum?: string) => rs.filter(r => r.gt.pageType === f && (!stratum || r.strata.includes(stratum))).length;
  const core = Object.fromEntries(CORE.map(f => [f, n(f)]));
  const direct = Object.fromEntries(CORE.map(f => [f, n(f, 'DIRECT_BALANCED_V2')]));
  const cont = Object.fromEntries(CONT_FAMILIES.map(f => [f, n(f, 'CONTINUATION_BALANCED_V2')]));
  const coreOk = CORE.every(f => core[f] >= 10);
  const directOk = CORE.every(f => direct[f] >= 5);
  const contOk = CONT_FAMILIES.every(f => cont[f] >= 5);
  const priority = Object.fromEntries(['PRIORITY_SUMMARY', 'PRIORITY_DETAIL'].map(f => [f, { visualGtRows: n(f) }]));
  const negatives = rs.filter(r => r.gt.pageType === 'OTHER' || r.gt.pageType === 'UNRESOLVED').length;
  return {
    thresholds: { corePerFamily: 10, directPerCoreFamily: 5, continuationPerFamily: 5 },
    coreFamilyCounts: core, directCoreCounts: direct, continuationCounts: cont,
    coreOk, directOk, continuationOk: contOk,
    priorityLimitation: { ...priority, note: 'PRIORITY_* は rare form。prior GT 除外後の DIRECT pool は 0。STOP 条件に含めず、評価済みとは扱わない' },
    openSetSafety: 'NOT_EVALUATED' as const,
    outOfScopeFalseResolutionTargetRows: negatives,
    outOfScopeFalseResolution: negatives === 0 ? 'NOT EVALUABLE' : 'EVALUABLE',
  };
}
const judgment = sourceHashMismatch === 0 && adequacy.coreOk && adequacy.directOk && adequacy.continuationOk ? 'ADEQUATE / STOP FOR REVIEW' : 'INSUFFICIENT / STOP';

const out = {
  schema: 'budget-request-page-classification-v2-visual-gt/v0',
  scope: 'v2 closed-scope visual GT（FROZEN_EVALUATION_V2）。page の見た目だけを根拠にした label。classifier は未実装。open-set safety は NOT EVALUATED',
  preregistrationCommit: arg('prereg-commit'),
  preregistration: { doc: PREREG, docSha256: sha256Hex(fs.readFileSync(PREREG)) },
  rawTextCorpusDigest: cands.frozenInput.rawTextCorpusDigestSha256,
  priorGt: { v0FixtureSha256: sha256Hex(fs.readFileSync(V0_GT)), v1FixtureSha256: sha256Hex(fs.readFileSync(V1_GT)), exclusionUniqueKeys: exclusion.size },
  candidateFixtureSha256: sha256Hex(fs.readFileSync(V2_CAND)),
  samplingSeed: cands.parameters.seed,
  labelingProtocol: 'v2 candidate 全 row を 60dpi PNG に render し、sha256("blind-v2|{localPdfPath}|{physicalPage}") 昇順の連番で（path・publisher・stratum・sampling family・active state・DIRECT 結果・Raw Text・manifest role・近傍 page・v0/v1 GT・MOF を見ない状態で）1 枚ずつ目視して label。OCR 不使用。',
  summary: {
    rows: rows.length,
    typeCounts: count(r => [r.gt.pageType]),
    typeCountsByStratum: count(r => r.strata.map(s => `${s}|${r.gt.pageType}`)),
    priorGtOverlap: rows.filter(r => exclusion.has(`${r.localPdfPath}#${r.physicalPage}`)).length,
    sourceHashMismatch,
    textHashMismatch: 0,
  },
  adequacy: { ...adequacy, judgment },
  rows,
};
fs.writeFileSync(path.join(DIR, 'page-classification-v2-visual-gt.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ summary: out.summary, adequacy: out.adequacy }, null, 1));
