/**
 * 事業詳細データAPI
 * GET /api/project-details/[projectId]
 *
 * 指定されたprojectIdの詳細情報を返す
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ProjectDetailsData, ProjectDetail } from '@/types/project-details';

// データをメモリにキャッシュ（サーバー起動時に1回だけ読み込み）
let cachedProjectDetails: ProjectDetailsData | null = null;

/**
 * 事業詳細データを取得（キャッシュ付き）
 */
function getProjectDetails(): ProjectDetailsData {
  if (cachedProjectDetails === null) {
    const filePath = join(process.cwd(), 'public', 'data', 'rs2024-project-details.json');
    const fileContent = readFileSync(filePath, 'utf-8');
    cachedProjectDetails = JSON.parse(fileContent);
    console.log('[API] Project details data loaded into cache');
  }
  return cachedProjectDetails;
}

/**
 * GET /api/project-details/[projectId]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // バリデーション
    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // データ取得
    const projectDetails = getProjectDetails();
    const detail = projectDetails[projectId];

    if (!detail) {
      return NextResponse.json(
        { error: `Project not found: ${projectId}` },
        { status: 404 }
      );
    }

    // レスポンス
    return NextResponse.json(detail, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to get project details:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
