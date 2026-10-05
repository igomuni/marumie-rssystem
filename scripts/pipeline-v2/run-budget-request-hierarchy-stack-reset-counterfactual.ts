/**
 * hierarchy stack-reset counterfactual（C0 / T1 / T2）の frozen evaluation（protocol: docs/tasks/20261005_1450_Budget_Request_Hierarchy_Stack_Reset_Counterfactual_Protocol.md）。
 * T2 = T1 の nodes / x cluster / level をそのまま使い、stack の replay だけを manual 開始直前で reset。production code は変更しない。
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-hierarchy-stack-reset-counterfactual.ts
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
import { causalClass, decideStackReset, replayStack, type CausalClass } from './lib/budget-request-stack-reset-counterfactual';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const PA = 'tests/fixtures/budget-request-source-range-hierarchy/2024';
const OUT = 'tests/fixtures/budget-request-hierarchy-stack-reset/2024';
const FROZEN: Record<string, string> = {
  [`${PA}/range-manifest.json`]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e',
  [`${PA}/phaseA-evaluation.json`]: '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6',
  [`${PA}/phaseB-mof-diagnostic.json`]: '5b6fe1f309854fce5a738c24d19aabe38bb931246dc35444252c313a90c4fd83',
  'scripts/pipeline-v2/lib/budget-request-source-range-compare.ts': 'c8b757e7cffc90c836ff0134eed057021edff45e4428ab76010a1db82fa34103',
  'scripts/pipeline-v2/run-budget-request-source-range-hierarchy-paired.ts': '3601da017a8a501298e2d0eea3d502ce30f1cfbf62cc00c0ce8c4d1896e1e1e1',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d',
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'docs/tasks/20261005_1450_Budget_Request_Hierarchy_Stack_Reset_Counterfactual_Protocol.md': '22884704f4b4529da2ba63a260e54a1df5fa32d553436c7683c3264482f07007',
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

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const manifest = readJson<{ pdfs: RangeRow[] }>(`${PA}/range-manifest.json`).pdfs;
  const pa = readJson<PhaseA>(`${PA}/phaseA-evaluation.json`);
  const paOf = new Map(pa.pdfs.map(p => [p.localPath, p]));
  const pageOf = (id: string | null) => (id ? Number(/-p(\d+)-r/.exec(id)?.[1] ?? 0) : null);

  const perPdf: unknown[] = [], gateFailures: string[] = [];
  const counts: Record<CausalClass, number> = { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
  const decomp: Record<string, Record<string, number>> = {};
  const t2VsT1Flags: Record<string, number> = {};
  const diagRows: unknown[] = [];
  let primaryRows = 0, priorChanged = 0, controlRows = 0, controlChanged = 0, dup = 0, unjoin = 0, invariantViolations = 0;

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
    const rec0 = res0.records.length, rec1 = res1.records.length;

    // T2: T1 の hierarchy から edges だけを replay（reset は manual 開始が source 開始より後の PDF のみ）
    const resetPage = m.manual[0] > m.sourceDerived[0] ? m.manual[0] : null;
    const r0 = replayStack(h1.nodes, null);
    const sameEdges = r0.edges.length === h1.edges.length && r0.edges.every((e, i) => { const t = h1.edges[i]; return e.childNodeId === t.childNodeId && e.parentNodeId === t.parentNodeId && e.status === t.status && JSON.stringify(e.ancestorCandidateNodeIds) === JSON.stringify(t.ancestorCandidateNodeIds); });
    const rr = replayStack(h1.nodes, resetPage);
    const evidenceOf = new Map(h1.edges.map(e => [e.childNodeId, e.evidence]));
    const h2: DocumentHierarchyV2Result = { ...h1, edges: rr.edges.map(e => ({ ...e, evidence: e.parentNodeId === null ? [{ kind: 'document_order' as const, detail: { reason: 'no_preceding_shallower_heading' } }] : evidenceOf.get(e.childNodeId)! })) };
    const res2 = resolveFields({ pages: sourcePages, hierarchy: h2 });
    const t2 = rowTableOf(res2, h2), rec2 = res2.records.length;

    // mechanism gates
    const gates: Record<string, boolean> = {
      C0_equals_frozen: tableDigest(c0) === paOf.get(m.localPath)!.rowTableDigests.control,
      T1_equals_frozen: tableDigest(t1) === paOf.get(m.localPath)!.rowTableDigests.treatment,
      R0_replay_equals_T1_edges: sameEdges,
      M1_activation_range_identical: JSON.stringify(h1.pages) === JSON.stringify(h2.pages),
      M2_node_population_identical: JSON.stringify(h1.nodes.map(n => n.id)) === JSON.stringify(h2.nodes.map(n => n.id)),
      M3_cluster_population_identical: JSON.stringify(h1.indentClusters) === JSON.stringify(h2.indentClusters),
      M4_level_assignment_identical: JSON.stringify(h1.nodes.map(n => n.xIndentEvidence)) === JSON.stringify(h2.nodes.map(n => n.xIndentEvidence)),
      M5_reset_once_at_locator: resetPage === null ? rr.resetEvents.length === 0 : rr.resetEvents.length === 1,
      M6_non_hierarchy_invariants: true,
    };
    const manualKey = (k: string) => { const p = Number(k.split(':')[0]); return p >= m.manual[0] && p <= m.manual[1]; };
    // join
    const keys = new Set([...c0.keys(), ...t1.keys(), ...t2.keys()]);
    for (const k of keys) if (!t1.has(k) !== !t2.has(k)) unjoin++;
    dup += (rec0 - c0.size) + (rec1 - t1.size) + (rec2 - t2.size);
    for (const [k, b] of t1) { const t = t2.get(k); if (t && I(b) !== I(t)) { gates.M6_non_hierarchy_invariants = false; invariantViolations++; } }
    const pdfCounts: Record<CausalClass, number> = { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
    let pdfPrimary = 0, pdfPrior = 0, outsideT1T2Diff = 0;
    for (const k of [...t1.keys()].sort(cmp)) {
      const a = c0.get(k), b = t1.get(k)!, c = t2.get(k)!;
      if (!manualKey(k)) { if (V(b) !== V(c)) outsideT1T2Diff++; continue; }
      if (!a) { unjoin++; continue; }
      pdfPrimary++;
      const s = causalClass(V(a), V(b), V(c));
      pdfCounts[s]++;
      const ch01 = classifyChange(a, b), ch12 = classifyChange(b, c), ch02 = classifyChange(a, c);
      if (V(a) !== V(b)) {
        pdfPrior++;
        const cls = ch01.primary;
        const d = (decomp[cls] ??= {});
        inc(d, 'C0_vs_T1'); if (V(b) !== V(c)) inc(d, 'T1_vs_T2'); if (V(c) !== V(a)) inc(d, 'T2_vs_C0'); inc(d, s);
        if (diagRows.length < 100000) diagRows.push([name, k, s, cls, ch01.flags, ch12.flags, ch02.flags]);
      }
      for (const f of ch12.flags) inc(t2VsT1Flags, `${name}|${f}`);
      if (s === 'S4') diagRows.push([name, k, s, ch01.primary, ch01.flags, ch12.flags, ch02.flags]);
    }
    for (const g of Object.keys(gates)) if (!gates[g]) gateFailures.push(`${name}:${g}`);
    if (exact) { controlRows += pdfPrimary; controlChanged += pdfPrior + pdfCounts.S4; } else { primaryRows += pdfPrimary; priorChanged += pdfPrior; for (const k of Object.keys(counts) as CausalClass[]) counts[k] += pdfCounts[k]; }
    // manual-start targeted diagnostic
    const firstOf = (h: DocumentHierarchyV2Result, t: Table) => {
      const n = h.nodes.filter(x => x.sourcePage >= m.manual[0]).sort((x, y) => x.sourcePage - y.sourcePage || x.sourceRowRefs.logicalRowIndex - y.sourceRowRefs.logicalRowIndex)[0];
      if (!n) return null;
      const e = h.edges.find(x => x.childNodeId === n.id);
      return { id: n.id, level: n.xIndentEvidence.level, edgeStatus: e?.status ?? null, parentId: e?.parentNodeId ?? null, parentPage: pageOf(e?.parentNodeId ?? null), kind: t.get(`${n.sourcePage}:${n.sourceRowRefs.logicalRowIndex}`)?.kind ?? null };
    };
    const f0 = firstOf(h0, c0), f1 = firstOf(h1, t1), f2 = firstOf(h2, t2);
    perPdf.push({
      localPath: m.localPath, relation: m.relation, manual: m.manual, sourceDerived: m.sourceDerived, resetPage, resetEvents: rr.resetEvents, gates,
      rows: { primary: pdfPrimary, priorChanged: pdfPrior, causal: pdfCounts, t1VsT2DifferingRowsOutsideManualRange: outsideT1T2Diff },
      tableDigests: { c0: tableDigest(c0), t1: tableDigest(t1), t2: tableDigest(t2) },
      manualStart: { c0: f0, t1: f1, t2: f2, parentRelationRemovedInT2: !!f1?.parentId && !f2?.parentId, levelSameAsT1InT2: f1?.level === f2?.level, kindC0T1T2: [f0?.kind, f1?.kind, f2?.kind] },
    });
    console.log(`${name} primary=${pdfPrimary} prior=${pdfPrior} ${JSON.stringify(pdfCounts)} resets=${rr.resetEvents.length}`);
  }
  // 既知値の再現
  const primaryPdfs = manifest.filter(m => m.relation !== 'exact_same').map(m => paOf.get(m.localPath)!);
  const knownOk = {
    primaryRows2080: primaryRows === 2080, priorChanged536: priorChanged === 536 && priorChanged === pa.facts.intersectionChangedRows,
    classes: decomp.level_changed?.C0_vs_T1 === 490 && decomp.newly_unclassified?.C0_vs_T1 === 37 && decomp.parent_changed?.C0_vs_T1 === 9,
    clusters: JSON.stringify(primaryPdfs.map(p => [p.stateComparison.controlClusters.length, p.stateComparison.treatmentClusters.length])) === JSON.stringify([[13, 27], [15, 34]]),
    sourceOnly: JSON.stringify(primaryPdfs.map(p => p.regionRows.source_only)) === JSON.stringify([3053, 7001]), sameRangeRows5893: controlRows === 5893,
  };
  const gatesPass = gateFailures.length === 0 && dup === 0 && unjoin === 0 && controlChanged === 0 && invariantViolations === 0 && Object.values(knownOk).every(Boolean);
  const decision = decideStackReset({ gatesPass, counts, priorChanged });
  const rowsGz = zlib.gzipSync(Buffer.from(JSON.stringify(diagRows), 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/causal-rows.json.gz`, rowsGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-hierarchy-stack-reset-counterfactual/v0',
    note: 'T2 は T1 の frame（nodes / x cluster / level）固定で stack のみ manual 開始直前に reset。manual contract・MOF は GT ではない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), causalRowsGzSha256: sha(rowsGz),
    population: { primaryRows, priorChangedRows: priorChanged, sameRangeControlRows: controlRows, sameRangeControlChanged: controlChanged, duplicates: dup, unjoinable: unjoin, nonHierarchyInvariantViolations: invariantViolations },
    knownValueReproduction: knownOk, gateFailures, gatesPass, causalCounts: counts, fieldDecomposition: decomp, t2VsT1FlagCounts: t2VsT1Flags, pdfs: perPdf, decision,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/evaluation.json`, text);
  console.log(JSON.stringify({ sha: sha(text), population: { primaryRows, priorChanged, controlRows, controlChanged, dup, unjoin, invariantViolations }, knownOk, gateFailures, counts, decomp, decision }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
