/**
 * Page Classification v3 cumulative pre-implementation benchmark の純関数（benchmark aggregation と adequacy 計算のみ）。classifier ではない。
 * v0 matcher・継承規則・vocabulary は変更しない。GT label から machine evidence を逆算しない（candidate fixture を key join して取得する）。
 *
 * version ごとの mapping（preregistration で freeze。source artifact から一意に決まらなければ throw する）:
 *   v0: DIRECT stratum = 'DIRECT'（strataDetail.DIRECT.family）、CONTINUATION stratum = 'CONTINUATION'（strataDetail.CONTINUATION.stateFamily / distanceBucket）
 *   v1: 'DIRECT_BALANCED'（samplingObservation.directResult.family）、'CONTINUATION_BALANCED'（samplingObservation.activeStateFamily、strataDetail.CONTINUATION_BALANCED.distanceBucket）
 *   v2: 'DIRECT_BALANCED_V2'（samplingObservation.directResult）、'CONTINUATION_BALANCED_V2'（samplingObservation.activeStateFamily / distanceBucket）
 */
export type SourceVersion = 'v0' | 'v1' | 'v2';

export const KNOWN_FAMILIES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL'] as const;
export const INHERITABLE_FAMILIES = ['TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL'] as const;
export const CORE_FAMILIES = ['COVER', 'TOC', 'SUMMARY', 'DETAIL', 'STAFFING'] as const;
export const CONTINUATION_FAMILIES = ['TOC', 'SUMMARY', 'DETAIL', 'STAFFING'] as const;
/** v2 から継承（変更しない） */
export const THRESHOLDS = { corePerFamily: 10, directPerCoreFamily: 5, continuationPerFamily: 5 } as const;

export const DIRECT_STRATUM: Record<SourceVersion, string> = { v0: 'DIRECT', v1: 'DIRECT_BALANCED', v2: 'DIRECT_BALANCED_V2' };
export const CONTINUATION_STRATUM: Record<SourceVersion, string> = { v0: 'CONTINUATION', v1: 'CONTINUATION_BALANCED', v2: 'CONTINUATION_BALANCED_V2' };

export interface CandidateRow {
  localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; evaluationRole: string; strata: string[];
  strataDetail?: Record<string, Record<string, unknown>>;
  samplingObservation?: { directResult?: unknown; activeStateFamily?: string | null; distanceBucket?: string | null };
}
export interface GtRow { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; evaluationRole: string; strata: string[]; gt: { pageType: string; evidence: string } }
export interface MachineEvidence { directFamily: string | null; activeStateFamily: string | null; distanceBucket: string | null }
export interface CumulativeRow {
  localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string;
  sourceVersion: SourceVersion; sourceEvaluationRole: string; sourceStrata: string[];
  gt: { pageType: string; evidence: string };
  machineEvidence: MachineEvidence;
  /** adequacy で数える条件（stratum 所属 かつ machine family が known かつ GT 一致） */
  directMatched: boolean; continuationMatched: boolean;
}

export const keyOf = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** candidate row から machine evidence を取り出す。mapping が一意に決まらない場合は throw */
export function machineEvidenceOf(version: SourceVersion, c: CandidateRow): MachineEvidence {
  const inDirect = c.strata.includes(DIRECT_STRATUM[version]);
  const inCont = c.strata.includes(CONTINUATION_STRATUM[version]);
  let directFamily: string | null = null;
  let activeStateFamily: string | null = null;
  let distanceBucket: string | null = null;
  if (version === 'v0') {
    if (inDirect) directFamily = str(c.strataDetail?.DIRECT?.family);
    if (inCont) { activeStateFamily = str(c.strataDetail?.CONTINUATION?.stateFamily); distanceBucket = str(c.strataDetail?.CONTINUATION?.distanceBucket); }
  } else if (version === 'v1') {
    const d = c.samplingObservation?.directResult as { kind?: string; family?: string } | undefined;
    if (inDirect) directFamily = d?.kind === 'DIRECT' ? str(d.family) : null;
    if (inCont) { activeStateFamily = str(c.samplingObservation?.activeStateFamily); distanceBucket = str(c.strataDetail?.CONTINUATION_BALANCED?.distanceBucket); }
  } else {
    if (inDirect) directFamily = str(c.samplingObservation?.directResult);
    if (inCont) { activeStateFamily = str(c.samplingObservation?.activeStateFamily); distanceBucket = str(c.samplingObservation?.distanceBucket); }
  }
  if (inDirect && directFamily === null) throw new Error(`${version}: DIRECT stratum row without machine directFamily: ${keyOf(c)}`);
  if (inCont && activeStateFamily === null) throw new Error(`${version}: CONTINUATION stratum row without machine activeStateFamily: ${keyOf(c)}`);
  return { directFamily, activeStateFamily, distanceBucket };
}

