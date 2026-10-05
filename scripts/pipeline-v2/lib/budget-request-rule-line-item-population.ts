/**
 * 罫線基準「項」population inventory（Phase A、source-only）の純関数。規則は
 * docs/tasks/20261005_1930_Budget_Request_RuleLine_Item_Population_Inventory_Protocol.md（全件 scan の前に固定）。
 * hierarchy・MOF・manual contract・既存 item・既知の indent 定数を参照しない（source scan test で確認）。
 */
import { normalizeText } from './stable-id';

export const RE_PLAIN3 = /^\d{3}$/;
export interface AmountCell { status: string; value: unknown; evidence: { sourceTokenRefs: number[] } | null }
export interface SourceRecord {
  anchor: { page: number; logicalRowIndex: number };
  anchorBBox: { xMin: number; yMin: number; xMax: number; yMax: number };
  recordKind: string;
  rowLocal: {
    code: { status: string; value: { raw: string } | null; evidence: { sourceTokenRefs: number[]; bboxUnion: { xMin: number } } | null };
    name: { status: string; reasonCode: string | null; value: { raw: string; normalized: string } | null; evidence?: { sourceTokenRefs: number[] } | null };
    previousBudget: AmountCell; requestedBudget: AmountCell; difference: AmountCell;
  };
}

export interface StructuralRow {
  page: number; logicalRowIndex: number; requestShaped: false; codeRaw: string; codeNormalized: string; codeX: number;
  nameRaw: string | null; nameNormalized: string | null; nameStatus: string; nameTokenRefs: number[];
  amountEvidence: boolean; previousBudgetEvidence: boolean; requestBudgetEvidence: boolean; differenceEvidence: boolean; amountPattern: string; amountStatuses: { previous: string; request: string; difference: string }; amountTokenRefs: number[];
  rowBBox: { xMin: number; yMin: number; xMax: number; yMax: number }; sourceTokenRefs: number[];
}

const resolved = (c: AmountCell) => c.status === 'resolved' && c.value !== null && c.value !== undefined;
/** primary structural row（protocol §3）。request-shaped（recordKind = request）・code 非 resolved・plain 3 桁でない・amount evidence なしは null */
export function structuralRow(r: SourceRecord): StructuralRow | null {
  if (r.recordKind === 'request') return null;
  const code = r.rowLocal.code;
  if (code.status !== 'resolved' || !code.value || !code.evidence || !RE_PLAIN3.test(code.value.raw)) return null;
  const p = resolved(r.rowLocal.previousBudget), q = resolved(r.rowLocal.requestedBudget), d = resolved(r.rowLocal.difference);
  if (!p && !q && !d) return null;
  const nm = r.rowLocal.name;
  const name = nm.status === 'resolved' ? nm.value : null;
  const amountRefs = [r.rowLocal.previousBudget, r.rowLocal.requestedBudget, r.rowLocal.difference].flatMap(c => (resolved(c) ? c.evidence?.sourceTokenRefs ?? [] : []));
  const nameRefs = nm.evidence?.sourceTokenRefs ?? [];
  return {
    page: r.anchor.page, logicalRowIndex: r.anchor.logicalRowIndex, requestShaped: false, codeRaw: code.value.raw, codeNormalized: normalizeText(code.value.raw), codeX: code.evidence.bboxUnion.xMin,
    nameRaw: name?.raw ?? null, nameNormalized: name ? normalizeText(name.raw) : null, nameStatus: nm.status, nameTokenRefs: nameRefs,
    amountEvidence: true, previousBudgetEvidence: p, requestBudgetEvidence: q, differenceEvidence: d, amountPattern: `${p ? 'P' : '-'}${q ? 'R' : '-'}${d ? 'D' : '-'}`,
    amountStatuses: { previous: r.rowLocal.previousBudget.status, request: r.rowLocal.requestedBudget.status, difference: r.rowLocal.difference.status }, amountTokenRefs: [...new Set(amountRefs)].sort((a, b) => a - b),
    rowBBox: r.anchorBBox, sourceTokenRefs: [...new Set([...code.evidence.sourceTokenRefs, ...nameRefs, ...amountRefs])].sort((a, b) => a - b),
  };
}

export interface VRule { x: number; yMin: number; yMax: number; lineWidths: number[]; sourcePaths: number[] }
export type RuleStatus = 'rule_linked' | 'rule_unavailable' | 'rule_ambiguous';
/** left rule: codeX より左で、row の vertical midpoint を y 区間（端を含む）が含む rule のうち最も近いもの */
export function selectLeftRule(rules: VRule[], codeX: number, bbox: { yMin: number; yMax: number }): { status: RuleStatus; rule: VRule | null; eligibleCount: number } {
  const mid = (bbox.yMin + bbox.yMax) / 2;
  const eligible = rules.filter(r => r.x < codeX && r.yMin <= mid && mid <= r.yMax);
  if (eligible.length === 0) return { status: 'rule_unavailable', rule: null, eligibleCount: 0 };
  const nearestX = Math.max(...eligible.map(r => r.x));
  const nearest = eligible.filter(r => r.x === nearestX);
  return nearest.length > 1 ? { status: 'rule_ambiguous', rule: null, eligibleCount: eligible.length } : { status: 'rule_linked', rule: nearest[0], eligibleCount: eligible.length };
}

export const round3 = (x: number) => Math.round(x * 1000) / 1000;
export const round1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
