/**
 * recipient-index-{YEAR}.json の読み込み・メモリキャッシュ。
 * /api/recipients/[key] と /api/search/recipients が共用する。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RecipientIndex } from '@/types/recipient-index';

const cache = new Map<string, RecipientIndex>();

export function loadRecipientIndex(year: string): RecipientIndex {
  if (cache.has(year)) return cache.get(year)!;

  const jsonPath = path.join(process.cwd(), 'public', 'data', `recipient-index-${year}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `recipient-index-${year}.json が見つかりません。` +
      `npm run generate-recipient-index${year === '2024' ? '' : `-${year}`} を実行してください。`
    );
  }

  const data: RecipientIndex = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  cache.set(year, data);
  return data;
}
