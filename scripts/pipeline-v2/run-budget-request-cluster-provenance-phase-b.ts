/**
 * Phase B（Phase A freeze 後のみ）: 61 cluster の C0 frame / manual range との関係の diagnostic。C0 は comparator であり teacher ではない。
 * protocol: docs/tasks/20261005_1640_Budget_Request_Level_Frame_Cluster_Provenance_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-cluster-provenance-phase-b.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { classifyRelations, decideProvenance, patternsOf, type Relation } from './lib/budget-request-cluster-provenance-relation';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { assignToFrame } from './lib/budget-request-level-frame-counterfactual';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const A = `${FX}/budget-request-level-frame-cluster-provenance/2024`;
const SRC = `${FX}/budget-request-source-range-hierarchy/2024`, SR = `${FX}/budget-request-hierarchy-stack-reset/2024`, LF = `${FX}/budget-request-hierarchy-level-frame/2024`;
const FROZEN: Record<string, string> = {
  [`${A}/phaseA-cluster-inventory.json`]: '2bb3e5929fcb9539b78018f740c112222956fd70a776796322e5900d46b672e5', [`${A}/phaseA-support-nodes.jsonl.gz`]: 'fef26771118722adf35d9f367b4bdab03c0897c8f5f8efeecb9fdc3b4ee34b6e',
  [`${SRC}/range-manifest.json`]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e', [`${SRC}/phaseA-evaluation.json`]: '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6',
  [`${SR}/evaluation.json`]: 'e31d2cadecd30ef401b5fc2a77f2b930c1eacd38c7bb15a35f6988a87a0d0128', [`${SR}/causal-rows.json.gz`]: 'e19d0098d7995ecfc618c20fe99476d482f41e0b91aff54912d1c053b5f390c9',
  [`${LF}/evaluation.json`]: 'cb3c75bf9bb2dc2ffef9cff7adbd899d3020b68eb8ab42a6ee21a0a68186641a', [`${LF}/component-rows.json.gz`]: '66c0584bf55a0526d4d9c7791accb3fc281c49387f714ae3436c3ac62e11b239',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d', 'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts': 'd2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5',
  'docs/tasks/20261005_1640_Budget_Request_Level_Frame_Cluster_Provenance_Protocol.md': '34de591474815cded7214907ee23b68796a7a5bccee8e4d29473ea94e5a8c5a2',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const gunzipJson = <T>(f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')) as T;

interface Support { pdf: string; clusterId: number; nodeId: string; page: number; logicalRowIndex: number; keyTokenXMin: number; lexicalClass: string; rowShape: string; layout: { rangeId: string } }
interface ClusterInv { pdf: string; clusterId: number; level: number | null; xMin: number; xMax: number; support: { count: number }; pages: { runs: { start: number; end: number; supportCount: number }[] }; layoutRangeIds: string[]; lexicalComposition: Record<string, { count: number }> }
type Region = 'before_manual' | 'inside_manual' | 'after_manual';

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const inv = readJson<{ gates: Record<string, boolean>; clusters: ClusterInv[] }>(`${A}/phaseA-cluster-inventory.json`);
  const phaseAGatesPass = Object.values(inv.gates).every(Boolean) && inv.clusters.length === 61;
  const supports = zlib.gunzipSync(fs.readFileSync(`${A}/phaseA-support-nodes.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as Support);
  const manifest = readJson<{ pdfs: { localPath: string; relation: string; manual: [number, number] }[] }>(`${SRC}/range-manifest.json`).pdfs.filter(m => m.relation !== 'exact_same');
  const frozenCtrl = new Map(readJson<{ pdfs: { localPath: string; stateComparison: { controlClusters: unknown[] } }[] }>(`${SRC}/phaseA-evaluation.json`).pdfs.map(p => [p.localPath, p.stateComparison.controlClusters]));
  const sr = readJson<{ pdfs: { localPath: string; resetEvents: { beforeNodeId: string }[] }[] }>(`${SR}/evaluation.json`);
  const lf = readJson<{ pdfs: { localPath: string; manualStart: Record<string, { clusterIndex: number | null; level: number | null } | unknown> }[] }>(`${LF}/evaluation.json`);
  const causal = gunzipJson<[string, string, string, string][]>(`${SR}/causal-rows.json.gz`);

  const keyOf = (pdf: string, c: number) => `${pdf}|${c}`;
  const perPdfOut: unknown[] = [], clusterOut: unknown[] = [], gateFails: string[] = [];
  const relation = new Map<string, Relation>(), target = new Map<string, string>(), regionsOf = new Map<string, Set<string>>(), layoutsOf = new Map<string, Set<string>>(), runsOf = new Map<string, { start: number; end: number }[]>();
  const relationCounts: Record<string, number> = {};
  const nodeInfo = new Map<string, { pdf: string; t2Cluster: number; t2Level: number | null; c0Cluster: number | null; c0Level: number | null; region: Region; layoutRangeId: string; x: number; page: number; row: number }>();
  const splitMatrix: unknown[] = [], rankShift: Record<string, unknown> = {}, unassignedOut: Record<string, unknown> = {};
  let b6 = 0, unassignedTotal = 0, unassignedPrimary = 0;

  for (const m of manifest) {
    const name = m.localPath.split('/').pop()!;
    // C0 frame: manual range の page から既存規則で生成（frozen controlClusters と照合）
    const pages: Parameters<typeof observeDocumentHierarchyV2>[1] = [];
    for (let n = m.manual[0]; n <= m.manual[1]; n++) {
      const ex = await extractPageTokens(m.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    const frame = observeDocumentHierarchyV2('detail', pages, HIERARCHY_B_ONLY_OPTIONS).indentClusters;
    const frameOk = JSON.stringify(sortDeep(frame.map(k => ({ xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, level: k.level })))) === JSON.stringify(sortDeep(frozenCtrl.get(m.localPath)));
    if (!frameOk) gateFails.push(`${name}:C0_frame_identity`);
    const regionOf = (page: number): Region => (page < m.manual[0] ? 'before_manual' : page > m.manual[1] ? 'after_manual' : 'inside_manual');
    const sup = supports.filter(s => s.pdf === name);
    const cl = inv.clusters.filter(c => c.pdf === name);
    const t2Level = new Map(cl.map(c => [c.clusterId, c.level]));
    const assigned = new Map<number, (number | null)[]>();
    for (const s of sup) {
      const a = assignToFrame(s.keyTokenXMin, frame);
      if (!assigned.has(s.clusterId)) assigned.set(s.clusterId, []);
      assigned.get(s.clusterId)!.push(a ? a.clusterIndex : null);
      nodeInfo.set(s.nodeId + '|' + name, { pdf: name, t2Cluster: s.clusterId, t2Level: t2Level.get(s.clusterId) ?? null, c0Cluster: a ? a.clusterIndex : null, c0Level: a ? a.level : null, region: regionOf(s.page), layoutRangeId: s.layout.rangeId, x: s.keyTokenXMin, page: s.page, row: s.logicalRowIndex });
    }
    const rel = classifyRelations(cl.map(c => ({ id: c.clusterId, assigned: assigned.get(c.clusterId) ?? [] })));
    const c0Targets = new Map<number, number[]>();
    for (const c of cl) {
      const k = keyOf(name, c.clusterId), r = rel.relation.get(c.clusterId)!;
      relation.set(k, r); inc(relationCounts, `${name}|${r}`); if (r === 'B6_unclassifiable') b6++;
      if (rel.target.has(c.clusterId)) { target.set(k, keyOf(name, rel.target.get(c.clusterId)!)); if (!c0Targets.has(rel.target.get(c.clusterId)!)) c0Targets.set(rel.target.get(c.clusterId)!, []); c0Targets.get(rel.target.get(c.clusterId)!)!.push(c.clusterId); }
      const mine = sup.filter(s => s.clusterId === c.clusterId);
      const reg: Record<Region, { count: number; pages: number; layouts: number }> = { before_manual: { count: 0, pages: 0, layouts: 0 }, inside_manual: { count: 0, pages: 0, layouts: 0 }, after_manual: { count: 0, pages: 0, layouts: 0 } };
      for (const rg of Object.keys(reg) as Region[]) { const ss = mine.filter(s => regionOf(s.page) === rg); reg[rg] = { count: ss.length, pages: new Set(ss.map(s => s.page)).size, layouts: new Set(ss.map(s => s.layout.rangeId)).size }; }
      regionsOf.set(k, new Set(mine.map(s => regionOf(s.page)))); layoutsOf.set(k, new Set(c.layoutRangeIds)); runsOf.set(k, c.pages.runs.map(x => ({ start: x.start, end: x.end })));
      const a = assigned.get(c.clusterId) ?? [];
      clusterOut.push({ pdf: name, clusterId: c.clusterId, t2Level: c.level, relation: r, c0Targets: [...new Set(a.filter((x): x is number => x !== null))].sort((x, y) => x - y), c0AssignedCount: a.filter(x => x !== null).length, c0UnassignedCount: a.filter(x => x === null).length, manualRegion: reg });
    }
    for (const [c0, ids] of [...c0Targets.entries()].sort((a, b) => a[0] - b[0])) if (ids.length >= 2) splitMatrix.push({ pdf: name, c0Cluster: c0, c0Level: frame[c0].level, c0X: [frame[c0].xMin, frame[c0].xMax], t2Clusters: ids.map(id => { const c = cl.find(x => x.clusterId === id)!; const mine = sup.filter(s => s.clusterId === id); return { clusterId: id, level: c.level, xMin: c.xMin, xMax: c.xMax, support: c.support.count, runs: c.pages.runs, layoutRanges: c.layoutRangeIds, regionCounts: { before: mine.filter(s => regionOf(s.page) === 'before_manual').length, inside: mine.filter(s => regionOf(s.page) === 'inside_manual').length, after: mine.filter(s => regionOf(s.page) === 'after_manual').length } }; }) });
    // rank shift（manual 範囲内の node）
    const delta: Record<string, number> = {}, matrix: Record<string, number> = {};
    for (const s of sup) { if (regionOf(s.page) !== 'inside_manual') continue; const i = nodeInfo.get(s.nodeId + '|' + name)!; inc(matrix, `T2c${i.t2Cluster}(L${i.t2Level})->C0c${i.c0Cluster}(L${i.c0Level})`); if (i.t2Level !== null && i.c0Level !== null) inc(delta, String(i.t2Level - i.c0Level)); }
    rankShift[name] = { levelDeltaT2MinusC0: delta, t2ToC0Matrix: matrix };
    // frame-unassigned（eligible node 全体）
    const un = sup.filter(s => nodeInfo.get(s.nodeId + '|' + name)!.c0Cluster === null);
    unassignedTotal += un.length; unassignedPrimary += un.filter(s => regionOf(s.page) === 'inside_manual').length;
    const byC: Record<string, { count: number; pages: number[]; layouts: string[]; regions: Record<string, number>; lexical: Record<string, number> }> = {};
    for (const s of un) { const g = (byC[String(s.clusterId)] ??= { count: 0, pages: [], layouts: [], regions: {}, lexical: {} }); g.count++; g.pages.push(s.page); g.layouts.push(s.layout.rangeId); inc(g.regions, regionOf(s.page)); inc(g.lexical, s.lexicalClass); }
    unassignedOut[name] = { total: un.length, byT2Cluster: Object.fromEntries(Object.entries(byC).map(([k, g]) => [k, { count: g.count, uniquePages: new Set(g.pages).size, layouts: [...new Set(g.layouts)].sort(cmp), regions: g.regions, lexical: g.lexical }])) };
    perPdfOut.push({ pdf: name, manual: m.manual, c0ClusterCount: frame.length, t2ClusterCount: cl.length, c0FrameMatchesFrozen: frameOk, c0Frame: frame.map(k => ({ id: k.clusterIndex, level: k.level, xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount })) });
    console.log(`${name} c0=${frame.length} t2=${cl.length} unassigned=${un.length} frameOk=${frameOk}`);
  }

  // prior-change 536 join
  const prior = causal.filter(r => r[2] !== 'S0');
  const joined: unknown[] = [], bySubset: Record<string, { rows: number; relations: Record<string, number>; t2Clusters: Record<string, number>; regions: Record<string, number> }> = {};
  let missing = 0;
  for (const [pdf, key, s, cls] of prior) {
    const [pg, rw] = key.split(':'), i = nodeInfo.get(`detail-p${pg}-r${rw}|${pdf}`);
    if (!i) { missing++; continue; }
    const r = relation.get(keyOf(pdf, i.t2Cluster))!;
    joined.push([pdf, key, cls, s, i.t2Cluster, i.t2Level, i.c0Cluster, i.c0Level, r, i.region, i.layoutRangeId]);
    const g = (bySubset[cls] ??= { rows: 0, relations: {}, t2Clusters: {}, regions: {} });
    g.rows++; inc(g.relations, r); inc(g.t2Clusters, `${pdf}|c${i.t2Cluster}`); inc(g.regions, i.region);
  }
  // manual-start 2 node
  const manualStart = sr.pdfs.filter(p => p.resetEvents.length === 1).map(p => {
    const name = p.localPath.split('/').pop()!, id = p.resetEvents[0].beforeNodeId, i = nodeInfo.get(`${id}|${name}`);
    const lfp = lf.pdfs.find(q => q.localPath === p.localPath)!.manualStart as Record<string, { clusterIndex: number | null; level: number | null }>;
    if (!i) return { pdf: name, nodeId: id, joined: false };
    const cin = clusterOut.find(c => (c as { pdf: string; clusterId: number }).pdf === name && (c as { clusterId: number }).clusterId === i.t2Cluster) as { relation: string; manualRegion: unknown };
    const comp = inv.clusters.find(c => c.pdf === name && c.clusterId === i.t2Cluster)!;
    return { pdf: name, nodeId: id, joined: true, x: i.x, t2: { cluster: i.t2Cluster, level: i.t2Level }, c0: { cluster: i.c0Cluster, level: i.c0Level }, frozenObservationReproduced: lfp.t2.clusterIndex === i.t2Cluster && lfp.t2.level === i.t2Level && lfp.t3.clusterIndex === i.c0Cluster && lfp.t3.level === i.c0Level, relation: cin.relation, manualRegion: cin.manualRegion, clusterSupportCount: comp.support.count, lexicalComposition: comp.lexicalComposition, layoutRanges: comp.layoutRangeIds, pageRuns: comp.pages.runs.length };
  });
  const patterns = patternsOf({ relation, target, regions: regionsOf, layoutRanges: layoutsOf, runs: runsOf, pdfOf: k => k.split('|')[0] });
  const known = { unassigned1214: unassignedTotal === 1214 && JSON.stringify(Object.values(unassignedOut).map(u => (u as { total: number }).total)) === JSON.stringify([649, 565]), unassignedPrimary0: unassignedPrimary === 0, prior536: prior.length === 536 && joined.length === 536, subsets490_37_9: bySubset.level_changed?.rows === 490 && bySubset.newly_unclassified?.rows === 37 && bySubset.parent_changed?.rows === 9, manualStart2: manualStart.length === 2 && manualStart.every(x => x.joined && (x as { frozenObservationReproduced?: boolean }).frozenObservationReproduced), relations61: relation.size === 61 };
  const joinComplete = missing === 0 && Object.values(known).every(Boolean);
  const gatesPass = phaseAGatesPass && gateFails.length === 0;
  const decision = decideProvenance({ gatesPass, b6, joinComplete, patterns });
  // representative（PDF, cluster id, node id の辞書順先頭）
  const rep = (xs: string[]) => [...xs].sort(cmp)[0] ?? null;
  const reps = { byRelation: Object.fromEntries((['B1_one_to_one', 'B2_split_member', 'B3_crosses_c0_clusters', 'B4_c0_unassigned_only', 'B5_mixed_assigned_unassigned', 'B6_unclassifiable'] as Relation[]).map(r => [r, rep(clusterOut.filter(c => (c as { relation: string }).relation === r).map(c => `${(c as { pdf: string }).pdf}|${String((c as { clusterId: number }).clusterId).padStart(3, '0')}`))])), priorSubset: Object.fromEntries(Object.keys(bySubset).map(k => [k, rep(joined.filter(j => (j as string[])[2] === k).map(j => `${(j as string[])[0]}|${(j as string[])[1]}`))])) };
  const joinedGz = zlib.gzipSync(Buffer.from(JSON.stringify(joined), 'utf8'), { level: 9 });
  fs.writeFileSync(`${A}/phaseB-prior-change-join.json.gz`, joinedGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-level-frame-cluster-provenance-phaseB/v0',
    note: 'C0 / manual range は comparator であり teacher ではない。relation は C0 の正しさ・cluster の良否を意味しない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), priorChangeJoinGzSha256: sha(joinedGz), phaseAGatesPass, gateFailures: gateFails,
    perPdf: perPdfOut, relationCounts, clusters: clusterOut, splitMatrix, rankShift, priorChange: { total: prior.length, joined: joined.length, missing, bySubset, joinColumns: ['pdf', 'key', 'priorChangeClass', 'causalClass', 't2Cluster', 't2Level', 'c0Cluster', 'c0Level', 'relation', 'manualRegion', 'layoutRangeId'] },
    manualStart, frameUnassigned: { total: unassignedTotal, primaryIntersection: unassignedPrimary, byPdf: unassignedOut }, patterns, knownValueReproduction: known, b6, representatives: reps, decision,
  }), null, 1)}\n`;
  fs.writeFileSync(`${A}/phaseB-diagnostic.json`, text);
  console.log(JSON.stringify({ sha: sha(text), relationCounts, patterns, known, b6, missing, gateFails, decision }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
