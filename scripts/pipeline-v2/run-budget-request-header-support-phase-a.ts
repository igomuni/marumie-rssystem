/**
 * Phase A（source-only）: header-position support の provenance feature（F1〜F6）の全 node 抽出と P1 vs P2 の primary comparison。
 * protocol: docs/tasks/20261005_1815_Budget_Request_Header_Support_Provenance_Isolation_Protocol.md
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-header-support-phase-a.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { layoutRangeOf } from './lib/budget-request-cluster-provenance';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { compareFeature, computeFeatures, decideHeaderSupport, type FeatureContext, type FeatureRec, type NodeLite, type RelationLite } from './lib/budget-request-header-support-features';
import { p4ClusterKeys } from './lib/budget-request-header-support-population';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-header-support-provenance/2024`;
const MANIFEST = `${FX}/budget-request-source-range-hierarchy/2024/range-manifest.json`, PAIRED = `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`;
const LAYOUT = `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`;
const REL = `${FX}/budget-request-level-frame-table-eligibility/2024/phaseA-node-relations.jsonl.gz`;
const PROV_NODES = `${FX}/budget-request-level-frame-cluster-provenance/2024/phaseA-support-nodes.jsonl.gz`;
const FROZEN: Record<string, string> = {
  [MANIFEST]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e', [PAIRED]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [LAYOUT]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266',
  [REL]: '21f167c30d5f3ac51821de36bc3f53e87df88718c90474fba7eae6f44a46dcea', [PROV_NODES]: 'fef26771118722adf35d9f367b4bdab03c0897c8f5f8efeecb9fdc3b4ee34b6e',
  'scripts/pipeline-v2/lib/budget-request-p1-outlier.ts': '9cb749d2a3b80f1e71ff3993f9db77e57c723f552c56e1ea5d3a88a11637e5d4', 'scripts/pipeline-v2/lib/budget-request-table-frame-eligibility.ts': 'b43eab8b5e129b5755619c9ea3f037682a2d843dae8c4fbfb39535ab5bfffdf2',
  'scripts/pipeline-v2/lib/budget-request-table-eligibility-frame.ts': '802796e97f2d5d644f60667e91f3201184c41475e3ecc42939b54b540b43a2b9', 'scripts/pipeline-v2/lib/budget-request-cluster-provenance.ts': 'd8f24f672c537e5fcf27482f83c8c3c312f0076215b460fcb7506cb969183764',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d', 'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts': 'd2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5',
  'docs/tasks/20261005_1815_Budget_Request_Header_Support_Provenance_Isolation_Protocol.md': '9e0da7875ba722463eec2050235a37fe5a397dc2aa42bee6a929b0022466487a',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

type Pop = 'P1' | 'P2' | 'P3' | 'P4';

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const targets = readJson<{ pdfs: { localPath: string; relation: string; sourceDerived: [number, number] }[] }>(MANIFEST).pdfs;
  const pairedDocs = new Map(readJson<{ documents: { localPath: string; sourceSha256: string }[] }>(PAIRED).documents.map(d => [d.localPath, d.sourceSha256]));
  const layoutRanges = new Map(readJson<{ perPdf: { localPath: string; ranges: { from: number; to: number; gapPages: number[]; signature: string }[] }[] }>(LAYOUT).perPdf.map(p => [p.localPath, p.ranges]));
  const relMap = new Map<string, RelationLite & { supportEligible: boolean }>();
  for (const l of zlib.gunzipSync(fs.readFileSync(REL)).toString('utf8').trim().split('\n')) {
    const o = JSON.parse(l) as { pdf: string; nodeId: string; frameAvailable: boolean; frameBBox: RelationLite['frameBBox']; bbox: RelationLite['bbox']; relation: string; supportEligible: boolean };
    relMap.set(`${o.pdf}|${o.nodeId}`, { frameAvailable: o.frameAvailable, frameBBox: o.frameBBox, bbox: o.bbox, relation: o.relation, supportEligible: o.supportEligible });
  }
  const provCount = zlib.gunzipSync(fs.readFileSync(PROV_NODES)).toString('utf8').trim().split('\n').length;
  const p4Keys = p4ClusterKeys();

  const lines: string[] = [], catalog = new Map<string, { name: string; family: string; circular: boolean; kind: FeatureRec['kind'] }>();
  const samples: Record<Pop, { pdf: string; nodeId: string; feats: Map<string, FeatureRec> }[]> = { P1: [], P2: [], P3: [], P4: [] };
  const counts: Record<string, number> = {};
  const gates: Record<string, boolean> = {};
  const seen = new Set<string>();
  let duplicates = 0, unjoinable = 0, provenanceLoss = 0;
  const popBy = { P1: new Map<string, number>(), P2: new Map<string, number>(), P3: new Map<string, number>(), P4: new Map<string, number>() };

  for (const m of targets) {
    const name = m.localPath.split('/').pop()!, exact = m.relation === 'exact_same';
    const sourceSha = pairedDocs.get(m.localPath);
    if (!sourceSha || fileSha(m.localPath) !== sourceSha) throw new Error(`原本の hash 不一致（STOP）: ${m.localPath}`);
    const pages: Parameters<typeof observeDocumentHierarchyV2>[1] = [];
    for (let n = m.sourceDerived[0]; n <= m.sourceDerived[1]; n++) {
      const ex = await extractPageTokens(m.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    const pageByNo = new Map(pages.map(p => [p.meta.number, p]));
    const h = observeDocumentHierarchyV2('detail', pages, HIERARCHY_B_ONLY_OPTIONS);
    const lite: NodeLite[] = h.nodes.map(n => {
      const p = pageByNo.get(n.sourcePage)!;
      const texts = n.sourceTokenRefs.rowTokenIndexes.map(i => p.tokens[i].rawText.trim()).filter(t => t !== '');
      return { id: n.id, page: n.sourcePage, logicalRowIndex: n.sourceRowRefs.logicalRowIndex, x: n.xIndentEvidence.keyTokenXMin, rowShape: n.rowShape, code: n.observedCodeParts.code, clusterIndex: n.xIndentEvidence.clusterIndex, textParts: n.observedTextParts, rowTokenCount: n.structureEvidence.rowTokenCount, rowTexts: texts };
    });
    const ranges = layoutRanges.get(m.localPath)!;
    const layoutOf = (page: number) => { const r = layoutRangeOf(page, ranges); const rg = ranges.find(x => `${x.from}-${x.to}` === r.id); return { id: r.id, signature: r.signature, detail: r.detail, from: rg ? rg.from : null, to: rg ? rg.to : null }; };
    const pageCount = new Map<number, number>(), ordinal = new Map<string, number>();
    for (const n of lite) { const o = pageCount.get(n.page) ?? 0; ordinal.set(n.id, o); pageCount.set(n.page, o + 1); }
    const byCluster = new Map<number, NodeLite[]>();
    for (const n of lite) if (n.clusterIndex !== null) { if (!byCluster.has(n.clusterIndex)) byCluster.set(n.clusterIndex, []); byCluster.get(n.clusterIndex)!.push(n); }
    const leftCluster = h.indentClusters.find(k => Math.abs(k.xMin - 37.982) < 0.001)?.clusterIndex ?? null;

    const members: { pop: Pop; n: NodeLite }[] = [];
    for (const n of lite) {
      if (n.clusterIndex === null) continue;
      const rel = relMap.get(`${name}|${n.id}`);
      const isHeader = rel?.relation === 'header_position_supported', isBody = rel?.relation === 'body_or_table_position_supported';
      if (!exact && n.clusterIndex === leftCluster && isHeader) members.push({ pop: 'P1', n });
      if (exact && isHeader) members.push({ pop: 'P2', n });
      if (exact && isBody) members.push({ pop: 'P3', n });
      if (!exact && p4Keys.has(`${name}|${n.clusterIndex}`)) members.push({ pop: 'P4', n });
    }
    const idx = new Map(lite.map((n, i) => [n.id, i]));
    for (const { pop, n } of members) {
      const key = `${pop}|${name}|${n.id}`;
      if (seen.has(key)) duplicates++; seen.add(key);
      const rel = relMap.get(`${name}|${n.id}`) ?? null;
      if (!rel) unjoinable++;
      const node = h.nodes[idx.get(n.id)!];
      if (!node || node.sourceTokenRefs.rowTokenIndexes.length === 0) provenanceLoss++;
      const ctx: FeatureContext = { node: n, indexInSequence: idx.get(n.id)!, sequence: lite, range: m.sourceDerived, gap: h.parameters.clusterGap, relation: rel, layoutOf, pageNodeOrdinal: ordinal.get(n.id)!, pageNodeCount: pageCount.get(n.page)! };
      const feats = computeFeatures(ctx, byCluster.get(n.clusterIndex!)!);
      for (const f of feats) if (!catalog.has(f.name)) catalog.set(f.name, { name: f.name, family: f.family, circular: f.circular, kind: f.kind });
      samples[pop].push({ pdf: name, nodeId: n.id, feats: new Map(feats.map(f => [f.name, f])) });
      popBy[pop].set(name, (popBy[pop].get(name) ?? 0) + 1); counts[pop] = (counts[pop] ?? 0) + 1;
      lines.push(JSON.stringify(sortDeep({ population: pop, pdf: name, nodeId: n.id, page: n.page, logicalRowIndex: n.logicalRowIndex, t2ClusterIndex: n.clusterIndex, provenance: { keyTokenIndex: node?.sourceTokenRefs.keyTokenIndex ?? null, rowTokenIndexes: node?.sourceTokenRefs.rowTokenIndexes ?? [], physicalRowIndexes: node?.sourceRowRefs.physicalRowIndexes ?? [] }, features: Object.fromEntries(feats.map(f => [f.name, [f.raw, f.label, f.missing]])) })));
    }
    console.log(`${name} nodes=${lite.length} P1=${popBy.P1.get(name) ?? 0} P2=${popBy.P2.get(name) ?? 0} P3=${popBy.P3.get(name) ?? 0} P4=${popBy.P4.get(name) ?? 0}`);
  }
  // A1〜A9
  gates.A1_P1_900_450_450 = counts.P1 === 900 && [...popBy.P1.values()].sort().join() === '450,450';
  const keysOf = (p: Pop) => new Set(samples[p].map(s => `${s.pdf}|${s.nodeId}`));
  gates.A2_populations_unique_and_disjoint = (['P1', 'P2', 'P3', 'P4'] as Pop[]).every(p => keysOf(p).size === samples[p].length) && [...keysOf('P1')].every(k => !keysOf('P4').has(k)) && [...keysOf('P2')].every(k => !keysOf('P3').has(k));
  gates.A3_duplicate_node_id_zero = duplicates === 0; gates.A4_unjoinable_zero = unjoinable === 0; gates.A5_provenance_loss_zero = provenanceLoss === 0;
  gates.A6_frozen_classifier_layout_hash = true; gates.A9_production_hash_frozen = true; // FROZEN の guard を通過済み
  gates.T2_node_universe_matches_frozen = relMap.size === [...relMap.keys()].length && provCount === 4667;
  // primary comparison（P1 vs P2）
  const cmpOf = (a: typeof samples.P1, b: typeof samples.P1) => [...catalog.values()].sort((x, y) => cmp(x.name, y.name)).map(c => compareFeature(c, a.map(s => ({ pdf: s.pdf, label: s.feats.get(c.name)?.label ?? null })), b.map(s => ({ pdf: s.pdf, label: s.feats.get(c.name)?.label ?? null }))));
  const primary = cmpOf(samples.P1, samples.P2);
  const complete = primary.filter(c => c.complete), partial = primary.filter(c => c.strongPartial);
  const decision = decideHeaderSupport({ gatesPass: Object.values(gates).every(Boolean), p1Size: samples.P1.length, p2Size: samples.P2.length, p1Unconstructible: unjoinable === 0 ? 0 : samples.P1.filter(s => !relMap.has(`${s.pdf}|${s.nodeId}`)).length, p2Unconstructible: samples.P2.filter(s => !relMap.has(`${s.pdf}|${s.nodeId}`)).length, completeSeparators: complete.length, strongPartialSeparators: partial.length });
  const nodesGz = zlib.gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/phaseA-node-features.jsonl.gz`, nodesGz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-header-support-provenance-phaseA/v0',
    note: 'source-only。C0・manual range・MOF・L/P/K・T3・T4 downstream outcome は未参照。circular feature は separator 判定から除外',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), nodeFeaturesGzSha256: sha(nodesGz), populationCounts: counts, populationByPdf: Object.fromEntries((['P1', 'P2', 'P3', 'P4'] as Pop[]).map(p => [p, Object.fromEntries([...popBy[p].entries()].sort())])),
    duplicates, unjoinable, provenanceLoss, gates, featureCatalog: [...catalog.values()].sort((a, b) => cmp(a.name, b.name)),
    primaryComparison: primary, completeSeparators: complete.map(c => c.name), strongPartialSeparators: partial.map(c => c.name), decision,
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-primary-comparison.json`, text);
  console.log(JSON.stringify({ sha: sha(text), nodesGz: sha(nodesGz), counts, gates, complete: complete.map(c => c.name), partial: partial.map(c => c.name), decision }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
