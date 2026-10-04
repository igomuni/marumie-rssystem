/**
 * hierarchy ON/OFF paired diagnostic の評価（事前登録 Hierarchy_Failure_Isolation_Preregistration の指標・判定規則をそのまま適用する）。
 * ON = baseline の records artifact（凍結。ON control で再現済み）、OFF = paired runner の出力。join は anchor（page + logicalRowIndex）のみ。値は補正しない。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-hierarchy-failure-isolation.ts
 * 出力: tests/fixtures/budget-request-hierarchy-failure-isolation/2024/{transition-evaluation,unclassified-inventory}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readJsonl } from './lib/jsonl';
import { anchorKey, decideIsolation, itemTransitions, joinOnOff, kindMatrix, nameStatusTransitions, parentState, requestParentTransitions, type PairRecord } from './lib/budget-request-hierarchy-paired';
import { reconcile, type MatchResult, type MofJikou, type MofSection, type PdfPopulationRecord } from './lib/budget-request-mof-reconciliation';
import type { MofBudgetJikouRecord } from './types';

const FIX = path.join('tests', 'fixtures', 'budget-request-hierarchy-failure-isolation', '2024');
const BASE_FIX = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const JIKOU_EVAL = path.join('tests', 'fixtures', 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json');
const FROZEN: Record<string, string> = {
  [path.join(FIX, 'paired-manifest.json')]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [path.join(BASE_FIX, 'corpus-manifest.json')]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a',
  [path.join(BASE_FIX, 'extraction-baseline.json')]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f',
  [path.join(BASE_FIX, 'extraction-population.json')]: '3ec53c133117033ea0c8a8f23a3196f5b28ff18120957c7531c48c6df15fdbf8',
  [path.join(BASE_FIX, 'reconciliation-result.json')]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts': 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts': '758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224',
  'docs/tasks/20261005_0730_Budget_Request_Hierarchy_Failure_Isolation_Preregistration.md': '0841ed5b9dadafc2f62b24124facc8e462238ff7bd3b07d9b916dfdaa3e2484d',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const incN = (m: Record<string, Record<string, number>>, a: string, b: string) => { inc((m[a] ??= {}), b); };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');

interface Field { status: string; value: ({ raw: string; normalized?: string } | { parentNodeRef: string }) | null; reasonCode: string | null }
interface ParentField { status: string; value: { parentNodeRef: string } | null; reasonCode: string | null }
interface Rec extends PairRecord { rowLocal: { code: Field; name: Field }; hierarchyDependent: { parentItemAssociation: ParentField; parentOrganizationAssociation: ParentField } }
interface PDoc { localPath: string; sourceSha256: string; publisherAuthority: string; accountType: string; class: string; hierarchySegment: [number, number]; baselineOnRecordsSha256: string }
interface SegRes { pages: [number, number]; mode: string; status: string; outputs: { records: { path: string; sha256: string } } | null }
interface DocRes { localPath: string; publisherAuthority: string; accountType: string; status: string; segments: SegRes[] }

const readGz = (f: string): Rec[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Rec);
const nameOf = (f: Field) => (f.status === 'resolved' && f.value && 'raw' in f.value ? { raw: f.value.raw, normalized: f.value.normalized ?? null } : null);
const codeOf = (f: Field) => (f.status === 'resolved' && f.value && 'raw' in f.value ? f.value.raw : null);
const refAnchor = (ref: string) => { const m = /-p(\d+)-r(\d+)$/.exec(ref); return m ? `${m[1]}:${m[2]}` : null; };

/** baseline の population 構築（evaluate-…-extraction.ts）と同じ規則で、item / request を P1 matcher の入力にする */
function toPopulation(recs: Rec[], d: PDoc): PdfPopulationRecord[] {
  const byAnchor = new Map(recs.map(x => [anchorKey(x), x]));
  const out: PdfPopulationRecord[] = [];
  for (const x of recs) {
    if (x.recordKind !== 'item' && x.recordKind !== 'request') continue;
    const link = (f: ParentField) => {
      if (f.status !== 'resolved' || !f.value) return { status: f.status === 'resolved' ? 'unresolved' : f.status, reasonCode: f.reasonCode, ref: null as string | null, record: null as Rec | null };
      const a = refAnchor(f.value.parentNodeRef);
      return { status: 'resolved', reasonCode: null, ref: f.value.parentNodeRef, record: a ? byAnchor.get(a) ?? null : null };
    };
    const org = link(x.hierarchyDependent.parentOrganizationAssociation);
    const item = x.recordKind === 'request' ? link(x.hierarchyDependent.parentItemAssociation) : null;
    out.push({
      runId: `${d.localPath}@${d.hierarchySegment[0]}-${d.hierarchySegment[1]}`, canonicalUrl: d.localPath, sourceAuthority: d.publisherAuthority, accountType: d.accountType,
      page: x.anchor.page, logicalRowIndex: x.anchor.logicalRowIndex, recordKind: x.recordKind, rawCode: codeOf(x.rowLocal.code), nameStatus: x.rowLocal.name.status, name: nameOf(x.rowLocal.name),
      parentOrganization: { status: org.status, reasonCode: org.reasonCode, ref: org.ref, recordKind: org.record?.recordKind ?? null, name: org.record ? nameOf(org.record.rowLocal.name) : null, rawCode: null },
      parentItem: item ? { status: item.status, reasonCode: item.reasonCode, ref: item.ref, recordKind: item.record?.recordKind ?? null, name: item.record ? nameOf(item.record.rowLocal.name) : null, rawCode: item.record ? codeOf(item.record.rowLocal.code) : null } : null,
    } as PdfPopulationRecord);
  }
  return out;
}

