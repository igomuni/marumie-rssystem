import { NextResponse } from 'next/server';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { parseYear, buildMetadata, serverErrorResponse } from '@/app/lib/api/api-notes';
import {
  resolveSankeyQuery,
  buildFilterExcludedIds,
  summarizeFilteredGraph,
  sankeyQueryToUrlParams,
  sankeyQueryFromUrlParams,
  hasActiveFilter,
} from '@/app/lib/sankey-query';
import { filterTopN } from '@/app/lib/sankey-svg-filter';
import type { SankeyQuery } from '@/types/sankey-query';

/** /api/sankey/query 固有のデータ留意事項 */
const SANKEY_QUERY_NOTES: readonly string[] = [
  'このAPIは /sankey-svg と同じグラフデータ・フィルタロジックを共有します。links.webView を開くと同一条件のサンキー図が表示されます',
  'グラフの支出先はグラフ生成時に名寄せ・集約済みのため、全支出先件数より少なくなります。ヒットしない支出先は /api/search/recipients で集計データを検索してください',
  'summary.projects.spendingTotal は「残存事業 → 残存支出先」エッジの合計です。支出先フィルタ使用時は事業の総支出より小さくなります',
  'summary はフィルタ適用後の全マッチを集計します（TopN集約前）。detail=full の sankey は表示用にTopN集約された後のノード・エッジです',
];

// ローカル実験フェーズのため Cache-Control は付与しない（公開段階で API_CACHE_CONTROL を追加する）

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // detail: summary（既定）= 件数・金額のみ / full = TopN集約後の nodes/edges も返す
    const detailParam = url.searchParams.get('detail') ?? 'summary';
    if (detailParam !== 'summary' && detailParam !== 'full') {
      return NextResponse.json(
        { error: `detail は "summary" または "full" を指定してください（受領値: ${detailParam}）` },
        { status: 400 },
      );
    }

    // クエリの受領: q=JSON（推奨）または /sankey-svg と同じ短縮URLパラメータ
    let input: SankeyQuery;
    const q = url.searchParams.get('q');
    if (q !== null) {
      try {
        input = JSON.parse(q) as SankeyQuery;
      } catch (e) {
        return NextResponse.json(
          { error: `q パラメータのJSONが不正です: ${e instanceof Error ? e.message : String(e)}` },
          { status: 400 },
        );
      }
    } else {
      input = sankeyQueryFromUrlParams(url.searchParams);
    }

    // 年度: q.year > yr > year > 既定（2024）
    if (input.year == null) {
      const year = parseYear(url.searchParams.get('year'));
      if (year === null) {
        return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
      }
      input.year = year;
    }

    const { query, errors } = resolveSankeyQuery(input);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'クエリが不正です。details を修正して再実行してください', details: errors },
        { status: 400 },
      );
    }

    const graph = loadSankeyGraph(query.year);

    // プレフィルタ（/sankey-svg と同一ロジック）。ピン中の事業はカスケード除外から保護される
    const excludedIds = buildFilterExcludedIds(
      graph.nodes,
      graph.edges,
      query.filter,
      [query.view.pin.projectId],
    );
    const summary = summarizeFilteredGraph(graph.nodes, graph.edges, excludedIds);

    const params = sankeyQueryToUrlParams(query);
    const body: Record<string, unknown> = {
      metadata: buildMetadata(query.year, {
        appliedQuery: query,
        detail: detailParam,
        filterActive: hasActiveFilter(query.filter),
      }, SANKEY_QUERY_NOTES),
      summary,
      links: {
        webView: `/sankey-svg?${params.toString()}`,
        docs: 'https://github.com/igomuni/marumie-rssystem/blob/main/docs/api-guide.md',
      },
    };

    if (detailParam === 'full') {
      // page.tsx の filtered useMemo と同じ手順: 除外 → recipientOffset クランプ → filterTopN
      const nodes = excludedIds ? graph.nodes.filter(n => !excludedIds.has(n.id)) : graph.nodes;
      const edges = excludedIds
        ? graph.edges.filter(e => !excludedIds.has(e.source) && !excludedIds.has(e.target))
        : graph.edges;
      const { view } = query;
      const maxOffset = Math.max(0, nodes.filter(n => n.type === 'recipient').length - view.topRecipient);
      const clampedOffset = Math.min(view.offset.recipient, maxOffset);
      const result = filterTopN(
        nodes, edges,
        view.topMinistry, view.topProject, view.topRecipient,
        clampedOffset,
        view.pin.projectId,
        true, // includeZeroSpending（/sankey-svg と同じ固定値）
        view.showAggRecipient, view.showAggProject,
        view.scaleBudgetToVisible,
        view.focusRelated,
        view.pin.recipientId, view.pin.ministryName,
        view.offset.target, view.offset.project,
        view.projectSortBy,
      );
      body.sankey = {
        nodes: result.nodes,
        edges: result.edges,
        totalProjectCount: result.totalProjectCount,
        totalRecipientCount: result.totalRecipientCount,
      };
    }

    return NextResponse.json(body);
  } catch (e) {
    return serverErrorResponse('sankey/query', e);
  }
}
