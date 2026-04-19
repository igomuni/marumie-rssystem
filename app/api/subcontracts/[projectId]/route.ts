import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { SubcontractIndex } from '@/types/subcontract';

const SUPPORTED_YEARS = [2024, 2025];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const yearParam = request.nextUrl.searchParams.get('year') ?? '2024';
  const year = parseInt(yearParam, 10);

  if (!SUPPORTED_YEARS.includes(year)) {
    return NextResponse.json({ error: `Unsupported year: ${year}` }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'public', 'data', `subcontracts-${year}.json`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: `Data file not found for year ${year}` }, { status: 404 });
  }

  const data: SubcontractIndex = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const graph = data[projectId];

  if (!graph) {
    return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
  }

  return NextResponse.json(graph);
}
