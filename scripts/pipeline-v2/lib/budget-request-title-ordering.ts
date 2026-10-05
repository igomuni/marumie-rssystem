/**
 * page header blank の title ordering inventory（research-only 純関数）。規則は docs/tasks/20261005_1117_Budget_Request_Page_Header_Blank_Title_Ordering_Protocol.md（Phase A 全件走査の前に固定）。
 * label の意味は解釈しない。blank に前後 page の label を補完しない。
 */
import { normalizeLabel, shapeOf } from './budget-request-header-label';

export const TOP_BAND_FRACTION = 0.2;
export interface OrderRow { index: number; x: number; y: number; texts: string[]; physicalRowIndexes: number[]; tokenIndexes: number[] }
export interface RowEvidence {
  index: number; x: number; y: number; raw: string; normalized: string; shape: { prefixLength: number | null; innerLength: number | null } | null;
  codeShaped: boolean; labelShaped: boolean; titleLike: boolean; tokenIndexes: number[];
}

/** row の evidence。label-shaped は上端帯（y < page 高さ × 0.2）で normalized が prefix(inner) 形、code-shaped は先頭 token が 3 桁数字、title-like は上端帯で label でも code でもなく数字以外の文字を含む */
export function evidenceOf(row: OrderRow, pageHeight: number): RowEvidence {
  const raw = row.texts.join(' ');
  const normalized = normalizeLabel(raw);
  const sh = shapeOf(normalized);
  const top = row.y < pageHeight * TOP_BAND_FRACTION;
  const codeShaped = /^\d{3}$/.test(row.texts[0] ?? '');
  const labelShaped = top && normalized !== '' && sh.parenthesized;
  const titleLike = top && !labelShaped && !codeShaped && /[^\d\s]/.test(raw);
  return { index: row.index, x: row.x, y: row.y, raw, normalized, shape: sh.parenthesized ? { prefixLength: sh.prefixLength, innerLength: sh.innerLength } : null, codeShaped, labelShaped, titleLike, tokenIndexes: row.tokenIndexes };
}

export type OrderClass = 'unavailable' | 'neither_label_nor_code' | 'label_without_code' | 'code_without_label' | 'ordering_ambiguous' | 'label_and_code_same_row' | 'label_before_code' | 'multiple_labels_before_code' | 'code_before_label' | 'multiple_labels_after_code' | 'other_observed_structure';

/** primary class（排他。protocol の順に最初に当たるもの） */
export function classifyOrdering(rows: RowEvidence[]): { cls: OrderClass; labelRows: number; codeRows: number; firstLabelIndex: number | null; firstCodeIndex: number | null } {
  const labels = rows.filter(r => r.labelShaped), codes = rows.filter(r => r.codeShaped);
  const fl = labels[0]?.index ?? null, fc = codes[0]?.index ?? null;
  const base = { labelRows: labels.length, codeRows: codes.length, firstLabelIndex: fl, firstCodeIndex: fc };
  if (labels.length === 0 && codes.length === 0) return { cls: 'neither_label_nor_code', ...base };
  if (codes.length === 0) return { cls: 'label_without_code', ...base };
  if (labels.length === 0) return { cls: 'code_without_label', ...base };
  const firstCode = codes[0];
  const labelsBefore = labels.filter(l => l.index < firstCode.index), labelsAfter = labels.filter(l => l.index > firstCode.index);
  if (labelsBefore.length > 0 && labelsAfter.length > 0) return { cls: 'ordering_ambiguous', ...base };
  if (labels[0].index === firstCode.index) return { cls: 'label_and_code_same_row', ...base };
  if (labelsBefore.length > 0) return { cls: labelsBefore.length === 1 ? 'label_before_code' : 'multiple_labels_before_code', ...base };
  if (labelsAfter.length > 0) return { cls: labelsAfter.length === 1 ? 'code_before_label' : 'multiple_labels_after_code', ...base };
  return { cls: 'other_observed_structure', ...base };
}

export type BlankReason = 'unavailable' | 'source_order_ambiguous' | 'projection_cutoff_before_label' | 'label_shape_unrecognized' | 'source_label_absent' | 'other_observed_structure';
/** 前回 observed_blank page の blank reason（protocol の優先順）。evaluable でない page は unavailable */
export function blankReasonOf(available: boolean, cls: OrderClass, rows: RowEvidence[]): BlankReason {
  if (!available) return 'unavailable';
  if (cls === 'ordering_ambiguous') return 'source_order_ambiguous';
  if (rows.some(r => r.labelShaped)) return 'projection_cutoff_before_label';
  if (rows.some(r => r.titleLike)) return 'label_shape_unrecognized';
  if (cls === 'other_observed_structure') return 'other_observed_structure';
  return 'source_label_absent';
}

export type PhaseADecision = 'PROJECTION_ARTIFACT_DOMINANT' | 'SOURCE_BLANK_DOMINANT' | 'MULTIPLE_SOURCE_SCHEMA_VARIANTS' | 'INCONCLUSIVE';
/** 事前登録の判定規則。blank = 前回 observed_blank の page 数 */
export function decidePhaseA(reproduced: boolean, blank: number, reasons: Record<string, number>): { decision: PhaseADecision; rule: number } {
  const n = (k: string) => reasons[k] ?? 0;
  if (!reproduced || blank === 0 || (n('unavailable') + n('source_order_ambiguous') + n('other_observed_structure')) / blank >= 0.5) return { decision: 'INCONCLUSIVE', rule: 1 };
  const max = Math.max(...Object.values(reasons));
  if (n('projection_cutoff_before_label') === max && n('projection_cutoff_before_label') / blank > 0.5) return { decision: 'PROJECTION_ARTIFACT_DOMINANT', rule: 2 };
  if (n('source_label_absent') === max && n('source_label_absent') / blank > 0.5) return { decision: 'SOURCE_BLANK_DOMINANT', rule: 3 };
  return { decision: 'MULTIPLE_SOURCE_SCHEMA_VARIANTS', rule: 4 };
}
