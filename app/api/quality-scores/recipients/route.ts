import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// フィールド名は短縮形（JSONサイズ削減のため）
// n=name, b=blockNo, s=status, c=cnFilled, o=opaque, a=amount, r=isRoot
export interface RecipientRow {
  n: string;
  b: string;
  s: 'valid' | 'gov' | 'supp' | 'invalid' | 'unknown';
  c: boolean;
  o: boolean;
  a: number;
  r: boolean;
}

let cached: Record<string, RecipientRow[]> | null = null;

function loadData(): Record<string, RecipientRow[]> {
  if (cached) return cached;

  const jsonPath = path.join(process.cwd(), 'public', 'data', 'project-quality-recipients.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      'project-quality-recipients.json が見つかりません。' +
      'python3 scripts/score-project-quality.py を実行してください。'
    );
  }

  cached = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  return cached!;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pid = url.searchParams.get('pid');
    if (!pid) {
      return NextResponse.json({ error: 'pid パラメータが必要です' }, { status: 400 });
    }

    const data = loadData();
    return NextResponse.json(data[pid] ?? []);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
