'use client';

import { accounts, organizationNames, yen, type EntitySummary, type EntitySort, type EntitySortKey } from './model';
import { DataTable, type DataTableColumn } from './data-table';

const columns: DataTableColumn<EntitySortKey>[] = [
  { key: 'sectionName', label: '項名', min: 180, max: 700, width: 280 },
  { key: 'organization', label: '所管・組織', min: 120, max: 600, width: 180 },
  { key: 'accountType', label: '会計', min: 90, max: 300, width: 100 },
  { key: 'sectionCode', label: '項コード', min: 90, max: 240, width: 90 },
  { key: 'amount', label: '当初予算額（円）', min: 170, max: 400, width: 190, align: 'right' },
  { key: 'rsProjectCount', label: 'RS事業', min: 80, max: 160, width: 90, align: 'right' },
];

export function EntityTable({ entities, amounts, amountError, selected, onSelect, sort, onSort }: {
  entities: EntitySummary[]; amounts: Record<string, number | null>; amountError: boolean;
  selected: string; onSelect: (id: string) => void; sort: EntitySort | null; onSort: (key: EntitySortKey) => void;
}) {
  return <DataTable ariaLabel="項一覧" columns={columns} rows={entities} getRowKey={e => e.id} selected={selected} onSelect={onSelect} sort={sort} onSort={onSort}
    renderCell={(e, key) => {
      switch (key) {
        case 'sectionName': return e.sectionName;
        case 'organization': return <>
          <span title={organizationNames(e).join(' / ')}>{organizationNames(e).join(' / ') || '—'}</span>
          {[e.specialAccount, e.subAccount].filter(Boolean).length > 0 && <small>{[e.specialAccount, e.subAccount].filter(Boolean).join(' / ')}</small>}
        </>;
        case 'accountType': return accounts[e.accountType] ?? e.accountType;
        case 'sectionCode': return e.sectionCode;
        case 'amount': return amounts[e.id] === undefined ? (amountError ? '取得失敗' : '読込中…') : amounts[e.id] === null ? '—' : yen(amounts[e.id]!);
        case 'rsProjectCount': return e.rsProjectCount ?? '—';
      }
    }} />;
}
