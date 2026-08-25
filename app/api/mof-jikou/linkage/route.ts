/**
 * MOF事項 ↔ RS事業 紐づけAPIエンドポイント。
 *
 * 生成は npm run generate-mof-rs-linkage（scripts/generate-mof-rs-linkage.ts）。
 * ロジックは app/lib/api/mof-rs-linkage-loader.ts に置き、ここは HTTP の入出力だけ。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { findLinksByKey, linkageAvailable } from '@/app/lib/api/mof-rs-linkage-loader';

/**
 * GET /api/mof-jikou/linkage
 *
 * クエリ:
 *   key  — 事項の合成キー（`MOFJikouItem.key`）
 *   year — 予算年度（= mof-jikou の会計年度、西暦）
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const yearRaw = url.searchParams.get('year');
    if (!key || !yearRaw) {
      return NextResponse.json({ error: 'key と year を指定してください' }, { status: 400 });
    }
    const year = Number(yearRaw);
    if (isNaN(year)) {
      return NextResponse.json({ error: `不正な year です: ${yearRaw}` }, { status: 400 });
    }

    const available = linkageAvailable(year);
    const links = available ? findLinksByKey(year, key) : [];

    return NextResponse.json({ available, links }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-jikou/linkage', error);
  }
}
