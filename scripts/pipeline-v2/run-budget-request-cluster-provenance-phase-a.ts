/**
 * Phase A（source-only）: T2 source-derived frame の cluster 61 個（mext 27 / mhlw 34）の provenance inventory。
 * protocol: docs/tasks/20261005_1640_Budget_Request_Level_Frame_Cluster_Provenance_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-cluster-provenance-phase-a.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { classifyCluster, layoutRangeOf, lexicalClassOf, pageRuns } from './lib/budget-request-cluster-provenance';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-level-frame-cluster-provenance/2024`;
const MANIFEST = `${FX}/budget-request-source-range-hierarchy/2024/range-manifest.json`, PAIRED_EVAL = `${FX}/budget-request-source-range-hierarchy/2024/phaseA-evaluation.json`;
const LAYOUT = `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, LAYOUT_PAGES = `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-page-inventory.json`;
const FROZEN: Record<string, string> = {
  [MANIFEST]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e', [PAIRED_EVAL]: '72ad477e5953316e8774919c7f3da2491b22af25332c95d52b65f981e90b67b6',
  [LAYOUT]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [LAYOUT_PAGES]: 'fb74ca44614e5170fb20508343551dd5491b37251f6774a45cb7a418b008441b',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts': 'd2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5',
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'docs/tasks/20261005_1640_Budget_Request_Level_Frame_Cluster_Provenance_Protocol.md': '34de591474815cded7214907ee23b68796a7a5bccee8e4d29473ea94e5a8c5a2',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const round = (x: number) => Math.round(x * 1e6) / 1e6;

interface FrozenClusters { localPath: string; stateComparison: { treatmentClusters: { xMin: number; xMax: number; memberCount: number; level: number | null }[] } }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const targets = readJson<{ pdfs: { localPath: string; relation: string; sourceDerived: [number, number] }[] }>(MANIFEST).pdfs.filter(m => m.relation !== 'exact_same');
  const frozenT = new Map(readJson<{ pdfs: FrozenClusters[] }>(PAIRED_EVAL).pdfs.map(p => [p.localPath, p.stateComparison.treatmentClusters]));
  const layoutOf = new Map(readJson<{ perPdf: { localPath: string; ranges: { from: number; to: number; gapPages: number[]; signature: string }[] }[] }>(LAYOUT).perPdf.map(p => [p.localPath, p.ranges]));
  const pageInv = new Map(readJson<{ pdfs: { localPath: string; pages: { page: number; header: unknown; requestEvidence: string; requestDominantX: number | null }[] }[] }>(LAYOUT_PAGES).pdfs.map(p => [p.localPath, new Map(p.pages.map(q => [q.page, q]))]));

  const clusters: unknown[] = [], supportLines: string[] = [];
  const gates: Record<string, boolean> = {};
  const perPdf: unknown[] = [];
  for (const m of targets) {
    const name = m.localPath.split('/').pop()!;
    const pages: Parameters<typeof observeDocumentHierarchyV2>[1] = [];
    for (let n = m.sourceDerived[0]; n <= m.sourceDerived[1]; n++) {
      const ex = await extractPageTokens(m.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    const h = observeDocumentHierarchyV2('detail', pages, HIERARCHY_B_ONLY_OPTIONS);
    const eligible = h.nodes.filter(n => n.hierarchyEligibility === 'candidate');
    const pageRank = new Map<string, number>();
    const perPageCount = new Map<number, number>();
    for (const n of eligible) { const r = perPageCount.get(n.sourcePage) ?? 0; pageRank.set(n.id, r); perPageCount.set(n.sourcePage, r + 1); }
    const ranges = layoutOf.get(m.localPath)!;
    const inv = pageInv.get(m.localPath)!;
    const byCluster = new Map<number, typeof eligible>();
    for (const n of eligible) { const ci = n.xIndentEvidence.clusterIndex; if (ci !== null) { if (!byCluster.has(ci)) byCluster.set(ci, []); byCluster.get(ci)!.push(n); } }
    const frozen = frozenT.get(m.localPath)!;
    const a1 = h.indentClusters.length === frozen.length && JSON.stringify(sortDeep(h.indentClusters.map(k => ({ xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, level: k.level })))) === JSON.stringify(sortDeep(frozen));
    let a2 = true, a3 = true;
    const seen = new Set<string>();
    for (const k of h.indentClusters) {
      const sup = byCluster.get(k.clusterIndex) ?? [];
      if (sup.length !== k.memberCount || sup.some(n => n.xIndentEvidence.keyTokenXMin < k.xMin || n.xIndentEvidence.keyTokenXMin > k.xMax)) a2 = false;
      for (const n of sup) { if (seen.has(n.id)) a3 = false; seen.add(n.id); }
    }
    if (seen.size !== eligible.length || eligible.some(n => n.xIndentEvidence.clusterIndex === null)) a3 = false;
    gates[`${name}:A1_T2_frame_identity`] = a1; gates[`${name}:A2_support_completeness`] = a2; gates[`${name}:A3_node_uniqueness`] = a3;

    const cl: unknown[] = [];
    for (const k of h.indentClusters) {
      const sup = (byCluster.get(k.clusterIndex) ?? []).sort((a, b) => a.sourcePage - b.sourcePage || a.sourceRowRefs.logicalRowIndex - b.sourceRowRefs.logicalRowIndex);
      const feats = sup.map(n => {
        const lr = layoutRangeOf(n.sourcePage, ranges), pg = inv.get(n.sourcePage);
        const code = n.observedCodeParts.code;
        return { n, lr, pg, lexical: lexicalClassOf(n.rowShape, code) };
      });
      for (const f of feats) supportLines.push(JSON.stringify(sortDeep({
        pdf: name, clusterId: k.clusterIndex, nodeId: f.n.id, page: f.n.sourcePage, logicalRowIndex: f.n.sourceRowRefs.logicalRowIndex, keyTokenXMin: f.n.xIndentEvidence.keyTokenXMin,
        codeRaw: f.n.observedCodeParts.code, requestNoRaw: f.n.observedCodeParts.requestNo ?? null, rowShape: f.n.rowShape, lexicalClass: f.lexical, rowTokenCount: f.n.structureEvidence.rowTokenCount, nodeRankInPage: pageRank.get(f.n.id),
        eligibilityBasis: { eligibility: f.n.hierarchyEligibility, observedHeaderEvidenceKinds: f.n.headerEvidenceObserved.map(e => e.kind).sort() },
        layout: { rangeId: f.lr.id, signature: f.lr.signature, detailRange: f.lr.detail, pageHasHeader: f.pg ? f.pg.header !== null : null, requestEvidence: f.pg?.requestEvidence ?? null, requestDominantX: f.pg?.requestDominantX ?? null },
        ruleLine: 'not_available',
      })));
      const xs = sup.map(n => n.xIndentEvidence.keyTokenXMin);
      const runs = pageRuns(sup.map(n => n.sourcePage));
      const c = classifyCluster(feats.map(f => ({ page: f.n.sourcePage, layoutRangeId: f.lr.id, lexical: f.lexical, rowShape: f.n.rowShape })));
      cl.push(sortDeep({
        pdf: name, clusterId: k.clusterIndex, level: k.level, xMin: k.xMin, xMax: k.xMax, memberCount: k.memberCount, placementBasis: k.placementBasis, hasLatticeEvidence: !!k.latticeEvidence,
        support: { count: sup.length, minX: xs.length ? Math.min(...xs) : null, maxX: xs.length ? Math.max(...xs) : null, distinctX: new Set(xs).size, xSpread: xs.length ? round(Math.max(...xs) - Math.min(...xs)) : null, condition: 'x in [xMin, xMax] of the existing cluster (eligible candidate nodes, first match)' },
        pages: { unique: new Set(sup.map(n => n.sourcePage)).size, first: sup[0]?.sourcePage ?? null, last: sup[sup.length - 1]?.sourcePage ?? null, list: [...new Set(sup.map(n => n.sourcePage))], runCount: runs.length, runs },
        layoutRangeIds: [...new Set(feats.map(f => f.lr.id))].sort(cmp),
        classification: { supportExtent: c.supportExtent, layoutConcentration: c.layoutConcentration, documentDistribution: c.documentDistribution, requestRelation: c.request },
        lexicalComposition: c.lexicalComposition,
      }));
    }
    clusters.push(...cl);
    perPdf.push({ pdf: name, localPath: m.localPath, sourceDerived: m.sourceDerived, clusterCount: h.indentClusters.length, eligibleNodes: eligible.length, nodes: h.nodes.length });
    console.log(`${name} clusters=${h.indentClusters.length} eligible=${eligible.length} A1=${a1} A2=${a2} A3=${a3}`);
  }
  const supportGz = zlib.gzipSync(Buffer.from(supportLines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/phaseA-support-nodes.jsonl.gz`, supportGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-level-frame-cluster-provenance-phaseA/v0',
    note: 'source-only。基準 frame・基準範囲・MOF は未参照。cluster identity は既存 algorithm の clusterIndex。分類は記述軸で良否ではない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), supportNodesGzSha256: sha(supportGz), supportNodeCount: supportLines.length,
    gates, perPdf, clusterCount: clusters.length, clusters,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-cluster-inventory.json`, text);
  console.log(JSON.stringify({ sha: sha(text), supportGz: sha(supportGz), clusterCount: clusters.length, supportNodes: supportLines.length, gates }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
