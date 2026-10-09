/**
 * Family C（evaluator の identity key 衝突）の corpus-level 機械的 failure isolation 用 analysis-only helper。
 * evaluator / parser / GT / #395 protocol は変更せず、export 済みの gtKey / parserKey / isComparableGt と evaluatePage の出力を集計するだけ。
 * production path からは呼ばれない。研究判断（matching rule の提案など）は含めない。
 *
 * ---- 分類定義（census 実行前に固定。結果を見て調整しない）----
 * 用語: collision = 同一ページ内で identity key k が GT 側 n 件・parser 側 m 件（RESOLVED の REQUEST/MARKER unit）で max(n, m) >= 2。
 *   A. DUPLICATE_KEY_PRESENT = collision が存在すること自体（評価への影響は問わない）
 *   B. MATCHING_AMBIGUITY    = n と m が非 1:1（evaluator が個別 row の対応を取れない）
 *   C. OWNER_AMBIGUITY       = fragment の owner が collision group に属し、evaluator が AMBIGUOUS_OWNER_GROUP を出した
 *   D. ACTUAL_PARSER_ERROR   = source evidence 上の parser 誤り。本 helper は A/B/C から D を推測しない（判定しない）
 * GT ありページ（parser が PAGE_ABSTAINED でない）の collision group の分類:
 *   rowIssue  = n != m || wrongColumn > 0 || extras > 0 || unmatchedState != null || AMBIGUOUS_OWNER_GROUP 以外の evaluator instance が gtKey = k を名指しする
 *   fragRel   = (GT fragment のうち owner row の key = k の件数) + (parser の key = k の RESOLVED unit に付いた fragment の件数)
 *   ownerAmb  = AMBIGUOUS_OWNER_GROUP instance が gtKey = k を名指しする
 *   - rowIssue && ownerAmb                         -> MULTIPLE_EFFECTS
 *   - rowIssue                                      -> ROW_MATCHING_AMBIGUITY
 *   - !rowIssue && ownerAmb && fragRel > 0          -> FRAGMENT_OWNER_AMBIGUITY
 *   - !rowIssue && !ownerAmb && fragRel == 0        -> DUPLICATE_ONLY_NO_EVAL_EFFECT（n = m >= 2・全 matched）
 *   - 上記以外（fragRel > 0 だが ownerAmb なし、ownerAmb だが fragRel = 0）-> UNRESOLVED_MECHANISM
 * GT なしページ -> NOT_EVALUABLE_NO_GT（fragRel の parser 側のみ示す）。GT ありだが parser が PAGE_ABSTAINED -> NOT_EVALUATED_PAGE_ABSTAINED。
 * latent limitation（actual effect とは別記）: DUPLICATE_ONLY_NO_EVAL_EFFECT の group に対し、evaluator が構造的に
 *   ORDER_INVERSION_NOT_EVALUATED（order inversion は 1:1 のみ）/ SAME_KEY_MERGE_NOT_DETECTABLE（merge 検出は同一 key を skip）/
 *   COLUMN_MULTISET_ONLY（column は多重集合比較で個別 row 不特定。GT occurrence が LEFT/RIGHT 両方に跨る場合のみ）を失う。
 * POTENTIAL_DISCRIMINATOR は観察された事実（occurrence の位置・column・直前の（組織）code）の記録のみで、identity への追加案ではない。
 */
import type { PageOut } from './budget-request-toc-row-assembly';
import { evaluatePage, gtKey, isComparableGt, normKey, parserKey, type GtPage, type Instance, type PageResult } from './budget-request-toc-row-assembly-evaluator';

export type Classification = 'DUPLICATE_ONLY_NO_EVAL_EFFECT' | 'ROW_MATCHING_AMBIGUITY' | 'FRAGMENT_OWNER_AMBIGUITY' | 'MULTIPLE_EFFECTS' | 'UNRESOLVED_MECHANISM' | 'NOT_EVALUABLE_NO_GT' | 'NOT_EVALUATED_PAGE_ABSTAINED';
export type Side = 'GT' | 'PARSER' | 'BOTH';
export type KeyKind = 'REQUEST' | 'MARKER';
export interface PageMeta { localPdfPath: string; physicalPage: number; partition: string; classifierSource: string }

