'use client';

import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type {
  MofKouMokuV2IdentityProject,
  MofKouMokuV2IdentityRelation,
  MofKouMokuV2IdentitySource,
} from '@/types/mof-kou-moku-v2-linkage';
import { DataGrid, type GridColumn, type GridViewState } from '@/client/components/mof-kou/DataGrid';
import { MatchMethodBadge } from '@/client/components/mof-rs/MatchMethodBadge';

interface IdentityRow { relation: MofKouMokuV2IdentityRelation; project: MofKouMokuV2IdentityProject; }

function sourceStageLabel(source: MofKouMokuV2IdentitySource): string {
  if (source.phase === 'initial') return '当初';
  return source.revision === null ? '補正' : `第${source.revision}次補正`;
}

export function V2SettlementIdentityTab({ relations, reviewYear, loading, error, gridState, onGridStateChange }: {
  relations: MofKouMokuV2IdentityRelation[]; reviewYear: number | null; loading: boolean; error: string | null;
  gridState: GridViewState; onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">V2関連事業の取得に失敗しました: {error}</p>;
  if (loading) return <p className="p-3 text-neutral-400">V2関連事業を読み込み中…</p>;
  const rows: IdentityRow[] = relations.flatMap(relation => relation.projects.map(project => ({ relation, project })));
  const columns: GridColumn<IdentityRow>[] = [
    { key: 'project', label: '関連RS事業', width: 260, sortValue: row => row.project.projectName || row.project.projectId,
      render: row => reviewYear !== null ? <a href={sankeySvgProjectUrl(Number(row.project.projectId), row.project.projectName || row.project.projectId, reviewYear)} target="_blank" rel="noopener noreferrer" className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100" title={`事業ID ${row.project.projectId}`}>{row.project.projectName || row.project.projectId}</a> : row.project.projectName || row.project.projectId },
    { key: 'ministry', label: '府省庁', width: 120, sortValue: row => row.project.ministry, render: row => row.project.ministry || '—' },
    { key: 'stages', label: 'リンク元', width: 150, sortValue: row => row.project.sources.map(sourceStageLabel).join(' / '), render: row => <span className="flex flex-wrap gap-1">{row.project.sources.map(source => <span key={source.linkId} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" title={source.linkId}>{sourceStageLabel(source)}</span>)}</span> },
    { key: 'evidence', label: '元リンク根拠', width: 180, sortValue: row => [...new Set(row.project.sources.map(source => source.matchMethod))].join(','), render: row => <span className="flex flex-wrap gap-1">{[...new Set(row.project.sources.map(source => source.matchMethod))].map(method => <MatchMethodBadge key={method} method={method} />)}</span> },
  ];
  const validSortKeys = new Set(columns.map(column => column.key));
  const effectiveState: GridViewState =
    gridState.sortKey !== null && validSortKeys.has(gridState.sortKey)
      ? gridState
      : { ...gridState, sortKey: 'project', sortDir: 'asc' };
  return <div><p className="px-2 pb-1.5 pt-2 text-[11px] leading-5 text-neutral-400">この決算項目と同じMOF目について、当初予算または補正予算で正式に対応付けられたRS事業を表示しています。決算額とRS予算額の一致や、決算額の事業別配分を示すものではありません。</p><DataGrid rows={rows} columns={columns} rowKey={row => `${row.relation.relationId}:${row.project.projectId}`} state={effectiveState} onStateChange={onGridStateChange} emptyMessage="予算段階で対応付けられたRS事業は見つかりませんでした。" /></div>;
}
