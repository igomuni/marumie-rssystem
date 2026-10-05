/**
 * hierarchy level-frame counterfactual（C0 / T1 / T2 / T3）の frozen evaluation（protocol: docs/tasks/20261005_1535_Budget_Request_Hierarchy_Level_Frame_Counterfactual_Protocol.md）。
 * T3 = T2（source range・stack reset）から level frame の参照元だけを C0 の frozen frame に替える。production code は変更しない。
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-hierarchy-level-frame-counterfactual.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { observeDocumentHierarchyV2, type DocumentHierarchyV2Result } from './lib/budget-request-document-hierarchy-v2';
import { resolveFields, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { classifyChange, type NodeInfo, type RowRec } from './lib/budget-request-source-range-compare';
import { assignToFrame, decideLevelFrame, replayStackAtNode, transitionClass, type TransitionClass } from './lib/budget-request-level-frame-counterfactual';
import { replayStack } from './lib/budget-request-stack-reset-counterfactual';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const PA = 'tests/fixtures/budget-request-source-range-hierarchy/2024';
const SR = 'tests/fixtures/budget-request-hierarchy-stack-reset/2024';
const OUT = 'tests/fixtures/budget-request-hierarchy-level-frame/2024';
const FROZEN: Record<string, string> = {
  [`${PA}/range-manifest.json`]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e',
  [`${PA}/phaseA-evaluation.json`]: '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6',
  [`${PA}/phaseB-mof-diagnostic.json`]: '5b6fe1f309854fce5a738c24d19aabe38bb931246dc35444252c313a90c4fd83',
  'scripts/pipeline-v2/lib/budget-request-source-range-compare.ts': 'c8b757e7cffc90c836ff0134eed057021edff45e4428ab76010a1db82fa34103',
  'scripts/pipeline-v2/run-budget-request-source-range-hierarchy-paired.ts': '3601da017a8a501298e2d0eea3d502ce30f1cfbf62cc00c0ce8c4d1896e1e1e1',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d',
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  [`${SR}/evaluation.json`]: 'e31d2cadecd30ef401b5fc2a77f2b930c1eacd38c7bb15a35f6988a87a0d0128',
  [`${SR}/causal-rows.json.gz`]: 'e19d0098d7995ecfc618c20fe99476d482f41e0b91aff54912d1c053b5f390c9',
  'scripts/pipeline-v2/run-budget-request-hierarchy-stack-reset-counterfactual.ts': 'b1b5f54382b4b34a876c65ec3ec4b94a05fcf2268d1a6af8e980149f341a4a5c',
  'scripts/pipeline-v2/lib/budget-request-stack-reset-counterfactual.ts': 'b0f940c99ec27a1ca4a185b811f944b8beda093862b0230912a5133999889c61',
  'docs/tasks/20261005_1520_Budget_Request_Hierarchy_Stack_Reset_Counterfactual_Result.md': '31fc3cb2c4342a0f777a47844693d6d29de8b95ea986f6b74e4398186cc87e74',
  'docs/tasks/20261005_1535_Budget_Request_Hierarchy_Level_Frame_Counterfactual_Protocol.md': '8b6a81b71ab5e82b46b55422a6219f7ca9d05dc1b805d81aca493e67422dde61',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface RangeRow { localPath: string; manual: [number, number]; sourceDerived: [number, number]; relation: string }
interface PhaseA { facts: { intersectionChangedRows: number }; totals: { intersectionChangeClassPrimary: Record<string, number> }; pdfs: { localPath: string; join: Record<string, number>; regionRows: Record<string, number>; stateComparison: { controlClusters: unknown[]; treatmentClusters: unknown[] }; rowTableDigests: { control: string; treatment: string } }[] }
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


interface SrEval { causalCounts: Record<string, number>; population: { primaryRows: number; priorChangedRows: number; sameRangeControlRows: number }; pdfs: { localPath: string; resetEvents: { beforeNodeId: string }[]; tableDigests: { c0: string; t1: string; t2: string }; manualStart: { t2: unknown } }[] }
const Lc = (r: RowRec) => JSON.stringify({ isNode: r.node.isNode, level: r.node.level, clusterX: r.node.clusterX });
const Pc = (r: RowRec) => JSON.stringify({ parentItem: r.parentItem, parentOrg: r.parentOrg, edgeStatus: r.node.edgeStatus, parentId: r.node.parentId, root: r.node.root });
const Kc = (r: RowRec) => JSON.stringify({ kind: r.kind, basis: r.basis });
const Vc = (r: RowRec | undefined) => (r ? Lc(r) + Pc(r) + Kc(r) : undefined);
const zero = (): Record<TransitionClass, number> => ({ R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 });

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const manifest = readJson<{ pdfs: RangeRow[] }>(`${PA}/range-manifest.json`).pdfs;
  const pa = readJson<PhaseA>(`${PA}/phaseA-evaluation.json`);
  const sr = readJson<SrEval>(`${SR}/evaluation.json`);
  const paOf = new Map(pa.pdfs.map(p => [p.localPath, p])), srOf = new Map(sr.pdfs.map(p => [p.localPath, p]));
  const pageOf = (id: string | null) => (id ? Number(/-p(\d+)-r/.exec(id)?.[1] ?? 0) : null);

  const perPdf: unknown[] = [], gateFailures: string[] = [];
  const total: Record<'L' | 'P' | 'K', Record<TransitionClass, number>> = { L: zero(), P: zero(), K: zero() };
  const tuples: Record<string, number> = {}, byPrior: Record<string, { rows: number; L: Record<TransitionClass, number>; P: Record<TransitionClass, number>; K: Record<TransitionClass, number>; tuples: Record<string, number> }> = {};
  const rows: unknown[] = [];
  let primaryRows = 0, priorChanged = 0, controlRows = 0, controlRegress = 0, dup = 0, unjoin = 0, invariantViolations = 0, unassignedNodes = 0, unassignedRows = 0;

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
    // T2（frozen 再生成。intervention 無効）
    const resetPage = m.manual[0] > m.sourceDerived[0] ? m.manual[0] : null;
    const rr2 = replayStack(h1.nodes, resetPage);
    const h2 = withEdges(h1, rr2.edges);
    const res2 = resolveFields({ pages: sourcePages, hierarchy: h2 });
    const t2 = rowTableOf(res2, h2);
    // T3: T2 の node population に C0 frame を既存 assignment 規則で適用、reset は frozen T2 locator の位置
    const frame = h0.indentClusters;
    const unassigned = new Set<string>();
    const nodes3 = h1.nodes.map(nd => {
      if (nd.hierarchyEligibility !== 'candidate') return { ...nd };
      const x = nd.xIndentEvidence.keyTokenXMin, cl = assignToFrame(x, frame);
      if (!cl) { unassigned.add(nd.id); return { ...nd, xIndentEvidence: { keyTokenXMin: x, clusterIndex: null, level: null, placed: false } }; }
      return { ...nd, xIndentEvidence: { keyTokenXMin: x, clusterIndex: cl.clusterIndex, level: cl.level, placed: cl.level !== null } };
    });
    const locator = srOf.get(m.localPath)!.resetEvents[0]?.beforeNodeId ?? null;
    const rr3 = replayStackAtNode(nodes3, locator);
    const h3 = withEdges({ ...h1, nodes: nodes3, indentClusters: frame }, rr3.edges);
    const res3 = resolveFields({ pages: sourcePages, hierarchy: h3 });
    const t3 = rowTableOf(res3, h3);
    unassignedNodes += unassigned.size;

    const frozenCtrl = paOf.get(m.localPath)!.stateComparison.controlClusters as { xMin: number; xMax: number; memberCount: number; level: number | null }[];
    const frozenT2Digest = srOf.get(m.localPath)!.tableDigests;
    const gates: Record<string, boolean> = {
      M1_activation_range_identical: JSON.stringify(h2.pages) === JSON.stringify(h3.pages),
      M2_node_population_and_eligibility_identical: JSON.stringify(h2.nodes.map(n => [n.id, n.hierarchyEligibility])) === JSON.stringify(h3.nodes.map(n => [n.id, n.hierarchyEligibility])),
      M3_document_order_identical: JSON.stringify(h2.nodes.map(n => n.id)) === JSON.stringify(h3.nodes.map(n => n.id)),
      M4_reset_event_identical: JSON.stringify(rr2.resetEvents.map(e => e.beforeNodeId)) === JSON.stringify(rr3.resetEvents.map(e => e.beforeNodeId)) && rr3.resetEvents.length === (locator ? 1 : 0) && JSON.stringify(rr2.resetEvents.map(e => e.beforeNodeId)) === JSON.stringify(srOf.get(m.localPath)!.resetEvents.map(e => e.beforeNodeId)),
      M5_frame_identical_to_C0: JSON.stringify(h3.indentClusters) === JSON.stringify(h0.indentClusters) && JSON.stringify(sortDeep(h3.indentClusters.map(k => ({ xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, level: k.level })))) === JSON.stringify(sortDeep(frozenCtrl)),
      M6_T2_and_C0_T1_reproduced: tableDigest(c0) === frozenT2Digest.c0 && tableDigest(t1) === frozenT2Digest.t1 && tableDigest(t2) === frozenT2Digest.t2,
      M7_non_hierarchy_invariants: true,
      M8_same_range_C0_T1_T2_T3_equal: !exact || (tableDigest(c0) === tableDigest(t1) && tableDigest(t1) === tableDigest(t2) && tableDigest(t2) === tableDigest(t3)),
    };
    dup += (res0.records.length - c0.size) + (res1.records.length - t1.size) + (res2.records.length - t2.size) + (res3.records.length - t3.size);
    for (const k of new Set([...t2.keys(), ...t3.keys()])) if (!t2.has(k) || !t3.has(k)) unjoin++;
    for (const [k, b] of t2) { const t = t3.get(k); if (t && I(b) !== I(t)) { gates.M7_non_hierarchy_invariants = false; invariantViolations++; } }
    const manualKey = (k: string) => { const p = Number(k.split(':')[0]); return p >= m.manual[0] && p <= m.manual[1]; };
    const pdfR: Record<'L' | 'P' | 'K', Record<TransitionClass, number>> = { L: zero(), P: zero(), K: zero() };
    let pdfPrimary = 0, pdfPrior = 0, pdfUnassignedRows = 0;
    for (const k of [...t1.keys()].sort(cmp)) {
      if (!manualKey(k)) continue;
      const a = c0.get(k), b = t2.get(k)!, c = t3.get(k)!, o = t1.get(k)!;
      if (!a) { unjoin++; continue; }
      pdfPrimary++;
      const [pg, rw] = k.split(':');
      const un = unassigned.has(`detail-p${pg}-r${rw}`);
      if (un) pdfUnassignedRows++;
      const cl = { L: transitionClass(Lc(a), Lc(b), Lc(c), un), P: transitionClass(Pc(a), Pc(b), Pc(c), un), K: transitionClass(Kc(a), Kc(b), Kc(c), un) };
      for (const comp of ['L', 'P', 'K'] as const) inc(pdfR[comp], cl[comp]);
      const tuple = `L=${cl.L},P=${cl.P},K=${cl.K}`;
      if (!exact) inc(tuples, tuple);
      if (Vc(a) !== Vc(o)) {
        pdfPrior++;
        const pc = classifyChange(a, o).primary;
        const g = (byPrior[pc] ??= { rows: 0, L: zero(), P: zero(), K: zero(), tuples: {} });
        g.rows++;
        for (const comp of ['L', 'P', 'K'] as const) inc(g[comp], cl[comp]);
        inc(g.tuples, tuple);
      }
      if (tuple !== 'L=R0,P=R0,K=R0') rows.push([name, k, tuple, Vc(a) !== Vc(o)]);
    }
    for (const g of Object.keys(gates)) if (!gates[g]) gateFailures.push(`${name}:${g}`);
    if (exact) { controlRows += pdfPrimary; if (tableDigest(c0) !== tableDigest(t3)) controlRegress++; }
    else { primaryRows += pdfPrimary; priorChanged += pdfPrior; unassignedRows += pdfUnassignedRows; for (const comp of ['L', 'P', 'K'] as const) for (const r of Object.keys(zero()) as TransitionClass[]) total[comp][r] += pdfR[comp][r]; }
    const firstOf = (h: DocumentHierarchyV2Result, t: Table) => {
      const n = h.nodes.filter(x => x.sourcePage >= m.manual[0]).sort((x, y) => x.sourcePage - y.sourcePage || x.sourceRowRefs.logicalRowIndex - y.sourceRowRefs.logicalRowIndex)[0];
      if (!n) return null;
      const e = h.edges.find(x => x.childNodeId === n.id), row = t.get(`${n.sourcePage}:${n.sourceRowRefs.logicalRowIndex}`);
      return { id: n.id, keyTokenXMin: n.xIndentEvidence.keyTokenXMin, clusterIndex: n.xIndentEvidence.clusterIndex, clusterX: row?.node.clusterX ?? null, level: n.xIndentEvidence.level, placed: n.xIndentEvidence.placed, edgeStatus: e?.status ?? null, parentId: e?.parentNodeId ?? null, parentPage: pageOf(e?.parentNodeId ?? null), root: !!e && e.status === 'unresolved' && !e.parentNodeId, kind: row?.kind ?? null, basis: row?.basis ?? null };
    };
    perPdf.push({
      localPath: m.localPath, relation: m.relation, manual: m.manual, sourceDerived: m.sourceDerived, resetLocator: locator, resetEventsT2: rr2.resetEvents, resetEventsT3: rr3.resetEvents, gates,
      frame: { c0ClusterCount: frame.length, t2ClusterCount: h1.indentClusters.length, frameUnassignedNodes: unassigned.size },
      rows: { primary: pdfPrimary, priorChanged: pdfPrior, unassignedRows: pdfUnassignedRows, components: pdfR },
      tableDigests: { c0: tableDigest(c0), t1: tableDigest(t1), t2: tableDigest(t2), t3: tableDigest(t3) },
      manualStart: { c0: firstOf(h0, c0), t1: firstOf(h1, t1), t2: firstOf(h2, t2), t3: firstOf(h3, t3), frozenT2Observation: srOf.get(m.localPath)!.manualStart.t2 },
    });
    console.log(`${name} primary=${pdfPrimary} prior=${pdfPrior} L=${JSON.stringify(pdfR.L)} P=${JSON.stringify(pdfR.P)} K=${JSON.stringify(pdfR.K)} unassigned=${unassigned.size}`);
  }
  const known = {
    primaryRows2080: primaryRows === 2080 && primaryRows === sr.population.primaryRows, priorChanged536: priorChanged === 536 && priorChanged === sr.population.priorChangedRows, sameRangeRows5893: controlRows === 5893 && controlRows === sr.population.sameRangeControlRows,
    byPriorClass_490_37_9: byPrior.level_changed?.rows === 490 && byPrior.newly_unclassified?.rows === 37 && byPrior.parent_changed?.rows === 9,
  };
  const r = zero();
  for (const comp of ['L', 'P', 'K'] as const) for (const k of Object.keys(r) as TransitionClass[]) r[k] += total[comp][k];
  const gatesPass = gateFailures.length === 0 && dup === 0 && unjoin === 0 && controlRegress === 0 && invariantViolations === 0 && known.primaryRows2080 && known.priorChanged536 && known.sameRangeRows5893 && known.byPriorClass_490_37_9;
  const decision = decideLevelFrame({ gatesPass, r });
  const rowsGz = zlib.gzipSync(Buffer.from(JSON.stringify(rows), 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/component-rows.json.gz`, rowsGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-hierarchy-level-frame-counterfactual/v0',
    note: 'T3 は T2（source range・stack reset）の node population に C0 の frozen frame を既存 assignment 規則で適用。manual contract・MOF は GT ではない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), componentRowsGzSha256: sha(rowsGz),
    population: { primaryRows, priorChangedRows: priorChanged, sameRangeControlRows: controlRows, duplicates: dup, unjoinable: unjoin, nonHierarchyInvariantViolations: invariantViolations, frameUnassignedNodes: unassignedNodes, frameUnassignedPrimaryRows: unassignedRows },
    knownValueReproduction: known, gateFailures, gatesPass, componentTransitions: total, totalAcrossComponents: r, rowTuples: tuples, byPriorChangeClass: byPrior, pdfs: perPdf, decision,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/evaluation.json`, text);
  console.log(JSON.stringify({ sha: sha(text), population: { primaryRows, priorChanged, controlRows, controlRegress, dup, unjoin, invariantViolations, unassignedNodes, unassignedRows }, gateFailures, total, r, tuples, decision }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
