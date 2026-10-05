/**
 * 8.6pt（±3.0pt）罫線基準の項候補（Phase A、source-only）の純関数。規則は
 * docs/tasks/20261005_2040_Budget_Request_8p6pt_Item_Candidate_Full_Corpus_Protocol.md（全件評価の前に固定）。金額は条件にしない。
 * MOF・hierarchy・manual・既存 item を参照しない（source scan test で確認）。
 */
import { RE_PLAIN3, type SourceRecord } from './budget-request-rule-line-item-population';
import { normalizeText } from './stable-id';

export const BAND_MIN = 5.6;
export const BAND_MAX = 11.6;
export const inBand = (deltaX: number): boolean => deltaX >= BAND_MIN && deltaX <= BAND_MAX;

export type NameClass = 'resolved' | 'continuation_ambiguous' | 'name_unresolved';
export interface UniverseRow {
  page: number; logicalRowIndex: number; codeRaw: string; codeX: number; nameClass: NameClass; nameComplete: boolean; nameRaw: string | null; nameNormalized: string | null; nameStatus: string; nameReason: string | null; nameTokenRefs: number[];
  rowBBox: { xMin: number; yMin: number; xMax: number; yMax: number }; sourceTokenRefs: number[];
}

/** pre-band universe: request-shaped でない・plain 3 桁 code（resolved）の row（名称 text の有無で nameClass を付ける。金額は見ない） */
export function universeRow(r: SourceRecord): UniverseRow | null {
  if (r.recordKind === 'request') return null;
  const code = r.rowLocal.code;
  if (code.status !== 'resolved' || !code.value || !code.evidence || !RE_PLAIN3.test(code.value.raw)) return null;
  const nm = r.rowLocal.name;
  const resolved = nm.status === 'resolved' && !!nm.value && nm.value.raw.trim() !== '';
  const nameClass: NameClass = resolved ? 'resolved' : nm.status === 'ambiguous' && nm.reasonCode === 'continuation_ambiguous' ? 'continuation_ambiguous' : 'name_unresolved';
  const nameRefs = nm.evidence?.sourceTokenRefs ?? [];
  return {
    page: r.anchor.page, logicalRowIndex: r.anchor.logicalRowIndex, codeRaw: code.value.raw, codeX: code.evidence.bboxUnion.xMin, nameClass, nameComplete: resolved,
    nameRaw: resolved ? nm.value!.raw : null, nameNormalized: resolved ? normalizeText(nm.value!.raw) : null, nameStatus: nm.status, nameReason: nm.reasonCode, nameTokenRefs: nameRefs,
    rowBBox: r.anchorBBox, sourceTokenRefs: [...new Set([...code.evidence.sourceTokenRefs, ...nameRefs])].sort((a, b) => a - b),
  };
}

/** candidate = 名称 text が非空と確認できる（resolved / continuation_ambiguous）・rule linked・band 内 */
export const isCandidate = (u: UniverseRow, ruleStatus: string, deltaX: number | null): boolean => u.nameClass !== 'name_unresolved' && ruleStatus === 'rule_linked' && deltaX !== null && inBand(deltaX);
