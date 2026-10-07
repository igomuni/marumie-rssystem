/**
 * Cover Structure v0 の visual GT を fixture に freeze する（label の取り込みのみ。parser は含まない）。
 * GT は candidate page を render した画像（blind-cover 順の連番）だけを見て作った。Raw Text・parser output・PR-3A taxonomy・manifest 由来文字列は見ていない。
 *
 * 入力 gt.txt の書式（1 行 1 field、blind id は 3 桁）:
 *   <id>|H|<codeVisual>|<headerTextVisual>             header（titleVisualParts は全 page 共通の見える title を stamp）
 *   <id>|S1|<printedPageRefVisual> / S2 / S3           1.総表 / 2.明細表 / 3.定員表 の SECTION_REFERENCE
 *   <id>|C|<markerVisual>|<codeVisual>|<namePartsVisual（';;' 区切りで見える行分割）>|<printedPageRefVisual>   SCOPE_REFERENCE
 * 使い方: npx tsx scripts/pipeline-v2/freeze-budget-request-cover-structure-visual-gt.ts --gt=<gt.txt> --blind-map=<map.json> --prereg-commit=<sha>
 * 出力: tests/fixtures/budget-request-cover-structure/2024/visual-gt.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIR = path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024');
const CAND = path.join(DIR, 'frozen-candidates.json');
const PREREG_DOC = path.join('docs', 'tasks', '20261007_2310_Budget_Request_Cover_Structure_v0_Preregistration.md');
const TITLE_PARTS = ['令和６年度歳出概算要求書'];
const SECTION: Record<string, { ordinal: string; label: string[] }> = {
  S1: { ordinal: '1.', label: ['令和６年度歳出概算要求額総表'] },
  S2: { ordinal: '2.', label: ['令和６年度歳出概算要求額明細表'] },
  S3: { ordinal: '3.', label: ['令和６年度概算要求定員表'] },
};
const cand = JSON.parse(fs.readFileSync(CAND, 'utf8')) as { candidateDigestSha256: string; frozenInput: Record<string, string>; candidates: { filePath: string; fileSha256: string; physicalPage: number; textSha256: string }[] };
const byKey = new Map(cand.candidates.map(c => [`${c.filePath}#${c.physicalPage}`, c]));
const blind = JSON.parse(fs.readFileSync(arg('blind-map')!, 'utf8')) as Record<string, string>;
const lines = fs.readFileSync(arg('gt')!, 'utf8').split('\n').filter(l => l.trim());

type Entry = { kindVisual: 'SECTION_REFERENCE' | 'SCOPE_REFERENCE'; ordinalVisual: string | null; labelOrMarkerVisual: string | null; codeVisual: string | null; labelVisualParts: string[]; nameVisualParts: string[]; printedPageRefVisual: string | null; status: 'RESOLVED' };
const byId = new Map<string, { header?: { codeVisual: string; textVisualParts: string[] }; entries: Entry[] }>();
for (const l of lines) {
  const f = l.split('|');
  const g = byId.get(f[0]) ?? { entries: [] };
  byId.set(f[0], g);
  if (f[1] === 'H') g.header = { codeVisual: f[2], textVisualParts: [f[3]] };
  else if (f[1] in SECTION) g.entries.push({ kindVisual: 'SECTION_REFERENCE', ordinalVisual: SECTION[f[1]].ordinal, labelOrMarkerVisual: null, codeVisual: null, labelVisualParts: SECTION[f[1]].label, nameVisualParts: [], printedPageRefVisual: f[2], status: 'RESOLVED' });
  else if (f[1] === 'C') g.entries.push({ kindVisual: 'SCOPE_REFERENCE', ordinalVisual: null, labelOrMarkerVisual: f[2], codeVisual: f[3], labelVisualParts: [], nameVisualParts: f[4].split(';;'), printedPageRefVisual: f[5], status: 'RESOLVED' });
  else throw new Error(`bad line ${l}`);
}
if (byId.size !== cand.candidates.length || Object.keys(blind).length !== cand.candidates.length) throw new Error('count mismatch');
const seen = new Set<string>();
const rows = [...byId].map(([id, g]) => {
  const c = byKey.get(blind[id]);
  if (!c || !g.header) throw new Error(`unknown/incomplete ${id}`);
  seen.add(blind[id]);
  // 見える並びの順（総表→明細表→scope→定員表）に source order を整える: S1,S2,C...,S3 は gt.txt の記載順（上から下）のまま
  return { sourceKey: { filePath: c.filePath, fileSha256: c.fileSha256, physicalPage: c.physicalPage, textSha256: c.textSha256 }, visualStatus: 'RESOLVED' as const, header: { codeVisual: g.header.codeVisual, textVisualParts: g.header.textVisualParts, titleVisualParts: TITLE_PARTS, status: 'RESOLVED' as const }, entries: g.entries, notes: null as string | null };
}).sort((a, b) => (a.sourceKey.filePath < b.sourceKey.filePath ? -1 : a.sourceKey.filePath > b.sourceKey.filePath ? 1 : a.sourceKey.physicalPage - b.sourceKey.physicalPage));
if (seen.size !== cand.candidates.length) throw new Error('GT does not cover candidates 1:1');
// source hash 再検証
let sourceHashMismatch = 0;
const sha = new Map<string, string>();
for (const r of rows) { if (!sha.has(r.sourceKey.filePath)) sha.set(r.sourceKey.filePath, sha256Hex(fs.readFileSync(r.sourceKey.filePath))); if (sha.get(r.sourceKey.filePath) !== r.sourceKey.fileSha256) sourceHashMismatch++; }
const count = (f: (r: (typeof rows)[number]) => string) => { const o: Record<string, number> = {}; for (const r of rows) o[f(r)] = (o[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };
const out = {
  schema: 'budget-request-cover-structure-visual-gt/v0',
  scope: 'Cover Structure v0 の visual GT（FROZEN_EVALUATION）。candidate page の render 画像だけを根拠にした。parser は未実装',
  preregistrationCommit: arg('prereg-commit'),
  preregistration: { doc: PREREG_DOC, docSha256: sha256Hex(fs.readFileSync(PREREG_DOC)) },
  candidateFixtureSha256: sha256Hex(fs.readFileSync(CAND)), candidateDigestSha256: cand.candidateDigestSha256,
  protocol: 'frozen candidate 55 page を 90dpi で page 上部を render し、sha256("blind-cover|{filePath}|{physicalPage}") 昇順の連番で 1 枚ずつ目視。Raw Text・parser output・PR-3A taxonomy・manifest 由来文字列・MOF/RS・OCR は不使用。title は全 page 共通の見える文字列。name の字間空白は記録せず、見える文字のみを parts として記録（比較は whitespace 除去）。',
  summary: {
    rows: rows.length, sourceHashMismatch,
    visualStatus: count(r => r.visualStatus),
    entryKinds: count(r => `${r.entries.filter(e => e.kindVisual === 'SECTION_REFERENCE').length}sec+${r.entries.filter(e => e.kindVisual === 'SCOPE_REFERENCE').length}scope`),
    scopeMarkers: count(r => r.entries.filter(e => e.kindVisual === 'SCOPE_REFERENCE').map(e => e.labelOrMarkerVisual).join(',')),
    headerCodeLengths: count(r => String(r.header.codeVisual.length)),
    withStaffingSection: rows.filter(r => r.entries.some(e => e.ordinalVisual === '3.')).length,
    printedPageRefNonNumeric: rows.reduce((n, r) => n + r.entries.filter(e => e.printedPageRefVisual !== null && !/^\d+$/.test(e.printedPageRefVisual)).length, 0),
    multilineNameRows: rows.filter(r => r.entries.some(e => e.nameVisualParts.length > 1)).length,
    partialOrUnresolvedRows: rows.filter(r => r.visualStatus !== 'RESOLVED').length,
  },
  rows,
};
fs.writeFileSync(path.join(DIR, 'visual-gt.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.summary, null, 1));
