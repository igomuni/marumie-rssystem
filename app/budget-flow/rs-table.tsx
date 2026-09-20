'use client';

import { useRef, useState } from 'react';
import { yen } from './model';
import { budgetFor, connectionCount, type RsProject, type RsSort, type RsSortKey } from './rs-model';
import styles from './page.module.css';

const columns: { key: RsSortKey; label: string; min: number; max: number; width: number }[] = [
  { key: 'projectName', label: '事業名', min: 180, max: 700, width: 280 },
  { key: 'organizations', label: '府省庁・局庁', min: 120, max: 600, width: 180 },
  { key: 'projectId', label: '事業ID', min: 80, max: 240, width: 90 },
  { key: 'connection', label: 'MOF接続', min: 130, max: 300, width: 140 },
  { key: 'amount', label: '当初予算額（円）', min: 170, max: 400, width: 190 },
];

export function RsTable({ entities, fiscalYear, covered, selected, onSelect, sort, onSort }: {
  entities: RsProject[]; fiscalYear: number; covered: boolean;
  selected: string; onSelect: (id: string) => void; sort: RsSort | null; onSort: (key: RsSortKey) => void;
}) {
  const [widths, setWidths] = useState(columns.map(c => c.width));
  const drag = useRef<{ x: number; widths: number[] } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const measuredWidths = () => Array.from(table.current!.querySelectorAll('th')).map(th => th.getBoundingClientRect().width);
  const resize = (i: number, width: number, base: number[]) => setWidths(base.map((w, index) => index === i ? Math.max(columns[i].min, Math.min(columns[i].max, width)) : w));
  return <table ref={table} className={styles.entityTable} aria-label="RS事業一覧" style={{ width: widths.reduce((a, b) => a + b, 0), minWidth: '100%' }}>
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
      <td><button aria-pressed={e.id === selected} onClick={() => onSelect(e.id)}>{e.projectName}</button></td>
      <td><span className={styles.organizationCell} title={e.organizations.join(' / ')}>{e.organizations.join(' / ') || '—'}</span></td>
      <td>{e.projectId}</td>
      <td>{connectionCount(e, fiscalYear) ? `● 接続あり（${connectionCount(e, fiscalYear)}項）` : covered ? '○ 接続なし' : '— 照合データなし'}</td>
      <td className={styles.amount}>{budgetFor(e, fiscalYear)?.initialBudgetYen == null ? '—' : yen(budgetFor(e, fiscalYear)!.initialBudgetYen!)}</td>
    </tr>)}</tbody>
  </table>;
}
