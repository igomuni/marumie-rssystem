import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { parseYear, buildMetadata, API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks } from '@/app/lib/api/links';

// フィールド名は短縮形（JSONサイズ削減のため）
// n=name, b=blockNo, s=status, c=cnFilled, o=opaque
// a2=金額（個別支出額）, r=isRoot
// chain=ブロック委託チェーン("組織→A→B→C"), d=委託深度
// role=事業を行う上での役割（ブロック単位）, cc=契約概要
export interface RecipientRow {
  n: string;
  b: string;
  s: 'valid' | 'gov' | 'supp' | 'invalid' | 'unknown';
  c: boolean;
  o: boolean;
  a2: number | null;
  r: boolean;
  chain: string;
  d: number;
  role: string;
  cc: string;
}

const cache = new Map<string, Record<string, RecipientRow[]>>();

function loadData(year: string): Record<string, RecipientRow[]> {
  if (cache.has(year)) return cache.get(year)!;

  const jsonPath = path.join(process.cwd(), 'public', 'data', `project-quality-recipients-${year}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `project-quality-recipients-${year}.json が見つかりません。` +
      `python3 scripts/score-project-quality.py --year ${year} を実行してください。`
    );
  }

  const data: Record<string, RecipientRow[]> = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  cache.set(year, data);
  return data;
}

/** 短縮フィールド名の凡例（AI・外部利用者向け） */
const FIELD_LEGEND = {
  n: 'name（支出先名）',
  b: 'blockNo（ブロックNo）',
  s: 'status（valid|gov|supp|invalid|unknown）',
  c: 'cnFilled（法人番号充足）',
  o: 'opaque（不透明支出）',
  a2: 'amount（個別支出額・1円単位）',
  r: 'isRoot（ルート行）',
  chain: 'ブロック委託チェーン（"組織→A→C"）',
  d: '委託深度',
  role: '事業を行う上での役割（ブロック単位）',
  cc: '契約概要',
} as const;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pid = url.searchParams.get('pid');
    if (!pid) {
      return NextResponse.json({ error: 'pid パラメータが必要です' }, { status: 400 });
    }
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }

    const data = loadData(year);
    const body = {
      metadata: buildMetadata(year, { pid }),
      fieldLegend: FIELD_LEGEND,
      links: projectLinks(pid, year),
      rows: data[pid] ?? [],
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('quality-scores/recipients', e);
  }
}
