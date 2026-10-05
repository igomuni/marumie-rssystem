/**
 * Phase B（Phase A freeze 後のみ）: downstream outcome との relation と secondary comparison（diagnostic。Phase A の feature・separator は変更しない）。
 * protocol: docs/tasks/20261005_1815_Budget_Request_Header_Support_Provenance_Isolation_Protocol.md
 * 使い方: node --import tsx scripts/pipeline-v2/run-budget-request-header-support-phase-b.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { compareFeature } from './lib/budget-request-header-support-features';

const FX = 'tests/fixtures';
const A = `${FX}/budget-request-header-support-provenance/2024`, TE = `${FX}/budget-request-level-frame-table-eligibility/2024`, PA = `${FX}/budget-request-source-range-hierarchy/2024`;
const FROZEN: Record<string, string> = {
  [`${TE}/phaseB-diagnostic.json`]: 'e93fc23adac0b77c2ec83ee8d933576defe94ce47e9f597621fa89377d7b73ca', [`${PA}/range-manifest.json`]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e',
  'docs/tasks/20261005_1815_Budget_Request_Header_Support_Provenance_Isolation_Protocol.md': '9e0da7875ba722463eec2050235a37fe5a397dc2aa42bee6a929b0022466487a',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
type Pop = 'P1' | 'P2' | 'P3' | 'P4';
interface Node { population: Pop; pdf: string; nodeId: string; page: number; logicalRowIndex: number; t2ClusterIndex: number; features: Record<string, [unknown, string | null, string | null]> }

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${A}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact が freeze と不一致（STOP）: ${p}`);
  const pa = readJson<{ gates: Record<string, boolean>; decision: unknown; featureCatalog: { name: string; family: string; circular: boolean; kind: 'categorical' | 'binned' | 'descriptive' }[]; completeSeparators: string[]; strongPartialSeparators: string[] }>(`${A}/phaseA-primary-comparison.json`);
  const nodes = zlib.gunzipSync(fs.readFileSync(`${A}/phaseA-node-features.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as Node);
  const by = (p: Pop) => nodes.filter(n => n.population === p);
  const samples = (ns: Node[], f: string) => ns.map(n => ({ pdf: n.pdf, label: n.features[f]?.[1] ?? null }));
  const secondary = (a: Pop, b: Pop) => {
    const rows = pa.featureCatalog.map(c => compareFeature(c, samples(by(a), c.name), samples(by(b), c.name)));
    return { populations: [a, b], sizes: [by(a).length, by(b).length], completeSeparators: rows.filter(r => r.complete).map(r => r.name), strongPartialSeparators: rows.filter(r => r.strongPartial).map(r => r.name), topTvd: rows.filter(r => r.eligibleForSeparator && r.tvd !== null).sort((x, y) => (y.tvd as number) - (x.tvd as number) || cmp(x.name, y.name)).slice(0, 8).map(r => ({ name: r.name, tvd: r.tvd, availability: [r.availabilityP1, r.availabilityP2] })) };
  };
  // confound diagnostic: complete separator の値が PDF を一意に決めるか（document scale / PDF identity の代理になっていないか）
  const confound = pa.completeSeparators.map(f => {
    const pdfsOfValue = new Map<string, Set<string>>();
    for (const n of [...by('P1'), ...by('P2')]) { const v = n.features[f]?.[1]; if (v !== null && v !== undefined) { if (!pdfsOfValue.has(v)) pdfsOfValue.set(v, new Set()); pdfsOfValue.get(v)!.add(n.pdf); } }
    const vals = [...pdfsOfValue.entries()].sort((a, b) => cmp(a[0], b[0]));
    return { feature: f, distinctValues: vals.length, valuesOccurringInOnePdfOnly: vals.filter(([, s]) => s.size === 1).length, valueToPdfs: Object.fromEntries(vals.map(([k, s]) => [k, [...s].sort()])) };
  });
  // downstream relation
  const te = readJson<{ sameRangeControl: { rows: number; changedRows: number; detail: { pdf: string; key: string; nodeRelation: { relation: string } | null; t4Unassigned: boolean }[] }; primaryComponentTransitions: unknown; primaryRowTuples: Record<string, number>; manualStart: { pdf: string; t2: { id: string } }[] }>(`${TE}/phaseB-diagnostic.json`);
  const changed = new Map(te.sameRangeControl.detail.map(d => [`${d.pdf}|${d.key}`, d]));
  const p2 = by('P2');
  const p2Rel = { total: p2.length, inChangedRows: 0, inUnplacedRows: 0, notInChangedRows: 0 };
  for (const n of p2) { const d = changed.get(`${n.pdf}|${n.page}:${n.logicalRowIndex}`); if (d) { p2Rel.inChangedRows++; if (d.t4Unassigned) p2Rel.inUnplacedRows++; } else p2Rel.notInChangedRows++; }
  const p3 = by('P3'), p3Rel = { total: p3.length, inChangedRows: p3.filter(n => changed.has(`${n.pdf}|${n.page}:${n.logicalRowIndex}`)).length };
  const manual = new Map(readJson<{ pdfs: { localPath: string; manual: [number, number] }[] }>(`${PA}/range-manifest.json`).pdfs.map(p => [p.localPath.split('/').pop()!, p.manual]));
  const region = (pdf: string, page: number) => { const m = manual.get(pdf)!; return page < m[0] ? 'before_manual' : page > m[1] ? 'after_manual' : 'inside_manual'; };
  const p1Region: Record<string, Record<string, number>> = {};
  for (const n of by('P1')) { const r = region(n.pdf, n.page); (p1Region[n.pdf] ??= {}); p1Region[n.pdf][r] = (p1Region[n.pdf][r] ?? 0) + 1; }
  const startIds = new Set(te.manualStart.map(m => `${m.pdf}|${m.t2.id}`));
  const p1ContainsManualStart = by('P1').filter(n => startIds.has(`${n.pdf}|${n.nodeId}`)).length;
  // representative（population × clusterExtent ごとに stable node id の辞書順先頭 2 件）
  const rep: Record<string, string[]> = {};
  for (const p of ['P1', 'P2', 'P3', 'P4'] as Pop[]) for (const cls of [...new Set(by(p).map(n => n.features.clusterExtent?.[1] ?? 'none'))].sort()) rep[`${p}|${cls}`] = by(p).filter(n => (n.features.clusterExtent?.[1] ?? 'none') === cls).map(n => `${n.pdf}|${n.nodeId}`).sort().slice(0, 2);
  const result = sortDeep({
    schema: 'budget-request-header-support-provenance-phaseB/v0',
    note: 'diagnostic のみ。Phase A の feature・separator・decision は変更しない。manual 前 / 後は rule にしない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), phaseAFreeze: freeze.artifacts, phaseAGatesPass: Object.values(pa.gates).every(Boolean), phaseADecision: pa.decision,
    confoundDiagnosticForCompleteSeparators: confound,
    p2SameRangeRelation: { sameRangeRows: te.sameRangeControl.rows, sameRangeChangedRows: te.sameRangeControl.changedRows, p2: p2Rel, p3: p3Rel },
    p1PrimaryRelation: { p1ByPdfAndManualRegion: p1Region, p1ContainsManualStartNode: p1ContainsManualStart, primaryRowTuples: te.primaryRowTuples, note: 'primary の 462 / 55 / 64 は manual range 内の row。P1 の page 位置との関係は上記の region 分布のみ（row 単位の帰属は frozen artifact に無い）' },
    secondary: { P2_vs_P3: secondary('P2', 'P3'), P1_vs_P4: secondary('P1', 'P4') }, representatives: rep,
  });
  const text = `${JSON.stringify(result, null, 1)}\n`;
  fs.writeFileSync(`${A}/phaseB-diagnostic.json`, text);
  console.log(text.slice(0, 6000));
}
main();
