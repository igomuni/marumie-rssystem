/**
 * item-shaped geometry の行（rule-line anchor 基準の offset が既存 item の offset クラスタに入る 3 桁 plain code 行 887）を、既存 DocumentHierarchy がどう意味分離しているかの inventory（research-only、production 不変）。
 * 既存の ON kind は human GT ではなく、既存 hierarchy が同じ geometry population をどう分けているかを説明する control label。MOF は使わない。
 * --phase=population : 887 を既存 artifact から再構成し row-level evidence を保存（件数の再現のみ）
 * --phase=evaluate   : 事前登録した指標・mechanism 分類・判定規則を適用
 * 使い方: npx tsx scripts/pipeline-v2/inventory-budget-request-semantic-boundary.ts --phase=population|evaluate
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { codeClass } from './lib/budget-request-layout-inventory';
import { BASIS, decideBoundary, mechanismOf, unclassifiedClassOf } from './lib/budget-request-semantic-boundary';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-semantic-boundary', '2024');
const P = {
  thin: `${FX}/budget-request-rule-line-geometry/2024/rule-line-thin-anchor-development.json`, decision: `${FX}/budget-request-rule-line-geometry/2024/rule-line-decision.json`,
  fullEval: `${FX}/budget-request-range-local-item-extraction/2024/full-evaluation.json`, pairedManifest: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`,
  protocol: 'docs/tasks/20261005_0905_Budget_Request_Semantic_Boundary_Inventory_Preregistration.md',
};
const FROZEN: Record<string, string> = {
  [P.thin]: 'a45951b54bd814c575ebd821d8edd2f7c13424ca1ed8503327500e887ec7ae86', [P.decision]: 'ab1f802877bef2164894b4d5d9e2bcd7921897457f198b315643af57b9fbcbd0',
  [P.fullEval]: '421dbf8b3165057926ba21c84a7debb549a31941dfc8c62df2e39df651c9519d', [P.pairedManifest]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
};
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const incN = (m: Record<string, Record<string, number>>, a: string, b: string) => { inc((m[a] ??= {}), b); };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const json = (o: unknown) => `${JSON.stringify(sortDeep(o), null, 1)}\n`;
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

interface Ev { page: number; sourceTokenRefs: number[]; sourceRowRefs: unknown[]; bboxUnion: { xMin: number } }
interface Rec {
  anchor: { page: number; logicalRowIndex: number }; recordKind: string; recordKindBasis: string;
  rowLocal: { code: { status: string; value: { raw: string } | null; evidence: Ev | null }; name: { status: string; reasonCode: string | null; value: { raw: string; normalized: string } | null; evidence: Ev | null } };
  hierarchyDependent: { parentItemAssociation: { status: string; reasonCode: string | null; value: { parentNodeRef: string } | null }; parentOrganizationAssociation: { status: string; reasonCode: string | null; value: { parentNodeRef: string } | null } };
}
const codeX = (r: Rec) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);
interface ThinRange { localPath: string; accountType: string; from: number; to: number; variant: string; rangeAnchor: { status: string; x: number | null } }
interface FullPdf { localPath: string; publisherAuthority: string; ranges: { from: number; to: number; signature: string; status: string; refX: number | null; requests: number }[] }

const LIMIT = 'existing ON kind は human GT ではない。既存 DocumentHierarchy が同じ geometry population をどう分けているかを説明する control label に限る。MOF は使わない。';

function buildPopulation() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const thin = readJson<{ ranges: ThinRange[] }>(P.thin).ranges;
  const full = new Map(readJson<{ perPdf: FullPdf[] }>(P.fullEval).perPdf.map(p => [p.localPath, p]));
  const paired = new Map(readJson<{ documents: { localPath: string; class: string; hierarchySegment: [number, number]; publisherAuthority: string }[] }>(P.pairedManifest).documents.filter(d => d.class === 'paired_evaluable').map(d => [d.localPath, d]));
  const itemOffsets = new Set<string>();
  const cache = new Map<string, Rec[]>();
  const seg = (lp: string): Rec[] => {
    if (!cache.has(lp)) {
      const c = paired.get(lp)!; const res = readJson<{ segments: { mode: string; outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slugOf(lp), 'result.json'));
      const all = res.segments.flatMap(s => readGz<Rec>(s.outputs.records.path));
      cache.set(lp, all.filter(r => r.anchor.page >= c.hierarchySegment[0] && r.anchor.page <= c.hierarchySegment[1]).sort((a, b) => a.anchor.page - b.anchor.page || a.anchor.logicalRowIndex - b.anchor.logicalRowIndex));
    }
    return cache.get(lp)!;
  };
  const inRange = (lp: string, r: ThinRange) => { const c = paired.get(lp)!; return seg(lp).filter(x => x.anchor.page >= Math.max(r.from, c.hierarchySegment[0]) && x.anchor.page <= Math.min(r.to, c.hierarchySegment[1])); };
  const ranges = thin.filter(r => paired.has(r.localPath) && r.rangeAnchor.x !== null);
  for (const r of ranges) for (const x of inRange(r.localPath, r)) { const cx = codeX(x); if (x.recordKind === 'item' && cx !== null) itemOffsets.add(r1(cx - (r.rangeAnchor.x as number))); }
  const rows: Record<string, unknown>[] = [];
  const keys = new Set<string>();
  let duplicates = 0;
  for (const r of ranges) {
    const recs = seg(r.localPath);
    const fr = full.get(r.localPath)!.ranges.find(x => x.from === r.from && x.to === r.to)!;
    const pageIdx = new Map<number, number>();
    const inR = inRange(r.localPath, r);
    inR.forEach((rec, i) => {
      const raw = rec.rowLocal.code.value?.raw; const cx = codeX(rec);
      if (cx === null || !raw || !/^\d{3}$/.test(raw)) return;
      const off = r1(cx - (r.rangeAnchor.x as number));
      if (!itemOffsets.has(off)) return;
      const idxAll = recs.indexOf(rec);
      const nb = (d: number) => { const n = recs[idxAll + d]; return n ? { kind: n.recordKind, codeClass: codeClass(n as never), nameStatus: n.rowLocal.name.status, page: n.anchor.page } : null; };
      const key = `${r.localPath}|${rec.anchor.page}:${rec.anchor.logicalRowIndex}`;
      if (keys.has(key)) duplicates++; keys.add(key);
      const pageRows = recs.filter(x => x.anchor.page === rec.anchor.page);
      pageIdx.set(rec.anchor.page, pageRows.length);
      let sinceRequest: number | null = null;
      for (let d = 1; d <= 50 && idxAll - d >= 0; d++) if (recs[idxAll - d].recordKind === 'request') { sinceRequest = d; break; }
      let sinceHeading: number | null = null;
      for (let d = 1; d <= 50 && idxAll - d >= 0; d++) if (['organization', 'item'].includes(recs[idxAll - d].recordKind)) { sinceHeading = d; break; }
      rows.push({
        key, localPath: r.localPath, publisherAuthority: paired.get(r.localPath)!.publisherAuthority, accountType: r.accountType, rangeFrom: r.from, rangeTo: r.to, layoutVariant: r.variant,
        page: rec.anchor.page, logicalRowIndex: rec.anchor.logicalRowIndex, onKind: rec.recordKind, onKindBasis: rec.recordKindBasis,
        rawCode: raw, codeClass: codeClass(rec as never), codeDigits: raw.length, nameStatus: rec.rowLocal.name.status, nameReason: rec.rowLocal.name.reasonCode, nameRaw: rec.rowLocal.name.value?.raw ?? null, nameNormalized: rec.rowLocal.name.value?.normalized ?? null,
        codeX: Math.round(cx * 1000) / 1000, nameX: rec.rowLocal.name.evidence ? Math.round(rec.rowLocal.name.evidence.bboxUnion.xMin * 1000) / 1000 : null, anchorX: r.rangeAnchor.x, offsetFromAnchor: off,
        rangeRequestRefX: fr.refX, offsetFromRangeRequestRef: fr.refX === null ? null : Math.round((cx - fr.refX) * 10) / 10, headerPresent: true,
        rowIndexInPage: pageRows.indexOf(rec), pageRowCount: pageRows.length, firstInRange: idxAll === 0 || recs[idxAll - 1].anchor.page < r.from, lastInRange: idxAll === recs.length - 1 || recs[idxAll + 1].anchor.page > r.to,
        neighbors: { prev3: nb(-3), prev2: nb(-2), prev1: nb(-1), next1: nb(1), next2: nb(2), next3: nb(3) }, rowsSinceRequest: sinceRequest, rowsSinceHeadingKind: sinceHeading,
        parentOrganizationRef: rec.hierarchyDependent.parentOrganizationAssociation.value?.parentNodeRef ?? null, parentItemRef: rec.hierarchyDependent.parentItemAssociation.value?.parentNodeRef ?? null,
        provenance: { codeSourceTokenRefs: rec.rowLocal.code.evidence?.sourceTokenRefs ?? [], codeSourceRowRefs: rec.rowLocal.code.evidence?.sourceRowRefs ?? [] },
      });
    });
  }
  rows.sort((a, b) => cmp(a.key as string, b.key as string));
  const byKind: Record<string, number> = {};
  for (const r of rows) inc(byKind, r.onKind as string);
  return { rows, byKind, duplicates, itemOffsets: [...itemOffsets].sort() };
}

function populationArtifact() {
  const { rows, byKind, duplicates, itemOffsets } = buildPopulation();
  const reproduced = rows.length === 887 && byKind.item === 97 && byKind.detail_line === 613 && byKind.unclassified === 170 && byKind.organization === 7 && duplicates === 0;
  return { text: json({ schema: 'budget-request-semantic-boundary-population/v0', limitation: LIMIT, scope: 'rule-line anchor（range-anchor）基準の offset が既存 item の offset クラスタに入る 3 桁 plain code 行（control 8 PDF の hierarchy 区間・development detail range 内）', itemOffsetClusters: itemOffsets, counts: { total: rows.length, byKind, duplicatesByLocator: duplicates }, reproduced, rows }), reproduced, byKind, total: rows.length, duplicates };
}

function evaluate() {
  const popText = fs.readFileSync(path.join(OUT, 'population-887.json'), 'utf8');
  const fresh = populationArtifact();
  const popReproduced = fresh.text === popText && fresh.reproduced;
  const pop = JSON.parse(popText) as { rows: Record<string, any>[] };
  const rows = pop.rows;
  const BAND = [-7.9, -5.9]; // 前回 frozen rule（−6.9pt ±1.0pt）
  const kinds = ['item', 'detail_line', 'organization', 'unclassified'];
  const basisByKind: Record<string, Record<string, number>> = {}, mechByKind: Record<string, Record<string, number>> = {}, unclassifiedClasses: Record<string, number> = {};
  const unclByPdf: Record<string, Record<string, number>> = {}, unclByOffset: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    incN(basisByKind, r.onKind, r.onKindBasis);
    incN(mechByKind, r.onKind, mechanismOf(r.onKindBasis, r.nameReason));
    if (r.onKind === 'unclassified') { const c = unclassifiedClassOf(r.onKindBasis, r.nameReason); inc(unclassifiedClasses, c); incN(unclByPdf, path.basename(r.localPath), c); incN(unclByOffset, r.offsetFromAnchor, c); }
  }
  // item vs detail_line / organization / unclassified: request-relative offset（range-local frame）
  const relHist: Record<string, Record<string, number>> = {}, anchorHist: Record<string, Record<string, number>> = {};
  for (const r of rows) { incN(relHist, r.onKind, r.offsetFromRangeRequestRef === null ? 'null' : r.offsetFromRangeRequestRef.toFixed(1)); incN(anchorHist, r.onKind, r.offsetFromAnchor); }
  const inBand = (r: Record<string, any>) => r.offsetFromRangeRequestRef !== null && r.offsetFromRangeRequestRef >= BAND[0] && r.offsetFromRangeRequestRef <= BAND[1];
  const bandCounts = Object.fromEntries(kinds.map(k => [k, { rows: rows.filter(r => r.onKind === k).length, inBand: rows.filter(r => r.onKind === k && inBand(r)).length }]));
  // 同じ anchor offset のセルごとの kind（PDF × anchor offset）
  const cells: Record<string, Record<string, number>> = {};
  for (const r of rows) incN(cells, `${path.basename(r.localPath)}|${r.layoutVariant}|${r.offsetFromAnchor}`, r.onKind);
  const sameAnchorOffsetMixed: Record<string, Record<string, number>> = {};
  for (const r of rows) incN(sameAnchorOffsetMixed, r.offsetFromAnchor, r.onKind);
  // organization 7 vs item: row-local feature の disjoint 検査
  const items = rows.filter(r => r.onKind === 'item'), orgs = rows.filter(r => r.onKind === 'organization');
  const features: Record<string, (r: Record<string, any>) => string> = { codeDigits: r => String(r.codeDigits), codeClass: r => r.codeClass, nameStatusReason: r => `${r.nameStatus}/${r.nameReason}`, nameResolved: r => String(r.nameStatus === 'resolved'), headerPresent: r => String(r.headerPresent), layoutVariant: r => r.layoutVariant };
  const featureDisjoint: Record<string, { item: string[]; organization: string[]; disjoint: boolean }> = {};
  for (const [k, f] of Object.entries(features)) { const a = new Set(items.map(f)), b = new Set(orgs.map(f)); featureDisjoint[k] = { item: [...a].sort(), organization: [...b].sort(), disjoint: [...a].every(v => !b.has(v)) }; }
  // sequence evidence
  const seq: Record<string, { prev1: Record<string, number>; next1: Record<string, number>; withRequestWithin3Before: number; firstInPage: number; firstInRange: number; rows: number }> = {};
  for (const k of kinds) { const rs = rows.filter(r => r.onKind === k); const s = { prev1: {} as Record<string, number>, next1: {} as Record<string, number>, withRequestWithin3Before: 0, firstInPage: 0, firstInRange: 0, rows: rs.length }; for (const r of rs) { inc(s.prev1, r.neighbors.prev1 ? `${r.neighbors.prev1.kind}` : 'none'); inc(s.next1, r.neighbors.next1 ? `${r.neighbors.next1.kind}` : 'none'); if (r.rowsSinceRequest !== null && r.rowsSinceRequest <= 3) s.withRequestWithin3Before++; if (r.rowIndexInPage === 0) s.firstInPage++; if (r.firstInRange) s.firstInRange++; } seq[k] = s; }
  // item・organization の root 関係
  const orgBasisRoot = orgs.every(r => r.onKindBasis === BASIS.root);
  const itemBasisChild = items.every(r => r.onKindBasis === BASIS.childOfRoot);
  const itemOrgRelSame = orgs.length > 0 && orgs.every(r => inBand(r));
  const mechCounts: Record<string, number> = {};
  for (const r of rows) if (['item', 'detail_line', 'organization'].includes(r.onKind)) inc(mechCounts, mechanismOf(r.onKindBasis, r.nameReason));
  const facts = {
    populationReproduced: popReproduced,
    itemVsDetailSeparable: bandCounts.detail_line.inBand === 0 && bandCounts.item.inBand === bandCounts.item.rows && bandCounts.item.rows === 97,
    orgMechanismIdentified: orgBasisRoot && itemBasisChild,
    m3Rows: mechCounts.M3_contract_dependent ?? 0,
  };
  const decision = decideBoundary(facts);
  return json({
    schema: 'budget-request-semantic-boundary-evaluation/v0', limitation: LIMIT,
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), population: sha(popText), protocol: fileSha(P.protocol) },
    population: { total: rows.length, byKind: Object.fromEntries(kinds.map(k => [k, rows.filter(r => r.onKind === k).length])) },
    basisByKind, mechanismByKind: mechByKind, mechanismCountsItemDetailOrganization: mechCounts,
    itemVsDetailLine: { band: BAND, bandCounts, requestRelativeOffsetByKind: relHist, anchorOffsetByKind: anchorHist, anchorOffsetKindMix: sameAnchorOffsetMixed, cellsByPdfVariantAnchorOffset: cells },
    itemVsOrganization: { organizationRows: orgs.length, organizationRowsInRequestRelativeBand: orgs.filter(inBand).length, itemRowsInBand: items.filter(inBand).length, orgBasisAllRoot: orgBasisRoot, itemBasisAllChildOfRoot: itemBasisChild, rowLocalFeatureDisjointness: featureDisjoint, organizationPdfs: [...new Set(orgs.map(r => path.basename(r.localPath)))].sort(), geometrySeparable: !itemOrgRelSame },
    unclassified: { total: rows.filter(r => r.onKind === 'unclassified').length, byClass: unclassifiedClasses, byPdf: unclByPdf, byAnchorOffset: unclByOffset },
    sequence: seq,
    portability: {
      boundaryRule: 'kind は hierarchy node の x-level（range 内の x クラスタの順位）と文書順 stack の親子で決まる（FieldResolver.kindFromHierarchy）: 親が無い root→organization、root の子→item、request/それ以外の子→detail_line、level_gap・unplaced・strong header collision→unclassified。コード値・名称・外部辞書は使わない',
      activationRange: 'node 候補・x クラスタ（支持 2 行以上）・stack は A2_EXPERIMENTS の手書き page 範囲を入力にして作られる。root は「入力 range 内で自分より浅い見出しが先行しない行」',
      coordinateFrame: 'x-level は入力 range 内の x クラスタの相対順位。layout variant（request x 66 / 79）を絶対 x では持たない。request 基準 offset（−6.9）は別の range-local frame',
    },
    facts, decision,
  });
}

function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  fs.mkdirSync(OUT, { recursive: true });
  if (phase === 'population') { const p = populationArtifact(); fs.writeFileSync(path.join(OUT, 'population-887.json'), p.text); console.log(JSON.stringify({ sha: sha(p.text), reproduced: p.reproduced, total: p.total, byKind: p.byKind, duplicates: p.duplicates })); }
  else if (phase === 'evaluate') { const t = evaluate(); fs.writeFileSync(path.join(OUT, 'semantic-boundary-evaluation.json'), t); console.log(t); }
  else throw new Error('--phase=population|evaluate が必要');
}

main();
