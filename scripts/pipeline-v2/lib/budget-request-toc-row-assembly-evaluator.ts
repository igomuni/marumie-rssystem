/**
 * TOC A 層 row assembly の held-out evaluator。frozen amendment（#395 evaluation-protocol-amendment.json）を機械化するだけで、評価規則を独自に再定義しない。
 * 入力: frozen GT（#392）の page record、parser の page 出力（#393）、frozen Raw Text の line。出力: 評価の raw result（解釈を含まない）。
 * 規則の根拠は amendment の各節（amendedAlignment / evidenceOnlyPredicates / pageLevel / gtRowStateAssignment / plainRow / fragment / severeOperationalization / goStop）。
 */
import type { PageOut, RowOut } from './budget-request-toc-row-assembly';

export interface GtRow { rowId: string; column: 'LEFT' | 'RIGHT'; orderInColumn: number; rowKindVisual: string; requestNumberVisualToken: string | null; codeVisual: string | null; markerVisual: string | null; pageRefVisual: string | null; wrappedFragmentCount: number }
export interface GtFragment { fragmentId: string; ownerRowId: string; column: 'LEFT' | 'RIGHT'; orderInOwner: number }
export interface GtPage { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; rightColumnVisual: string; gtPageComplete: boolean; rows: GtRow[]; fragments: GtFragment[] }
export interface RawPageLines { pdfSha256: string; textSha256: string; lines: { lineIndex: number; text: string }[] }

export type State = 'CORRECT' | 'INCORRECT' | 'ABSTAINED' | 'UNRESOLVED';
export type SevereFamily = 'FALSE_POSITIVE_ROW_ASSEMBLY' | 'WRONG_COLUMN_ASSIGNMENT' | 'WRONG_FRAGMENT_ATTACHMENT' | 'PROVENANCE_MISMATCH';
export const SEVERE_FAMILIES: SevereFamily[] = ['FALSE_POSITIVE_ROW_ASSEMBLY', 'WRONG_COLUMN_ASSIGNMENT', 'WRONG_FRAGMENT_ATTACHMENT', 'PROVENANCE_MISMATCH'];
const BLOCKING_FAMILIES = ['NO_GT_CLASS_FOR_OTHER_CODE', 'AMBIGUOUS_OWNER_GROUP'];

const cps = (s: string) => Array.from(s);
const mapChars = (s: string) => s.replace(/[‐‑]/gu, '-').replace(/\(/gu, '（').replace(/\)/gu, '）');
export const normKey = (s: string | null) => mapChars((s ?? '').replace(/\s+/gu, ''));
export const normColl = (s: string) => mapChars(s.replace(/\s+/gu, ' ').trim());
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const isComparableGt = (r: GtRow) => r.rowKindVisual === 'REQUEST_NUMBER_ROW' || r.rowKindVisual === 'MARKER_ROW';
export const gtKey = (r: GtRow) => (r.rowKindVisual === 'REQUEST_NUMBER_ROW' ? `R|${normKey(r.requestNumberVisualToken)}` : `M|${normKey(r.markerVisual)}|${normKey(r.codeVisual)}`);
export const gtTokenString = (r: GtRow) => normColl(r.rowKindVisual === 'REQUEST_NUMBER_ROW' ? `${r.requestNumberVisualToken} ${r.codeVisual}` : `${r.markerVisual} ${r.codeVisual ?? ''}`);
export const parserKey = (u: RowOut): string | null => {
  if (u.rowKind === 'REQUEST_NUMBER_ROW') { const m = /^\d+/u.exec(u.rowStartTokenRaw ?? ''); return m ? `R|${normKey(m[0])}` : null; }
  if (u.rowKind === 'MARKER_ROW') return `M|${normKey(u.rowStartTokenRaw)}|${normKey(u.codeRaw)}`;
  return null;
};
const contains = (slice: string, token: string) => new RegExp(`(?<![0-9])${escapeRe(token)}(?![0-9])`, 'u').test(normColl(slice));

const unitId = (p: { localPdfPath: string; physicalPage: number }, u: RowOut) => `${p.localPdfPath}#${p.physicalPage}:${u.column}:${u.sourceOrder}@line${u.provenance.lineIndex}`;

