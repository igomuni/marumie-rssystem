/**
 * incomplete-name safety guard の凍結評価（P3）。事前登録（P1）の指標・GO/STOP を機械的に適用する。評価側のモジュール。
 * 判定の基準はここに固定した数値で、結果を見て変えない。
 */
import type { FieldResolverResult, RecordFieldResolution } from './budget-request-field-resolver';
import { INCOMPLETE_NAME_GUARD_REASON } from './budget-request-field-resolver';

export const GUARD_EVAL_SCHEMA = 'budget-request-incomplete-name-guard-p3-evaluation/v0';
export const GUARD_PREDICATE_VERSION = 'A∧B∧¬C∧¬D (preregistration 2e9eff1 + supplement e5e5cd8)';

export type VisualLabel = 'complete_on_current_logical_row' | 'incomplete_continues_below' | 'unclear';
export interface GtUnit { unitId: string; visualLabel: VisualLabel }
export interface SampleUnit { documentKey: string; page: number; logicalRowIndex: number; stratum: string; baselineName: string; selectedAs: string }

export interface UnitOutcome {
  unitId: string;
  visualGt: VisualLabel;
  stratum: string;
  beforeStatus: string;
  beforeNameMatchesFrozenBaseline: boolean;
  guardFired: boolean;
  afterStatus: string;
  reasonCode: string | null;
  note: string;
}

export interface GuardMetrics {
  /** GT=incomplete かつ guard 後も resolved */
  falseResolvedIncomplete: number;
  /** GT=incomplete かつ guard が発火して ambiguous */
  safetyCatches: number;
  /** GT=complete かつ guard が発火して abstain */
  falseAbstainedComplete: number;
  /** GT=complete かつ resolved のまま */
  preservedComplete: number;
  incomplete: number;
  complete: number;
  unclear: number;
  fired: number;
  firedDecisive: number;
  /** FAC / 発火した decisive unit */
  facRate: number | null;
  guardPrecision: number | null;
  guardRecall: number | null;
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);

export function unitOutcomes(gt: GtUnit[], sample: Map<string, SampleUnit>, off: Map<string, RecordFieldResolution | undefined>, on: Map<string, RecordFieldResolution | undefined>): UnitOutcome[] {
  return gt.map(g => {
    const s = sample.get(g.unitId)!;
    const a = off.get(g.unitId);
    const b = on.get(g.unitId);
    const beforeStatus = a?.rowLocal.name.status ?? 'record_not_found';
    const afterStatus = b?.rowLocal.name.status ?? 'record_not_found';
    return {
      unitId: g.unitId,
      visualGt: g.visualLabel,
      stratum: s.stratum,
      beforeStatus,
      beforeNameMatchesFrozenBaseline: a?.rowLocal.name.value?.raw === s.baselineName,
      guardFired: b?.rowLocal.name.reasonCode === INCOMPLETE_NAME_GUARD_REASON,
      afterStatus,
      reasonCode: b?.rowLocal.name.reasonCode ?? null,
      note: b?.rowLocal.name.candidates?.[0]?.geometryNote ?? '',
    };
  });
}

export function guardMetrics(os: UnitOutcome[]): GuardMetrics {
  const inc = os.filter(o => o.visualGt === 'incomplete_continues_below');
  const comp = os.filter(o => o.visualGt === 'complete_on_current_logical_row');
  const fri = inc.filter(o => o.afterStatus === 'resolved').length;
  const catches = inc.filter(o => o.guardFired && o.afterStatus === 'ambiguous').length;
  const fac = comp.filter(o => o.guardFired).length;
  const decisive = [...inc, ...comp];
  const fired = os.filter(o => o.guardFired).length;
  const firedDecisive = decisive.filter(o => o.guardFired).length;
  return {
    falseResolvedIncomplete: fri,
    safetyCatches: catches,
    falseAbstainedComplete: fac,
    preservedComplete: comp.filter(o => o.afterStatus === 'resolved').length,
    incomplete: inc.length,
    complete: comp.length,
    unclear: os.length - decisive.length,
    fired,
    firedDecisive,
    facRate: rate(fac, firedDecisive),
    guardPrecision: rate(catches, catches + fac),
    guardRecall: rate(catches, catches + fri),
  };
}

export interface Differential {
  records: number;
  fired: number;
  /** name 以外の field・record の他の部分に差があった record 数（0 であるべき） */
  nonNameDifferences: number;
  /** name の差のうち「resolved → ambiguous（guard の reasonCode・value null）」以外の数（0 であるべき） */
  unexpectedNameChanges: number;
}