const reached = (r: MatchResult) => ['exact_unique', 'exact_ambiguous', 'no_exact_match'].includes(r.classification);

function funnel(pop: PdfPopulationRecord[], results: MatchResult[]) {
  const gen = pop.map((p, i) => ({ p, r: results[i] })).filter(x => x.p.accountType === 'general' && x.p.recordKind === 'request');
  return {
    requestsGeneralAccount: gen.length,
    nameAvailable: gen.filter(x => x.p.name !== null).length,
    parentItemKindResolved: gen.filter(x => x.p.name !== null && x.p.parentItem?.status === 'resolved' && x.p.parentItem.recordKind === 'item').length,
    parentMofExactUnique_comparable: gen.filter(x => reached(x.r)).length,
    jikouExactUnique: gen.filter(x => x.r.classification === 'exact_unique').length,
    byClass: Object.fromEntries(Object.entries(gen.reduce<Record<string, number>>((m, x) => { inc(m, x.r.classification); return m; }, {})).sort(([a], [b]) => cmp(a, b))),
  };
}

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const jikouSha = fileSha(JIKOU);
  if (jikouSha !== (JSON.parse(fs.readFileSync(JIKOU_EVAL, 'utf8')) as { output: { sha256: string } }).output.sha256) throw new Error('budget-jikou.jsonl が #371 の記録と一致しない（STOP）');
  const control = JSON.parse(fs.readFileSync(path.join(FIX, 'on-control.json'), 'utf8')) as { allMatched: boolean };
  const offDiag = JSON.parse(fs.readFileSync(path.join(FIX, 'off-diagnostic.json'), 'utf8')) as { documents: { localPath: string; recordsSha256: string }[] };
  const docs = (JSON.parse(fs.readFileSync(path.join(FIX, 'paired-manifest.json'), 'utf8')) as { documents: PDoc[] }).documents.filter(d => d.class === 'paired_evaluable');

  const jikouRows = readJsonl<MofBudgetJikouRecord>(JIKOU);
  const sm = new Map<string, MofSection>();
  for (const j of jikouRows) if (!sm.has(j.parentSectionId)) sm.set(j.parentSectionId, { id: j.parentSectionId, organization: j.organization, sectionName: j.sectionName });
  const sections = [...sm.values()];
  const jikou: MofJikou[] = jikouRows.map(j => ({ parentSectionId: j.parentSectionId, jikouName: j.jikouName, recordId: j.recordId }));

  // ---- paired join ----
  const perPdf: Record<string, unknown>[] = [];
  const allPairs: ReturnType<typeof joinOnOff<Rec>>['pairs'] = [];
  const onAll: Rec[] = [], offAll: Rec[] = [];
  const joinAll = { unjoinableOn: [] as string[], unjoinableOff: [] as string[], duplicateOn: [] as string[], duplicateOff: [] as string[] };
  let pageSetsEqual = true;
  const onPop: PdfPopulationRecord[] = [], offPop: PdfPopulationRecord[] = [];
  const stat = { I: 0, R: 0, X: 0, Y: 0, P: 0 };
  const sI: Record<string, number> = {}, sP: Record<string, number> = {};
  const byPublisher: Record<string, Record<string, number>> = {};
  const kindMatrixByPdf: Record<string, unknown> = {};
  const tag = (d: PDoc, ...ids: (string | number)[]) => `${slugOf(d.localPath).slice(0, 60)}::${ids.join(':')}`;
  const sidesByPdf = new Map<string, { on: Rec[]; off: Rec[]; doc: PDoc }>();

  for (const d of docs) {
    const [from, to] = d.hierarchySegment;
    const onFile = path.join(BASE_WORK, slugOf(d.localPath), `seg-${from}-${to}.records.jsonl.gz`);
    const offFile = path.join(OFF_WORK, slugOf(d.localPath), `seg-${from}-${to}.records.jsonl.gz`);
    if (fileSha(onFile) !== d.baselineOnRecordsSha256) throw new Error(`ON artifact の hash 不一致: ${onFile}`);
    if (fileSha(offFile) !== offDiag.documents.find(x => x.localPath === d.localPath)?.recordsSha256) throw new Error(`OFF artifact の hash 不一致: ${offFile}`);
    const on = readGz(onFile), off = readGz(offFile);
    sidesByPdf.set(d.localPath, { on, off, doc: d });
    const pagesOf = (rs: Rec[]) => [...new Set(rs.map(r => r.anchor.page))].sort((a, b) => a - b).join(',');
    const samePages = pagesOf(on) === pagesOf(off);
    if (!samePages) pageSetsEqual = false;
    const j = joinOnOff(on, off);
    for (const k of ['unjoinableOn', 'unjoinableOff', 'duplicateOn', 'duplicateOff'] as const) joinAll[k].push(...j[k].map(x => tag(d, x)));
    allPairs.push(...j.pairs); onAll.push(...on); offAll.push(...off);
    const it = itemTransitions(j, on);
    const rp = requestParentTransitions(j, on, off);
    const km = kindMatrix(j.pairs);
    kindMatrixByPdf[d.localPath] = km;
    const onSide = new Map(on.map(r => [anchorKey(r), r])), offSide = new Map(off.map(r => [anchorKey(r), r]));
    let I = 0, R = 0, X = 0, Y = 0, P = 0;
    for (const p of j.pairs) {
      if (p.on.recordKind === 'item') { if (p.off.recordKind === 'item') R++; else I++; }
      if (p.off.recordKind === 'unclassified') { if (p.on.recordKind === 'unclassified') Y++; else X++; }
      if (p.on.recordKind === 'request' && parentState(p.on, onSide) === 'resolved_item' && parentState(p.off, offSide) !== 'resolved_item') P++;
    }
    stat.I += I; stat.R += R; stat.X += X; stat.Y += Y; stat.P += P;
    if (I > 0) inc(sI, d.localPath); if (P > 0) inc(sP, d.localPath);
    incN(byPublisher, d.publisherAuthority, 'I'); byPublisher[d.publisherAuthority].I += I - 1; // 初期化用（下で加算）
    byPublisher[d.publisherAuthority].R = (byPublisher[d.publisherAuthority].R ?? 0) + R; byPublisher[d.publisherAuthority].X = (byPublisher[d.publisherAuthority].X ?? 0) + X; byPublisher[d.publisherAuthority].P = (byPublisher[d.publisherAuthority].P ?? 0) + P;
    onPop.push(...toPopulation(on, d)); offPop.push(...toPopulation(off, d));
    perPdf.push({
      localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, segment: d.hierarchySegment, onRecords: on.length, offRecords: off.length, joined: j.pairs.length,
      unjoinableOn: j.unjoinableOn.length, unjoinableOff: j.unjoinableOff.length, duplicateOn: j.duplicateOn.length, duplicateOff: j.duplicateOff.length, pageSetsEqual: samePages,
      itemTransitions: it, requestParentTransitions: rp, I, R, X, Y, P,
      onByKind: on.reduce<Record<string, number>>((m, r) => { inc(m, r.recordKind); return m; }, {}), offByKind: off.reduce<Record<string, number>>((m, r) => { inc(m, r.recordKind); return m; }, {}),
    });
  }

  // ---- funnel (P1 matcher 無修正) ----
  const onRes = reconcile(onPop, sections, jikou), offRes = reconcile(offPop, sections, jikou);
  const fOn = funnel(onPop, onRes), fOff = funnel(offPop, offRes);
  const itemsOn = onPop.map((p, i) => ({ p, r: onRes[i] })).filter(x => x.p.recordKind === 'item' && x.p.accountType === 'general');

  // ---- 68 件（parent_item_not_item_kind、baseline の一般会計 request）を ON/OFF で追う ----
  const base = JSON.parse(fs.readFileSync(path.join(BASE_FIX, 'reconciliation-result.json'), 'utf8')) as { records: { localPath: string; page: number; logicalRowIndex: number; recordKind: string; accountType: string; classification: string; diagnostic: string | null }[] };
  const nik = base.records.filter(r => r.diagnostic === 'parent_unresolved:parent_item_not_item_kind');
  const nikOut: Record<string, unknown> = { total: nik.length, inPairedPopulation: 0, notInPairedPopulation: 0, byPublisher: {}, onParentRecordKind: {}, offParentState: {}, offRecordKind: {}, stillNotItemKindInOff: 0 };
  const onPopByKey = new Map(onPop.map(p => [`${p.canonicalUrl}|${p.page}:${p.logicalRowIndex}`, p]));
  for (const r of nik) {
    const side = sidesByPdf.get(r.localPath);
    const pub = (JSON.parse(fs.readFileSync(path.join(BASE_FIX, 'corpus-manifest.json'), 'utf8')) as { documents: { localPath: string; publisherAuthority: string }[] }).documents.find(x => x.localPath === r.localPath)?.publisherAuthority ?? 'unknown';
    inc(nikOut.byPublisher as Record<string, number>, pub);
    if (!side) { (nikOut.notInPairedPopulation as number)++; continue; }
    (nikOut.inPairedPopulation as number)++;
    const k = `${r.page}:${r.logicalRowIndex}`;
    const on = side.on.find(x => anchorKey(x) === k), off = side.off.find(x => anchorKey(x) === k);
    const pk = onPopByKey.get(`${r.localPath}|${k}`)?.parentItem?.recordKind ?? 'not_available';
    inc(nikOut.onParentRecordKind as Record<string, number>, pk);
    const offMap = new Map(side.off.map(x => [anchorKey(x), x]));
    const os = off ? parentState(off, offMap) : 'off_missing';
    inc(nikOut.offParentState as Record<string, number>, os);
    inc(nikOut.offRecordKind as Record<string, number>, off?.recordKind ?? 'off_missing');
    if (os === 'resolved_non_item') (nikOut.stillNotItemKindInOff as number)++;
    void on;
  }

  // ---- unclassified inventory（baseline 全 82 PDF。既存 metadata のみ、人手ラベルなし） ----
  const manifest = JSON.parse(fs.readFileSync(path.join(BASE_FIX, 'corpus-manifest.json'), 'utf8')) as { documents: { localPath: string; publisherAuthority: string; accountType: string }[] };
  const inv = { total: 0, byMode: {} as Record<string, number>, byPublisher: {} as Record<string, number>, byPdf: {} as Record<string, number>, byNameStatus: {} as Record<string, Record<string, number>>, byColumnLayout: {} as Record<string, number>, neighbor: {} as Record<string, Record<string, number>>, pagesWithUnclassified: { hierarchy_enabled: 0, null_hierarchy: 0 }, byPdfMode: {} as Record<string, Record<string, number>>, recordsByMode: {} as Record<string, Record<string, number>> };
  const neighbors = (recs: Rec[], i: number) => `${recs[i - 1] ? recs[i - 1].recordKind : 'segment_start'}|${recs[i + 1] ? recs[i + 1].recordKind : 'segment_end'}`;
  for (const d of manifest.documents) {
    const f = path.join(BASE_WORK, slugOf(d.localPath), 'result.json');
    const res = JSON.parse(fs.readFileSync(f, 'utf8')) as DocRes;
    for (const seg of res.segments) {
      if (seg.status !== 'success' || !seg.outputs) continue;
      const recs = readGz(seg.outputs.records.path);
      const meta = JSON.parse(fs.readFileSync(seg.outputs.records.path.replace('.records.jsonl.gz', '.meta.json'), 'utf8')) as { pageDiagnostics: { page: number; columnLayout: unknown | null }[] };
      const layoutByPage = new Map(meta.pageDiagnostics.map(p => [p.page, p.columnLayout !== null]));
      const pagesSeen = new Set<number>();
      recs.forEach((r, i) => {
        inc((inv.recordsByMode[seg.mode] ??= {}), r.recordKind);
        if (r.recordKind !== 'unclassified') return;
        inv.total++; inc(inv.byMode, seg.mode); inc(inv.byPublisher, d.publisherAuthority); inc(inv.byPdf, d.localPath); incN(inv.byPdfMode, d.localPath, seg.mode);
        incN(inv.byNameStatus, seg.mode, `${r.rowLocal.name.status}/${r.rowLocal.name.reasonCode ?? 'none'}`);
        inc(inv.byColumnLayout, `${seg.mode}|${layoutByPage.get(r.anchor.page) ? 'layout_observed' : 'layout_unobserved'}`);
        incN(inv.neighbor, seg.mode, neighbors(recs, i)); pagesSeen.add(r.anchor.page);
      });
      inv.pagesWithUnclassified[seg.mode as 'hierarchy_enabled' | 'null_hierarchy'] += pagesSeen.size;
    }
  }
  // paired OFF で新たに生じた unclassified（X: ON が unclassified 以外）の構成。ON 側の kind、name status、OFF 側の前後 kind
  const offNew = { total: 0, onKind: {} as Record<string, number>, nameStatus: {} as Record<string, number>, neighbor: {} as Record<string, number>, offUnclassifiedTotal: 0, offUnclassifiedNameStatus: {} as Record<string, number>, offUnclassifiedNeighbor: {} as Record<string, number> };
  for (const { on, off } of sidesByPdf.values()) {
    const onBy = new Map(on.map(r => [anchorKey(r), r]));
    off.forEach((r, i) => {
      if (r.recordKind !== 'unclassified') return;
      offNew.offUnclassifiedTotal++; inc(offNew.offUnclassifiedNameStatus, `${r.rowLocal.name.status}/${r.rowLocal.name.reasonCode ?? 'none'}`); inc(offNew.offUnclassifiedNeighbor, neighbors(off, i));
      const o = onBy.get(anchorKey(r));
      if (!o || o.recordKind === 'unclassified') return;
      offNew.total++; inc(offNew.onKind, o.recordKind); inc(offNew.nameStatus, `${r.rowLocal.name.status}/${r.rowLocal.name.reasonCode ?? 'none'}`); inc(offNew.neighbor, neighbors(off, i));
    });
  }

  // ---- 74 PDF の観測（baseline）: hierarchy を持たない PDF の records ----
  const hierPaths = new Set(docs.map(d => d.localPath));
  const obs74 = { pdfs: 0, byKind: {} as Record<string, number>, requestParentItemStatus: {} as Record<string, number> };
  for (const d of manifest.documents) {
    if (hierPaths.has(d.localPath)) continue;
    const res = JSON.parse(fs.readFileSync(path.join(BASE_WORK, slugOf(d.localPath), 'result.json'), 'utf8')) as DocRes;
    obs74.pdfs++;
    for (const seg of res.segments) {
      if (seg.status !== 'success' || !seg.outputs) continue;
      for (const r of readGz(seg.outputs.records.path)) { inc(obs74.byKind, r.recordKind); if (r.recordKind === 'request') inc(obs74.requestParentItemStatus, r.hierarchyDependent.parentItemAssociation.status); }
    }
  }

  // ---- 名称 status と判定 ----
  const nameT = nameStatusTransitions(allPairs);
  const reasonsOfInterest = ['column_layout_unobserved', 'continuation_ambiguous', 'no_name_token'];
  const reasonCounts = Object.fromEntries(reasonsOfInterest.map(r => [r, { on: onAll.filter(x => x.rowLocal.name.reasonCode === r).length, off: offAll.filter(x => x.rowLocal.name.reasonCode === r).length }]));
  const pubOf = (lp: string) => docs.find(d => d.localPath === lp)!.publisherAuthority;
  const facts = {
    controlMatched: control.allMatched, unjoinable: joinAll.unjoinableOn.length + joinAll.unjoinableOff.length, duplicates: joinAll.duplicateOn.length + joinAll.duplicateOff.length, pageSetsEqual, offRunFailed: false,
    pairedPdfs: docs.length, publishers: new Set(docs.map(d => d.publisherAuthority)).size,
    ...stat, Con: fOn.parentMofExactUnique_comparable, Coff: fOff.parentMofExactUnique_comparable,
    pdfsWithI: Object.keys(sI).length, publishersWithI: new Set(Object.keys(sI).map(pubOf)).size, pdfsWithP: Object.keys(sP).length, publishersWithP: new Set(Object.keys(sP).map(pubOf)).size,
  };
  const decision = decideIsolation(facts);

  const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  void total; void itemsOn;
  const out = sortDeep({
    schema: 'budget-request-hierarchy-failure-isolation/v0',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), mofJikouSha256: jikouSha, onControlAllMatched: control.allMatched, pairedManifest: 'paired-manifest.json' },
    join: { joined: allPairs.length, onRecords: onAll.length, offRecords: offAll.length, unjoinableOn: joinAll.unjoinableOn.length, unjoinableOff: joinAll.unjoinableOff.length, duplicateOn: joinAll.duplicateOn.length, duplicateOff: joinAll.duplicateOff.length, pageSetsEqual, unjoinableSamples: [...joinAll.unjoinableOn, ...joinAll.unjoinableOff].slice(0, 10) },
    kindMatrix: kindMatrix(allPairs), kindMatrixByPdf,
    itemTransitions: itemTransitions({ pairs: allPairs, unjoinableOn: joinAll.unjoinableOn.map(x => x.split('::')[1]), unjoinableOff: [], duplicateOn: [], duplicateOff: [] }, []),
    requestParentTransitions: (() => { const o: Record<string, number> = {}; for (const r of perPdf) for (const [k, v] of Object.entries(r.requestParentTransitions as Record<string, number>)) inc(o, k, v); return o; })(),
    nameStatus: { unchanged: nameT.unchanged, changed: nameT.changed, unchangedByLabel: nameT.byReasonUnchanged, reasonCounts },
    funnel: { on: fOn, off: fOff },
    stats: facts, byPublisher,
    perPdf,
    parentItemNotItemKind68: nikOut,
    unclassifiedOffNew: offNew,
    fullCorpusObservation74Pdfs: obs74,
    decision,
  });
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(path.join(FIX, 'transition-evaluation.json'), text);
  const invText = `${JSON.stringify(sortDeep({ schema: 'budget-request-baseline-unclassified-inventory/v0', scope: 'baseline 82 PDF（成功区間）の recordKind=unclassified を既存 metadata だけで集計。人手ラベルなし', ...inv }), null, 2)}\n`;
  fs.writeFileSync(path.join(FIX, 'unclassified-inventory.json'), invText);
  console.log(JSON.stringify({ transitionSha: sha(text), inventorySha: sha(invText), decision, facts, kindMatrix: (out as { kindMatrix: unknown }).kindMatrix }, null, 1));
}

main();
