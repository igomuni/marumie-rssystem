/**
 * FieldResolver v0 PoC の実行単位（CLI と評価CLIが共有する純粋な定義。副作用なし）。
 * ページ範囲は「どのページを走査するか」の選択で、推論の入力ではない（Golden の値・ID は含まない）。
 * hierarchy ありの run は DocumentHierarchy v2-B（凍結済みの最終構成）の観測結果を消費する。hierarchy を再推論しない。
 * hierarchy の走査範囲が無いページ（親子を観測していない範囲）の run は hierarchy 依存 field が not_observed になる。
 */
import { A2_EXPERIMENTS } from './budget-request-document-hierarchy-a2-experiments';
import type { HierarchyView } from './budget-request-document-hierarchy';
import type { HierarchyV2ExperimentalOptions } from './budget-request-document-hierarchy-v2';

/** DocumentHierarchy の最終構成 B（singleton root placement のみ。header collision は観測のみ） */
export const HIERARCHY_B_ONLY_OPTIONS: HierarchyV2ExperimentalOptions = { headerCollisionHandling: 'observe-only', singletonRootPlacement: 'lattice-supported' };

export interface FieldResolverRun {
  /** artifact のディレクトリ名（document-key） */
  documentKey: string;
  canonicalUrl: string;
  pages: [number, number];
  /** hierarchy を観測する range（A2_EXPERIMENTS の id）。無ければ null（hierarchy 依存 field は not_observed） */
  hierarchy: { experimentId: string; view: HierarchyView } | null;
}

const exp = (id: string) => {
  const e = A2_EXPERIMENTS.find(x => x.id === id);
  if (!e) throw new Error(`experiment not found: ${id}`);
  return e;
};
const withHierarchy = (documentKey: string, id: string): FieldResolverRun => {
  const e = exp(id);
  return { documentKey, canonicalUrl: e.canonicalUrl, pages: e.pages, hierarchy: { experimentId: e.id, view: e.view } };
};

const MHLW_URL = exp('mhlw-detail').canonicalUrl;
const MEXT_URL = exp('mext-detail').canonicalUrl;

export const FIELD_RESOLVER_RUNS: FieldResolverRun[] = [
  withHierarchy('meti-detail-9-106', 'meti-detail'),
  withHierarchy('mhlw-detail-1555-1700', 'mhlw-detail'),
  withHierarchy('cfa-general-detail-7-147', 'cfa-general-detail'),
  { documentKey: 'mhlw-detail-1260-1275', canonicalUrl: MHLW_URL, pages: [1260, 1275], hierarchy: null },
  { documentKey: 'mext-detail-870-880', canonicalUrl: MEXT_URL, pages: [870, 880], hierarchy: null },
];
