'use client';

import { useRef, useState } from 'react';
import { accounts, organizationNames, yen, type EntitySummary, type EntitySort, type EntitySortKey } from './model';
import styles from './page.module.css';

const columns: { key: EntitySortKey; label: string; min: number; max: number; width: number }[] = [
  { key: 'sectionName', label: '項名', min: 180, max: 700, width: 280 },
  { key: 'organization', label: '所管・組織', min: 120, max: 600, width: 180 },
  { key: 'accountType', label: '会計', min: 90, max: 300, width: 100 },
  { key: 'sectionCode', label: '項コード', min: 90, max: 240, width: 90 },
  { key: 'amount', label: '当初予算額（円）', min: 170, max: 400, width: 190 },
];

export function EntityTable({ entities, amounts, amountError, selected, onSelect, sort, onSort }: {
  entities: EntitySummary[]; amounts: Record<string, number | null>; amountError: boolean;
  selected: string; onSelect: (id: string) => void; sort: EntitySort | null; onSort: (key: EntitySortKey) => void;
}) {
  const [widths, setWidths] = useState(columns.map(c => c.width));
  const drag = useRef<{ x: number; widths: number[] } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const measuredWidths = () => Array.from(table.current!.querySelectorAll('th')).map(th => th.getBoundingClientRect().width);
  const resize = (i: number, width: number, base: number[]) => setWidths(base.map((w, index) => index === i ? Math.max(columns[i].min, Math.min(columns[i].max, width)) : w));
  return <table ref={table} className={styles.entityTable} aria-label="項一覧" style={{ width: widths.reduce((a, b) => a + b, 0), minWidth: '100%' }}>
    <colgroup>{widths.map((width, i) => <col key={columns[i].key} style={{ width }} />)}</colgroup>
    <thead><tr>{columns.map((column, i) => <th key={column.key} aria-sort={sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button className={styles.sortButton} aria-label={`${column.label}で並べ替え`} onClick={() => onSort(column.key)}>{column.label}<span aria-hidden="true">{sort?.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>
      <div className={styles.columnResize} role="separator" tabIndex={0} aria-label={`${column.label}の列幅`} aria-orientation="vertical" aria-valuemin={column.min} aria-valuemax={column.max} aria-valuenow={Math.round(widths[i])}
        onPointerDown={e => { drag.current = { x: e.clientX, widths: measuredWidths() }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
        onPointerMove={e => { if (drag.current) resize(i, drag.current.widths[i] + e.clientX - drag.current.x, drag.current.widths); }}
        onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const base = measuredWidths(); resize(i, base[i] + (e.key === 'ArrowRight' ? 20 : -20), base); } }} />
    </th>)}</tr></thead>
    <tbody>{entities.map(e => <tr key={e.id} className={e.id === selected ? styles.selected : ''}>
      <td><button aria-pressed={e.id === selected} onClick={() => onSelect(e.id)}>{e.sectionName}</button></td>
      <td><span className={styles.organizationCell} title={organizationNames(e).join(' / ')}>{organizationNames(e).join(' / ') || '—'}</span>{[e.specialAccount, e.subAccount].filter(Boolean).length > 0 && <small>{[e.specialAccount, e.subAccount].filter(Boolean).join(' / ')}</small>}</td>
      <td>{accounts[e.accountType] ?? e.accountType}</td><td>{e.sectionCode}</td>
      <td className={styles.amount}>{amounts[e.id] === undefined ? (amountError ? '取得失敗' : '読込中…') : amounts[e.id] === null ? '—' : yen(amounts[e.id]!)}</td>
    </tr>)}</tbody>
  </table>;
}