export function differential(off: FieldResolverResult[], on: FieldResolverResult[]): Differential {
  let records = 0, fired = 0, nonName = 0, unexpected = 0;
  off.forEach((r, i) => {
    r.records.forEach((a, j) => {
      const b = on[i].records[j];
      records++;
      const strip = (x: RecordFieldResolution) => JSON.stringify({ ...x, rowLocal: { ...x.rowLocal, name: undefined } });
      if (strip(a) !== strip(b)) nonName++;
      if (JSON.stringify(a.rowLocal.name) !== JSON.stringify(b.rowLocal.name)) {
        fired++;
        const ok = a.rowLocal.name.status === 'resolved' && b.rowLocal.name.status === 'ambiguous' && b.rowLocal.name.reasonCode === INCOMPLETE_NAME_GUARD_REASON && b.rowLocal.name.value === null;
        if (!ok) unexpected++;
      }
    });
  });
  return { records, fired, nonNameDifferences: nonName, unexpectedNameChanges: unexpected };
}

export interface Verdict {
  verdict: 'GO' | 'GO-WITH-SCOPE' | 'STOP' | 'NON-INFORMATIVE';
  checks: { name: string; pass: boolean; detail: string }[];
}

export interface VerdictInput {
  metrics: GuardMetrics;
  knownFailuresFalseResolved: number;
  firedCompleteInGStratum: { complete: number };
  differential: Differential;
  goldenOutcomeChanges: number;
  goldenOnSafety: { falseResolved: number; wrongSource: number; wrongNormalization: number };
  heldoutOnSafety: { wrongSource: number; wrongNormalization: number; blankAsZero: number; zeroAsBlank: number };
  beforeMismatches: number;
}

/** 事前登録（1321 §12）の数値基準を機械的に適用する */
export function judge(i: VerdictInput): Verdict {
  const m = i.metrics;
  const checks: Verdict['checks'] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  add('safety: known failure の false-resolved incomplete = 0', i.knownFailuresFalseResolved === 0, `${i.knownFailuresFalseResolved}`);
  add('safety: 全体の FRI ≤ 2 かつ incomplete(decisive) の 10% 以下', m.falseResolvedIncomplete <= 2 && m.falseResolvedIncomplete <= 0.1 * m.incomplete, `FRI=${m.falseResolvedIncomplete}, incomplete=${m.incomplete}`);
  add('regression: FAC ≤ 2 かつ 発火した decisive unit の 10% 以下', m.falseAbstainedComplete <= 2 && m.falseAbstainedComplete <= 0.1 * m.firedDecisive, `FAC=${m.falseAbstainedComplete}, firedDecisive=${m.firedDecisive}`);
  add('invariant: name 以外の差 0', i.differential.nonNameDifferences === 0, `${i.differential.nonNameDifferences}`);
  add('invariant: name の変化は resolved→ambiguous(value null)のみ', i.differential.unexpectedNameChanges === 0, `${i.differential.unexpectedNameChanges}`);
  add('invariant: development Golden の評価が baseline と同一', i.goldenOutcomeChanges === 0, `changed outcomes=${i.goldenOutcomeChanges}`);
  add('invariant: Golden で false resolved / wrong source / wrong normalization = 0', i.goldenOnSafety.falseResolved === 0 && i.goldenOnSafety.wrongSource === 0 && i.goldenOnSafety.wrongNormalization === 0, JSON.stringify(i.goldenOnSafety));
  add('invariant: held-out で wrong source / wrong normalization / blank↔zero = 0', i.heldoutOnSafety.wrongSource === 0 && i.heldoutOnSafety.wrongNormalization === 0 && i.heldoutOnSafety.blankAsZero === 0 && i.heldoutOnSafety.zeroAsBlank === 0, JSON.stringify(i.heldoutOnSafety));
  add('identity: baseline の名称が凍結した標本と一致', i.beforeMismatches === 0, `${i.beforeMismatches}`);
  const informative = m.incomplete >= 10 && m.unclear <= 0.2 * (m.incomplete + m.complete + m.unclear);
  const hardPass = checks.every(c => c.pass);
  if (!informative) return { verdict: 'NON-INFORMATIVE', checks };
  if (!hardPass) return { verdict: 'STOP', checks };
  // G 層の complete が 3 件未満なら guard の過剰は十分に測れていない → GO-WITH-SCOPE
  return { verdict: i.firedCompleteInGStratum.complete < 3 ? 'GO-WITH-SCOPE' : 'GO', checks };
}
