import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export interface QualityScoreItem {
  pid: string;
  name: string;
  ministry: string;
  bureau: string;
  division: string;
  section: string;
  office: string;
  team: string;
  unit: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  validRatio: number | null;
  cnFilled: number;
  cnEmpty: number;
  cnFillRatio: number | null;
  budgetAmount: number;
  execAmount: number;
  spendTotal: number;
  gapRatio: number | null;
  blockCount: number;
  hasRedelegation: boolean;
  redelegationDepth: number;
  otherFlagRatio: number | null;
  axis1: number | null;
  axis2: number | null;
  axis3: number | null;
  axis4: number | null;
  axis5: number | null;
  totalScore: number | null;
}

export interface QualityScoresResponse {
  items: QualityScoreItem[];
  summary: {
    total: number;
    avgScore: number;
    ministries: string[];
  };
}

let cached: QualityScoresResponse | null = null;

function loadData(): QualityScoresResponse {
  if (cached) return cached;

  const jsonPath = path.join(process.cwd(), 'public', 'data', 'project-quality-scores.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      'project-quality-scores.json が見つかりません。' +
      'python3 scripts/score-project-quality.py を実行してください。'
    );
  }

  const items: QualityScoreItem[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const ministries = [...new Set(items.map(i => i.ministry))].sort();
  const scored = items.filter(i => i.totalScore !== null);
  const avgScore = scored.length > 0
    ? scored.reduce((sum, i) => sum + (i.totalScore ?? 0), 0) / scored.length
    : 0;

  cached = {
    items,
    summary: { total: items.length, avgScore, ministries },
  };
  return cached;
}

export async function GET() {
  try {
    const data = loadData();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
