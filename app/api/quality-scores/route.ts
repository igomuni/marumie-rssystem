import { NextResponse } from 'next/server';
import { loadQualityScores } from '@/app/lib/api/quality-scores-loader';
import { parseYear, buildMetadata, API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import { projectLinks } from '@/app/lib/api/links';

export type { QualityScoreItem, QualityScoresResponse } from '@/app/lib/api/quality-scores-loader';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }
    const data = loadQualityScores(year);
    const body = {
      ...data,
      metadata: buildMetadata(year, { totalItems: data.items.length }),
      items: data.items.map(i => ({ ...i, links: projectLinks(i.pid, year) })),
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
