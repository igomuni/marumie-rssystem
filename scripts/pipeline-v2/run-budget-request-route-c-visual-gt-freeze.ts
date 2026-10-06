/**
 * Route C visual GT fixture の freeze。視覚転記（lib/budget-request-visual-transcription.ts）の 37 項に、転記の後から MOF 側 field を name 正規化 join で付ける。
 * visual の値は MOF から作っていない。join は照合の記録のみで、visual 値を MOF 値で置換しない。
 * 使い方: node --import tsx scripts/pipeline-v2/run-budget-request-route-c-visual-gt-freeze.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { VISUAL_TRANSCRIPTION } from './lib/budget-request-visual-transcription';
import { SCOPE_ROWS } from './lib/budget-request-route-c-scope-rows';

const OUT = 'tests/fixtures/budget-request-route-c-drawing-path/2024';
const INV = 'tests/fixtures/budget-request-unmatched-59/2024/unmatched-59-inventory.jsonl.gz';
const PDFS = {
  moj: { path: 'data/download/moj.go.jp/content/001402818.pdf', sha256: 'bd5ce9c5dee48b03407e9a8d4050f3992c8a515f510c0339364316448dd9cf8c', split: 'development' },
  fsa: { path: 'data/download/fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf', sha256: '9803cfd8e2f33592ae01612cce6e570e56208f1a758027b09d69055cff91cb9b', split: 'held-out' },
} as const;
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
// 正規化規則（実装前に固定）: NFKC → 空白除去。それ以外（長音符号の統一・全半角以外の変換・括弧除去等）は行わない
const N = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

for (const p of Object.values(PDFS)) if (sha(fs.readFileSync(p.path)) !== p.sha256) throw new Error(`原本の hash 不一致（STOP）: ${p.path}`);

interface Mof { mofRowId: string; mofCode: string; mofNameRaw: string; mofOrganization: string; mofMinistry: string; failureClass: string }
const mof: Mof[] = zlib.gunzipSync(fs.readFileSync(INV)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const f1 = mof.filter(m => m.failureClass === 'F1');
if (f1.length !== 37) throw new Error(`F1 が 37 でない: ${f1.length}`);

const claimed = new Set<string>();
const gt = VISUAL_TRANSCRIPTION.map(v => {
  const pdf = PDFS[v.pdfId];
  const byName = f1.filter(m => N(m.mofNameRaw) === N(v.itemName) && !claimed.has(m.mofRowId));
  const sameCode = byName.filter(m => m.mofCode === v.itemCode);
  const m = byName.length === 1 ? byName[0] : null;
  if (!m) throw new Error(`MOF join 不能/曖昧: ${v.pdfId} p${v.pdfPage} ${v.itemCode} ${v.itemName} (${byName.length})`);
  claimed.add(m.mofRowId);
  return {
    rowId: `${v.pdfId}-p${v.pdfPage}-${v.column}-${v.organizationCode}-${v.itemCode}`,
    split: pdf.split, sourcePdf: pdf.path, sourceSha256: pdf.sha256, page: v.pdfPage, column: v.column,
    organizationCodeVisual: v.organizationCode, organizationNameVisual: v.organizationName,
    visualItemCode: v.itemCode, visualItemName: v.itemName, visualTocPageRef: v.tocPageRef,
    visualItemNameNormalized: N(v.itemName),
    mofRowId: m.mofRowId, mofItemCode: m.mofCode, mofItemName: m.mofNameRaw, mofOrganization: m.mofOrganization,
    nameExactToMof: N(v.itemName) === N(m.mofNameRaw), codeExactToMof: sameCode.length === 1,
    visualEvidenceNote: `pdftoppm 150dpi の page ${v.pdfPage}（${v.column} 列）を目視して転記${v.notes ? `。${v.notes}` : ''}`,
  };
}).sort((a, b) => cmp(a.rowId, b.rowId));
if (new Set(gt.map(g => g.rowId)).size !== gt.length) throw new Error('rowId 重複');
if (new Set(gt.map(g => g.mofRowId)).size !== gt.length) throw new Error('mofRowId 重複');

// scope rows と GT の整合: GT の 37 項は scope rows の item row と一致していること
const scopeItems = SCOPE_ROWS.filter(r => r.kind === 'item');
const missingInScope = gt.filter(g => !scopeItems.some(s => s.pdfId === (g.sourcePdf.includes('moj') ? 'moj' : 'fsa') && s.pdfPage === g.page && s.code === g.visualItemCode && s.name === g.visualItemName));
if (missingInScope.length) throw new Error(`scope rows に無い GT 項: ${missingInScope.map(g => g.rowId).join(',')}`);

const summary = {
  gtRows: gt.length,
  byPdf: { moj: gt.filter(g => g.sourcePdf === PDFS.moj.path).length, fsa: gt.filter(g => g.sourcePdf === PDFS.fsa.path).length },
  bySplit: { development: gt.filter(g => g.split === 'development').length, 'held-out': gt.filter(g => g.split === 'held-out').length },
  nameExactToMof: gt.filter(g => g.nameExactToMof).length,
  codeExactToMof: gt.filter(g => g.codeExactToMof).length,
  nameAndCodeExactToMof: gt.filter(g => g.nameExactToMof && g.codeExactToMof).length,
  nameNotExact: gt.filter(g => !g.nameExactToMof).map(g => g.rowId),
  codeNotExact: gt.filter(g => !g.codeExactToMof).map(g => ({ rowId: g.rowId, visualItemCode: g.visualItemCode, mofItemCode: g.mofItemCode })),
};
const scopeSummary = {
  scopeRows: SCOPE_ROWS.length,
  byPdf: { moj: SCOPE_ROWS.filter(r => r.pdfId === 'moj').length, fsa: SCOPE_ROWS.filter(r => r.pdfId === 'fsa').length },
  byKind: Object.fromEntries(['toc_section', 'organization', 'item', 'request'].map(k => [k, SCOPE_ROWS.filter(r => r.kind === k).length])),
};
const body = { normalizationRule: 'NFKC → 空白除去のみ（実装前に固定。長音符号・括弧・記号の統一はしない）', pdfs: PDFS, summary, scopeSummary, rows: gt, scopeRows: SCOPE_ROWS };
fs.writeFileSync(`${OUT}/visual-gt.json`, `${JSON.stringify(body, null, 2)}\n`);
console.log(JSON.stringify({ summary, scopeSummary }, null, 1));
