/**
 * table-frame relation による eligibility（research-only 純関数。production には接続しない）。規則は docs/tasks/20261005_1330_Budget_Request_Table_Frame_Predicate_Refinement_Preregistration.md。
 * 直前研究の classifier（budget-request-p1-outlier.ts の frameOf / classifyPosition）を変更せずに使い、fail-closed の分類と判定規則だけを足す。
 */
import { classifyPosition, frameOf, type BBox, type Frame, type SourcePosition } from './budget-request-p1-outlier';

export type Relation = 'header_position_supported' | 'body_or_table_position_supported' | 'ambiguous' | 'unavailable';
export interface RelationResult { relation: Relation; frameAvailable: boolean; classification: SourcePosition | null; reason: string }

const finite = (b: Partial<BBox> | null | undefined): b is BBox => !!b && ['xMin', 'xMax', 'yMin', 'yMax'].every(k => Number.isFinite((b as Record<string, number>)[k])) && (b.xMax as number) >= (b.xMin as number) && (b.yMax as number) >= (b.yMin as number);

/** candidate の bbox と、その page の long な垂直 rule から relation を決める。geometry / frame が無ければ unavailable（fail-closed） */
export function relationOf(bbox: Partial<BBox> | null | undefined, longVerticalRules: { x: number; yMin: number; yMax: number }[]): RelationResult {
  if (!finite(bbox)) return { relation: 'unavailable', frameAvailable: false, classification: null, reason: 'geometry_unavailable' };
  const frame: Frame | null = frameOf(longVerticalRules);
  if (!frame) return { relation: 'unavailable', frameAvailable: false, classification: 'SOURCE_POSITION_AMBIGUOUS', reason: 'frame_unavailable' };
  const c = classifyPosition(bbox, frame);
  const relation: Relation = c.classification === 'SOURCE_HEADER_POSITION_SUPPORTED' ? 'header_position_supported' : c.classification === 'SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED' ? 'body_or_table_position_supported' : 'ambiguous';
  return { relation, frameAvailable: true, classification: c.classification, reason: c.basis };
}

/** eligibility: header position のときだけ採用 */
export const isEligible = (r: RelationResult): boolean => r.relation === 'header_position_supported';

/** 同一 page に複数の eligible candidate があれば一意に決めず abstain */
export function selectEligible<T extends { relation: RelationResult }>(candidates: T[]): { kind: 'selected'; candidate: T } | { kind: 'abstain_multiple' } | { kind: 'none' } {
  const e = candidates.filter(c => isEligible(c.relation));
  return e.length === 1 ? { kind: 'selected', candidate: e[0] } : e.length > 1 ? { kind: 'abstain_multiple' } : { kind: 'none' };
}

export type RefinementDecision = 'TABLE_FRAME_REFINEMENT_SUPPORTED' | 'TABLE_FRAME_REFINEMENT_PARTIALLY_SUPPORTED' | 'TABLE_FRAME_REFINEMENT_NOT_SUPPORTED' | 'STOP_INTEGRITY_FAILURE';
export interface RefinementFacts {
  integrityOk: boolean; classifierReproduced: boolean; deterministic: boolean;
  p1DominantRetention: number; outliersExcluded: number; outliersTotal: number; p2BodyShare: number; coverage: number;
  regressionChanged: number; fidelityViolations: number; provenanceMissing: number; provenanceLoss: number; synthesizedText: number;
}
/** 事前登録の数値 gate と判定順序（D4 → D3 → D1 → D2） */
export function decideRefinement(f: RefinementFacts): { decision: RefinementDecision; rule: number; gates: Record<string, boolean> } {
  const g5 = f.regressionChanged === 0 && f.fidelityViolations === 0 && f.provenanceMissing === 0 && f.provenanceLoss === 0 && f.synthesizedText === 0;
  const g2 = f.outliersTotal === 2 && f.outliersExcluded === 2;
  const gates = { G1_d1: f.p1DominantRetention >= 0.98, G1_d2: f.p1DominantRetention >= 0.9, G2: g2, G3_d1: f.p2BodyShare >= 0.8, G3_d2: f.p2BodyShare >= 0.5, G4_d1: f.coverage >= 0.9, G4_d2: f.coverage >= 0.5, G5: g5 };
  if (!f.integrityOk || !f.classifierReproduced || !f.deterministic) return { decision: 'STOP_INTEGRITY_FAILURE', rule: 1, gates };
  if (!g5 || !g2 || !gates.G1_d2 || !gates.G3_d2 || !gates.G4_d2) return { decision: 'TABLE_FRAME_REFINEMENT_NOT_SUPPORTED', rule: 2, gates };
  if (gates.G1_d1 && gates.G3_d1 && gates.G4_d1) return { decision: 'TABLE_FRAME_REFINEMENT_SUPPORTED', rule: 3, gates };
  return { decision: 'TABLE_FRAME_REFINEMENT_PARTIALLY_SUPPORTED', rule: 4, gates };
}