export interface Occurrence { side: 'GT' | 'PARSER'; column: string; order: number; lineIndex: number | null; precedingOrgCode: string | null; fragments: number }
export interface Collision {
  key: string; kind: KeyKind; n: number | null; m: number; multiplicity: number; side: Side | 'PARSER_ONLY_NO_GT';
  gtFragmentsOnKey: number | null; parserFragmentsOnKey: number; evaluatorOwnerUnresolved: number; evaluatorOtherInstances: string[];
  classification: Classification; latentLimitations: string[]; occurrences: Occurrence[];
}
export interface OtherGroup { key: string; kind: KeyKind; n: number; m: number; shape: string; unmatchedState: string | null }
export interface PageCensus {
  localPdfPath: string; physicalPage: number; partition: string; classifierSource: string; parserState: string; gtAvailable: boolean;
  parser: { requestUnits: number; requestUnique: number; markerUnits: number; markerUnique: number; otherCode: number; abstainedUnits: number };
  gt: null | { requestRows: number; requestUnique: number; markerRows: number; markerUnique: number; plainRows: number; fragments: number; exemptRightRows: number };
  collisions: Collision[]; otherNonOneToOne: OtherGroup[];
  evaluator: null | { pageOutcome: string; unresolvedFragments: number; ownerGroupInstances: number; otherCodeInstances: number };
}

const REST_LATENT = ['ORDER_INVERSION_NOT_EVALUATED', 'SAME_KEY_MERGE_NOT_DETECTABLE'];
const kindOf = (k: string): KeyKind => (k.startsWith('R|') ? 'REQUEST' : 'MARKER');
const isOrg = (marker: string | null) => normKey(marker) === '（組織）';

// provenance は raw text を要するため dummy raw で走らせ、groups / fragments / instances のみ使う（provenance 由来の結果は破棄）
export function evaluateWithoutRaw(gt: GtPage, parser: PageOut): PageResult {
  const r = evaluatePage(gt, parser, { pdfSha256: '', textSha256: '', lines: [] }, []);
  return { ...r, provenance: { checkedUnits: 0, checkedFragments: 0, mismatches: 0 }, instances: r.instances.filter(i => i.family !== 'PROVENANCE_MISMATCH') };
}

const resolvedUnits = (p: PageOut) => p.rows.filter(u => u.state === 'RESOLVED' && (u.rowKind === 'REQUEST_NUMBER_ROW' || u.rowKind === 'MARKER_ROW'));

function parserOccurrences(p: PageOut, k: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const u of resolvedUnits(p)) {
    if (parserKey(u) !== k) continue;
    const org = [...p.rows].filter(x => x.state === 'RESOLVED' && x.rowKind === 'MARKER_ROW' && isOrg(x.rowStartTokenRaw) && x.column === u.column && x.sourceOrder < u.sourceOrder).sort((a, b) => b.sourceOrder - a.sourceOrder)[0];
    out.push({ side: 'PARSER', column: u.column, order: u.sourceOrder, lineIndex: u.provenance.lineIndex, precedingOrgCode: org ? normKey(org.codeRaw) : null, fragments: u.fragments.length });
  }
  return out;
}

function gtOccurrences(g: GtPage, k: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of g.rows) {
    if (!isComparableGt(r) || gtKey(r) !== k) continue;
    const org = g.rows.filter(x => x.rowKindVisual === 'MARKER_ROW' && isOrg(x.markerVisual) && x.column === r.column && x.orderInColumn < r.orderInColumn).sort((a, b) => b.orderInColumn - a.orderInColumn)[0];
    out.push({ side: 'GT', column: r.column, order: r.orderInColumn, lineIndex: null, precedingOrgCode: org ? normKey(org.codeVisual) : null, fragments: g.fragments.filter(f => f.ownerRowId === r.rowId).length });
  }
  return out;
}

const countBy = (keys: string[]) => keys.reduce((a: Map<string, number>, k) => a.set(k, (a.get(k) ?? 0) + 1), new Map<string, number>());

