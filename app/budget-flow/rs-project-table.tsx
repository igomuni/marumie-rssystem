'use client';

import { yen } from './model';
import { DataTable, type DataTableColumn } from './data-table';
import type { RsProjectSummary, RsProjectSort, RsProjectSortKey } from './rs-model';

const columns: DataTableColumn<RsProjectSortKey>[] = [
  { key: 'projectId', label: '事業ID', min: 80, max: 200, width: 90 },
  { key: 'projectName', label: '事業名', min: 200, max: 700, width: 320 },
  { key: 'ministry', label: '府省庁', min: 100, max: 400, width: 140 },
  { key: 'budgetTotalYen', label: '予算現額（円）', min: 150, max: 400, width: 170, align: 'right' },
  { key: 'blockCount', label: 'ブロック数', min: 90, max: 200, width: 100, align: 'right' },
  { key: 'mofSectionCount', label: 'MOF項', min: 80, max: 160, width: 90, align: 'right' },
];

export function RsProjectTable({ projects, selected, onSelect, sort, onSort }: {
  projects: RsProjectSummary[]; selected: string; onSelect: (id: string) => void;
  sort: RsProjectSort | null; onSort: (key: RsProjectSortKey) => void;
}) {
  return <DataTable ariaLabel="事業一覧" columns={columns} rows={projects} getRowKey={p => p.projectId} selected={selected} onSelect={onSelect}
    sort={sort} onSort={onSort}
    renderCell={(p, key) => {
      switch (key) {
        case 'projectId': return p.projectId;
        case 'projectName': return <>{p.projectName}<br /><small>{[p.ministry, p.bureau].filter(Boolean).join(' / ')}</small></>;
        case 'ministry': return p.ministry;
        case 'budgetTotalYen': return p.budgetTotalYen != null ? yen(p.budgetTotalYen) : '—';
        case 'blockCount': return p.blockCount;
        case 'mofSectionCount': return p.mofSectionCount;
      }
    }} />;
}
