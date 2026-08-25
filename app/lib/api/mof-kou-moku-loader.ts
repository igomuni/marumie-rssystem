/**
 * 科目別内訳（項・目）データの読み込み。
 *
 * 生成は npm run generate-mof-kou-moku（scripts/generate-mof-kou-moku-data.ts）。
 * ZIPがローカルに当初予算しか無いため、年度ごとに1ファイル・当初予算のみを収録する。
 * `/mof-jikou`（事項・mof-jikou-loader.ts）と対になるが、目には事項のような年度横断の
 * 追跡機能（buildHistory）は設けていない（目の分類コードは事項以上に年度で揺れやすいため）。
 */

import type { MOFKouMokuData } from '@/types/mof-kou-moku';
import { dataFileExists, readDataJson } from './data-file';

/** 収録候補の会計年度（新しい順）。実際に返せるのは JSON が生成済みの年度だけ */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] as const;

const fileName = (year: number) => `mof-kou-moku-${year}.json`;

const cache = new Map<number, MOFKouMokuData>();
let cachedYears: number[] | null = null;

/** 生成済みの年度（新しい順） */
export function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(fileName(y)));
  return cachedYears;
}

/** 1年度分を読む（プロセス内キャッシュ） */
export function loadYear(year: number): MOFKouMokuData {
  const cached = cache.get(year);
  if (cached) return cached;
  const data = readDataJson<MOFKouMokuData>(
    fileName(year),
    `npm run generate-mof-kou-moku を実行してください（対象年度: ${year}）。`
  );
  cache.set(year, data);
  return data;
}
