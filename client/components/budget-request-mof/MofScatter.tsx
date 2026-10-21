'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BudgetRequestMofRow } from '@/types/budget-request-mof';
import { diffOf, mofRowKey, orgOf } from '@/app/lib/budget-request-mof';
import { changeColor, formatSen, formatSenSigned } from '@/client/components/budget-request-trend/format';

/**
 * 分布図: 横軸 = 概算要求額、縦軸 = 当初予算額（どちらも対数、千円）。対角線（要求 = 当初）より上は予算が要求を上回った項。
 * 0 の値は軸の外側の帯に置く（対数で描けないため）。要求か予算のどちらかが無い行（MOF のみ・概算要求のみ）は描かない。
 * 色は 3 つ（散布図で全組の判別を満たすのは 3 色まで）: 編成で決まる項 / 金額を示さない要求を含む（事項要求・要求額0・一括計上の配分先）/ 通常の要求。
 */
const SERIES = [
  { label: '編成で決まる項', cls: 'fill-[#2a78d6] dark:fill-[#3987e5]', swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  { label: '金額を示さない要求を含む', cls: 'fill-[#eb6834] dark:fill-[#d95926]', swatch: 'bg-[#eb6834] dark:bg-[#d95926]' },
  { label: '通常の要求', cls: 'fill-[#1baf7a] dark:fill-[#199e70]', swatch: 'bg-[#1baf7a] dark:bg-[#199e70]' },
] as const;
const seriesOf = (r: BudgetRequestMofRow): 0 | 1 | 2 => (r.types.includes('編成で決まる') ? 0 : r.types.some(t => t === '事項要求' || t === '要求額0' || t === '一括計上の配分先') ? 1 : 2);

const M = { left: 72, right: 16, top: 12, bottom: 40 };
const ZERO_BAND = 18; // 0 の帯の幅（px）

export function MofScatter({ rows, selectedKey, onSelect }: { rows: readonly BudgetRequestMofRow[]; selectedKey: string | null; onSelect: (r: BudgetRequestMofRow) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(320, e.contentRect.width), h: Math.max(260, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<{ r: BudgetRequestMofRow; x: number; y: number } | null>(null);

  const pts = useMemo(() => rows.filter(r => r.req !== null && r.mof !== null && r.req >= 0 && r.mof >= 0), [rows]);
  const skipped = rows.length - pts.length;
  // 対数の範囲: 正の値の最小・最大を 10 の累乗に丸める
  const [lo, hi] = useMemo(() => {
    const v = pts.flatMap(r => [r.req!, r.mof!]).filter(x => x > 0);
    if (v.length === 0) return [1, 10];
    return [10 ** Math.floor(Math.log10(Math.min(...v))), 10 ** Math.ceil(Math.log10(Math.max(...v)))];
  }, [pts]);
  const plotW = size.w - M.left - M.right - ZERO_BAND, plotH = size.h - M.top - M.bottom - ZERO_BAND;
  const x0 = M.left + ZERO_BAND, y0 = M.top + plotH; // 対数の領域の左端・下端
  const sx = (v: number) => (v <= 0 ? M.left + ZERO_BAND / 2 : x0 + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotW);
  const sy = (v: number) => (v <= 0 ? y0 + ZERO_BAND / 2 : y0 - ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotH);
  const ticks: number[] = []; for (let t = lo; t <= hi; t *= 10) ticks.push(t);
  const counts = [0, 1, 2].map(i => pts.filter(r => seriesOf(r) === i).length);
  // 選択中の点は最後に描く（上に重ねる）
  const ordered = useMemo(() => [...pts].sort((a, b) => Number(mofRowKey(a) === selectedKey) - Number(mofRowKey(b) === selectedKey) || seriesOf(b) - seriesOf(a)), [pts, selectedKey]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-200 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
        {SERIES.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5"><span className={`inline-block h-2.5 w-2.5 rounded-full ${s.swatch}`} />{s.label}<span className="tabular-nums text-neutral-400">{counts[i].toLocaleString()}</span></span>
        ))}
        <span className="text-neutral-400">横軸 = 概算要求額、縦軸 = 当初予算額（対数）。対角線より上は予算が要求を上回った項。{skipped > 0 ? `要求か予算の無い ${skipped.toLocaleString()} 件は描いていません。` : ''}</span>
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1">
        <svg width={size.w} height={size.h} role="img" aria-label="概算要求額と当初予算額の分布図" className="absolute inset-0" onMouseLeave={() => setHover(null)}>
          {/* 格子と目盛り（10 の累乗） */}
          {ticks.map(t => (
            <g key={t} className="text-neutral-400">
              <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={y0} className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth={1} />
              <line x1={x0} x2={x0 + plotW} y1={sy(t)} y2={sy(t)} className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth={1} />
              {/* 最小の目盛りは 0 の帯の文字と重ならないよう、横軸は右寄せの外へ、縦軸は上へずらす */}
              <text x={sx(t) + (t === lo ? 2 : 0)} y={y0 + ZERO_BAND + 14} textAnchor={t === lo ? 'start' : 'middle'} className="fill-neutral-500 text-[10px]">{formatSen(t)}</text>
              <text x={M.left - 4} y={sy(t) + (t === lo ? -2 : 3)} textAnchor="end" className="fill-neutral-500 text-[10px]">{formatSen(t)}</text>
            </g>
          ))}
          {/* 0 の帯 */}
          <text x={M.left + ZERO_BAND / 2} y={y0 + ZERO_BAND + 14} textAnchor="middle" className="fill-neutral-500 text-[10px]">0</text>
          <text x={M.left - 4} y={y0 + ZERO_BAND / 2 + 3} textAnchor="end" className="fill-neutral-500 text-[10px]">0</text>
          <rect x={M.left} y={M.top} width={ZERO_BAND} height={plotH + ZERO_BAND} className="fill-neutral-100/60 dark:fill-neutral-800/40" />
          <rect x={M.left} y={y0} width={plotW + ZERO_BAND} height={ZERO_BAND} className="fill-neutral-100/60 dark:fill-neutral-800/40" />
          {/* 対角線（要求 = 当初） */}
          <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} className="stroke-neutral-400 dark:stroke-neutral-500" strokeWidth={1} />
          <text x={sx(hi) - 4} y={sy(hi) + 14} textAnchor="end" className="fill-neutral-500 text-[10px]">要求 = 当初</text>
          <text x={(x0 + x0 + plotW) / 2} y={size.h - 4} textAnchor="middle" className="fill-neutral-600 text-[11px] dark:fill-neutral-300">概算要求額</text>
          <text transform={`translate(12 ${(M.top + y0) / 2}) rotate(-90)`} textAnchor="middle" className="fill-neutral-600 text-[11px] dark:fill-neutral-300">当初予算額</text>
          {ordered.map(r => {
            const k = mofRowKey(r); const sel = k === selectedKey; const cx = sx(r.req!), cy = sy(r.mof!);
            return (
              <g key={k} className="cursor-pointer" onClick={() => onSelect(r)} onMouseEnter={() => setHover({ r, x: cx, y: cy })}>
                <circle cx={cx} cy={cy} r={9} fill="transparent" />
                <circle cx={cx} cy={cy} r={sel ? 6 : 4} className={`${SERIES[seriesOf(r)].cls} ${sel ? 'stroke-neutral-900 dark:stroke-white' : 'stroke-white dark:stroke-neutral-900'}`} strokeWidth={2} />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute z-10 max-w-xs rounded border border-neutral-200 bg-white px-2 py-1.5 text-[11px] shadow-md dark:border-neutral-700 dark:bg-neutral-900" style={{ left: Math.min(hover.x + 12, size.w - 240), top: Math.max(hover.y - 60, 4) }}>
            <div className="font-semibold text-neutral-800 dark:text-neutral-100">{hover.r.name}</div>
            <div className="text-neutral-500">{hover.r.acct === 0 ? hover.r.grp : `${hover.r.min}特別会計`}{orgOf(hover.r) ? ` › ${orgOf(hover.r)}` : ''}</div>
            <div className="mt-0.5 tabular-nums text-neutral-700 dark:text-neutral-300">要求 {formatSen(hover.r.req)} → 当初 {formatSen(hover.r.mof)}　<span className={changeColor(diffOf(hover.r))}>{formatSenSigned(diffOf(hover.r))}</span></div>
            {hover.r.types.length > 0 && <div className="text-neutral-500">{hover.r.types.join('・')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

