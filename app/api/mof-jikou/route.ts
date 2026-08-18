/**
 * 財務省 予算書「事項別内訳」APIエンドポイント。
 *
 * 生成は npm run generate-mof-jikou（scripts/generate-mof-jikou-data.ts）。
 * 行政事業レビューのデータとは独立した、MOF単独のデータセット。
 */

import { NextResponse } from 'next/server';
import type { MOFJikouData } from '@/types/mof-jikou';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { readDataJson } from '@/app/lib/api/data-file';

/** 現状は令和8年度（2026）当初予算のみ */
const FISCAL_YEAR = 2026;

let cachedData: MOFJikouData | null = null;

/** GET /api/mof-jikou */
export async function GET() {
  try {
    if (!cachedData) {
      cachedData = readDataJson<MOFJikouData>(
        `mof-jikou-${FISCAL_YEAR}.json`,
        'npm run generate-mof-jikou を実行してください。'
      );
    }
    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': API_CACHE_CONTROL },
    });
  } catch (error) {
    return serverErrorResponse('mof-jikou', error);
  }
}
