/**
 * 事項別内訳データの読み込みと、年度をまたいだ追跡。
 *
 * 年度ごとに1ファイル（`mof-jikou-{YEAR}.json`）なので、経年推移を出すには
 * 全年度を横断する必要がある。ここでプロセス内にキャッシュし、API 層は薄く保つ。
 */

import type { MOFJikouData, MOFJikouItem } from '@/types/mof-jikou';
import { dataFileExists, readDataJson } from './data-file';

/**
 * 収録候補の会計年度（新しい順）。
 * 実際に返せるのは JSON が生成済みの年度だけ。
 */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023] as const;

const fileName = (year: number) => `mof-jikou-${year}.json`;

const cache = new Map<number, MOFJikouData>();
let cachedYears: number[] | null = null;

/** 生成済みの年度（新しい順） */
export function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(fileName(y)));
  return cachedYears;
}

/** 1年度分を読む（プロセス内キャッシュ） */
export function loadYear(year: number): MOFJikouData {
  const cached = cache.get(year);
  if (cached) return cached;
  const data = readDataJson<MOFJikouData>(
    fileName(year),
    `npm run generate-mof-jikou を実行してください（対象年度: ${year}）。`
  );
  cache.set(year, data);
  return data;
}

/**
 * 予算種別を除いた「同じ事項」の識別子。
 *
 * `item.key` は予算種別を含むため、当初と決算を同じ事項として辿れない。
 * ここでは種別だけを落とし、会計区分・所管・組織・特会・勘定・機関・項コード・事項名で識別する。
 * 令和5〜8年度のいずれの年度でも「識別子 × 予算種別」に重複は無い。
 */
export function identityKey(item: MOFJikouItem): string {
  return [
    item.accountType,
    item.ministry,
    item.organization,
    item.specialAccount,
    item.subAccount,
    item.agency,
    item.sectionCode,
    item.name,
  ].join('|');
}

/** `item.key`（予算種別を含む）から識別子に落とす */
function identityFromKey(key: string): string {
  const parts = key.split('|');
  // key の並びは 会計区分 | 予算種別 | 所管 | … なので2番目を取り除く
  return [parts[0], ...parts.slice(2)].join('|');
}

/** ある年度に現れた同一事項 */
export interface MOFJikouHistoryYear {
  fiscalYear: number;
  eraLabel: string;
  items: MOFJikouItem[];
}

export interface MOFJikouHistory {
  /** 問い合わせに使われた key */
  key: string;
  /** 予算種別を除いた識別子 */
  identity: string;
  /** 事項名（見つかった中で最初のもの） */
  name: string;
  /** 収録済みの全年度（新しい順）。推移の横軸 */
  availableYears: number[];
  /** 事項が現れた年度（古い順） */
  years: MOFJikouHistoryYear[];
}

/**
 * 事項の経年推移を組み立てる。
 *
 * 事項名が改称されると別の事項として扱われる（識別子に名前を含むため）。
 * 実態としては継続でも「新規」に見えるケースがあることに注意
 * （docs/tasks/20260819_1920_複数年度にわたる予算の判別方法.md）。
 */
export function buildHistory(key: string): MOFJikouHistory {
  const identity = identityFromKey(key);
  const years: MOFJikouHistoryYear[] = [];
  let name = '';

  // 推移は古い順に並べる
  for (const year of [...availableYears()].sort((a, b) => a - b)) {
    const data = loadYear(year);
    const items = data.items.filter(i => identityKey(i) === identity);
    if (items.length === 0) continue;
    if (!name) name = items[0].name;
    years.push({ fiscalYear: year, eraLabel: data.metadata.eraLabel, items });
  }

  return { key, identity, name, availableYears: availableYears(), years };
}
