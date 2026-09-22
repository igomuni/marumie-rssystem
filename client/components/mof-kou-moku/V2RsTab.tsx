'use client';

import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MofKouMokuV2LinkGroup } from '@/types/mof-kou-moku-v2-linkage';
import { formatRate, formatYen } from '@/client/components/mof-jikou/format';
import { DataGrid, type GridColumn, type GridViewState } from '@/client/components/mof-kou/DataGrid';
import { MatchMethodBadge } from '@/client/components/mof-rs/MatchMethodBadge';

interface V2ProjectRow {
  group: MofKouMokuV2LinkGroup;
  project: MofKouMokuV2LinkGroup['projects'][number];
}

export function V2KouMokuRsTab({ links, reviewYear, loading, error, gridState, onGridStateChange }: {
  links: MofKouMokuV2LinkGroup[];
  reviewYear: number | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">V2紐づけの取得に失敗しました: {error}</p>;
  if (loading) return <p className="p-3 text-neutral-400">V2紐づけを読み込み中…</p>;
  const rows: V2ProjectRow[] = links.flatMap(group => group.projects.map(project => ({ group, project })));
  const projectBudgetShare = (row: V2ProjectRow) =>
    !row.project.projectBudgetAmountYen ? null : row.project.rsAmountYen / row.project.projectBudgetAmountYen;
  const mofItemShare = (row: V2ProjectRow) =>
    row.group.mofAmountYen === 0 ? null : row.project.rsAmountYen / row.group.mofAmountYen;
  const uniqueGroups = new Map(links.map(group => [group.linkId, group]));
  const groupRsTotal = [...uniqueGroups.values()].reduce((sum, group) => sum + group.rsAmountYen, 0);
  const projectRsTotal = rows.reduce((sum, row) => sum + row.project.rsAmountYen, 0);
  const columns: GridColumn<V2ProjectRow>[] = [
    { key: 'matchMethod', label: '根拠', width: 100, sortValue: row => row.group.matchMethod, render: row => <MatchMethodBadge method={row.group.matchMethod} /> },
    {
      key: 'project', label: 'RS事業', width: 240, sortValue: row => row.project.projectName || row.project.projectId,
      render: row => reviewYear !== null ? <a href={sankeySvgProjectUrl(Number(row.project.projectId), row.project.projectName || row.project.projectId, reviewYear)} target="_blank" rel="noopener noreferrer" className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100" title={row.project.projectId}>{row.project.projectName || row.project.projectId}</a> : row.project.projectName || row.project.projectId,
    },
    { key: 'ministry', label: '府省庁', width: 120, sortValue: row => row.project.ministry, render: row => row.project.ministry || '—' },
    { key: 'projectRsAmount', label: 'RS事業額', width: 120, numeric: true, sortValue: row => row.project.rsAmountYen, render: row => <span className="font-medium text-neutral-900 dark:text-neutral-100" title={`このlink groupに採用されたRS 2-2 ${row.project.rsRecordCount}行の合計`}>{formatYen(row.project.rsAmountYen)}</span> },
    { key: 'projectBudgetShare', label: 'RS事業%', width: 82, numeric: true, sortValue: projectBudgetShare, render: row => formatRate(projectBudgetShare(row)) },
    { key: 'mofItemShare', label: 'MOF目%', width: 82, numeric: true, sortValue: mofItemShare, render: row => formatRate(mofItemShare(row)) },
  ];
  return <div>
    <p className="px-2 pb-1.5 pt-2 text-[11px] leading-5 text-neutral-400">RS事業額は、正式link groupに採用されたRS 2-2行を事業ID別に合算した当該目・stageの内訳です。按分値ではありません。RS事業%はRS 2-1の「計（歳出予算現額合計）」に対する割合、MOF目%はMOF額に対するRS事業額の割合です。複数目をまたぐlinkでは、MOF目%の分母はlink group全体のMOF額です。{rows.length > 0 && <> 事業別合計 {formatYen(projectRsTotal)} / RS合計 {formatYen(groupRsTotal)}</>}</p>
    <DataGrid rows={rows} columns={columns} rowKey={row => `${row.group.linkId}:${row.group.itemNaturalKey}:${row.project.projectId}`} state={gridState} onStateChange={onGridStateChange} emptyMessage="紐づく RS 事業は見つかりませんでした。" />
  </div>;
}
