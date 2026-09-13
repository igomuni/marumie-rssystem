import { NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { resolveLinks, linkageRsYear } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';
import { buildIntegratedGraph } from '@/app/lib/integrated-sankey';
import type { MOFKouMokuData } from '@/types/mof-kou-moku';

export async function GET(request: Request) {
  const rsYear = Number(new URL(request.url).searchParams.get('year') || 2025); const budgetYear = rsYear - 1;
  if (rsYear !== 2025 || linkageRsYear(budgetYear) !== rsYear)
    return NextResponse.json({ error: 'ファーストカットはRS 2025／予算年度2024のみ対応しています' }, { status: 400 });
  const mof = readDataJson<MOFKouMokuData>(`mof-kou-moku-${budgetYear}.json`);
  const graph = loadSankeyGraph(String(rsYear));
  const projects = graph.nodes.filter(n => n.type === 'project-budget' && n.projectId !== undefined)
    .map(n => ({ projectId:n.projectId!, budgetSummary:n.budgetSummary, budgetBreakdown:n.budgetBreakdown }));
  return NextResponse.json(buildIntegratedGraph(mof.items, resolveLinks(budgetYear).links, projects, budgetYear, rsYear));
}
