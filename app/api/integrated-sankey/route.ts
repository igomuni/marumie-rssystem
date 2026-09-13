import { NextResponse } from 'next/server';
import { loadYear } from '@/app/lib/api/mof-kou-moku-loader';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { resolveLinks, linkageRsYear, linkageQuality } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';
import { buildIntegratedGraph } from '@/app/lib/integrated-sankey';

/**
 * 紐づけ生成済みの年度（予算年度=会計年度）。年度により紐づけ品質が大きく異なる
 * （docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md 実測）。品質改善は
 * generate-mof-rs-kou-moku-linkage.ts 側の別タスクとし、ここでは隠さず両方出す。
 */
const SUPPORTED_RS_YEARS = [2024, 2025] as const;

export async function GET(request: Request) {
  const rsYear = Number(new URL(request.url).searchParams.get('year') || 2025); const budgetYear = rsYear - 1;
  if (!SUPPORTED_RS_YEARS.includes(rsYear as typeof SUPPORTED_RS_YEARS[number]) || linkageRsYear(budgetYear) !== rsYear)
    return NextResponse.json(
      { error: `対応年度はRS ${SUPPORTED_RS_YEARS.join('・')}のみです` },
      { status: 400 },
    );
  const mof = loadYear(budgetYear);
  const graph = loadSankeyGraph(String(rsYear));
  // 支出額はproject-budgetノードのbudgetSummary.executedAmount（RS 2-1予算執行サマリの執行額）
  // ではなく、project-spendingノードのvalue（支出先データ由来の直接支出額合計。
  // scripts/generate-sankey-svg-data.ts の spendingAmount）を使う。両者は別のデータソースで、
  // RS 2-1に予算執行サマリが無い事業（例: PID21972）でも直接支出額は存在しうるため
  const spendingByProjectId = new Map(
    graph.nodes.filter(n => n.type === 'project-spending' && n.projectId !== undefined)
      .map(n => [n.projectId!, n.value]));
  const projects = graph.nodes.filter(n => n.type === 'project-budget' && n.projectId !== undefined)
    .map(n => ({ projectId: n.projectId!, name: n.name, ministry: n.ministry ?? '',
      budgetSummary: n.budgetSummary, budgetBreakdown: n.budgetBreakdown,
      spendingAmount: spendingByProjectId.get(n.projectId!) ?? 0 }));
  const integrated = buildIntegratedGraph(mof.items, resolveLinks(budgetYear).links, projects, budgetYear, rsYear);
  return NextResponse.json({ ...integrated, linkageQuality: linkageQuality(budgetYear) });
}
