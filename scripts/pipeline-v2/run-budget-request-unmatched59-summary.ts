/**
 * frozen の行別 inventory の集計と次研究の routing（Route A→B→C→D の優先順で 1 つだけ）。class 定義は変更しない。
 * protocol: docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';

const OUT = 'tests/fixtures/budget-request-unmatched-59/2024';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sortDeep(x)])) : v);
const FROZEN: Record<string, string> = {
  [`${OUT}/baseline.json`]: '7f7e219245849b4dcec9a7352dfdda70eeb09f0f404047d18f5a979ff1e24bb4',
  [`${OUT}/unmatched-59-inventory.jsonl.gz`]: sha(fs.readFileSync(`${OUT}/unmatched-59-inventory.jsonl.gz`)),
};
interface Row { mofRowId: string; mofCode: string; mofNameRaw: string; mofMinistry: string; mofOrganization: string; sourceAssignmentStatus: string; sourcePdfPath: string | null; sourcePage: number | null; pdfRepresentationClass: string; sourceFullNameStatus: string; currentCandidateStatus: string; failureClass: string; failureDetail: string; recoverabilityClass: string; authorityLevelBlockerPdfs?: string[]; authorityPdfPaths: string[]; nearTextEvidence: unknown[]; exactHitCountAllPdfs: number }
const rows = zlib.gunzipSync(fs.readFileSync(`${OUT}/unmatched-59-inventory.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as Row);
const baseline = JSON.parse(fs.readFileSync(`${OUT}/baseline.json`, 'utf8')) as { mofTotal: number; exactCovered: number; unmatched: number };
if (rows.length !== 59 || new Set(rows.map(r => r.mofRowId)).size !== 59 || baseline.unmatched !== 59) throw new Error('inventory が不一致（STOP）');
const by = (f: (r: Row) => string) => { const m: Record<string, number> = {}; for (const r of rows) m[f(r)] = (m[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))); };
const list = (pred: (r: Row) => boolean) => rows.filter(pred).map(r => ({ mofRowId: r.mofRowId, ministry: r.mofMinistry, organization: r.mofOrganization, code: r.mofCode, name: r.mofNameRaw, failureDetail: r.failureDetail }));
const rec = (c: string) => rows.filter(r => r.recoverabilityClass === c).length;
const f1Pdfs: Record<string, number> = {}; for (const r of rows.filter(x => x.failureClass === 'F1')) for (const p of r.authorityLevelBlockerPdfs ?? []) f1Pdfs[p] = (f1Pdfs[p] ?? 0) + 1;
const counts = { F0: 0, F1: 0, F2: 0, F3: 0, F4: 0, F5: 0, F6: 0, F7: 0 } as Record<string, number>; for (const r of rows) counts[r.failureClass]++;
const unresolvedRows = rows.filter(r => r.failureClass === 'F0' || r.failureClass === 'F6' || r.sourceAssignmentStatus === 'SOURCE_ASSIGNMENT_UNRESOLVED');
const route = counts.F3 >= 1 ? 'A' : counts.F4 >= 1 ? 'B' : counts.F1 > unresolvedRows.length ? 'C' : 'D';
const body = {
  schema: 'budget-request-unmatched59-summary/v0', note: 'frozen 行別 inventory の集計。数値は実測。class 定義は変更していない。F1 の assignment は所管レベルのみ（item レベルの assignment ではない）',
  frozen: Object.fromEntries(Object.entries(FROZEN).map(([p, h]) => [p, h])),
  mofTotal: baseline.mofTotal, exactCovered: baseline.exactCovered, unmatched: baseline.unmatched,
  byMinistry: by(r => r.mofMinistry), byOrganization: by(r => `${r.mofMinistry}/${r.mofOrganization}`), bySourceAssignmentStatus: by(r => r.sourceAssignmentStatus), byRepresentationClass: by(r => r.pdfRepresentationClass), bySourceFullNameStatus: by(r => r.sourceFullNameStatus), byCurrentCandidateStatus: by(r => r.currentCandidateStatus), byFailureClass: by(r => r.failureClass), byRecoverabilityClass: by(r => r.recoverabilityClass),
  recoverableWithCurrentTextGeometry: rec('RECOVERABLE_WITH_CURRENT_TEXT_GEOMETRY'), requiresNewRepresentationSupport: rec('REQUIRES_NEW_REPRESENTATION_SUPPORT'), notCurrentlyRecoverableFromSource: rec('NOT_CURRENTLY_RECOVERABLE_FROM_SOURCE'), unresolved: rec('UNRESOLVED'),
  f3: list(r => r.failureClass === 'F3'), f4: list(r => r.failureClass === 'F4'), f1RepresentationBlocker: { itemsByAuthorityLevelPdf: f1Pdfs, itemLevelAssignedCount: rows.filter(r => r.failureClass === 'F1' && r.sourcePdfPath !== null).length }, f2SourceFullNameAbsent: list(r => r.failureClass === 'F2'), f7: list(r => r.failureClass === 'F7'), unresolvedRows: list(r => r.failureClass === 'F0' || r.failureClass === 'F6' || r.sourceAssignmentStatus === 'SOURCE_ASSIGNMENT_UNRESOLVED'),
  sourcePdfsReferenced: [...new Set(rows.flatMap(r => [...(r.sourcePdfPath ? [r.sourcePdfPath] : []), ...(r.authorityLevelBlockerPdfs ?? [])]))].sort(),
  routing: { route, rule: 'A: F3>=1 → B: F4>=1 → C: F1 > unresolved(F0/F6/assignment unresolved) → D（優先順で 1 つ）', counts: { F3: counts.F3, F4: counts.F4, F1: counts.F1, unresolved: unresolvedRows.length } },
};
const summary = sortDeep(body) as typeof body;
const text = `${JSON.stringify(summary, null, 1)}\n`;
fs.writeFileSync(`${OUT}/unmatched-59-summary.json`, text);
console.log(JSON.stringify({ sha: sha(text), byFailureClass: summary.byFailureClass, byRecoverabilityClass: summary.byRecoverabilityClass, routing: summary.routing }, null, 1));
