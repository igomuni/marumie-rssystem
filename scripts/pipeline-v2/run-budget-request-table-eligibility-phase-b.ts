/**
 * Phase B（Phase A freeze 後のみ）: T4（table-frame eligibility による support 限定 frame）と frozen の C0 / T1 / T2 / T3 の比較。
 * protocol: docs/tasks/20261005_1735_Budget_Request_Level_Frame_Table_Eligibility_Counterfactual_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-table-eligibility-phase-b.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { observeDocumentHierarchyV2, type DocumentHierarchyV2Result, type IndentClusterV2 } from './lib/budget-request-document-hierarchy-v2';
import { resolveFields, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { assignToFrame, replayStackAtNode, transitionClass, type TransitionClass } from './lib/budget-request-level-frame-counterfactual';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { classifyChange, type NodeInfo, type RowRec } from './lib/budget-request-source-range-compare';
import { replayStack } from './lib/budget-request-stack-reset-counterfactual';
import { decideTableEligibility, supportEffect, t2ParentOf } from './lib/budget-request-table-eligibility-frame';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface RangeRow { localPath: string; manual: [number, number]; sourceDerived: [number, number]; relation: string }
type Table = Map<string, RowRec>;
function rowTableOf(result: { records: ReturnType<typeof resolveFields>['records'] }, h: DocumentHierarchyV2Result): Table {
  const nodeByRow = new Map(h.nodes.map(n => [`${n.sourcePage}:${n.sourceRowRefs.logicalRowIndex}`, n]));
  const edgeByChild = new Map(h.edges.map(e => [e.childNodeId, e]));
  const out: Table = new Map();
  for (const r of result.records) {
    const key = `${r.anchor.page}:${r.anchor.logicalRowIndex}`;
    const n = nodeByRow.get(key), e = n ? edgeByChild.get(n.id) : undefined;
    const cl = n && n.xIndentEvidence.clusterIndex !== null ? h.indentClusters[n.xIndentEvidence.clusterIndex] : null;
    const val = (f: { status: string; value: unknown }) => ({ status: f.status, ref: f.value && typeof f.value === 'object' && 'parentNodeRef' in (f.value as object) ? (f.value as { parentNodeRef: string }).parentNodeRef : null });
    const node: NodeInfo = { isNode: !!n, level: n?.xIndentEvidence.level ?? null, clusterX: cl ? [cl.xMin, cl.xMax] : null, edgeStatus: e?.status ?? null, parentId: e?.parentNodeId ?? null, root: !!e && e.status === 'unresolved' && !e.parentNodeId };
    out.set(key, {
      kind: r.recordKind, basis: r.recordKindBasis, codeRaw: r.rowLocal.code.value?.raw ?? null, nameStatus: r.rowLocal.name.status, nameReason: r.rowLocal.name.reasonCode, nameRaw: r.rowLocal.name.value?.raw ?? null,
      parentItem: val(r.hierarchyDependent.parentItemAssociation), parentOrg: val(r.hierarchyDependent.parentOrganizationAssociation), node,
      geometry: [r.anchorBBox.xMin, r.anchorBBox.yMin, r.anchorBBox.xMax, r.anchorBBox.yMax], tokenRefs: r.rowLocal.code.evidence?.sourceTokenRefs ?? [],
    });
  }
  return out;
}
const tableDigest = (t: Table) => sha(JSON.stringify([...t.entries()].sort((x, y) => cmp(x[0], y[0]))));
const V = (r: RowRec | undefined) => (r ? JSON.stringify({ kind: r.kind, basis: r.basis, parentItem: r.parentItem, parentOrg: r.parentOrg, node: r.node }) : undefined);
const I = (r: RowRec) => JSON.stringify({ codeRaw: r.codeRaw, nameRaw: r.nameRaw, nameStatus: r.nameStatus, nameReason: r.nameReason, geometry: r.geometry, tokenRefs: r.tokenRefs });



const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-level-frame-table-eligibility/2024`;
const PA = `${FX}/budget-request-source-range-hierarchy/2024`, SR = `${FX}/budget-request-hierarchy-stack-reset/2024`, LF = `${FX}/budget-request-hierarchy-level-frame/2024`, CP = `${FX}/budget-request-level-frame-cluster-provenance/2024`;
const FROZEN: Record<string, string> = {
  [`${PA}/range-manifest.json`]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e', [`${PA}/phaseA-evaluation.json`]: '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6',
  [`${SR}/evaluation.json`]: 'e31d2cadecd30ef401b5fc2a77f2b930c1eacd38c7bb15a35f6988a87a0d0128', [`${SR}/causal-rows.json.gz`]: 'e19d0098d7995ecfc618c20fe99476d482f41e0b91aff54912d1c053b5f390c9',
  [`${LF}/evaluation.json`]: 'cb3c75bf9bb2dc2ffef9cff7adbd899d3020b68eb8ab42a6ee21a0a68186641a',
  [`${CP}/phaseA-cluster-inventory.json`]: '2bb3e5929fcb9539b78018f740c112222956fd70a776796322e5900d46b672e5', [`${CP}/phaseA-support-nodes.jsonl.gz`]: 'fef26771118722adf35d9f367b4bdab03c0897c8f5f8efeecb9fdc3b4ee34b6e', [`${CP}/phaseB-diagnostic.json`]: '60dea6388658118a1aeb6aafd50633f88fd9679467f0cff03e41d13e40b5b3f6',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d', 'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts': 'd2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5', 'scripts/pipeline-v2/lib/budget-request-level-frame-counterfactual.ts': '07912b03fd9bf1353b8e7f3f826f3678b7fa1580f9fa23595047049776e4314e',
  'scripts/pipeline-v2/lib/budget-request-stack-reset-counterfactual.ts': 'b0f940c99ec27a1ca4a185b811f944b8beda093862b0230912a5133999889c61',
  'docs/tasks/20261005_1735_Budget_Request_Level_Frame_Table_Eligibility_Counterfactual_Protocol.md': '20a124f1473873c16acd8132629057a53ce4854b0c6b72dda7ddcfffe3bdbb36',
};
const Lc = (r: RowRec) => JSON.stringify({ isNode: r.node.isNode, level: r.node.level, clusterX: r.node.clusterX });
const Pc = (r: RowRec) => JSON.stringify({ parentItem: r.parentItem, parentOrg: r.parentOrg, edgeStatus: r.node.edgeStatus, parentId: r.node.parentId, root: r.node.root });
const Kc = (r: RowRec) => JSON.stringify({ kind: r.kind, basis: r.basis });
const zero = (): Record<TransitionClass, number> => ({ R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 });
type Region = 'before_manual' | 'inside_manual' | 'after_manual';

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  // Phase A の freeze manifest（Commit C で保存）と artifact の照合
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${OUT}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact が freeze と不一致（STOP）: ${p}`);
  const phaseA = readJson<{ gates: Record<string, boolean>; perPdf: { localPath: string; relation: string; supportEligible: number; excluded: Record<string, number>; relationDistribution: Record<string, number>; t4: { clusterCount: number; frameUnassignedNodes: number; indentClusters: IndentClusterV2[] }; mostLeftCluster37982: unknown }[] }>(`${OUT}/phaseA-t4-frame.json`);
  const phaseAGatesPass = Object.values(phaseA.gates).every(Boolean);
  const nodeRel = new Map<string, { relation: string; supportEligible: boolean }>();
  for (const l of zlib.gunzipSync(fs.readFileSync(`${OUT}/phaseA-node-relations.jsonl.gz`)).toString('utf8').trim().split('\n')) { const o = JSON.parse(l) as { pdf: string; nodeId: string; relation: string; supportEligible: boolean }; nodeRel.set(`${o.pdf}|${o.nodeId}`, { relation: o.relation, supportEligible: o.supportEligible }); }
  const manifest = readJson<{ pdfs: RangeRow[] }>(`${PA}/range-manifest.json`).pdfs;
  const pa = readJson<{ pdfs: { localPath: string; rowTableDigests: { control: string; treatment: string } }[] }>(`${PA}/phaseA-evaluation.json`);
  const paOf = new Map(pa.pdfs.map(p => [p.localPath, p]));
  const sr = readJson<{ pdfs: { localPath: string; resetEvents: { beforeNodeId: string }[]; tableDigests: { c0: string; t1: string; t2: string } }[] }>(`${SR}/evaluation.json`);
  const srOf = new Map(sr.pdfs.map(p => [p.localPath, p]));
  const lf = readJson<{ pdfs: { localPath: string; tableDigests: { t3: string } }[] }>(`${LF}/evaluation.json`);
  const lfOf = new Map(lf.pdfs.map(p => [p.localPath, p]));
  const causal = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${SR}/causal-rows.json.gz`)).toString('utf8')) as [string, string, string, string][];
  const provNodes = zlib.gunzipSync(fs.readFileSync(`${CP}/phaseA-support-nodes.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as { pdf: string; nodeId: string; clusterId: number });
  const provB = readJson<{ clusters: { pdf: string; clusterId: number; relation: string }[] }>(`${CP}/phaseB-diagnostic.json`);
  const pageOf = (id: string | null) => (id ? Number(/-p(\d+)-r/.exec(id)?.[1] ?? 0) : null);

  const perPdf: unknown[] = [], gateFailures: string[] = [], frameRows: unknown[] = [];
  const total: Record<'L' | 'P' | 'K', Record<TransitionClass, number>> = { L: zero(), P: zero(), K: zero() };
  const tuples: Record<string, number> = {}, bySubset: Record<string, { rows: number; L: Record<TransitionClass, number>; P: Record<TransitionClass, number>; K: Record<TransitionClass, number>; t2ToT4ChangedRows: number }> = {};
  const clusterTransition: Record<string, Record<string, number>> = {}, b4b5: Record<string, Record<string, number>> = { B1_one_to_one: {}, B4_c0_unassigned_only: {}, B5_mixed_assigned_unassigned: {} };
  let primaryRows = 0, primaryUnassignedRows = 0, primaryNewChangeRows = 0, primaryT2ToT4Changed = 0, primaryT3vsT4 = 0, nonHierarchyChangedPrimary = 0, nonHierarchyChangedAll = 0;
  let sameRangeRows = 0, sameRangeChanged = 0, newClusters = 0, dup = 0, unjoin = 0, priorChanged = 0;
  const sameRangeChangedDetail: unknown[] = [], manualStartOut: unknown[] = [];
  const primaryFrameBuilt: boolean[] = [];

  for (const m of manifest) {
    const name = m.localPath.split('/').pop()!;
    const exact = m.relation === 'exact_same';
    const pages = new Map<number, FieldResolverPageInput>();
    for (let n = m.sourceDerived[0]; n <= m.sourceDerived[1]; n++) {
      const ex = await extractPageTokens(m.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.set(n, { meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    const slice = (r: [number, number]) => { const o: FieldResolverPageInput[] = []; for (let n = r[0]; n <= r[1]; n++) o.push(pages.get(n)!); return o; };
    const hOf = (ps: FieldResolverPageInput[]) => observeDocumentHierarchyV2('detail', ps.map(p => ({ meta: p.meta, tokens: p.tokens, geometry: p.geometry, logical: p.logical })), HIERARCHY_B_ONLY_OPTIONS);
    const manualPages = slice(m.manual), sourcePages = slice(m.sourceDerived);
    const h0 = hOf(manualPages), h1 = hOf(sourcePages);
    const res0 = resolveFields({ pages: manualPages, hierarchy: h0 }), res1 = resolveFields({ pages: sourcePages, hierarchy: h1 });
    const c0 = rowTableOf(res0, h0), t1 = rowTableOf(res1, h1);
    const withEdges = (h: DocumentHierarchyV2Result, edges: ReturnType<typeof replayStack>['edges']): DocumentHierarchyV2Result => {
      const ev = new Map(h1.edges.map(e => [e.childNodeId, e.evidence]));
      return { ...h, edges: edges.map(e => ({ ...e, evidence: e.parentNodeId === null ? [{ kind: 'document_order' as const, detail: { reason: 'no_preceding_shallower_heading' } }] : (ev.get(e.childNodeId) ?? [{ kind: 'indent_level' as const, detail: {} }]) })) };
    };
    const locator = srOf.get(m.localPath)!.resetEvents[0]?.beforeNodeId ?? null;
    const resetPage = m.manual[0] > m.sourceDerived[0] ? m.manual[0] : null;
    const rr2 = replayStack(h1.nodes, resetPage), h2 = withEdges(h1, rr2.edges);
    const res2 = resolveFields({ pages: sourcePages, hierarchy: h2 }), t2 = rowTableOf(res2, h2);
    const injected = (frame: IndentClusterV2[]) => {
      const un = new Set<string>();
      const nodes = h1.nodes.map(nd => {
        if (nd.hierarchyEligibility !== 'candidate') return { ...nd };
        const x = nd.xIndentEvidence.keyTokenXMin, cl = assignToFrame(x, frame);
        if (!cl) { un.add(nd.id); return { ...nd, xIndentEvidence: { keyTokenXMin: x, clusterIndex: null, level: null, placed: false } }; }
        return { ...nd, xIndentEvidence: { keyTokenXMin: x, clusterIndex: cl.clusterIndex, level: cl.level, placed: cl.level !== null } };
      });
      const rr = replayStackAtNode(nodes, locator);
      const h = withEdges({ ...h1, nodes, indentClusters: frame }, rr.edges);
      const res = resolveFields({ pages: sourcePages, hierarchy: h });
      return { h, rr, un, table: rowTableOf(res, h), records: res.records.length };
    };
    const t3r = injected(h0.indentClusters);
    const frame4 = phaseA.perPdf.find(p => p.localPath === m.localPath)!.t4.indentClusters;
    const t4r = injected(frame4);
    const t3 = t3r.table, t4 = t4r.table;

    const gates: Record<string, boolean> = {
      C0_T1_T2_T3_reproduced: tableDigest(c0) === srOf.get(m.localPath)!.tableDigests.c0 && tableDigest(t1) === srOf.get(m.localPath)!.tableDigests.t1 && tableDigest(t2) === srOf.get(m.localPath)!.tableDigests.t2 && tableDigest(t3) === lfOf.get(m.localPath)!.tableDigests.t3,
      M1_activation_range_identical: JSON.stringify(h2.pages) === JSON.stringify(t4r.h.pages),
      M2_node_population_identical: JSON.stringify(h2.nodes.map(n => [n.id, n.hierarchyEligibility])) === JSON.stringify(t4r.h.nodes.map(n => [n.id, n.hierarchyEligibility])),
      M3_reset_event_identical: JSON.stringify(rr2.resetEvents.map(e => e.beforeNodeId)) === JSON.stringify(t4r.rr.resetEvents.map(e => e.beforeNodeId)) && t4r.rr.resetEvents.length === (locator ? 1 : 0),
      M4_frame_is_phaseA_frame: JSON.stringify(t4r.h.indentClusters) === JSON.stringify(frame4),
    };
    dup += (res0.records.length - c0.size) + (res1.records.length - t1.size) + (res2.records.length - t2.size) + (t3r.records - t3.size) + (t4r.records - t4.size);
    for (const k of new Set([...t2.keys(), ...t4.keys()])) if (!t2.has(k) || !t4.has(k)) unjoin++;
    const manualKey = (k: string) => { const p = Number(k.split(':')[0]); return p >= m.manual[0] && p <= m.manual[1]; };
    const regionOf = (page: number): Region => (page < m.manual[0] ? 'before_manual' : page > m.manual[1] ? 'after_manual' : 'inside_manual');
    let pdfPrimary = 0, pdfT2T4 = 0, pdfNonHier = 0;
    for (const k of [...t4.keys()].sort(cmp)) {
      const a = c0.get(k), o = t1.get(k), b = t2.get(k)!, c = t4.get(k)!, d3 = t3.get(k);
      if (I(b) !== I(c)) { nonHierarchyChangedAll++; if (manualKey(k)) pdfNonHier++; }
      if (V(b) !== V(c)) pdfT2T4++;
      if (exact) {
        sameRangeRows++;
        if (V(b) !== V(c) || (a && V(a) !== V(c))) { sameRangeChanged++; const [pg, rw] = k.split(':'); sameRangeChangedDetail.push({ pdf: name, key: k, nodeRelation: nodeRel.get(`${name}|detail-p${pg}-r${rw}`) ?? null, t4Unassigned: t4r.un.has(`detail-p${pg}-r${rw}`) }); }
        continue;
      }
      if (!manualKey(k)) continue;
      if (!a || !o) { unjoin++; continue; }
      pdfPrimary++;
      const [pg, rw] = k.split(':');
      const un = t4r.un.has(`detail-p${pg}-r${rw}`);
      if (un) primaryUnassignedRows++;
      if (d3 && V(d3) !== V(c)) primaryT3vsT4++;
      const cl = { L: transitionClass(Lc(a), Lc(b), Lc(c), un), P: transitionClass(Pc(a), Pc(b), Pc(c), un), K: transitionClass(Kc(a), Kc(b), Kc(c), un) };
      for (const comp of ['L', 'P', 'K'] as const) inc(total[comp], cl[comp]);
      inc(tuples, `L=${cl.L},P=${cl.P},K=${cl.K}`);
      if ((['L', 'P', 'K'] as const).some(x => cl[x] === 'R3' || cl[x] === 'R4')) primaryNewChangeRows++;
      if (V(b) !== V(c)) primaryT2ToT4Changed++;
      if (V(a) !== V(o)) {
        priorChanged++;
        const pc = classifyChange(a, o).primary;
        const g = (bySubset[pc] ??= { rows: 0, L: zero(), P: zero(), K: zero(), t2ToT4ChangedRows: 0 });
        g.rows++; for (const comp of ['L', 'P', 'K'] as const) inc(g[comp], cl[comp]);
        if (V(b) !== V(c)) g.t2ToT4ChangedRows++;
      }
    }
    if (!exact) { primaryRows += pdfPrimary; nonHierarchyChangedPrimary += pdfNonHier; primaryFrameBuilt.push(frame4.length > 0); }
    // frame 遷移（T2 cluster 単位）
    const t2cl = h1.indentClusters.map(k => ({ clusterIndex: k.clusterIndex, xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, level: k.level }));
    const desc = new Map<number, IndentClusterV2[]>(); const newList: IndentClusterV2[] = [];
    for (const k of frame4) { const p = t2ParentOf(k, t2cl); if (p === null) newList.push(k); else { if (!desc.has(p)) desc.set(p, []); desc.get(p)!.push(k); } }
    newClusters += newList.length;
    const supByCluster = new Map<number, { n: number; e: number }>();
    for (const n of provNodes.filter(p => p.pdf === name)) { const r = nodeRel.get(`${name}|${n.nodeId}`); const g = supByCluster.get(n.clusterId) ?? { n: 0, e: 0 }; g.n++; if (r?.supportEligible) g.e++; supByCluster.set(n.clusterId, g); }
    const relOfCluster = new Map(provB.clusters.filter(c => c.pdf === name).map(c => [c.clusterId, c.relation]));
    for (const k of t2cl) {
      const ds = desc.get(k.clusterIndex) ?? [];
      const one = ds.length === 1 ? ds[0] : null;
      const cat = ds.length === 0 ? 'removed' : ds.length >= 2 ? 'split' : (one!.xMin === k.xMin && one!.xMax === k.xMax && one!.memberCount === k.memberCount && one!.level === k.level) ? 'preserved' : (one!.memberCount > k.memberCount ? 'support_expanded' : (one!.xMin !== k.xMin || one!.xMax !== k.xMax) && one!.memberCount === k.memberCount ? 'x_or_level_changed' : one!.memberCount < k.memberCount ? 'support_reduced' : 'x_or_level_changed');
      inc(clusterTransition[name] ??= {}, cat);
      const sup = supByCluster.get(k.clusterIndex) ?? { n: 0, e: 0 };
      const eff = supportEffect(sup.e, sup.n), rel = relOfCluster.get(k.clusterIndex);
      if (rel && !exact && b4b5[rel]) { inc(b4b5[rel], eff); inc(b4b5[rel], `frameTransition:${cat}`); }
      frameRows.push([name, k.clusterIndex, k.xMin, k.level, k.memberCount, rel ?? null, sup.n, sup.e, eff, cat, ds.map(x => [x.clusterIndex, x.xMin, x.xMax, x.memberCount, x.level])]);
    }
    for (const k of newList) frameRows.push([name, 'new', k.clusterIndex, k.xMin, k.xMax, k.memberCount, k.level]);
    for (const g of Object.keys(gates)) if (!gates[g]) gateFailures.push(`${name}:${g}`);
    // manual 開始 node
    const firstOf = (h: DocumentHierarchyV2Result, t: Table) => {
      const n = h.nodes.filter(x => x.sourcePage >= m.manual[0]).sort((x, y) => x.sourcePage - y.sourcePage || x.sourceRowRefs.logicalRowIndex - y.sourceRowRefs.logicalRowIndex)[0];
      if (!n) return null;
      const e = h.edges.find(x => x.childNodeId === n.id), row = t.get(`${n.sourcePage}:${n.sourceRowRefs.logicalRowIndex}`);
      return { id: n.id, keyTokenXMin: n.xIndentEvidence.keyTokenXMin, clusterIndex: n.xIndentEvidence.clusterIndex, level: n.xIndentEvidence.level, edgeStatus: e?.status ?? null, parentId: e?.parentNodeId ?? null, parentPage: pageOf(e?.parentNodeId ?? null), root: !!e && e.status === 'unresolved' && !e.parentNodeId, kind: row?.kind ?? null, basis: row?.basis ?? null };
    };
    if (!exact) manualStartOut.push({ pdf: name, c0: firstOf(h0, c0), t1: firstOf(h1, t1), t2: firstOf(h2, t2), t3: firstOf(t3r.h, t3), t4: firstOf(t4r.h, t4), t4NodeRelation: locator ? nodeRel.get(`${name}|${locator}`) ?? null : null });
    perPdf.push({ pdf: name, relation: m.relation, gates, rows: { primary: pdfPrimary, t2ToT4ChangedRowsAllRegions: pdfT2T4, nonHierarchyChangedPrimary: pdfNonHier }, frameClusterCounts: { t2: t2cl.length, t4: frame4.length, newClusters: newList.length, c0: h0.indentClusters.length }, frameUnassignedNodes: t4r.un.size, tableDigests: { c0: tableDigest(c0), t2: tableDigest(t2), t3: tableDigest(t3), t4: tableDigest(t4) } });
    console.log(`${name} primary=${pdfPrimary} t2->t4 changed(all)=${pdfT2T4} t4clusters=${frame4.length} new=${newList.length} unassigned=${t4r.un.size}`);
  }
  // B4 の集計
  const b4 = b4b5.B4_c0_unassigned_only, b4RemovedOrReduced = (b4.support_removed ?? 0) + (b4.support_reduced ?? 0);
  const b4Total = provB.clusters.filter(c => c.relation === 'B4_c0_unassigned_only').length;
  const known = { primaryRows2080: primaryRows === 2080, priorChanged536: priorChanged === 536, sameRange5893: sameRangeRows === 5893, b4Total33: b4Total === 33, subsets490_37_9: bySubset.level_changed?.rows === 490 && bySubset.newly_unclassified?.rows === 37 && bySubset.parent_changed?.rows === 9, causalRows536: causal.filter(r => r[2] !== 'S0').length === 536 };
  const gatesPass = phaseAGatesPass && gateFailures.length === 0 && dup === 0 && unjoin === 0 && Object.values(known).every(Boolean);
  const facts = { gatesPass, nonHierarchyChangedRows: nonHierarchyChangedPrimary, primaryRows, primaryUnassignedRows, primaryFrameBuilt, b4Total, b4RemovedOrReduced, sameRangeChangedRows: sameRangeChanged, newClusters, primaryNewChangeRows };
  const decision = decideTableEligibility(facts);
  const framesGz = zlib.gzipSync(Buffer.from(JSON.stringify(frameRows), 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/phaseB-frame-transition.json.gz`, framesGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-level-frame-table-eligibility-phaseB/v0',
    note: 'C0 / T1 / T2 / T3 / manual range は comparator であり teacher ではない。removed / reduced は誤りを意味しない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), phaseAFreeze: freeze.artifacts, frameTransitionGzSha256: sha(framesGz), phaseAGatesPass, gateFailures,
    population: { primaryRows, priorChanged, sameRangeRows, duplicates: dup, unjoinable: unjoin, nonHierarchyChangedPrimary, nonHierarchyChangedAllRows: nonHierarchyChangedAll }, knownValueReproduction: known,
    coverage: { phaseAByPdf: phaseA.perPdf.map(p => ({ localPath: p.localPath, supportEligible: p.supportEligible, excluded: p.excluded, relationDistribution: p.relationDistribution, t4ClusterCount: p.t4.clusterCount, frameUnassignedNodes: p.t4.frameUnassignedNodes })), primaryUnassignedRows },
    frameTransitionByPdf: clusterTransition, newClusters, b4b5Transition: b4b5, b4: { total: b4Total, removedOrReduced: b4RemovedOrReduced },
    primaryComponentTransitions: total, primaryRowTuples: tuples, primaryT2ToT4ChangedRows: primaryT2ToT4Changed, primaryT3VsT4DifferingRows: primaryT3vsT4, primaryNewChangeRows, byPriorChangeClass: bySubset,
    sameRangeControl: { rows: sameRangeRows, changedRows: sameRangeChanged, detail: sameRangeChangedDetail }, manualStart: manualStartOut, mostLeftCluster37982: phaseA.perPdf.filter(p => p.relation !== 'exact_same').map(p => ({ localPath: p.localPath, diagnostic: p.mostLeftCluster37982 })),
    facts, perPdf, decision,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseB-diagnostic.json`, text);
  console.log(JSON.stringify({ sha: sha(text), facts, known, gateFailures, decision }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