export interface Instance { family: string; localPdfPath: string; physicalPage: number; gtRowId?: string; gtKey?: string; parserUnit?: string; state?: string; reason?: string; detail?: unknown }

export interface PageResult {
  localPdfPath: string; physicalPage: number; classifierSource: string; strata: string[];
  parserPageState: string; pageOutcome: { state: State | 'NOT_COMPARABLE'; reason: string };
  gtComparableRows: number; parserComparableUnits: number; matchedRows: number;
  rowStates: Record<State, number>; rowNotComparable: { plainRow: number; classification: number; columnUnclaimed: number };
  omittedSilently: number; orderInversions: number;
  groups: { key: string; n: number; m: number; matched: number; wrongColumn: number; extras: number; unmatchedState: string | null }[];
  fragments: { gt: number; correct: number; incorrect: number; abstained: number; unresolved: number; notComparable: number; wrongAttachment: number };
  provenance: { checkedUnits: number; checkedFragments: number; mismatches: number };
  instances: Instance[];
}

const emptyStates = (): Record<State, number> => ({ CORRECT: 0, INCORRECT: 0, ABSTAINED: 0, UNRESOLVED: 0 });
const FRAGMENT_ABSTAIN = new Set(['FRAGMENT_NO_SAFE_OWNER', 'FRAGMENT_WITH_PAGE_REF', 'SIMULTANEOUS_LR_FRAGMENT', 'FRAGMENT_OWNER_NOT_UNIQUE']);