/** GT row と candidate row を key join して cumulative row を作る（1:1 でなければ throw） */
export function buildVersionRows(version: SourceVersion, gt: GtRow[], cands: CandidateRow[]): CumulativeRow[] {
  const cmap = new Map(cands.map(c => [keyOf(c), c]));
  if (cmap.size !== cands.length) throw new Error(`${version}: duplicate candidate key`);
  if (new Set(gt.map(keyOf)).size !== gt.length) throw new Error(`${version}: duplicate GT key`);
  if (gt.length !== cands.length) throw new Error(`${version}: candidate/GT count mismatch ${cands.length}/${gt.length}`);
  return gt.map(g => {
    const c = cmap.get(keyOf(g));
    if (!c) throw new Error(`${version}: GT without candidate ${keyOf(g)}`);
    if (c.pdfSha256 !== g.pdfSha256 || c.textSha256 !== g.textSha256) throw new Error(`${version}: hash mismatch ${keyOf(g)}`);
    if (c.evaluationRole !== g.evaluationRole) throw new Error(`${version}: role mismatch ${keyOf(g)}`);
    const me = machineEvidenceOf(version, c);
    const inDirect = g.strata.includes(DIRECT_STRATUM[version]);
    const inCont = g.strata.includes(CONTINUATION_STRATUM[version]);
    return {
      localPdfPath: g.localPdfPath, physicalPage: g.physicalPage, pdfSha256: g.pdfSha256, textSha256: g.textSha256,
      sourceVersion: version, sourceEvaluationRole: g.evaluationRole, sourceStrata: g.strata,
      gt: { pageType: g.gt.pageType, evidence: g.gt.evidence },
      machineEvidence: me,
      directMatched: inDirect && me.directFamily !== null && (KNOWN_FAMILIES as readonly string[]).includes(me.directFamily) && g.gt.pageType === me.directFamily,
      continuationMatched: inCont && me.activeStateFamily !== null && (INHERITABLE_FAMILIES as readonly string[]).includes(me.activeStateFamily) && g.gt.pageType === me.activeStateFamily,
    };
  });
}

export function overlapOf(sets: Record<string, Set<string>>): Record<string, number> {
  const names = Object.keys(sets);
  const out: Record<string, number> = {};
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out[`${names[i]}&${names[j]}`] = [...sets[names[i]]].filter(k => sets[names[j]].has(k)).length;
  return out;
}

export function computeAdequacy(rows: CumulativeRow[]) {
  const n = (f: string, pred: (r: CumulativeRow) => boolean = () => true) => rows.filter(r => r.gt.pageType === f && pred(r)).length;
  const core = Object.fromEntries(CORE_FAMILIES.map(f => [f, n(f)]));
  const direct = Object.fromEntries(CORE_FAMILIES.map(f => [f, n(f, r => r.directMatched)]));
  const cont = Object.fromEntries(CONTINUATION_FAMILIES.map(f => [f, n(f, r => r.continuationMatched)]));
  const coreOk = CORE_FAMILIES.every(f => core[f] >= THRESHOLDS.corePerFamily);
  const directOk = CORE_FAMILIES.every(f => direct[f] >= THRESHOLDS.directPerCoreFamily);
  const continuationOk = CONTINUATION_FAMILIES.every(f => cont[f] >= THRESHOLDS.continuationPerFamily);
  const negatives = rows.filter(r => r.gt.pageType === 'OTHER' || r.gt.pageType === 'UNRESOLVED').length;
  return {
    thresholds: THRESHOLDS,
    coreFamilyCounts: core, directMatchedCoreCounts: direct, continuationMatchedCounts: cont,
    coreOk, directOk, continuationOk,
    priorityLimitation: {
      PRIORITY_SUMMARY: { gtRows: n('PRIORITY_SUMMARY'), directMatched: n('PRIORITY_SUMMARY', r => r.directMatched), continuationMatched: n('PRIORITY_SUMMARY', r => r.continuationMatched) },
      PRIORITY_DETAIL: { gtRows: n('PRIORITY_DETAIL'), directMatched: n('PRIORITY_DETAIL', r => r.directMatched), continuationMatched: n('PRIORITY_DETAIL', r => r.continuationMatched) },
      note: 'rare form limitation。adequacy STOP 条件に含めず、評価済みとは扱わない',
    },
    otherOrUnresolvedGtRows: negatives,
    openSetSafety: 'NOT_EVALUATED' as const,
  };
}

export function judge(adequacy: ReturnType<typeof computeAdequacy>, violations: number): 'ADEQUATE / STOP FOR REVIEW' | 'INSUFFICIENT / STOP' {
  return violations === 0 && adequacy.coreOk && adequacy.directOk && adequacy.continuationOk ? 'ADEQUATE / STOP FOR REVIEW' : 'INSUFFICIENT / STOP';
}

/**
 * 確定済みの protocol violation（preregistration freeze の前に cumulative result を観測した）。judge() は機械的 adequacy の計算（mapping・threshold は不変）であり、
 * 正式判定ではない。正式判定は常にこの定数に従う。
 */
export const FORMAL_JUDGMENT = 'INVALID / STOP' as const;
export const INVALID_REASON = 'preregistration freeze の前に cumulative result（dry-run）を観測したため、preregistration としての独立性が失われた。mapping・threshold は結果によって変更していないが、「事前登録した threshold を未知の結果が満たした」証拠としては使えない。post-hoc / descriptive benchmark として保存する。';
export const MECHANICAL_NOTE = 'core / DIRECT / CONTINUATION の threshold は機械的に充足（judge() が ADEQUATE / STOP FOR REVIEW 相当を返した）。preregistration 手続きの有効性とは別';
export const PROTOCOL_DEVIATIONS = [
  'preregistration commit の前に builder の dry-run（fixture を書かない）で結果を観測した',
  'PR #383 head commit が squash merge のため main の ancestor ではない（tree/diff 同一は確認済み。指示では不一致時 STOP だった）',
] as const;
export const GENERATOR_NOTE = 'mechanicalAdequacy は judge()（機械的な threshold 判定）の結果。正式判定 judgment は protocol violation により INVALID / STOP。preregistration doc・mapping・threshold は変更していない。';

export function formalAdequacy(adequacy: ReturnType<typeof computeAdequacy>, violations: number) {
  const mechanical = judge(adequacy, violations) === 'ADEQUATE / STOP FOR REVIEW' ? 'PASS' : 'FAIL';
  return { ...adequacy, judgment: FORMAL_JUDGMENT, mechanicalAdequacy: { result: mechanical, note: MECHANICAL_NOTE }, invalidReason: INVALID_REASON };
}
