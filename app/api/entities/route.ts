import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, EntityType } from '@/types/structured';

// サーバーキャッシュ（プロセス起動中は再読み込み不要）
let cachedEntities: EntityListItem[] | null = null;

export interface EntityListItem {
  spendingId: number;
  spendingName: string;
  displayName: string;          // displayName があれば、なければ spendingName
  entityType: EntityType | null;
  parentName: string | null;
  totalSpendingAmount: number;
  projectCount: number;
  corporateNumber: string;
}

export interface EntitiesResponse {
  entities: EntityListItem[];
  summary: {
    total: number;
    totalAmount: number;
    byEntityType: Record<string, { count: number; totalAmount: number }>;
  };
}

function loadEntities(): EntityListItem[] {
  if (cachedEntities) return cachedEntities;

  const dataPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('rs2024-structured.json が見つかりません');
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as RS2024StructuredData;

  cachedEntities = data.spendings.map(s => ({
    spendingId: s.spendingId,
    spendingName: s.spendingName,
    displayName: s.displayName ?? s.spendingName,
    entityType: s.entityType ?? null,
    parentName: s.parentName ?? null,
    totalSpendingAmount: s.totalSpendingAmount,
    projectCount: s.projectCount,
    corporateNumber: s.corporateNumber,
  }));

  return cachedEntities;
}

export async function GET() {
  try {
    const entities = loadEntities();

    // entityType 別の集計
    const byEntityType: Record<string, { count: number; totalAmount: number }> = {};
    let totalAmount = 0;

    for (const e of entities) {
      const key = e.entityType ?? 'その他';
      if (!byEntityType[key]) byEntityType[key] = { count: 0, totalAmount: 0 };
      byEntityType[key].count++;
      byEntityType[key].totalAmount += e.totalSpendingAmount;
      totalAmount += e.totalSpendingAmount;
    }

    const response: EntitiesResponse = {
      entities,
      summary: {
        total: entities.length,
        totalAmount,
        byEntityType,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading entities:', error);
    return NextResponse.json({ error: 'Failed to load entities' }, { status: 500 });
  }
}
