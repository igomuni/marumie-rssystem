/**
 * MOF事項 ↔ RS事業 紐づけAPIエンドポイント。
 *
 * 生成は npm run generate-mof-rs-linkage（scripts/generate-mof-rs-linkage.ts）。
 * ロジックは app/lib/api/mof-rs-linkage-loader.ts に置き、ここは HTTP の入出力だけ。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import {
  allLinks,
  findLinksByKey,
  linkageAvailable,
  linkageRsYear,
} from '@/app/lib/api/mof-rs-linkage-loader';

/**
 * GET /api/mof-jikou/linkage
 *
 * クエリ:
 *   year — 予算年度（= mof-jikou の会計年度、西暦）。必須
 *   key  — 事項の合成キー（`MOFJikouItem.key`）。省略時はその年度の全リンクを返す
 *          （一覧側の列表示・詳細パネルを1回のフェッチで賄うため）
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const yearRaw = url.searchParams.get('year');
    if (!yearRaw) {
      return NextResponse.json({ error: 'year を指定してください' }, { status: 400 });
    }
    const year = Number(yearRaw);
    if (isNaN(year)) {
      return NextResponse.json({ error: `不正な year です: ${yearRaw}` }, { status: 400 });
    }

    const available = linkageAvailable(year);
    const links = available ? (key ? findLinksByKey(year, key) : allLinks(year)) : [];
    const rsYear = linkageRsYear(year);

    return NextResponse.json(
      { available, rsYear, links },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } }
    );
  } catch (error) {
    return serverErrorResponse('mof-jikou/linkage', error);
  }
}
