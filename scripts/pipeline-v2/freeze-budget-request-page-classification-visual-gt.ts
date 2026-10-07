/**
 * Page Classification v0 の visual GT を fixture に freeze する（label の取り込みのみ。classifier は含まない）。
 * label は candidate 全 row を render した画像（blind 順の連番）を目視して付けた。Raw Text・manifest role・前後 page・MOF は label の根拠にしていない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/freeze-budget-request-page-classification-visual-gt.ts --labels=<labels.txt> --blind-map=<map.json> --prereg-commit=<sha>
 *   labels.txt: 1 行 1 page「<blind id> <pageType> <note>」。blind-map.json: blind id → "<localPdfPath>#<page>"（blind 順 = sha256("blind|path|page") 昇順）
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v0-visual-gt.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const TYPES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL', 'OTHER', 'UNRESOLVED'];
const PREREG = path.join('docs', 'tasks', '20261007_1925_Budget_Request_Page_Classification_v0_Preregistration.md');

interface Cand { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; publisherDomain: string; logicalDocumentIndex: number; strata: string[]; evaluationRole: string }
const cands = JSON.parse(fs.readFileSync(path.join(DIR, 'page-classification-v0-candidates.json'), 'utf8')) as { frozenInput: { rawTextCorpusDigestSha256: string }; parameters: { seed: string }; rows: Cand[] };
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
  return { ...c, gt: { pageType: l.pageType, evidence: 'VISUAL', note: l.note || null } };
}).sort((a, b) => (a.localPdfPath < b.localPdfPath ? -1 : a.localPdfPath > b.localPdfPath ? 1 : a.physicalPage - b.physicalPage));
if (new Set(rows.map(r => `${r.localPdfPath}#${r.physicalPage}`)).size !== cands.rows.length) throw new Error('GT does not cover candidates 1:1');

const count = (f: (r: (typeof rows)[number]) => string) => { const o: Record<string, number> = {}; for (const r of rows) o[f(r)] = (o[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };
const out = {
  schema: 'budget-request-page-classification-v0-visual-gt/v0',
  scope: 'visual GT。page の見た目（render した画像の目視）だけを根拠にした label。classifier の INHERITED rule・Raw Text・manifest role・前後 page・MOF は根拠にしていない',
  preregistration: { commit: arg('prereg-commit'), doc: PREREG, docSha256: sha256Hex(fs.readFileSync(PREREG)), candidatesFixtureSha256: sha256Hex(fs.readFileSync(path.join(DIR, 'page-classification-v0-candidates.json'))) },
  frozenInput: { rawTextCorpusDigestSha256: cands.frozenInput.rawTextCorpusDigestSha256 },
  samplingSeed: cands.parameters.seed,
  labelingProtocol: 'candidate 全 row を 80dpi PNG に render し、sha256("blind|{localPdfPath}|{physicalPage}") 昇順の連番で並べて（stratum・split・Raw Text・path を見ない状態で）1 枚ずつ目視して label。OCR 不使用。',
  summary: {
    rows: rows.length,
    byRole: count(r => r.evaluationRole),
    typeCountsByRole: count(r => `${r.evaluationRole}|${r.gt.pageType}`),
    typeCounts: count(r => r.gt.pageType),
    typeCountsByStratum: Object.fromEntries(['DIRECT', 'CONTINUATION', 'CORPUS_RANDOM'].map(s => [s, (() => { const o: Record<string, number> = {}; for (const r of rows) if (r.strata.includes(s)) o[r.gt.pageType] = (o[r.gt.pageType] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort()); })()])),
    unresolved: rows.filter(r => r.gt.pageType === 'UNRESOLVED').length,
    other: rows.filter(r => r.gt.pageType === 'OTHER').length,
    sourceHashMismatch,
    textHashMismatch: 0,
  },
  rows,
};
fs.writeFileSync(path.join(DIR, 'page-classification-v0-visual-gt.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.summary, null, 1));
