/**
 * manual activation range（control）と source-derived detail range（treatment）に既存 DocumentHierarchy v2-B + FieldResolver を適用する paired runner と比較（事前登録 Source_Range_Hierarchy_Paired_Protocol）。
 * 変更点は activation range（hierarchy と FieldResolver に渡す page 集合）だけ。hierarchy algorithm・FieldResolver・options は不変。MOF（Phase B を除く）・header label・manual boundary の再現は使わない。
 * --phase=run     : 各 PDF で control / treatment を実行し row table を data/work に保存（git 管理外）
 * --phase=compare : Phase A の比較・decision を fixtures に保存（MOF を見ない）
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-source-range-hierarchy-paired.ts --phase=run|compare
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { observeDocumentHierarchyV2, type DocumentHierarchyV2Result } from './lib/budget-request-document-hierarchy-v2';
import { resolveFields, type FieldResolverPageInput, type RecordFieldResolution } from './lib/budget-request-field-resolver';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { classifyChange, decidePaired, hierarchyDerivedChanged, inventoryOf, type NodeInfo, type RowRec } from './lib/budget-request-source-range-compare';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-source-range-hierarchy', '2024');
const WORK = path.join('data', 'work', 'budget-request-source-range-hierarchy', '2024');
const MANIFEST = `${OUT}/range-manifest.json`, PAIRED = `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`, CORPUS = `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`;
const PROTOCOL = 'docs/tasks/20261005_1425_Budget_Request_Source_Range_Hierarchy_Paired_Protocol.md';
const FROZEN: Record<string, string> = {
  [MANIFEST]: '3e00df693627e1bb22274c291694ac1aed2c079daf758ceda5af084da217201e', [PAIRED]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [CORPUS]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [PROTOCOL]: '294f909669dfdf342726ff835047dd5e028f5f80cd6e2c76adae6b475e4f0362',
  'scripts/pipeline-v2/lib/budget-request-document-hierarchy-v2.ts': '4372d9ff13e127c69976f1018bb1f41c1cf691ad5eee8b6cdef439ea311eea1d', 'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts': 'd2686cf42660c0ea8593045e40cf8ae3d618a7740b882820eb86c7c4b7a392b5',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);

interface RangeRow { localPath: string; manual: [number, number]; sourceDerived: [number, number]; relation: string; totalPages: number }
interface PairedDoc { localPath: string; sourceSha256: string; baselineOnRecordsSha256: string; hierarchySegment: [number, number] }
interface Summary { clusters: { xMin: number; xMax: number; memberCount: number; level: number | null }[]; nodes: number; edges: number; firstNodeAtOrAfter: Record<string, unknown> | null }

const guard = () => { for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`); };

function rowTableOf(result: { records: RecordFieldResolution[] }, h: DocumentHierarchyV2Result): Map<string, RowRec> {
  const nodeByRow = new Map(h.nodes.map(n => [`${n.sourcePage}:${n.sourceRowRefs.logicalRowIndex}`, n]));
  const edgeByChild = new Map(h.edges.map(e => [e.childNodeId, e]));
  const out = new Map<string, RowRec>();
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

async function runPhase() {
  guard();
  const manifest = readJson<{ pdfs: RangeRow[] }>(MANIFEST).pdfs;
  const paired = new Map(readJson<{ documents: PairedDoc[] }>(PAIRED).documents.map(d => [d.localPath, d]));
  const det: Record<string, string> = {};
  for (const m of manifest) {
    const d = paired.get(m.localPath)!;
    if (fileSha(m.localPath) !== d.sourceSha256) throw new Error(`原本の hash が manifest と一致しない: ${m.localPath}`);
    const pages = new Map<number, FieldResolverPageInput>();
    for (let n = m.sourceDerived[0]; n <= m.sourceDerived[1]; n++) {
      const ex = await extractPageTokens(m.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.set(n, { meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    const runOne = (range: [number, number]) => {
      const ps: FieldResolverPageInput[] = [];
      for (let n = range[0]; n <= range[1]; n++) ps.push(pages.get(n)!);
      const h = observeDocumentHierarchyV2('detail', ps.map(p => ({ meta: p.meta, tokens: p.tokens, geometry: p.geometry, logical: p.logical })), HIERARCHY_B_ONLY_OPTIONS);
      const result = resolveFields({ pages: ps, hierarchy: h });
      return { h, result, table: rowTableOf(result, h) };
    };
    const outDir = path.join(WORK, slugOf(m.localPath));
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, range] of [['control', m.manual], ['treatment', m.sourceDerived]] as const) {
      const { h, result, table } = runOne(range);
      const [a] = m.manual;
      const first = h.nodes.filter(n => n.sourcePage >= a).sort((x, y) => x.sourcePage - y.sourcePage || x.sourceRowRefs.logicalRowIndex - y.sourceRowRefs.logicalRowIndex)[0];
      const edge = first ? h.edges.find(e => e.childNodeId === first.id) : null;
      const pageOf = (id: string | null) => (id ? Number(/-p(\d+)-r/.exec(id)?.[1] ?? 0) : null);
      const summary: Summary = {
        clusters: h.indentClusters.map(c => ({ xMin: c.xMin, xMax: c.xMax, memberCount: c.memberCount, level: c.level })), nodes: h.nodes.length, edges: h.edges.length,
        firstNodeAtOrAfter: first ? { id: first.id, page: first.sourcePage, level: first.xIndentEvidence.level, edgeStatus: edge?.status ?? null, parentId: edge?.parentNodeId ?? null, parentPage: pageOf(edge?.parentNodeId ?? null), ancestorPages: (edge?.ancestorCandidateNodeIds ?? []).map(pageOf) } : null,
      };
      const lines = result.records.map(r => JSON.stringify(r, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))).join('\n');
      const gz = zlib.gzipSync(Buffer.from(lines + '\n', 'utf8'), { level: 9 });
      const tableText = JSON.stringify([...table.entries()].sort((x, y) => cmp(x[0], y[0])));
      fs.writeFileSync(path.join(outDir, `${name}.rows.json.gz`), zlib.gzipSync(Buffer.from(tableText, 'utf8'), { level: 9 }));
      fs.writeFileSync(path.join(outDir, `${name}.summary.json`), JSON.stringify(summary));
      fs.writeFileSync(path.join(outDir, `${name}.records.jsonl.gz`), gz);
      det[`${path.basename(m.localPath)}|${name}`] = sha(tableText);
      det[`${path.basename(m.localPath)}|${name}|recordsGz`] = sha(gz);
      console.log(`run ${path.basename(m.localPath)} ${name} p${range[0]}-${range[1]} records=${result.records.length}`);
    }
    // 凍結 baseline との一致（control = baseline の ON records）
    const baseline = fileSha(path.join('data', 'work', 'budget-request-corpus-baseline', '2024', slugOf(m.localPath), `seg-${d.hierarchySegment[0]}-${d.hierarchySegment[1]}.records.jsonl.gz`));
    det[`${path.basename(m.localPath)}|controlEqualsFrozenBaseline`] = String(det[`${path.basename(m.localPath)}|control|recordsGz`] === d.baselineOnRecordsSha256 && baseline === d.baselineOnRecordsSha256);
  }
  fs.writeFileSync(path.join(WORK, 'run-digest.json'), `${JSON.stringify(sortDeep(det), null, 1)}\n`);
  console.log(JSON.stringify({ digestSha: fileSha(path.join(WORK, 'run-digest.json')) }));
}

const readTable = (lp: string, name: string): Map<string, RowRec> => new Map(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(WORK, slugOf(lp), `${name}.rows.json.gz`))).toString('utf8')) as [string, RowRec][]);
const readSummary = (lp: string, name: string) => readJson<Summary>(path.join(WORK, slugOf(lp), `${name}.summary.json`));

function comparePhase() {
  guard();
  const manifest = readJson<{ pdfs: RangeRow[] }>(MANIFEST).pdfs;
  const digest = readJson<Record<string, string>>(path.join(WORK, 'run-digest.json'));
  const pdfs: unknown[] = [];
  let infrastructureOk = true, sameRangeExact = true, intersectionChangedRows = 0, sourceOnlyItems = 0, sourceOnlyOrgs = 0, sourceOnlyResolved = 0;
  const intersectionTotals: Record<string, number> = {}, flagTotals: Record<string, number> = {};
  for (const m of manifest) {
    const name = path.basename(m.localPath);
    const c = readTable(m.localPath, 'control'), t = readTable(m.localPath, 'treatment');
    const keys = new Set([...c.keys(), ...t.keys()]);
    const region = (k: string) => { const p = Number(k.split(':')[0]); const inM = p >= m.manual[0] && p <= m.manual[1], inS = p >= m.sourceDerived[0] && p <= m.sourceDerived[1]; return inM && inS ? 'intersection' : inM ? 'manual_only' : inS ? 'source_only' : 'outside_both'; };
    const join = { controlOnly: 0, treatmentOnly: 0, both: 0 };
    const regionRows: Record<string, number> = {};
    const byClass: Record<string, number> = {}, flags: Record<string, number> = {};
    let hierarchyChanged = 0, sourceLocalChanged = 0;
    const examples: { key: string; primary: string; flags: string[] }[] = [];
    const sourceOnly: RowRec[] = [];
    for (const k of [...keys].sort(cmp)) {
      const a = c.get(k), b = t.get(k);
      inc(regionRows, region(k));
      if (a && b) {
        join.both++;
        const ch = classifyChange(a, b);
        inc(byClass, ch.primary); for (const f of ch.flags) inc(flags, f);
        if (hierarchyDerivedChanged(ch.flags)) hierarchyChanged++;
        if (ch.flags.includes('other_changed')) sourceLocalChanged++;
        if (ch.primary !== 'unchanged' && examples.length < 5) examples.push({ key: k, primary: ch.primary, flags: ch.flags });
      } else if (a) join.controlOnly++;
      else { join.treatmentOnly++; if (region(k) === 'source_only') sourceOnly.push(b!); }
      if (!a && b && region(k) === 'intersection') infrastructureOk = false;
    }
    // source_only 行のうち、control に無い（treatment only）行 = source-only region の inventory
    const inv = inventoryOf(sourceOnly);
    const exact = m.relation === 'exact_same';
    const changedRows = hierarchyChanged + sourceLocalChanged - [...keys].filter(k => { const a = c.get(k), b = t.get(k); if (!a || !b) return false; const f = classifyChange(a, b).flags; return hierarchyDerivedChanged(f) && f.includes('other_changed'); }).length;
    if (exact) { if (changedRows > 0 || join.controlOnly > 0 || join.treatmentOnly > 0) sameRangeExact = false; } else { intersectionChangedRows += changedRows; sourceOnlyItems += inv.items; sourceOnlyOrgs += inv.organizations; sourceOnlyResolved += inv.parentResolved; }
    if (digest[`${name}|controlEqualsFrozenBaseline`] !== 'true') infrastructureOk = false;
    if ([...t.values(), ...c.values()].some(r => r.tokenRefs.length === 0 && r.kind !== 'unclassified' && r.codeRaw !== null)) { /* provenance は code evidence。欠落は別集計 */ }
    for (const [k, v] of Object.entries(byClass)) inc(intersectionTotals, `${exact ? 'sameRange' : 'perturbation'}|${k}`, v);
    for (const [k, v] of Object.entries(flags)) inc(flagTotals, `${exact ? 'sameRange' : 'perturbation'}|${k}`, v);
    const sc = readSummary(m.localPath, 'control'), st = readSummary(m.localPath, 'treatment');
    pdfs.push(sortDeep({
      localPath: m.localPath, manual: m.manual, sourceDerived: m.sourceDerived, relation: m.relation, join, regionRows, changeClassPrimary: byClass, changeFlags: flags, hierarchyDerivedChangedRows: hierarchyChanged, sourceLocalChangedRows: sourceLocalChanged, changedRowsAnyField: changedRows, examples,
      sourceOnlyRegionInventory: inv, stateComparison: { controlClusters: sc.clusters, treatmentClusters: st.clusters, controlFirstNodeAtOrAfterManualStart: sc.firstNodeAtOrAfter, treatmentFirstNodeAtOrAfterManualStart: st.firstNodeAtOrAfter },
      controlEqualsFrozenBaseline: digest[`${name}|controlEqualsFrozenBaseline`], rowTableDigests: { control: digest[`${name}|control`], treatment: digest[`${name}|treatment`] },
    }));
  }
  const decision = decidePaired({ infrastructureOk, sameRangeExact, intersectionChangedRows, sourceOnlyItems, sourceOnlyOrganizations: sourceOnlyOrgs, sourceOnlyResolvedRequests: sourceOnlyResolved });
  const text = `${JSON.stringify(sortDeep({ schema: 'budget-request-source-range-hierarchy-phaseA/v0', note: 'source-only。MOF は未使用。existing hierarchy kind・manual contract は GT ではない', frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), runDigestSha256: fileSha(path.join(WORK, 'run-digest.json')) }, facts: { infrastructureOk, sameRangeExact, intersectionChangedRows, sourceOnlyItems, sourceOnlyOrganizations: sourceOnlyOrgs, sourceOnlyResolvedRequests: sourceOnlyResolved }, totals: { intersectionChangeClassPrimary: intersectionTotals, changeFlags: flagTotals }, pdfs, decision }), null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'phaseA-evaluation.json'), text);
  console.log(JSON.stringify({ sha: sha(text), facts: { infrastructureOk, sameRangeExact, intersectionChangedRows, sourceOnlyItems, sourceOnlyOrgs, sourceOnlyResolved }, totals: { intersectionTotals, flagTotals }, decision }, null, 1));
}

async function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  if (phase === 'run') await runPhase(); else if (phase === 'compare') comparePhase(); else throw new Error('--phase=run|compare が必要');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
