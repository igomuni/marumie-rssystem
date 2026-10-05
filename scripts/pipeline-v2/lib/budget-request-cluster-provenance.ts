/**
 * Phase A（source-only）の純関数。規則は docs/tasks/20261005_1640_Budget_Request_Level_Frame_Cluster_Provenance_Protocol.md。
 * このファイルと Phase A runner は、基準 frame・基準範囲・外部照合を参照しない（source scan test で確認）。
 */
export interface PageRun { start: number; end: number; supportCount: number }

/** 連続する整数 page の最大列。pages は重複を含んでよい（support count は出現数） */
export function pageRuns(pages: number[]): PageRun[] {
  const count = new Map<number, number>();
  for (const p of pages) count.set(p, (count.get(p) ?? 0) + 1);
  const sorted = [...count.keys()].sort((a, b) => a - b);
  const runs: PageRun[] = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last && p === last.end + 1) { last.end = p; last.supportCount += count.get(p)!; } else runs.push({ start: p, end: p, supportCount: count.get(p)! });
  }
  return runs;
}

export type LexicalClass = 'plain3' | 'request_like' | 'hyphen_other' | 'other_numeric' | 'non_code';
/** node-local な code の lexical class（FieldResolver 非依存） */
export function lexicalClassOf(rowShape: string, code: string): LexicalClass {
  if (rowShape === 'request_no_then_code' && /^\d{2}-\d{2,5}$/.test(code)) return 'request_like';
  if (/^\d{3}$/.test(code)) return 'plain3';
  if (code.includes('-')) return 'hyphen_other';
  return /^\d+$/.test(code) ? 'other_numeric' : 'non_code';
}

export type SupportExtent = 'single_page' | 'multi_page_single_run' | 'multi_run' | 'unclassifiable';
export type LayoutConcentration = 'single_layout_range' | 'multiple_layout_ranges' | 'layout_unavailable';
export type DocumentDistribution = 'contiguous' | 'reappears_in_separate_runs' | 'unclassifiable';

export function classifyCluster(support: { page: number; layoutRangeId: string; lexical: LexicalClass; rowShape: string }[]): {
  supportExtent: SupportExtent; layoutConcentration: LayoutConcentration; documentDistribution: DocumentDistribution;
  lexicalComposition: Record<LexicalClass, { count: number; ratio: number }>; request: { requestShaped: number; nonRequest: number; mixed: boolean };
} {
  const runs = pageRuns(support.map(s => s.page));
  const uniquePages = new Set(support.map(s => s.page)).size;
  const supportExtent: SupportExtent = support.length === 0 ? 'unclassifiable' : uniquePages === 1 ? 'single_page' : runs.length === 1 ? 'multi_page_single_run' : 'multi_run';
  const ids = new Set(support.map(s => s.layoutRangeId));
  const layoutConcentration: LayoutConcentration = support.length === 0 || (ids.size === 1 && ids.has('unassigned')) ? 'layout_unavailable' : ids.size === 1 ? 'single_layout_range' : 'multiple_layout_ranges';
  const lexicalComposition = { plain3: { count: 0, ratio: 0 }, request_like: { count: 0, ratio: 0 }, hyphen_other: { count: 0, ratio: 0 }, other_numeric: { count: 0, ratio: 0 }, non_code: { count: 0, ratio: 0 } };
  for (const s of support) lexicalComposition[s.lexical].count++;
  for (const k of Object.keys(lexicalComposition) as LexicalClass[]) lexicalComposition[k].ratio = support.length === 0 ? 0 : Math.round((lexicalComposition[k].count / support.length) * 1e6) / 1e6;
  const requestShaped = support.filter(s => s.rowShape === 'request_no_then_code').length;
  return { supportExtent, layoutConcentration, documentDistribution: support.length === 0 ? 'unclassifiable' : runs.length === 1 ? 'contiguous' : 'reappears_in_separate_runs', lexicalComposition, request: { requestShaped, nonRequest: support.length - requestShaped, mixed: requestShaped > 0 && support.length - requestShaped > 0 } };
}

/** frozen layout-summary の ranges から page が属する range id（from-to）。属さなければ unassigned */
export function layoutRangeOf(page: number, ranges: { from: number; to: number; gapPages: number[]; signature: string }[]): { id: string; signature: string | null; detail: boolean } {
  const r = ranges.find(x => page >= x.from && page <= x.to && !x.gapPages.includes(page));
  if (!r) return { id: 'unassigned', signature: null, detail: false };
  return { id: `${r.from}-${r.to}`, signature: r.signature, detail: r.signature.startsWith('H:') && !r.signature.startsWith('H:-') };
}
