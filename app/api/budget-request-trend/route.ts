/**
 * 概算要求の年度推移（項の粒度）APIエンドポイント。
 * 専用の絞り込みはしない（約 1,300 項。絞り込み・並べ替えはクライアントで行う）。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { loadBudgetRequestTrend } from '@/app/lib/api/budget-request-trend-loader';

/** GET /api/budget-request-trend */
export async function GET() {
  try {
    const data = loadBudgetRequestTrend();
    if (!data) {
      return NextResponse.json(
        { error: 'データが生成されていません。npx tsx scripts/pipeline-v2/build-budget-request-trend-csv.ts を実行してください。' },
        { status: 503 }
      );
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('budget-request-trend', error);
  }
}
