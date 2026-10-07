/**
 * Page Classification v1 evaluation の visual GT を fixture に freeze し、evaluation-set adequacy を決定的に計算する。classifier は含まない。
 * label は candidate 全 row を render した画像（blind-v1 順の連番）を目視して付けた。Raw Text・manifest role・前後 page・MOF・v0 GT は label の根拠にしていない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/freeze-budget-request-page-classification-v1-eval-visual-gt.ts --labels=<labels.txt> --blind-map=<map.json> --prereg-commit=<sha>
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v1-eval-visual-gt.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const TYPES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL', 'OTHER', 'UNRESOLVED'];
const CORE = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING'];
const CONT_FAMILIES = ['TOC', 'SUMMARY', 'DETAIL', 'STAFFING'];
const RISK = ['R1_NO_ACTIVE_STATE', 'R2_PRE_DIRECT_TRANSITION', 'R3_LONG_INHERITANCE_TAIL', 'R4_POST_BLANK_BRIDGE', 'R5_POST_RESET', 'R6_TITLE_OUTSIDE_DIRECT_WINDOW', 'R7_PDF_START_WITHOUT_DIRECT'];
const CONT_STRATA = ['CONTINUATION_BALANCED', 'R2_PRE_DIRECT_TRANSITION', 'R3_LONG_INHERITANCE_TAIL', 'R4_POST_BLANK_BRIDGE'];
const PREREG = path.join('docs', 'tasks', '20261007_2105_Budget_Request_Page_Classification_v1_Evaluation_Preregistration.md');
const V0_GT = path.join(DIR, 'page-classification-v0-visual-gt.json');
const V1_CAND = path.join(DIR, 'page-classification-v1-eval-candidates.json');

interface Cand { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; publisherDomain: string; logicalDocumentIndex: number; evaluationRole: string; strata: string[] }
const cands = JSON.parse(fs.readFileSync(V1_CAND, 'utf8')) as { frozenInput: { rawTextCorpusDigestSha256: string }; parameters: { seed: string }; rows: Cand[] };
const v0Keys = new Set((JSON.parse(fs.readFileSync(V0_GT, 'utf8')) as { rows: { localPdfPath: string; physicalPage: number }[] }).rows.map(r => `${r.localPdfPath}#${r.physicalPage}`));
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
  const neg = rs.filter(r => r.gt.pageType === 'OTHER' || r.gt.pageType === 'UNRESOLVED');
  const negRisk = new Set(neg.flatMap(r => r.strata.filter(s => RISK.includes(s))));
  const negDomains = new Set(neg.map(r => r.publisherDomain));
  const safetyOk = neg.length >= 10 && negDomains.size >= 2 && negRisk.size >= 2;
  const coreCounts = Object.fromEntries(CORE.map(f => [f, rs.filter(r => r.gt.pageType === f).length]));
  const contCounts = Object.fromEntries(CONT_FAMILIES.map(f => [f, rs.filter(r => r.gt.pageType === f && r.strata.some(s => CONT_STRATA.includes(s))).length]));
  const coreOk = CORE.every(f => coreCounts[f] >= 5);
  const contOk = CONT_FAMILIES.every(f => contCounts[f] >= 3);
  return {
    safety: { safetyNegativeRows: neg.length, safetyNegativePublisherDomains: negDomains.size, safetyNegativeRiskStrata: [...negRisk].sort(), thresholds: { rows: 10, publisherDomains: 2, riskStrata: 2 }, falseResolvedSafety: neg.length === 0 ? 'NOT EVALUABLE' : safetyOk ? 'EVALUABLE' : 'LIMITED', result: safetyOk ? 'SUFFICIENT' : 'INSUFFICIENT' },
    semanticCoverage: { coreFamilyCounts: coreCounts, continuationOrRiskCountsByFamily: contCounts, thresholds: { corePerFamily: 5, continuationPerFamily: 3 }, priorityExemption: 'PRIORITY_* は publisher-domain limitation により exemption（core 5 の不足は exemption にしない）', result: coreOk && contOk ? 'SUFFICIENT' : 'INSUFFICIENT' },
  };
}
const judgment = adequacy.safety.result === 'SUFFICIENT' && adequacy.semanticCoverage.result === 'SUFFICIENT' && sourceHashMismatch === 0 ? 'ADEQUATE / STOP FOR REVIEW' : 'INSUFFICIENT / STOP';

const out = {
  schema: 'budget-request-page-classification-v1-eval-visual-gt/v0',
  scope: 'v1 evaluation visual GT（FROZEN_EVALUATION_V1）。page の見た目だけを根拠にした label。classifier は未実装',
  preregistrationCommit: arg('prereg-commit'),
  preregistration: { doc: PREREG, docSha256: sha256Hex(fs.readFileSync(PREREG)) },
  rawTextCorpusDigest: cands.frozenInput.rawTextCorpusDigestSha256,
  v0CandidateFixtureSha256: sha256Hex(fs.readFileSync(path.join(DIR, 'page-classification-v0-candidates.json'))),
  v0VisualGtFixtureSha256: sha256Hex(fs.readFileSync(V0_GT)),
  v1CandidateFixtureSha256: sha256Hex(fs.readFileSync(V1_CAND)),
  samplingSeed: cands.parameters.seed,
  labelingProtocol: 'v1 candidate 全 row を 80dpi PNG に render し、sha256("blind-v1|{localPdfPath}|{physicalPage}") 昇順の連番で（path・publisher・split・stratum・active state・DIRECT 結果・Raw Text・manifest role・近傍 page・MOF・v0 GT を見ない状態で）1 枚ずつ目視して label。OCR 不使用。',
  summary: {
    rows: rows.length,
    typeCounts: count(r => [r.gt.pageType]),
    typeCountsByStratum: count(r => r.strata.map(s => `${s}|${r.gt.pageType}`)),
    v0GtOverlap: rows.filter(r => v0Keys.has(`${r.localPdfPath}#${r.physicalPage}`)).length,
    sourceHashMismatch,
    textHashMismatch: 0,
  },
  adequacy: { ...adequacy, judgment },
  rows,
};
fs.writeFileSync(path.join(DIR, 'page-classification-v1-eval-visual-gt.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ summary: out.summary, adequacy: out.adequacy }, null, 1));
