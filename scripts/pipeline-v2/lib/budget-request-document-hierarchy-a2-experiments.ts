/**
 * DocumentHierarchy A2 最終実験の実験定義（走査範囲・variant）。純粋な定義で副作用なし（ランナーと評価CLIが共有）。
 * 範囲は事前登録（A2実験計画）の development / negative / regression と、B の development。親子関係を含まない。
 */
import type { HierarchyView } from './budget-request-document-hierarchy';
import type { HierarchyV2ExperimentalOptions } from './budget-request-document-hierarchy-v2';

const MHLW = 'https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf';
const METI = 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf';
const MEXT_SUMMARY = 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_02.pdf';
const MEXT_DETAIL = 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf';
const ENV = 'https://www.env.go.jp/content/000157010.pdf';
const MAFF_FUKKO = 'https://www.maff.go.jp/j/budget/attach/pdf/230901-4.pdf';
const MLIT_FUKKO = 'https://www.mlit.go.jp/page/content/001630395.pdf';

export type A2Set = 'a2-development' | 'regression' | 'b-development' | 'a2-holdout';
export interface A2Experiment {
  id: string;
  set: A2Set;
  view: HierarchyView;
  canonicalUrl: string;
  pages: [number, number];
}

/** 事前登録（A2実験計画）で固定した development / negative / regression と、B の development。範囲は #363〜#364・v2 実験と同じ */
export const A2_EXPERIMENTS: A2Experiment[] = [
  { id: 'meti-detail', set: 'a2-development', view: 'detail', canonicalUrl: METI, pages: [9, 106] },
  { id: 'env-detail', set: 'a2-development', view: 'detail', canonicalUrl: ENV, pages: [21, 193] },
  { id: 'maff-fukko-detail', set: 'a2-development', view: 'detail', canonicalUrl: MAFF_FUKKO, pages: [7, 20] },
  { id: 'mlit-fukko-detail', set: 'a2-development', view: 'detail', canonicalUrl: MLIT_FUKKO, pages: [7, 10] },
  { id: 'mhlw-summary', set: 'regression', view: 'summary', canonicalUrl: MHLW, pages: [19, 20] },
  { id: 'mhlw-detail', set: 'regression', view: 'detail', canonicalUrl: MHLW, pages: [1555, 1700] },
  { id: 'meti-summary', set: 'regression', view: 'summary', canonicalUrl: METI, pages: [5, 8] },
  { id: 'mext-summary', set: 'regression', view: 'summary', canonicalUrl: MEXT_SUMMARY, pages: [1, 8] },
  { id: 'mext-detail', set: 'regression', view: 'detail', canonicalUrl: MEXT_DETAIL, pages: [1045, 1339] },
  { id: 'meti-detail-pre-header', set: 'regression', view: 'detail', canonicalUrl: METI, pages: [9, 103] },
  { id: 'meti-detail-narrow', set: 'b-development', view: 'detail', canonicalUrl: METI, pages: [66, 81] },
  { id: 'mext-detail-narrow', set: 'b-development', view: 'detail', canonicalUrl: MEXT_DETAIL, pages: [1045, 1259] },
  { id: 'mhlw-detail-narrow', set: 'b-development', view: 'detail', canonicalUrl: MHLW, pages: [1555, 1602] },
];

export const A2_VARIANTS: { name: string; options: HierarchyV2ExperimentalOptions | null }[] = [
  { name: 'v1', options: null },
  { name: 'v2-A', options: { headerCollisionHandling: 'observational-filter', singletonRootPlacement: 'off' } },
  { name: 'v2-A2', options: { headerCollisionHandling: 'page-edge-domain', singletonRootPlacement: 'off' } },
  { name: 'v2-B', options: { headerCollisionHandling: 'off', singletonRootPlacement: 'lattice-supported' } },
  { name: 'v2-B-A2', options: { headerCollisionHandling: 'page-edge-domain', singletonRootPlacement: 'lattice-supported' } },
  { name: 'v2-B-obs', options: { headerCollisionHandling: 'observe-only', singletonRootPlacement: 'lattice-supported' } },
];
