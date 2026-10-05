/**
 * Phase B（Phase A freeze 後の post-freeze 診断）。MOF は教師・range 選択に使わない。名称単独 exact（P1 と同じ normalizeKey）。
 * 対象は mext / mhlw のみ。一般会計の絞り込みは row table に account が無いため行わない（全 MOF section / jikou に対する診断）。
 * 使い方: node --import tsx scripts/pipeline-v2/evaluate-budget-request-source-range-hierarchy-mof-diagnostic.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { classifyChange, type RowRec } from './lib/budget-request-source-range-compare';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const OUT = 'tests/fixtures/budget-request-source-range-hierarchy/2024';
const WORK = 'data/work/budget-request-source-range-hierarchy/2024';
const PHASE_A_SHA = fs.existsSync(`${OUT}/phaseA-evaluation.json`) ? crypto.createHash('sha256').update(fs.readFileSync(`${OUT}/phaseA-evaluation.json`)).digest('hex') : '';
if (PHASE_A_SHA !== '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6') throw new Error('Phase A の artifact が freeze 値と一致しない（STOP）');
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const jikouSha = crypto.createHash('sha256').update(fs.readFileSync(JIKOU)).digest('hex');
if (jikouSha !== (JSON.parse(fs.readFileSync('tests/fixtures/mof-jikou-normalized/2024/202411001-integration-evaluation.json', 'utf8')) as { output: { sha256: string } }).output.sha256) throw new Error('budget-jikou.jsonl が記録と一致しない（STOP）');

const sectionsByName = new Map<string, Set<string>>(), jikouBySection = new Map<string, Set<string>>();
for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) {
  const k = normalizeKey(j.sectionName);
  if (!sectionsByName.has(k)) sectionsByName.set(k, new Set());
  sectionsByName.get(k)!.add(j.parentSectionId);
  if (!jikouBySection.has(j.parentSectionId)) jikouBySection.set(j.parentSectionId, new Set());
  jikouBySection.get(j.parentSectionId)!.add(normalizeKey(j.jikouName));
}
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
const read = (dir: string, name: string) => new Map(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(WORK, dir, `${name}.rows.json.gz`))).toString('utf8')) as [string, RowRec][]);
const manifest = (JSON.parse(fs.readFileSync(`${OUT}/range-manifest.json`, 'utf8')) as { pdfs: { localPath: string; manual: [number, number]; sourceDerived: [number, number]; relation: string }[] }).pdfs.filter(m => m.relation !== 'exact_same');
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const itemTally = (rows: RowRec[]) => { const o: Record<string, number> = { rows: rows.length }; for (const r of rows) { if (!r.nameRaw) { inc(o, 'name_unavailable'); continue; } const m = sectionsByName.get(normalizeKey(r.nameRaw)); inc(o, !m ? 'no_exact_match' : m.size === 1 ? 'exact_unique' : 'exact_ambiguous'); } return o; };
const jikouTally = (reqs: RowRec[], table: Map<string, RowRec>) => {
  const o: Record<string, number> = { rows: reqs.length };
  for (const r of reqs) {
    const parent = r.parentItem.ref ? table.get(r.parentItem.ref.replace(/^detail-p(\d+)-r(\d+)$/, '$1:$2')) : undefined;
    if (!r.parentItem.ref || !parent) { inc(o, 'parent_unresolved'); continue; }
    if (!r.nameRaw) { inc(o, 'name_unavailable'); continue; }
    if (!parent.nameRaw) { inc(o, 'parent_name_unavailable'); continue; }
    const secs = sectionsByName.get(normalizeKey(parent.nameRaw));
    if (!secs) { inc(o, 'parent_no_exact_match'); continue; }
    if (secs.size !== 1) { inc(o, 'parent_exact_ambiguous'); continue; }
    inc(o, jikouBySection.get([...secs][0])!.has(normalizeKey(r.nameRaw)) ? 'jikou_exact_unique' : 'jikou_no_exact_match');
  }
  return o;
};
const pdfs = manifest.map(m => {
  const c = read(slugOf(m.localPath), 'control'), t = read(slugOf(m.localPath), 'treatment');
  const inInter = (k: string) => { const p = Number(k.split(':')[0]); return p >= m.manual[0] && p <= m.manual[1]; };
  const changedItemRows: RowRec[] = [], kindTransitions: Record<string, number> = {};
  const srcItems: RowRec[] = [], srcReqs: RowRec[] = [];
  for (const [k, b] of t) {
    const a = c.get(k);
    if (a) { const ch = classifyChange(a, b); if (ch.primary !== 'unchanged' && a.kind !== b.kind) inc(kindTransitions, `${a.kind}->${b.kind}`); if (ch.primary !== 'unchanged' && (a.kind === 'item' || b.kind === 'item')) changedItemRows.push(b); continue; }
    if (inInter(k)) continue;
    if (b.kind === 'item') srcItems.push(b);
    if (b.kind === 'request' && b.parentItem.status === 'resolved') srcReqs.push(b);
  }
  return {
    localPath: m.localPath, intersectionKindTransitions: kindTransitions, intersectionChangedItemRows: itemTally(changedItemRows),
    sourceOnlyItems: itemTally(srcItems), sourceOnlyResolvedRequests: jikouTally(srcReqs, t),
  };
});
const text = `${JSON.stringify({ schema: 'budget-request-source-range-hierarchy-phaseB-mof-diagnostic/v0', note: 'post-freeze 診断。MOF は教師でも range 選択基準でもない。名称単独 exact（組織・勘定の絞り込みなし）。overlap が高くても低くても range の正否は結論しない。optional の item candidate overlap は未実施', frozen: { phaseASha256: PHASE_A_SHA, mofJikouSha256: jikouSha }, pdfs }, null, 1)}\n`;
fs.writeFileSync(`${OUT}/phaseB-mof-diagnostic.json`, text);
console.log(text);
