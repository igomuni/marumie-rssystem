/**
 * MOF目 ↔ RS事業 紐づけAPIエンドポイント。
 *
 * 生成は npm run generate-mof-rs-kou-moku-linkage
 * （scripts/generate-mof-rs-kou-moku-linkage.ts）。
 * ロジックは app/lib/api/mof-rs-kou-moku-linkage-loader.ts に置き、ここは HTTP の入出力だけ。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { linkageRsYear, resolveLinks } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';

/**
 * GET /api/mof-kou-moku/linkage
 *
 * クエリ:
 *   year — 予算年度（= mof-kou-moku の会計年度、西暦）。必須
 */
export async function GET(request: Request) {
  try {
    const yearRaw = new URL(request.url).searchParams.get('year');
    if (!yearRaw) {
      return NextResponse.json({ error: 'year を指定してください' }, { status: 400 });
    }
    const year = Number(yearRaw);
    if (isNaN(year)) {
      return NextResponse.json({ error: `不正な year です: ${yearRaw}` }, { status: 400 });
    }

    const resolution = resolveLinks(year);
    const available = resolution.sourceBudgetYear !== null;
    const rsYear = resolution.sourceBudgetYear !== null ? linkageRsYear(resolution.sourceBudgetYear) : null;

    return NextResponse.json(
      {
        available,
        rsYear,
        links: resolution.links,
        isCarriedOver: resolution.isCarriedOver,
        sourceBudgetYear: resolution.sourceBudgetYear,
      },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('mof-kou-moku/linkage', error);
  }
}
