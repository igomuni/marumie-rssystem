/**
 * subcontracts-{YEAR}.json の読み込み・メモリキャッシュ。
 * /api/subcontracts/[projectId] と app/lib/ai/sankey-chat-agent.ts（深掘りツール）が共用する。
 */
import type { SubcontractIndex } from '@/types/subcontract';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { tryReadDataJson } from '@/app/lib/api/data-file';

const cache = new Map<SupportedYear, SubcontractIndex>();

/** 再委託構造インデックスを取得（年度別キャッシュ付き）。ファイルが無ければ null */
export function loadSubcontracts(year: SupportedYear): SubcontractIndex | null {
  if (cache.has(year)) return cache.get(year)!;
  const data = tryReadDataJson<SubcontractIndex>(`subcontracts-${year}.json`);
  if (data === null) return null;
  cache.set(year, data);
  return data;
}
