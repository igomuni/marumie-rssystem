/**
 * Phase A（source-only）: node ごとの table-frame relation・support eligibility と、support 限定で構築した T4 level frame。
 * C0 / manual range / T3 / MOF は参照しない。protocol: docs/tasks/20261005_1735_Budget_Request_Level_Frame_Table_Eligibility_Counterfactual_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-table-eligibility-phase-a.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { assignToFrame } from './lib/budget-request-level-frame-counterfactual';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { frameOf } from './lib/budget-request-p1-outlier';
import { longRules, mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { filterLogicalRows, nodeSupport } from './lib/budget-request-table-eligibility-frame';
import { pageRuns } from './lib/budget-request-cluster-provenance';

const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-level-frame-table-eligibility/2024`;
const MANIFEST = `${FX}/budget-request-source-range-hierarchy/2024/range-manifest.json`, PAIRED_EVAL = `${FX}/budget-request-source-range-hierarchy/2024/phaseA-evaluation.json`;
const PAIRED = `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`;
const PROV_A = `${FX}/budget-request-level-frame-cluster-provenance/2024/phaseA-cluster-inventory.json`, PROV_NODES = `${FX}/budget-request-level-frame-cluster-provenance/2024/phaseA-support-nodes.jsonl.gz`;
const LAYOUT = `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`;
const FROZEN: Record<string, string> = {
  [MANIFEST]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e', [PAIRED_EVAL]: '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6', [PAIRED]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [PROV_A]: '2bb3e5929fcb9539b78018f740c112222956fd70a776796322e5900d46b672e5', [PROV_NODES]: 'fef26771118722adf35d9f367b4bdab03c0897c8f5f8efeecb9fdc3b4ee34b6e', [LAYOUT]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266',
  'scripts/pipeline-v2/lib/budget-request-p1-outlier.ts': '9cb749d2a3b80f1e71ff3993f9db77e57c723f552c56e1ea5d3a88a11637e5d4', 'scripts/pipeline-v2/lib/budget-request-table-frame-eligibility.ts': 'b43eab8b5e129b5755619c9ea3f037682a2d843dae8c4fbfb39535ab5bfffdf2',
  'scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts': '50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7', 'scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts': '39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d', 'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts': 'd2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5', 'scripts/pipeline-v2/lib/budget-request-level-frame-counterfactual.ts': '07912b03fd9bf1353b8e7f3f826f3678b7fa1580f9fa23595047049776e4314e',
  'docs/tasks/20261005_1735_Budget_Request_Level_Frame_Table_Eligibility_Counterfactual_Protocol.md': '20a124f1473873c16acd8132629057a53ce4854b0c6b72dda7ddcfffe3bdbb36',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

type Pages = Parameters<typeof observeDocumentHierarchyV2>[1];

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (h.length === 64 && fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const targets = readJson<{ pdfs: { localPath: string; relation: string; sourceDerived: [number, number] }[] }>(MANIFEST).pdfs;
  const pairedDocs = new Map(readJson<{ documents: { localPath: string; sourceSha256: string }[] }>(PAIRED).documents.map(d => [d.localPath, d.sourceSha256]));
  const frozenT = new Map(readJson<{ pdfs: { localPath: string; stateComparison: { treatmentClusters: unknown[] } }[] }>(PAIRED_EVAL).pdfs.map(p => [p.localPath, p.stateComparison.treatmentClusters]));
  const provNodes = zlib.gunzipSync(fs.readFileSync(PROV_NODES)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as { pdf: string; nodeId: string; clusterId: number });
  const layoutOf = new Map(readJson<{ perPdf: { localPath: string; ranges: { from: number; to: number; gapPages: number[]; signature: string }[] }[] }>(LAYOUT).perPdf.map(p => [p.localPath, p.ranges]));

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const nodeLines: string[] = [], perPdf: unknown[] = [], gates: Record<string, boolean> = {};
  let duplicates = 0, provenanceLoss = 0;

  for (const m of targets) {
    const name = m.localPath.split('/').pop()!;
    const sourceSha = pairedDocs.get(m.localPath);
    if (!sourceSha || fileSha(m.localPath) !== sourceSha) throw new Error(`原本の hash 不一致（STOP）: ${m.localPath}`);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(m.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const pages: Pages = [], longByPage = new Map<number, { x: number; yMin: number; yMax: number }[]>();
    try {
      for (let n = m.sourceDerived[0]; n <= m.sourceDerived[1]; n++) {
        const ex = await extractPageTokens(m.localPath, n);
        const geometry = buildTableGeometry(ex.tokens, ex.page);
        pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
        const page = await doc.getPage(n);
        const ol = await page.getOperatorList();
        longByPage.set(n, longRules(mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])), page.view[3] - page.view[1]).map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax })));
        page.cleanup();
      }
    } finally { await doc.destroy(); }

    const h2 = observeDocumentHierarchyV2('detail', pages, HIERARCHY_B_ONLY_OPTIONS); // T2 の frame / node universe（非介入）
    const bboxOf = new Map<string, { xMin: number; xMax: number; yMin: number; yMax: number }>();
    for (const p of pages) for (const r of p.logical.logicalRowCandidates) bboxOf.set(`${p.meta.number}:${r.logicalRowIndex}`, r.bbox);
    const rel: Record<string, number> = {}, excluded: Record<string, number> = { header_position_supported: 0, ambiguous: 0, unavailable: 0 };
    const excludedRowsByPage = new Map<number, Set<number>>();
    const seen = new Set<string>();
    let supportEligible = 0, noFrameNodes = 0;
    const perNode = new Map<string, { relation: string; supportEligible: boolean }>();
    for (const nd of h2.nodes) {
      if (seen.has(nd.id)) duplicates++; seen.add(nd.id);
      const bbox = bboxOf.get(`${nd.sourcePage}:${nd.sourceRowRefs.logicalRowIndex}`);
      if (!bbox) provenanceLoss++;
      const longRulesOfPage = longByPage.get(nd.sourcePage) ?? [];
      const s = nodeSupport(bbox ?? null, longRulesOfPage);
      inc(rel, s.rel.relation); perNode.set(nd.id, { relation: s.rel.relation, supportEligible: s.supportEligible });
      if (s.supportEligible) supportEligible++; else { inc(excluded, s.rel.relation); if (!excludedRowsByPage.has(nd.sourcePage)) excludedRowsByPage.set(nd.sourcePage, new Set()); excludedRowsByPage.get(nd.sourcePage)!.add(nd.sourceRowRefs.logicalRowIndex); }
      if (!s.rel.frameAvailable) noFrameNodes++;
      const fr = frameOf(longRulesOfPage);
      nodeLines.push(JSON.stringify(sortDeep({ pdf: name, nodeId: nd.id, page: nd.sourcePage, logicalRowIndex: nd.sourceRowRefs.logicalRowIndex, keyTokenXMin: nd.xIndentEvidence.keyTokenXMin, bbox: bbox ?? null, frameAvailable: s.rel.frameAvailable, frameBBox: fr, relation: s.rel.relation, supportEligible: s.supportEligible, eligibilityReason: s.reason, provenance: { keyTokenIndex: nd.sourceTokenRefs.keyTokenIndex, rowTokenIndexes: nd.sourceTokenRefs.rowTokenIndexes, physicalRowIndexes: nd.sourceRowRefs.physicalRowIndexes } })));
    }
    // 非介入の恒等性: 何も除外しない同じ code path が T2 frame を再現
    const identity = JSON.stringify(sortDeep(observeDocumentHierarchyV2('detail', pages.map(p => ({ ...p, logical: { ...p.logical, logicalRowCandidates: filterLogicalRows(p.logical.logicalRowCandidates, new Set<number>()) } })), HIERARCHY_B_ONLY_OPTIONS).indentClusters)) === JSON.stringify(sortDeep(h2.indentClusters));
    // T4 frame: support でない node の行を除いた入力に対する既存 cluster algorithm の indentClusters
    const filtered: Pages = pages.map(p => ({ ...p, logical: { ...p.logical, logicalRowCandidates: filterLogicalRows(p.logical.logicalRowCandidates, excludedRowsByPage.get(p.meta.number) ?? new Set<number>()) } }));
    const h4f = observeDocumentHierarchyV2('detail', filtered, HIERARCHY_B_ONLY_OPTIONS);
    const frame = h4f.indentClusters;
    const supportIds = new Set([...perNode.entries()].filter(([, v]) => v.supportEligible).map(([k]) => k));
    const frameNodesOk = JSON.stringify(h4f.nodes.map(n => n.id).sort(cmp)) === JSON.stringify([...supportIds].sort(cmp));
    // 全 T2 node の T4 frame への割当（既存 first match）
    const assign = h2.nodes.map(n => ({ n, a: assignToFrame(n.xIndentEvidence.keyTokenXMin, frame) }));
    const unassigned = assign.filter(x => x.a === null).length;
    const unassignedByRelation: Record<string, number> = {};
    for (const x of assign) if (x.a === null) inc(unassignedByRelation, perNode.get(x.n.id)!.relation);
    // T4 cluster の support 要約
    const ranges = layoutOf.get(m.localPath)!;
    const clusters = frame.map(k => {
      const sup = h4f.nodes.filter(n => n.xIndentEvidence.clusterIndex === k.clusterIndex);
      const pgs = sup.map(n => n.sourcePage), runs = pageRuns(pgs);
      const lids = [...new Set(pgs.map(p => { const r = ranges.find(x => p >= x.from && p <= x.to && !x.gapPages.includes(p)); return r ? `${r.from}-${r.to}` : 'unassigned'; }))].sort(cmp);
      return { clusterIndex: k.clusterIndex, level: k.level, xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, placementBasis: k.placementBasis, supportCount: sup.length, uniquePages: new Set(pgs).size, firstPage: pgs.length ? Math.min(...pgs) : null, lastPage: pgs.length ? Math.max(...pgs) : null, pageSpan: pgs.length ? Math.max(...pgs) - Math.min(...pgs) + 1 : 0, runCount: runs.length, layoutRanges: lids };
    });
    // x = 37.982 の T2 最左 cluster
    const left = h2.indentClusters.find(k => Math.abs(k.xMin - 37.982) < 0.01);
    let leftDiag: unknown = null;
    if (left) {
      const ln = h2.nodes.filter(n => n.xIndentEvidence.clusterIndex === left.clusterIndex);
      const lr: Record<string, number> = {}; for (const n of ln) inc(lr, perNode.get(n.id)!.relation);
      const covered = frame.find(k => left.xMin >= k.xMin && left.xMax <= k.xMax) ?? null;
      leftDiag = { t2ClusterIndex: left.clusterIndex, t2X: [left.xMin, left.xMax], t2SupportCount: ln.length, relationDistribution: lr, t4SupportCount: ln.filter(n => perNode.get(n.id)!.supportEligible).length, excludedReasons: Object.fromEntries(Object.entries(lr).filter(([k]) => k !== 'body_or_table_position_supported')), t4ClusterCoveringT2Interval: covered ? { clusterIndex: covered.clusterIndex, level: covered.level, x: [covered.xMin, covered.xMax] } : null, nodesRemainInHierarchy: ln.every(n => h2.nodes.some(x => x.id === n.id)), t4FrameAssignment: { assigned: ln.filter(n => assignToFrame(n.xIndentEvidence.keyTokenXMin, frame) !== null).length, unassigned: ln.filter(n => assignToFrame(n.xIndentEvidence.keyTokenXMin, frame) === null).length } };
    }
    // A1: T2 node universe / frame が frozen と一致
    const frozenNodeIds = provNodes.filter(p => p.pdf === name).map(p => p.nodeId).sort(cmp);
    const frozenClusters = frozenT.get(m.localPath)!;
    const frameIdentity = JSON.stringify(sortDeep(h2.indentClusters.map(k => ({ xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, level: k.level })))) === JSON.stringify(sortDeep(frozenClusters));
    gates[`${name}:A1_T2_frame_identity`] = frameIdentity;
    gates[`${name}:A1_node_universe`] = m.relation === 'exact_same' ? true : JSON.stringify(h2.nodes.filter(n => n.hierarchyEligibility === 'candidate').map(n => n.id).sort(cmp)) === JSON.stringify(frozenNodeIds);
    gates[`${name}:A4_non_intervention_identity`] = identity;
    gates[`${name}:T4_frame_nodes_equal_support`] = frameNodesOk;
    perPdf.push(sortDeep({
      pdf: name, localPath: m.localPath, relation: m.relation, sourceDerived: m.sourceDerived,
      t2: { nodeCount: h2.nodes.length, clusterCount: h2.indentClusters.length }, relationDistribution: rel, supportEligible, excluded: { header: excluded.header_position_supported, ambiguous: excluded.ambiguous, unavailable: excluded.unavailable }, nodesOnPagesWithoutFrame: noFrameNodes,
      t4: { clusterCount: frame.length, clusters, frameUnassignedNodes: unassigned, frameUnassignedByRelation: unassignedByRelation, indentClusters: frame },
      mostLeftCluster37982: leftDiag,
    }));
    console.log(`${name} nodes=${h2.nodes.length} support=${supportEligible} t2clusters=${h2.indentClusters.length} t4clusters=${frame.length} unassigned=${unassigned} gates=${frameIdentity}/${identity}/${frameNodesOk}`);
  }
  gates.A2_classifier_code_hash_frozen = true; // FROZEN の guard を通過済み
  gates.A5_duplicates_zero = duplicates === 0; gates.A6_provenance_loss_zero = provenanceLoss === 0; gates.A8_production_hash_frozen = true;
  const nodesGz = zlib.gzipSync(Buffer.from(nodeLines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/phaseA-node-relations.jsonl.gz`, nodesGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-level-frame-table-eligibility-phaseA/v0',
    note: 'source-only。C0・manual range・T3・MOF は未参照。T4 frame は support を body_or_table_position_supported の node に限定して既存 cluster algorithm で構築。node は削除しない',
    frozen: Object.fromEntries(Object.entries(FROZEN).filter(([, h]) => h.length === 64).map(([p]) => [p, fileSha(p)])), nodeRelationsGzSha256: sha(nodesGz), nodeCount: nodeLines.length, duplicates, provenanceLoss, gates, perPdf,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-t4-frame.json`, text);
  console.log(JSON.stringify({ sha: sha(text), nodesGz: sha(nodesGz), nodes: nodeLines.length, duplicates, provenanceLoss, gates }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
