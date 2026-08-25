/**
 * MOF事項 ↔ RS事業 紐づけデータの読み込み。
 *
 * 生成は npm run generate-mof-rs-linkage（scripts/generate-mof-rs-linkage.ts）。
 * ファイルは予算年度（= mof-jikou の会計年度）ごとに1本。
 * 未生成の年度は「対象外」として扱い、呼び出し側でエラーにしない
 * （v1は一般会計・当初予算のみが対象で、他の年度・範囲は順次拡張のため）。
 */

import type { MofRsLinkageData, MofRsLinkageRecord } from '@/types/mof-rs-linkage';
import { dataFileExists, readDataJson } from './data-file';
import { identityFromKey } from './mof-jikou-loader';

const fileName = (budgetYear: number) => `mof-rs-linkage-${budgetYear}.json`;

const cache = new Map<number, MofRsLinkageData>();

/** その予算年度の紐づけデータが生成済みか */
export function linkageAvailable(budgetYear: number): boolean {
  return dataFileExists(fileName(budgetYear));
}

function loadYear(budgetYear: number): MofRsLinkageData {
  const cached = cache.get(budgetYear);
  if (cached) return cached;
  const data = readDataJson<MofRsLinkageData>(
    fileName(budgetYear),
    `npm run generate-mof-rs-linkage を実行してください（対象年度: ${budgetYear}）。`
  );
  cache.set(budgetYear, data);
  return data;
}

/**
 * 事項の合成キー（`MOFJikouItem.key`。予算種別込み）から、紐づく RS 事業を検索する。
 * 未生成の年度では空配列を返す（`linkageAvailable` で事前に判定可能）。
 */
export function findLinksByKey(budgetYear: number, key: string): MofRsLinkageRecord[] {
  if (!linkageAvailable(budgetYear)) return [];
  const identity = identityFromKey(key);
  return loadYear(budgetYear).links.filter(l => l.jikouIdentity === identity);
}
