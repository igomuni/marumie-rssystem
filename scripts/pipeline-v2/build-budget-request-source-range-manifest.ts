/**
 * manual activation range と source-derived detail-table range の manifest（事前登録 Source_Range_Hierarchy_Paired_Protocol）。新しい range detector は作らない。
 * manual = A2_EXPERIMENTS の契約範囲（hierarchyContractFor）、source-derived = frozen layout inventory の layout range のうち契約開始 page を含み、header 成分を持つ（detail-table）もの。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-source-range-manifest.ts
 * 出力: tests/fixtures/budget-request-source-range-hierarchy/2024/range-manifest.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-source-range-hierarchy', '2024', 'range-manifest.json');
const LAYOUT = `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, PAIRED = `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`;
const FROZEN: Record<string, string> = { [LAYOUT]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [PAIRED]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1' };
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
for (const [p, h] of Object.entries(FROZEN)) if (sha(fs.readFileSync(p)) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
const layout = new Map((JSON.parse(fs.readFileSync(LAYOUT, 'utf8')) as { perPdf: { localPath: string; totalPages: number; ranges: { from: number; to: number; signature: string }[] }[] }).perPdf.map(p => [p.localPath, p]));
const docs = (JSON.parse(fs.readFileSync(PAIRED, 'utf8')) as { documents: { localPath: string; canonicalUrl: string; class: string; publisherAuthority: string; accountType?: string }[] }).documents.filter(d => d.class === 'paired_evaluable');
const relationOf = (m: [number, number], s: [number, number]) => (m[0] === s[0] && m[1] === s[1] ? 'exact_same' : s[0] <= m[0] && s[1] >= m[1] ? 'source_superset' : s[0] >= m[0] && s[1] <= m[1] ? 'source_subset' : 'overlap_other');
const rows = docs.map(d => {
  const manual = hierarchyContractFor(d.canonicalUrl)!.pages as [number, number];
  const l = layout.get(d.localPath)!;
  const r = l.ranges.find(x => manual[0] >= x.from && manual[0] <= x.to);
  if (!r || !r.signature.startsWith('H:') || r.signature.startsWith('H:-|')) throw new Error(`契約開始 page を含む detail-table range が無い（STOP）: ${d.localPath}`);
  const source: [number, number] = [r.from, r.to];
  const pagesBy: Record<string, number> = { intersection: 0, manual_only: 0, source_only: 0, outside_both: 0 };
  for (let p = 1; p <= l.totalPages; p++) { const m = p >= manual[0] && p <= manual[1], s = p >= source[0] && p <= source[1]; pagesBy[m && s ? 'intersection' : m ? 'manual_only' : s ? 'source_only' : 'outside_both']++; }
  return { localPath: d.localPath, publisherAuthority: d.publisherAuthority, totalPages: l.totalPages, manual, sourceDerived: source, sourceSignature: r.signature, relation: relationOf(manual, source), pagesByRegion: pagesBy };
}).sort((a, b) => (a.localPath < b.localPath ? -1 : 1));
const text = `${JSON.stringify({ schema: 'budget-request-source-range-manifest/v0', note: 'manual は既存の手書き契約、source-derived は frozen layout inventory の detail-table range。新しい range detector・MOF・header label は不使用', frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, sha(fs.readFileSync(p))])) }, relationCounts: rows.reduce<Record<string, number>>((m, r) => { m[r.relation] = (m[r.relation] ?? 0) + 1; return m; }, {}), pdfs: rows }, null, 1)}\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(JSON.stringify({ sha: sha(text), relationCounts: JSON.parse(text).relationCounts, rows: rows.map(r => [r.localPath.split('/').pop(), r.manual, r.sourceDerived, r.relation, r.pagesByRegion]) }, null, 1));
