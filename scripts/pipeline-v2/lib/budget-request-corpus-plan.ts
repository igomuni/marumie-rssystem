/**
 * FY2024 概算要求 corpus の実行計画（純関数）。既存の contract（DocumentHierarchy A2 の実験定義）だけから、PDF ごとの実行方式を決める。
 * ページ範囲・hierarchy view を新たに作らない。結果（抽出・照合）には依存しない。
 */
import { A2_EXPERIMENTS } from './budget-request-document-hierarchy-a2-experiments';

export type ExecutionClass = 'runnable_existing_contract' | 'unrunnable_missing_hierarchy' | 'unrunnable_missing_layout_contract' | 'unrunnable_other';

export interface Segment { pages: [number, number]; mode: 'hierarchy_enabled' | 'null_hierarchy'; experimentId: string | null }
export interface CorpusPlan { executionClass: ExecutionClass; reason: string; hierarchyExperiment: { id: string; pages: [number, number] } | null; segments: Segment[] }

/** その PDF の hierarchy 契約: view=detail の A2 実験のうち、ページ範囲が最も広いもの（同数なら定義順で先頭）。無ければ null */
export function hierarchyContractFor(canonicalUrl: string): { id: string; pages: [number, number] } | null {
  const cands = A2_EXPERIMENTS.filter(e => e.canonicalUrl === canonicalUrl && e.view === 'detail');
  if (cands.length === 0) return null;
  let best = cands[0];
  for (const e of cands) if (e.pages[1] - e.pages[0] > best.pages[1] - best.pages[0]) best = e;
  return { id: best.id, pages: best.pages };
}

/**
 * 実行計画。hierarchy 契約があれば、その範囲を hierarchy 有りの 1 run、残りのページを null hierarchy の連続区間として run する
 * （null hierarchy は FieldResolver の既存の optional な入力。heldout・mhlw 1260 の run と同じ）。無ければ全ページを null hierarchy。
 * 区間ごとに resolveFields を 1 回呼ぶ（FieldResolver は区間内で直近の見出し layout を引き継ぐため、区間を分割しない）。
 */
export function planCorpusDocument(canonicalUrl: string, pageCount: number | null, fileState: 'FOUND' | 'MISSING' | 'INVALID'): CorpusPlan {
  if (fileState !== 'FOUND' || !pageCount || pageCount < 1) return { executionClass: 'unrunnable_other', reason: `原本の状態が ${fileState}、またはページ数を取得できない`, hierarchyExperiment: null, segments: [] };
  const h = hierarchyContractFor(canonicalUrl);
  if (!h) {
    return { executionClass: 'unrunnable_missing_hierarchy', reason: '既存の hierarchy 契約（view=detail の A2 実験）が無い。item / hierarchy 由来の項目は取得できず、null hierarchy（既存の optional な入力）でのみ実行する', hierarchyExperiment: null, segments: [{ pages: [1, pageCount], mode: 'null_hierarchy', experimentId: null }] };
  }
  const [a, b] = h.pages;
  if (a < 1 || b > pageCount || a > b) return { executionClass: 'unrunnable_other', reason: `hierarchy 契約のページ範囲 ${a}-${b} が PDF（${pageCount} ページ）に収まらない`, hierarchyExperiment: h, segments: [] };
  const segments: Segment[] = [];
  if (a > 1) segments.push({ pages: [1, a - 1], mode: 'null_hierarchy', experimentId: null });
  segments.push({ pages: [a, b], mode: 'hierarchy_enabled', experimentId: h.id });
  if (b < pageCount) segments.push({ pages: [b + 1, pageCount], mode: 'null_hierarchy', experimentId: null });
  return { executionClass: 'runnable_existing_contract', reason: `既存の hierarchy 契約 ${h.id}（view=detail、ページ ${a}-${b}）`, hierarchyExperiment: h, segments };
}