export function evaluatePage(gt: GtPage, parser: PageOut, raw: RawPageLines, strata: string[]): PageResult {
  const id = { localPdfPath: gt.localPdfPath, physicalPage: gt.physicalPage };
  const instances: Instance[] = [];
  const res: PageResult = {
    ...id, classifierSource: gt.classifierSource, strata, parserPageState: parser.pageState, pageOutcome: { state: 'UNRESOLVED', reason: '' },
    gtComparableRows: 0, parserComparableUnits: 0, matchedRows: 0, rowStates: emptyStates(), rowNotComparable: { plainRow: 0, classification: 0, columnUnclaimed: 0 },
    omittedSilently: 0, orderInversions: 0, groups: [], fragments: { gt: gt.fragments.length, correct: 0, incorrect: 0, abstained: 0, unresolved: 0, notComparable: 0, wrongAttachment: 0 },
    provenance: { checkedUnits: 0, checkedFragments: 0, mismatches: 0 }, instances,
  };
  const comparable = gt.rows.filter(isComparableGt);
  res.gtComparableRows = comparable.length;
  res.rowNotComparable.plainRow = gt.rows.length - comparable.length;
  res.rowNotComparable.classification = comparable.length; // WRONG_ROW_START_CLASSIFICATION は独立計測不能

  // ---- page abstain ----
  if (parser.pageState === 'PAGE_ABSTAINED') {
    res.pageOutcome = { state: 'ABSTAINED', reason: parser.pageAbstentionReason ?? '' };
    res.rowStates.ABSTAINED = comparable.length;
    for (const f of gt.fragments) { const o = gt.rows.find(r => r.rowId === f.ownerRowId)!; if (isComparableGt(o)) res.fragments.abstained++; else res.fragments.notComparable++; }
    return res;
  }

  // ---- page level ----
  const split = parser.pageState === 'ASSEMBLED_SPLIT';
  const rightRows = gt.rightColumnVisual === 'ROWS';
  if (gt.rightColumnVisual === 'UNRESOLVED' || !gt.gtPageComplete) res.pageOutcome = { state: 'UNRESOLVED', reason: 'GT_PAGE_UNRESOLVED' };
  else if (split && rightRows) res.pageOutcome = { state: 'CORRECT', reason: 'SPLIT_AND_GT_RIGHT_ROWS' };
  else if (split && !rightRows) res.pageOutcome = { state: 'INCORRECT', reason: 'SPLIT_BUT_GT_RIGHT_BLANK' };
  else if (!split && !rightRows) res.pageOutcome = { state: 'NOT_COMPARABLE', reason: 'UNSPLIT_AND_GT_RIGHT_BLANK' };
  else res.pageOutcome = { state: 'UNRESOLVED', reason: 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT' };
  const familyPage = !split && rightRows; // 右 column の GT row は対応・merge 検出の対象外

  const exempt = (r: GtRow) => familyPage && r.column === 'RIGHT';
  const gtRows = comparable.filter(r => !exempt(r));
  for (const r of comparable.filter(exempt)) { res.rowStates.UNRESOLVED++; instances.push({ family: 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT', ...id, gtRowId: r.rowId, gtKey: gtKey(r), state: 'UNRESOLVED' }); }

  const resolved = parser.rows.filter(u => u.state === 'RESOLVED');
  const units = resolved.filter(u => u.rowKind === 'REQUEST_NUMBER_ROW' || u.rowKind === 'MARKER_ROW');
  res.parserComparableUnits = units.length;

  // OTHER_CODE は GT class なし → UNRESOLVED（pass をブロック）
  for (const u of resolved.filter(x => x.rowKind === 'OTHER_CODE')) instances.push({ family: 'NO_GT_CLASS_FOR_OTHER_CODE', ...id, parserUnit: unitId(id, u), state: 'UNRESOLVED', detail: u.provenance.sourceRawSlice });

  // ---- key groups ----
  const keys = new Set<string>([...gtRows.map(gtKey), ...units.map(u => parserKey(u) as string)]);
  const unitsByKey = new Map<string, RowOut[]>(); for (const u of units) { const k = parserKey(u) as string; unitsByKey.set(k, [...(unitsByKey.get(k) ?? []), u]); }
  const gtByKey = new Map<string, GtRow[]>(); for (const r of gtRows) gtByKey.set(gtKey(r), [...(gtByKey.get(gtKey(r)) ?? []), r]);
  const abstainedUnits = parser.rows.filter(u => u.state === 'ABSTAINED');
  const pairOneToOne = new Map<string, { g: GtRow; u: RowOut }>();
  const ungrouped: string[] = [];

  for (const k of [...keys].sort()) {
    const g = gtByKey.get(k) ?? []; const u = unitsByKey.get(k) ?? [];
    const n = g.length, m = u.length, matched = Math.min(n, m);
    const grp = { key: k, n, m, matched, wrongColumn: 0, extras: Math.max(0, m - n), unmatchedState: null as string | null };
    res.matchedRows += matched;
    // 余剰 / split / parser-only extra
    for (let i = 0; i < grp.extras; i++) instances.push({ family: 'FALSE_POSITIVE_ROW_ASSEMBLY', ...id, gtKey: k, parserUnit: unitId(id, u[matched + i] ?? u[u.length - 1]), reason: n === 0 ? 'PARSER_ONLY_EXTRA' : 'SPLIT_EXTRA' });
    // column 多重集合
    const claimed = u.filter(x => x.column === 'LEFT' || x.column === 'RIGHT');
    res.rowNotComparable.columnUnclaimed += Math.min(matched, u.length - claimed.length);
    const cg: Record<string, number> = { LEFT: 0, RIGHT: 0 }; for (const x of g) cg[x.column]++;
    const cp: Record<string, number> = { LEFT: 0, RIGHT: 0 }; for (const x of claimed) cp[x.column]++;
    const explained = Math.min(cg.LEFT, cp.LEFT) + Math.min(cg.RIGHT, cp.RIGHT);
    grp.wrongColumn = Math.max(0, Math.min(claimed.length, matched) - explained);
    for (let i = 0; i < grp.wrongColumn; i++) instances.push({ family: 'WRONG_COLUMN_ASSIGNMENT', ...id, gtKey: k, parserUnit: unitId(id, claimed[i]), detail: { gtColumns: cg, parserClaimedColumns: cp } });
    res.rowStates.CORRECT += matched - grp.wrongColumn;
    res.rowStates.INCORRECT += grp.wrongColumn;
    // 未対応 GT row（n>m）
    const un = n - m;
    if (un > 0) {
      const tok = gtTokenString(g[0]);
      const other = (x: RowOut) => parserKey(x) !== k;
      const inAbstained = abstainedUnits.some(x => contains(x.provenance.sourceRawSlice, tok));
      const inResolved = parser.rows.filter(x => x.state === 'RESOLVED').some(x => other(x) && contains(x.provenance.sourceRawSlice, tok));
      let st: string;
      if (inAbstained && !inResolved) { st = 'ABSTAINED'; res.rowStates.ABSTAINED += un; }
      else if (inResolved) { st = 'INCORRECT_MERGED'; res.rowStates.INCORRECT += un; }
      else { st = 'OMITTED_SILENTLY'; res.rowStates.INCORRECT += un; res.omittedSilently += un; }
      grp.unmatchedState = st;
      for (const x of g.slice(m)) instances.push({ family: st === 'ABSTAINED' ? 'ABSTAINED_ROW' : st === 'OMITTED_SILENTLY' ? 'OMITTED_SILENTLY' : 'INCORRECT_MERGED_ROW', ...id, gtRowId: x.rowId, gtKey: k, state: st });
    }
    if (n === 1 && m === 1) pairOneToOne.set(k, { g: g[0], u: u[0] }); else if (n >= 1 || m >= 1) ungrouped.push(k);
    res.groups.push(grp);
  }

  // ---- merge detection（RESOLVED unit が自身以外の GT row の token を含む）----
  const gtTokens = gtRows.map(r => ({ r, k: gtKey(r), tok: gtTokenString(r) }));
  for (const u of resolved) {
    const own = parserKey(u);
    const seen = new Set<string>();
    for (const t of gtTokens) {
      if (t.k === own || seen.has(t.k)) continue;
      if (contains(u.provenance.sourceRawSlice, t.tok)) { seen.add(t.k); instances.push({ family: 'FALSE_POSITIVE_ROW_ASSEMBLY', ...id, gtKey: t.k, gtRowId: t.r.rowId, parserUnit: unitId(id, u), reason: 'MERGE', detail: { unitKind: u.rowKind } }); }
    }
  }

  // ---- order inversion（1:1 group 同士・同一 column・descriptive）----
  const pairs = [...pairOneToOne.values()].filter(p => (p.u.column === 'LEFT' || p.u.column === 'RIGHT') && p.u.column === p.g.column);
  for (const col of ['LEFT', 'RIGHT']) {
    const ps = pairs.filter(p => p.g.column === col);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if ((a.g.orderInColumn - b.g.orderInColumn) * (a.u.sourceOrder - b.u.sourceOrder) < 0) res.orderInversions++;
    }
  }

  // ---- fragments ----
  const rowById = new Map(gt.rows.map(r => [r.rowId, r]));
  for (const f of gt.fragments) {
    const o = rowById.get(f.ownerRowId)!;
    if (!isComparableGt(o)) { res.fragments.notComparable++; continue; }
    if (exempt(o)) { res.fragments.unresolved++; instances.push({ family: 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT', ...id, gtRowId: f.fragmentId, state: 'UNRESOLVED' }); continue; }
    const k = gtKey(o); const pr = pairOneToOne.get(k);
    if (!pr) {
      const grp = res.groups.find(x => x.key === k)!;
      if (grp.m === 0 && grp.unmatchedState === 'ABSTAINED') res.fragments.abstained++;
      else { res.fragments.unresolved++; instances.push({ family: 'AMBIGUOUS_OWNER_GROUP', ...id, gtRowId: f.fragmentId, gtKey: k, state: 'UNRESOLVED' }); }
      continue;
    }
    const u = pr.u;
    if (u.fragments[f.orderInOwner - 1]) { res.fragments.correct++; continue; }
    const nextResolvedOrder = Math.min(...parser.rows.filter(x => x.column === u.column && x.sourceOrder > u.sourceOrder && x.state === 'RESOLVED' && x.rowKind !== 'WRAPPED_FRAGMENT').map(x => x.sourceOrder), Infinity);
    const abst = parser.rows.some(x => x.column === u.column && x.state === 'ABSTAINED' && x.sourceOrder > u.sourceOrder && x.sourceOrder < nextResolvedOrder && FRAGMENT_ABSTAIN.has(x.abstentionReason ?? ''));
    if (abst) res.fragments.abstained++; else { res.fragments.incorrect++; instances.push({ family: 'OMITTED_SILENTLY_FRAGMENT', ...id, gtRowId: f.fragmentId, state: 'INCORRECT' }); }
  }
  for (const [k, { g, u }] of pairOneToOne) {
    const extra = Math.max(0, u.fragments.length - g.wrappedFragmentCount);
    res.fragments.wrongAttachment += extra;
    for (let i = 0; i < extra; i++) instances.push({ family: 'WRONG_FRAGMENT_ATTACHMENT', ...id, gtRowId: g.rowId, gtKey: k, parserUnit: unitId(id, u), detail: { parserFragments: u.fragments.length, gtFragments: g.wrappedFragmentCount } });
  }
  for (const k of ungrouped) for (const u of unitsByKey.get(k) ?? []) {
    if (u.fragments.length) { res.fragments.unresolved += u.fragments.length; instances.push({ family: 'AMBIGUOUS_OWNER_GROUP', ...id, gtKey: k, parserUnit: unitId(id, u), state: 'UNRESOLVED', detail: { parserFragments: u.fragments.length } }); }
  }

  // ---- provenance（GT 不要。全 RESOLVED unit と fragment）----
  const lineText = new Map(raw.lines.map(l => [l.lineIndex, l.text]));
  const checkProv = (p: { pdfSha256: string; textSha256: string; physicalPage: number; localPdfPath: string; lineIndex: number; charStart: number; charEnd: number; sourceRawSlice: string }, what: string) => {
    const t = lineText.get(p.lineIndex);
    const ok = p.pdfSha256 === raw.pdfSha256 && p.textSha256 === raw.textSha256 && p.physicalPage === gt.physicalPage && p.localPdfPath === gt.localPdfPath && t !== undefined && cps(t).slice(p.charStart, p.charEnd).join('') === p.sourceRawSlice;
    if (!ok) { res.provenance.mismatches++; instances.push({ family: 'PROVENANCE_MISMATCH', ...id, parserUnit: what, detail: { lineIndex: p.lineIndex, charStart: p.charStart, charEnd: p.charEnd } }); }
  };
  for (const u of resolved) { res.provenance.checkedUnits++; checkProv(u.provenance, unitId(id, u)); for (const f of u.fragments) { res.provenance.checkedFragments++; checkProv(f.provenance, `${unitId(id, u)}+fragment`); } }
  return res;
}

export interface EvaluationInput { gt: GtPage; parser: PageOut; raw: RawPageLines; strata: string[] }
export function aggregate(pages: PageResult[]) {
  const sum = (f: (p: PageResult) => number) => pages.reduce((a, p) => a + f(p), 0);
  const severe: Record<SevereFamily, { count: number; pages: string[]; evidence: Instance[] }> = {} as never;
  for (const fam of SEVERE_FAMILIES) {
    const inst = pages.flatMap(p => p.instances.filter(i => i.family === fam));
    severe[fam] = { count: inst.length, pages: [...new Set(inst.map(i => `${i.localPdfPath}#${i.physicalPage}`))], evidence: inst };
  }
  const totalSevere = SEVERE_FAMILIES.reduce((a, f) => a + severe[f].count, 0);
  const blocking = pages.flatMap(p => p.instances.filter(i => BLOCKING_FAMILIES.includes(i.family)));
  const unresolvedByFamily: Record<string, number> = {};
  for (const i of pages.flatMap(p => p.instances)) if (i.state === 'UNRESOLVED') unresolvedByFamily[i.family] = (unresolvedByFamily[i.family] ?? 0) + 1;
  const gtRows = sum(p => p.gtComparableRows);
  const gtFrags = sum(p => p.fragments.gt);
  const rowStates = emptyStates(); for (const p of pages) for (const s of Object.keys(rowStates) as State[]) rowStates[s] += p.rowStates[s];
  const abstentionByReason: Record<string, number> = {}; for (const p of pages) if (p.pageOutcome.state === 'ABSTAINED') abstentionByReason[p.pageOutcome.reason] = (abstentionByReason[p.pageOutcome.reason] ?? 0) + 1;
  const ratio = (a: number, b: number) => ({ numerator: a, denominator: b, value: b === 0 ? null : a / b });
  const strata: Record<string, { pages: number; pageResolutionCoverage: ReturnType<typeof ratio>; physicalRowCoverage: ReturnType<typeof ratio> }> = {};
  for (const s of new Set(pages.flatMap(p => p.strata))) {
    const ps = pages.filter(p => p.strata.includes(s));
    strata[s] = { pages: ps.length, pageResolutionCoverage: ratio(ps.filter(p => p.parserPageState !== 'PAGE_ABSTAINED').length, ps.length), physicalRowCoverage: ratio(ps.reduce((a, p) => a + p.matchedRows, 0), ps.reduce((a, p) => a + p.gtComparableRows, 0)) };
  }
  return {
    pages: pages.length, direct: pages.filter(p => p.classifierSource === 'DIRECT').length, inherited: pages.filter(p => p.classifierSource === 'INHERITED').length,
    pageStates: pages.reduce((a: Record<string, number>, p) => ((a[p.parserPageState] = (a[p.parserPageState] ?? 0) + 1), a), {}),
    pageOutcomes: pages.reduce((a: Record<string, number>, p) => { const k = `${p.pageOutcome.state}:${p.pageOutcome.reason}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
    rows: { gtComparable: gtRows, parserComparableUnits: sum(p => p.parserComparableUnits), matched: sum(p => p.matchedRows), states: rowStates, omittedSilently: sum(p => p.omittedSilently), orderInversions: sum(p => p.orderInversions), notComparable: { plainRow: sum(p => p.rowNotComparable.plainRow), classification: sum(p => p.rowNotComparable.classification), columnUnclaimed: sum(p => p.rowNotComparable.columnUnclaimed) }, pageLevelNotComparable: pages.filter(p => p.pageOutcome.state === 'NOT_COMPARABLE').length },
    severe: { ...severe, total: totalSevere, affectedPages: [...new Set(SEVERE_FAMILIES.flatMap(f => severe[f].pages))] },
    fragments: { gt: gtFrags, correct: sum(p => p.fragments.correct), incorrect: sum(p => p.fragments.incorrect), abstained: sum(p => p.fragments.abstained), unresolved: sum(p => p.fragments.unresolved), notComparable: sum(p => p.fragments.notComparable), wrongAttachment: sum(p => p.fragments.wrongAttachment) },
    provenance: { checkedUnits: sum(p => p.provenance.checkedUnits), checkedFragments: sum(p => p.provenance.checkedFragments), mismatches: sum(p => p.provenance.mismatches) },
    abstentionByReason, unresolvedByFamily,
    blockingUnresolved: { count: blocking.length, families: [...new Set(blocking.map(i => i.family))], affectedPages: [...new Set(blocking.map(i => `${i.localPdfPath}#${i.physicalPage}`))] },
    coverage: {
      pageResolutionCoverage: ratio(pages.filter(p => p.parserPageState !== 'PAGE_ABSTAINED').length, pages.length),
      physicalRowCoverage: ratio(sum(p => p.matchedRows), gtRows),
      comparableRowClassificationCoverage: ratio(rowStates.CORRECT + rowStates.INCORRECT, gtRows),
      fragmentAttachmentCoverage: ratio(sum(p => p.fragments.correct), gtFrags),
      byStratum: strata,
    },
  };
}

export type FinalJudgment = 'STOP_PROTOCOL' | 'STOP_SAFETY' | 'REVIEW_REQUIRED' | 'SAFETY_PASS_COVERAGE_REPORTED';
export function finalJudgment(protocolCompliant: boolean, totalSevere: number, blockingUnresolved: number): FinalJudgment {
  if (!protocolCompliant) return 'STOP_PROTOCOL';
  if (totalSevere >= 1) return 'STOP_SAFETY';
  if (blockingUnresolved > 0) return 'REVIEW_REQUIRED';
  return 'SAFETY_PASS_COVERAGE_REPORTED';
}
