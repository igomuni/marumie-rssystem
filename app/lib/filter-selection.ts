/**
 * 複数選択フィルタ（MultiSelectCombo）で「なし」（すべて解除）を表す値。選択の配列は、空 = すべて、
 * この値だけ = なし（どの選択肢とも一致しないので、`length > 0 && !includes` の絞り込みで 0 件になる）、それ以外 = 選んだものだけ。
 * 選択肢の外の値を落とす処理でも、この値は残す
 */
export const NONE_SELECTED = '__none__';

/**
 * 複数選択フィルタ（MultiSelectCombo等）の選択済みの値が、上位の絞り込みで
 * 再計算された選択肢の外に出ていたら落とす。FilterSidebar側のonChangeで
 * 直後にプルーンすると、そのハンドラのクロージャが直前レンダーの古い選択肢
 * （ministries等）を参照してしまい、更新が1テンポ遅れて無効な選択が残る
 * ことがある。ページ層でこの関数を使い、選択肢が再計算されるたびに
 * useEffectで都度検証する方が確実。
 */
export function pruneInvalidSelections<T extends object>(
  filters: T,
  entries: Array<[key: keyof T, options: readonly string[]]>
): T | null {
  let next = filters;
  let changed = false;
  for (const [key, options] of entries) {
    const current = next[key] as unknown;
    if (!Array.isArray(current)) continue;
    const filtered = (current as string[]).filter(v => v === NONE_SELECTED || options.includes(v));
    if (filtered.length !== current.length) {
      next = { ...next, [key]: filtered };
      changed = true;
    }
  }
  return changed ? next : null;
}
