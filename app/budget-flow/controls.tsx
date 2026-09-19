'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { searchMatcher } from './model';
import styles from './page.module.css';

export function SearchInput({ label, value, onChange, regex, onRegex }: { label: string; value: string; onChange: (value: string) => void; regex: boolean; onRegex: (value: boolean) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { error } = searchMatcher(value, regex);
  return <div><div className={styles.searchInput}><input ref={input} type="search" aria-label={label} placeholder="検索" value={value} onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? id : undefined} /><button type="button" aria-label={`${label}の正規表現`} title="正規表現を使用" aria-pressed={regex} onClick={() => onRegex(!regex)}>.*</button><button type="button" aria-label={`${label}をクリア`} title="検索をクリア" disabled={!value} onClick={() => { onChange(''); input.current?.focus(); }}>×</button></div>{error && <p id={id} role="alert" className={styles.searchError}>{error}</p>}</div>;
}

export function MultiSelect({ label, options, value, onChange, searchable = true }: { searchable?: boolean; label: string; options: { value: string; label: string }[]; value: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const { matches } = searchMatcher(query, regex);
  const visible = options.filter(option => matches(option.label));
  const details = useRef<HTMLDetailsElement>(null);
  const selectionText = value.length ? options.filter(option => value.includes(option.value)).map(option => option.label).join('、') : 'すべて';
  return <details ref={details} className={styles.multiSelect} onKeyDown={e => { if (e.key === 'Escape' && details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label={`${label}: ${selectionText}`}><span>{selectionText}</span></summary>
    <div className={styles.optionsPanel}>{searchable && <SearchInput label={`${label}の候補を検索`} value={query} onChange={setQuery} regex={regex} onRegex={setRegex} />}
      <button className={styles.clearSelection} onClick={() => onChange([])}>選択を解除（すべて表示）</button>
      <div className={styles.options} role="group" aria-label={`${label}の選択肢`}>{visible.map(option => <label key={option.value}><input type="checkbox" checked={value.includes(option.value)} onChange={e => onChange(e.target.checked ? [...value, option.value] : value.filter(v => v !== option.value))} /><span>{option.label}</span></label>)}{!visible.length && <p>候補がありません</p>}</div>
    </div>
  </details>;
}

export function PaneLayout({ filters, list, detail }: { filters: ReactNode; list: ReactNode; detail: ReactNode }) {
  const [left, setLeft] = useState(240);
  const [right, setRight] = useState(460);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (window.innerWidth <= 1100) return;
      const available = element.clientWidth;
      const nextLeft = Math.max(200, Math.min(left, available - 704));
      setLeft(nextLeft);
      setRight(width => Math.max(340, Math.min(width, available - nextLeft - 364)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [left]);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (side: 'left' | 'right', width: number) => {
    const available = container.current?.clientWidth ?? 1200;
    const other = side === 'left' ? right : left;
    const min = side === 'left' ? 200 : 340;
    const max = Math.max(min, Math.min(side === 'left' ? 360 : 760, available - other - 364));
    (side === 'left' ? setLeft : setRight)(Math.max(min, Math.min(max, width)));
  };
  const separator = (side: 'left' | 'right') => <div role="separator" aria-label={side === 'left' ? 'フィルタと項一覧の幅' : '項一覧と詳細の幅'} aria-orientation="vertical" aria-valuemin={side === 'left' ? 200 : 340} aria-valuemax={side === 'left' ? 360 : 760} aria-valuenow={side === 'left' ? left : right} tabIndex={0} className={styles.resizeHandle}
    onPointerDown={e => { drag.current = { x: e.clientX, width: side === 'left' ? left : right }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
    onPointerMove={e => { if (drag.current) resize(side, drag.current.width + (e.clientX - drag.current.x) * (side === 'left' ? 1 : -1)); }}
    onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(side, (side === 'left' ? left : right) + (e.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1)); } }}><span>⋮</span></div>;
  return <div ref={container} className={styles.workspace} style={{ '--filter-width': `${left}px`, '--detail-width': `${right}px` } as CSSProperties}>{filters}{separator('left')}{list}{separator('right')}{detail}</div>;
}
