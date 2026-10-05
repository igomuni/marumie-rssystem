/**
 * 既存 DocumentHierarchy が item-shaped geometry の行を意味分離する mechanism の分類（research-only 純関数）。
 * mapping は FieldResolver.kindFromHierarchy / hierarchyFields のコード上の分岐（recordKindBasis の文字列）から事前登録で固定したもの。結果を見て変更しない。
 */
export type Mechanism = 'M1_row_local' | 'M2_sequence_state' | 'M3_contract_dependent' | 'M4_unresolved';

export const BASIS = {
  requestNo: 'row-leading request number followed by a code',
  hyphen: 'hyphenated code without a request number',
  plainNoNode: 'plain code and no hierarchy node for this row',
  strongHeader: 'strong header-collision evidence on this node',
  noEdge: 'no edge for the node',
  root: 'hierarchy root: no parent candidate (edge unresolved)',
  parentMissing: 'parent node missing',
  parentKindUndetermined: 'parent kind not determined',
  childOfRoot: 'child of a hierarchy root (organization)',
  nestedUnderRequest: 'code-only row nested under a request in the observed hierarchy',
} as const;

/** recordKindBasis → mechanism（事前登録）。M3 は「root（入力 range 内で自分より浅い見出しが先行しない）」に依存する分岐。M2 は range 内の文書順 stack / x-level / page 状態で決まる分岐。M1 は行単独の形。 */
export function mechanismOf(basis: string, nameReason: string | null): Mechanism {
  if (basis === BASIS.requestNo || basis === BASIS.hyphen) return 'M1_row_local';
  if (basis === BASIS.plainNoNode) return nameReason === 'no_name_token' ? 'M1_row_local' : 'M4_unresolved';
  if (basis === BASIS.root) return 'M3_contract_dependent';
  if (basis === BASIS.childOfRoot || basis === BASIS.strongHeader || basis === BASIS.noEdge || basis === BASIS.parentMissing || basis === BASIS.parentKindUndetermined || /^hierarchy edge .+: kind not determined$/.test(basis) || /^code-only row nested under a .+ in the observed hierarchy$/.test(basis)) return 'M2_sequence_state';
  return 'M4_unresolved';
}

export type UnclassifiedClass = 'no_node_row_shape_no_name_token' | 'no_node_unexplained' | 'node_unplaced_no_edge' | 'level_gap' | 'parent_kind_not_determined' | 'strong_header_collision' | 'parent_node_missing' | 'other_unresolved';
/** unclassified 行の分解（事前登録）。contract / range 外は population が hierarchy 区間内のため 0 になる（分類対象に含めない） */
export function unclassifiedClassOf(basis: string, nameReason: string | null): UnclassifiedClass {
  if (basis === BASIS.plainNoNode) return nameReason === 'no_name_token' ? 'no_node_row_shape_no_name_token' : 'no_node_unexplained';
  if (basis === BASIS.noEdge) return 'node_unplaced_no_edge';
  if (/^hierarchy edge level_gap: kind not determined$/.test(basis)) return 'level_gap';
  if (basis === BASIS.parentKindUndetermined) return 'parent_kind_not_determined';
  if (basis === BASIS.strongHeader) return 'strong_header_collision';
  if (basis === BASIS.parentMissing) return 'parent_node_missing';
  return 'other_unresolved';
}

export type BoundaryDecision = 'EXISTING_HIERARCHY_SEMANTIC_BOUNDARY_DETERMINISTIC_AND_PORTABLE' | 'SEMANTIC_BOUNDARY_DETERMINISTIC_BUT_CONTRACT_DEPENDENT' | 'SEMANTIC_BOUNDARY_PARTIALLY_IDENTIFIED' | 'NO_DETERMINISTIC_SEMANTIC_BOUNDARY_IDENTIFIED' | 'INCONCLUSIVE';
export interface BoundaryFacts { populationReproduced: boolean; itemVsDetailSeparable: boolean; orgMechanismIdentified: boolean; m3Rows: number }

/** 事前登録の判定規則。itemVsDetailSeparable = 範囲内 request 基準の相対 offset で detail_line が item の帯に入らず item 97 が全て入る。orgMechanismIdentified = organization 7 の basis が全て root、item が全て child-of-root */
export function decideBoundary(f: BoundaryFacts): { decision: BoundaryDecision; rule: number } {
  if (!f.populationReproduced) return { decision: 'INCONCLUSIVE', rule: 1 };
  if (!f.itemVsDetailSeparable && !f.orgMechanismIdentified) return { decision: 'NO_DETERMINISTIC_SEMANTIC_BOUNDARY_IDENTIFIED', rule: 2 };
  if (f.itemVsDetailSeparable !== f.orgMechanismIdentified) return { decision: 'SEMANTIC_BOUNDARY_PARTIALLY_IDENTIFIED', rule: 3 };
  return f.m3Rows === 0 ? { decision: 'EXISTING_HIERARCHY_SEMANTIC_BOUNDARY_DETERMINISTIC_AND_PORTABLE', rule: 4 } : { decision: 'SEMANTIC_BOUNDARY_DETERMINISTIC_BUT_CONTRACT_DEPENDENT', rule: 5 };
}
