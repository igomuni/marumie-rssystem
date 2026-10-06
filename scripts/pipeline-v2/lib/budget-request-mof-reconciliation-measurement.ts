/**
 * P1 preregistration §7 の「親が exact_unique の request のうち exact_unique の割合」の測定 helper（measurement correction 用。matcher の規則は変えない）。
 * 親の判定は request 自身の最終 classification から逆算せず、parentItem.ref → 対応する item の照合結果で行う。
 * request 自身が name_unavailable でも、親の項が exact_unique なら denominator に入る。
 */
import type { MatchClass } from './budget-request-mof-reconciliation';

/** matcher と同じ ref の読み方（`...-p<page>-r<row>`）。item 側の anchor は `${runId}#${page}:${logicalRowIndex}` */
export function parentAnchor(runId: string, ref: string | null): string | null {
  const m = ref ? /-p(\d+)-r(\d+)$/.exec(ref) : null;
  return m ? `${runId}#${m[1]}:${m[2]}` : null;
}

export interface RequestMeasureRow { ownClass: MatchClass; parentItemClass: MatchClass | null }
export interface ParentExactMeasurement {
  requestTotal: number;
  requestExactUnique: number;
  /** 親の項が MOF exact_unique の request（request 自身の classification に関わらない） */
  parentExactUnique: number;
  /** その内訳（request 自身の classification 別） */
  parentExactUniqueByOwnClass: Record<string, number>;
  /** denominator が parentExactUnique、numerator が親 exact かつ request exact_unique */
  numerator: number;
  conditionalExactRate: number | null;
  nameUnavailableWithParentExact: number;
}

export function measureParentExact(rows: RequestMeasureRow[]): ParentExactMeasurement {
  const parentExact = rows.filter(r => r.parentItemClass === 'exact_unique');
  const byOwn: Record<string, number> = {};
  for (const r of parentExact) byOwn[r.ownClass] = (byOwn[r.ownClass] ?? 0) + 1;
  const numerator = parentExact.filter(r => r.ownClass === 'exact_unique').length;
  return {
    requestTotal: rows.length,
    requestExactUnique: rows.filter(r => r.ownClass === 'exact_unique').length,
    parentExactUnique: parentExact.length,
    parentExactUniqueByOwnClass: Object.fromEntries(Object.entries(byOwn).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    numerator,
    conditionalExactRate: parentExact.length === 0 ? null : numerator / parentExact.length,
    nameUnavailableWithParentExact: parentExact.filter(r => r.ownClass === 'name_unavailable').length,
  };
}

/** request 自身を MOF 事項と比較できた状態（名称あり＋親の項が exact_unique）。full-corpus の funnel / gate の「比較可能な request」と同じ意味 */
const COMPARABLE_OWN: MatchClass[] = ['exact_unique', 'exact_ambiguous', 'no_exact_match'];
export interface ComparableMeasurement {
  /** 親の項が exact_unique（request 名の有無を問わない） */
  parentExactUnique: number;
  /** 親が exact_unique かつ request 名があり、request 自身を照合できた件数 */
  comparableRequests: number;
  requestExactUnique: number;
  /** exact_unique ÷ comparableRequests（funnel 最終段の率） */
  exactRateWithinComparable: number | null;
  /** exact_unique ÷ parentExactUnique（P1 preregistration §7 の定義） */
  parentExactConditionalRate: number | null;
}
export function measureComparable(rows: RequestMeasureRow[]): ComparableMeasurement {
  const parentExact = rows.filter(r => r.parentItemClass === 'exact_unique');
  const comparable = parentExact.filter(r => COMPARABLE_OWN.includes(r.ownClass));
  const exact = comparable.filter(r => r.ownClass === 'exact_unique').length;
  return {
    parentExactUnique: parentExact.length,
    comparableRequests: comparable.length,
    requestExactUnique: exact,
    exactRateWithinComparable: comparable.length === 0 ? null : exact / comparable.length,
    parentExactConditionalRate: parentExact.length === 0 ? null : exact / parentExact.length,
  };
}
