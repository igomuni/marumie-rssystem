'use client';

import { useRef, useState } from 'react';
import styles from './page.module.css';

export interface DataTableColumn<K extends string> {
  key: K; label: string; min: number; max: number; width: number; sortable?: boolean; align?: 'left' | 'right';
}

export function DataTable<T, K extends string>({ ariaLabel, columns, rows, getRowKey, renderCell, selected, onSelect, sort, onSort }: {
  ariaLabel: string; columns: DataTableColumn<K>[]; rows: T[]; getRowKey: (row: T) => string;
  renderCell: (row: T, key: K) => React.ReactNode;
  selected: string; onSelect: (id: string) => void;
  sort: { key: K; direction: 'asc' | 'desc' } | null; onSort: (key: K) => void;
}) {
  const [widths, setWidths] = useState(columns.map(c => c.width));
  const drag = useRef<{ x: number; widths: number[] } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const measuredWidths = () => Array.from(table.current!.querySelectorAll('th')).map(th => th.getBoundingClientRect().width);
  const resize = (i: number, width: number, base: number[]) => setWidths(base.map((w, index) => index === i ? Math.max(columns[i].min, Math.min(columns[i].max, width)) : w));
  return <table ref={table} className={styles.entityTable} aria-label={ariaLabel} style={{ width: widths.reduce((a, b) => a + b, 0), minWidth: '100%' }}>
    <colgroup>{widths.map((width, i) => <col key={columns[i].key} style={{ width }} />)}</colgroup>
    <thead><tr>{columns.map((column, i) => <th key={column.key} aria-sort={sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
      {column.sortable === false
        ? <span className={styles.sortButton}>{column.label}</span>
        : <button className={styles.sortButton} aria-label={`${column.label}で並べ替え`} onClick={() => onSort(column.key)}>{column.label}<span aria-hidden="true">{sort?.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>}
      <div className={styles.columnResize} role="separator" tabIndex={0} aria-label={`${column.label}の列幅`} aria-orientation="vertical" aria-valuemin={column.min} aria-valuemax={column.max} aria-valuenow={Math.round(widths[i])}
        onPointerDown={e => { drag.current = { x: e.clientX, widths: measuredWidths() }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
        onPointerMove={e => { if (drag.current) resize(i, drag.current.widths[i] + e.clientX - drag.current.x, drag.current.widths); }}
        onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const base = measuredWidths(); resize(i, base[i] + (e.key === 'ArrowRight' ? 20 : -20), base); } }} />
    </th>)}</tr></thead>
    <tbody>{rows.map(row => { const id = getRowKey(row); return <tr key={id} aria-selected={id === selected} className={id === selected ? styles.selected : ''} onClick={() => onSelect(id)} style={{ cursor: 'pointer' }}>
      {columns.map(column => <td key={column.key} className={column.align === 'right' ? styles.amount : undefined}>{renderCell(row, column.key)}</td>)}
    </tr>; })}</tbody>
  </table>;
}
