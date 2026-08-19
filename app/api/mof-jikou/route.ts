/**
 * 財務省 予算書・決算書「事項別内訳」APIエンドポイント。
 *
 * 生成は npm run generate-mof-jikou（scripts/generate-mof-jikou-data.ts）。
 * 行政事業レビューのデータとは独立した、MOF単独のデータセット。
 */

import { NextResponse } from 'next/server';
import type { MOFJikouData } from '@/types/mof-jikou';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { dataFileExists, readDataJson } from '@/app/lib/api/data-file';

/**
 * 収録候補の会計年度（新しい順）。
 * 実際に返せるのは JSON が生成済みの年度だけで、availableYears で通知する。
 */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023] as const;

const fileName = (year: number) => `mof-jikou-${year}.json`;

/** プロセス内キャッシュ。年度ごとに保持する */
const cache = new Map<number, MOFJikouData>();
let cachedYears: number[] | null = null;

function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(fileName(y)));
  return cachedYears;
}

/**
 * GET /api/mof-jikou
 *
 * クエリ:
 *   year — 会計年度（西暦）。省略時は収録済みの最新年度
 */
export async function GET(request: Request) {
  try {
    const years = availableYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-jikou を実行してください。' },
        { status: 503 }
      );
    }

    const raw = new URL(request.url).searchParams.get('year');
    const year = raw ? Number(raw) : years[0];
    if (!years.includes(year)) {
      return NextResponse.json(
        { error: `対象外の年度です: ${raw}`, availableYears: years },
        { status: 400 }
      );
    }

    let data = cache.get(year);
    if (!data) {
      data = readDataJson<MOFJikouData>(
        fileName(year),
        `npm run generate-mof-jikou を実行してください（対象年度: ${year}）。`
      );
      cache.set(year, data);
    }

    // 年度切替の選択肢はクライアントが持たないので、応答に同梱する
    return NextResponse.json(
      { ...data, metadata: { ...data.metadata, availableYears: years } },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('mof-jikou', error);
  }
}
