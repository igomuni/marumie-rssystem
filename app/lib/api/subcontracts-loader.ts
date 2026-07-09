/**
 * subcontracts-{YEAR}.json の読み込み・メモリキャッシュ。
 * /api/subcontracts/[projectId] と app/lib/ai/sankey-chat-agent.ts（深掘りツール）が共用する。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SubcontractIndex } from '@/types/subcontract';
import type { SupportedYear } from '@/app/lib/api/api-notes';

const cache = new Map<SupportedYear, SubcontractIndex>();

/** 再委託構造インデックスを取得（年度別キャッシュ付き）。ファイルが無ければ null */
export function loadSubcontracts(year: SupportedYear): SubcontractIndex | null {
  if (cache.has(year)) return cache.get(year)!;
  const filePath = path.join(process.cwd(), 'public', 'data', `subcontracts-${year}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data: SubcontractIndex = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  cache.set(year, data);
  return data;
}
