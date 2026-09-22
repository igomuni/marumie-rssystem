"use client";

import { sankeySvgProjectUrl } from "@/app/lib/subcontracts/links";
import { aggregateV2IdentitySourceAmounts } from "@/app/lib/mof-kou-moku-v2-linkage";
import { formatYen } from "@/client/components/mof-jikou/format";
import type {
  MofKouMokuV2IdentityProject,
  MofKouMokuV2IdentityRelation,
  MofKouMokuV2IdentitySource,
} from "@/types/mof-kou-moku-v2-linkage";
import {
  DataGrid,
  type GridColumn,
  type GridViewState,
} from "@/client/components/mof-kou/DataGrid";
import { MatchMethodBadge } from "@/client/components/mof-rs/MatchMethodBadge";

interface IdentityRow {
  relation: MofKouMokuV2IdentityRelation;
  project: MofKouMokuV2IdentityProject;
}

function sourceStageLabel(source: MofKouMokuV2IdentitySource): string {
  if (source.phase === "initial") return "当初";
  return source.revision === null ? "補正" : `第${source.revision}次補正`;
}

function sourceStageKey(source: MofKouMokuV2IdentitySource): string {
  return source.phase === "initial"
    ? "initial"
    : `supplement-${source.revision ?? 0}`;
}

function stageColumns(
  rows: IdentityRow[],
): { key: string; label: string; rank: number }[] {
  const keys = new Set(
    rows.flatMap((row) => row.project.sources.map(sourceStageKey)),
  );
  return [...keys]
    .map((key) => {
      if (key === "initial") return { key, label: "当初", rank: 0 };
      const revision = Number(key.slice("supplement-".length));
      return {
        key,
        label: `補正${revision || ""}`,
        rank: revision || Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export function V2SettlementIdentityTab({
  relations,
  reviewYear,
  loading,
  error,
  gridState,
  onGridStateChange,
}: {
  relations: MofKouMokuV2IdentityRelation[];
  reviewYear: number | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error)
    return (
      <p className="p-3 text-red-600">
        V2関連事業の取得に失敗しました: {error}
      </p>
    );
  if (loading)
    return <p className="p-3 text-neutral-400">V2関連事業を読み込み中…</p>;
  const rows: IdentityRow[] = relations.flatMap((relation) =>
    relation.projects.map((project) => ({ relation, project })),
  );
  const stages = stageColumns(rows);
  const columns: GridColumn<IdentityRow>[] = [
    {
      key: "project",
      label: "関連RS事業",
      width: 260,
      sortValue: (row) => row.project.projectName || row.project.projectId,
      render: (row) =>
        reviewYear !== null ? (
          <a
            href={sankeySvgProjectUrl(
              Number(row.project.projectId),
              row.project.projectName || row.project.projectId,
              reviewYear,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
            title={`事業ID ${row.project.projectId}`}
          >
            {row.project.projectName || row.project.projectId}
          </a>
        ) : (
          row.project.projectName || row.project.projectId
        ),
    },
    {
      key: "ministry",
      label: "府省庁",
      width: 120,
      sortValue: (row) => row.project.ministry,
      render: (row) => row.project.ministry || "—",
    },
    ...stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      width: 108,
      numeric: true,
      sortValue: (row: IdentityRow) =>
        aggregateV2IdentitySourceAmounts(row.project.sources).get(stage.key) ??
        null,
      render: (row: IdentityRow) => {
        const amounts = aggregateV2IdentitySourceAmounts(row.project.sources);
        return amounts.has(stage.key)
          ? formatYen(amounts.get(stage.key) ?? 0)
          : "—";
      },
    })),
    {
      key: "budgetTotal",
      label: "当初＋補正",
      headerTitle:
        "当初・補正の金額は、同じMOF目に正式リンクされたRS 2-2予算額です。決算額の事業別内訳を示すものではありません。",
      width: 108,
      numeric: true,
      sortValue: (row) =>
        [
          ...aggregateV2IdentitySourceAmounts(row.project.sources).values(),
        ].reduce((sum, amount) => sum + amount, 0),
      render: (row) =>
        formatYen(
          [
            ...aggregateV2IdentitySourceAmounts(row.project.sources).values(),
          ].reduce((sum, amount) => sum + amount, 0),
        ),
    },
    {
      key: "stages",
      label: "リンク元",
      width: 150,
      sortValue: (row) => row.project.sources.map(sourceStageLabel).join(" / "),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.project.sources.map((source) => (
            <span
              key={source.linkId}
              className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              title={source.linkId}
            >
              {sourceStageLabel(source)}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "evidence",
      label: "元リンク根拠",
      width: 180,
      sortValue: (row) =>
        [
          ...new Set(row.project.sources.map((source) => source.matchMethod)),
        ].join(","),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {[
            ...new Set(row.project.sources.map((source) => source.matchMethod)),
          ].map((method) => (
            <MatchMethodBadge key={method} method={method} />
          ))}
        </span>
      ),
    },
  ];
  const validSortKeys = new Set(columns.map((column) => column.key));
  const effectiveState: GridViewState =
    gridState.sortKey !== null && validSortKeys.has(gridState.sortKey)
      ? gridState
      : { ...gridState, sortKey: "project", sortDir: "asc" };
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => `${row.relation.relationId}:${row.project.projectId}`}
      state={effectiveState}
      onStateChange={onGridStateChange}
      emptyMessage="予算段階で対応付けられたRS事業は見つかりませんでした。"
    />
  );
}
