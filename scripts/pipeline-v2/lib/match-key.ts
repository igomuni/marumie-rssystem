/**
 * RS事業とMOF BudgetEntityを完全一致キーで結合するための正規化・キー生成。
 * build-links.tsから使う純粋関数のみを切り出したもの（副作用を持つmain()から独立させ、
 * ユニットテスト可能にするため）。
 */

/** 突合用の文字列正規化: NFKC + 空白除去（V1のnorm()と同じ） */
export function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

/** MOF BudgetEntityとRsBudgetItem双方から同じ形で計算する突合キー */
export function entityMatchKey(account: string, organization: string, subAccount: string, sectionName: string, itemName: string): string {
  return [norm(account), norm(organization), norm(subAccount), norm(sectionName), norm(itemName)].join('|');
}