export function censusPage(meta: PageMeta, parser: PageOut, gt: GtPage | null): PageCensus {
  const units = resolvedUnits(parser);
  const pReq = units.filter(u => u.rowKind === 'REQUEST_NUMBER_ROW').map(u => parserKey(u) as string);
  const pMrk = units.filter(u => u.rowKind === 'MARKER_ROW').map(u => parserKey(u) as string);
  const pm = countBy(units.map(u => parserKey(u) as string));
  const page: PageCensus = {
    ...meta, parserState: parser.pageState, gtAvailable: gt !== null,
    parser: { requestUnits: pReq.length, requestUnique: new Set(pReq).size, markerUnits: pMrk.length, markerUnique: new Set(pMrk).size, otherCode: parser.rows.filter(u => u.state === 'RESOLVED' && u.rowKind === 'OTHER_CODE').length, abstainedUnits: parser.rows.filter(u => u.state === 'ABSTAINED').length },
    gt: null, collisions: [], otherNonOneToOne: [], evaluator: null,
  };
  const parserFrag = (k: string) => units.filter(u => parserKey(u) === k).reduce((a, u) => a + u.fragments.length, 0);

  if (!gt) {
    for (const [k, m] of [...pm].sort()) {
      if (m < 2) continue;
      page.collisions.push({ key: k, kind: kindOf(k), n: null, m, multiplicity: m, side: 'PARSER_ONLY_NO_GT', gtFragmentsOnKey: null, parserFragmentsOnKey: parserFrag(k), evaluatorOwnerUnresolved: 0, evaluatorOtherInstances: [], classification: 'NOT_EVALUABLE_NO_GT', latentLimitations: [], occurrences: parserOccurrences(parser, k) });
    }
    return page;
  }

  const cmp = gt.rows.filter(isComparableGt);
  const gReq = cmp.filter(r => r.rowKindVisual === 'REQUEST_NUMBER_ROW').map(gtKey);
  const gMrk = cmp.filter(r => r.rowKindVisual === 'MARKER_ROW').map(gtKey);
  const ev = evaluateWithoutRaw(gt, parser);
  const exempt = ev.instances.filter(i => i.family === 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT' && i.gtKey !== undefined).length;
  page.gt = { requestRows: gReq.length, requestUnique: new Set(gReq).size, markerRows: gMrk.length, markerUnique: new Set(gMrk).size, plainRows: gt.rows.length - cmp.length, fragments: gt.fragments.length, exemptRightRows: exempt };
  const ownerInst = (k: string) => ev.instances.filter(i => i.family === 'AMBIGUOUS_OWNER_GROUP' && i.gtKey === k);
  page.evaluator = { pageOutcome: `${ev.pageOutcome.state}:${ev.pageOutcome.reason}`, unresolvedFragments: ev.fragments.unresolved, ownerGroupInstances: ev.instances.filter(i => i.family === 'AMBIGUOUS_OWNER_GROUP').length, otherCodeInstances: ev.instances.filter(i => i.family === 'NO_GT_CLASS_FOR_OTHER_CODE').length };

  const rowById = new Map(gt.rows.map(r => [r.rowId, r]));
  const gtFrag = (k: string) => gt.fragments.filter(f => { const o = rowById.get(f.ownerRowId); return !!o && isComparableGt(o) && gtKey(o) === k; }).length;

  if (parser.pageState === 'PAGE_ABSTAINED') {
    // evaluator は group を作らない（page abstain）。primitive の multiplicity のみ示す
    const gm = countBy(cmp.map(gtKey));
    for (const k of [...new Set([...gm.keys(), ...pm.keys()])].sort()) {
      const n = gm.get(k) ?? 0, m = pm.get(k) ?? 0;
      if (Math.max(n, m) < 2) continue;
      page.collisions.push({ key: k, kind: kindOf(k), n, m, multiplicity: Math.max(n, m), side: sideOf(n, m), gtFragmentsOnKey: gtFrag(k), parserFragmentsOnKey: parserFrag(k), evaluatorOwnerUnresolved: 0, evaluatorOtherInstances: [], classification: 'NOT_EVALUATED_PAGE_ABSTAINED', latentLimitations: [], occurrences: [...gtOccurrences(gt, k), ...parserOccurrences(parser, k)] });
    }
    return page;
  }

  for (const g of ev.groups) {
    if (g.n === 1 && g.m === 1) continue;
    const kind = kindOf(g.key);
    if (Math.max(g.n, g.m) < 2) { page.otherNonOneToOne.push({ key: g.key, kind, n: g.n, m: g.m, shape: g.n > g.m ? 'GT_ONLY_OR_FEWER_PARSER' : 'PARSER_ONLY_OR_MORE_PARSER', unmatchedState: g.unmatchedState }); continue; }
    const otherInst = ev.instances.filter((i: Instance) => i.gtKey === g.key && i.family !== 'AMBIGUOUS_OWNER_GROUP').map(i => i.family + (i.reason ? `:${i.reason}` : ''));
    const rowIssue = g.n !== g.m || g.wrongColumn > 0 || g.extras > 0 || g.unmatchedState !== null || otherInst.length > 0;
    const oa = ownerInst(g.key).length;
    const gf = gtFrag(g.key), pf = parserFrag(g.key);
    const fragRel = gf + pf;
    let classification: Classification;
    if (rowIssue && oa > 0) classification = 'MULTIPLE_EFFECTS';
    else if (rowIssue) classification = 'ROW_MATCHING_AMBIGUITY';
    else if (oa > 0 && fragRel > 0) classification = 'FRAGMENT_OWNER_AMBIGUITY';
    else if (oa === 0 && fragRel === 0) classification = 'DUPLICATE_ONLY_NO_EVAL_EFFECT';
    else classification = 'UNRESOLVED_MECHANISM';
    const goc = gtOccurrences(gt, g.key);
    const latent = classification === 'DUPLICATE_ONLY_NO_EVAL_EFFECT' ? [...REST_LATENT, ...(new Set(goc.map(o => o.column)).size > 1 ? ['COLUMN_MULTISET_ONLY'] : [])] : [];
    page.collisions.push({ key: g.key, kind, n: g.n, m: g.m, multiplicity: Math.max(g.n, g.m), side: sideOf(g.n, g.m), gtFragmentsOnKey: gf, parserFragmentsOnKey: pf, evaluatorOwnerUnresolved: oa, evaluatorOtherInstances: otherInst, classification, latentLimitations: latent, occurrences: [...goc, ...parserOccurrences(parser, g.key)] });
  }
  return page;
}

function sideOf(n: number, m: number): Side { return n >= 2 && m >= 2 ? 'BOTH' : n >= 2 ? 'GT' : 'PARSER'; }

export interface Tally { pages: number; requestUnits: number; requestUnique: number; markerUnits: number; markerUnique: number; duplicateKeys: number; duplicateKeysRequest: number; duplicateKeysMarker: number; pagesWithDuplicate: number; side: Record<string, number>; classification: Record<string, number>; fragmentOwnerRelations: { gt: number; parser: number }; otherNonOneToOneGroups: number; otherCodeUnits: number }

export function tally(pages: PageCensus[]): Tally {
  const sum = (f: (p: PageCensus) => number) => pages.reduce((a, p) => a + f(p), 0);
  const inc = (acc: Record<string, number>, k: string) => { acc[k] = (acc[k] ?? 0) + 1; };
  const side: Record<string, number> = {}, classification: Record<string, number> = {};
  const all = pages.flatMap(p => p.collisions);
  for (const c of all) { inc(side, c.side); inc(classification, c.classification); }
  return {
    pages: pages.length,
    requestUnits: sum(p => p.parser.requestUnits), requestUnique: sum(p => p.parser.requestUnique), markerUnits: sum(p => p.parser.markerUnits), markerUnique: sum(p => p.parser.markerUnique),
    duplicateKeys: all.length, duplicateKeysRequest: all.filter(c => c.kind === 'REQUEST').length, duplicateKeysMarker: all.filter(c => c.kind === 'MARKER').length,
    pagesWithDuplicate: pages.filter(p => p.collisions.length > 0).length, side, classification,
    fragmentOwnerRelations: { gt: all.reduce((a, c) => a + (c.gtFragmentsOnKey ?? 0), 0), parser: all.reduce((a, c) => a + c.parserFragmentsOnKey, 0) },
    otherNonOneToOneGroups: sum(p => p.otherNonOneToOne.length), otherCodeUnits: sum(p => p.parser.otherCode),
  };
}
