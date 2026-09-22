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
  const rsToMofRate = (group: MofKouMokuV2LinkGroup) =>
    group.mofAmountYen === 0 ? null : group.rsAmountYen / group.mofAmountYen;
  const columns: GridColumn<V2ProjectRow>[] = [
    { key: 'matchMethod', label: '根拠', width: 100, sortValue: row => row.group.matchMethod, render: row => <MatchMethodBadge method={row.group.matchMethod} /> },
    {
      key: 'project', label: 'RS事業', width: 240, sortValue: row => row.project.projectName || row.project.projectId,
      render: row => reviewYear !== null ? <a href={sankeySvgProjectUrl(Number(row.project.projectId), row.project.projectName || row.project.projectId, reviewYear)} target="_blank" rel="noopener noreferrer" className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100" title={row.project.projectId}>{row.project.projectName || row.project.projectId}</a> : row.project.projectName || row.project.projectId,
    },
    { key: 'ministry', label: '府省庁', width: 120, sortValue: row => row.project.ministry, render: row => row.project.ministry || '—' },
    { key: 'mofAmount', label: 'MOF額（group）', width: 120, numeric: true, sortValue: row => row.group.mofAmountYen, render: row => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(row.group.mofAmountYen)}</span> },
    { key: 'rsAmount', label: 'RSリンク額（group）', width: 130, numeric: true, sortValue: row => row.group.rsAmountYen, render: row => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(row.group.rsAmountYen)}</span> },
    { key: 'rsToMofRate', label: 'RS/MOF', width: 85, numeric: true, sortValue: row => rsToMofRate(row.group), render: row => formatRate(rsToMofRate(row.group)) },
    { key: 'difference', label: '差額（group）', width: 120, numeric: true, sortValue: row => row.group.differenceYen, render: row => formatYen(row.group.differenceYen) },
  ];
  return <div>
    <p className="px-2 pb-1.5 pt-2 text-[11px] leading-5 text-neutral-400">Pipeline V2 の正式リンクを、RS事業ごとに1行で表示しています。group列の金額・比率は個別事業額ではなくlink group全体の値であり、同じgroup内の各行で繰り返し表示されます。</p>
    <DataGrid rows={rows} columns={columns} rowKey={row => `${row.group.linkId}:${row.group.itemNaturalKey}:${row.project.projectId}`} state={gridState} onStateChange={onGridStateChange} emptyMessage="紐づく RS 事業は見つかりませんでした。" />
  </div>;
}
