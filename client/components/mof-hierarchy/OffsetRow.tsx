'use client';

/**
 * 表示開始位置の1行ぶん。
 *
 * TopN だけだと上位しか見られず、窓から外れた分は集約に消えたまま辿れない。
 * 窓をずらして下位も見られるようにする（/sankey-svg のオフセットと同じ考え方）。
 * その列が丸ごと収まっているときは出さない（ずらす先が無いので）。
 */

import { useState } from 'react';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';

// [delta, SVGパス, ラベル]
const ARROW_PATHS: [number, string, string][] = [
  [-1, 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z', '前へ'],
  [1, 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z', '次へ'],
];

export function OffsetRow({
  label,
  offset,
  limit,
  total,
  onChange,
}: {
  /** 列名（所管・事項など） */
  label: string;
  /** 現在の開始位置（0始まり） */
  offset: number;
  /** その列の表示件数 */
  limit: number;
  /** その列の候補件数 */
  total: number;
  onChange: (next: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [input, setInput] = useState('');
  const repeat = useRepeatPress();

  const max = Math.max(0, total - limit);
  const current = Math.min(offset, max);
  const rangeStart = current + 1;
  const rangeEnd = Math.min(current + limit, total);
  const commit = (next: number) => onChange(Math.max(0, Math.min(max, next)));

  return (
    <div className="flex items-center gap-1 pl-[3.5em] text-[11px] text-gray-500">
      {isEditing ? (
        <input
          type="number"
          autoFocus
          min={1}
          max={max + 1}
          step={1}
          aria-label={`${label}の開始位置(数値)`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onBlur={() => {
            const value = Number(input);
            if (!Number.isNaN(value) && value >= 1) commit(value - 1);
            setIsEditing(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
          className="w-12 rounded border border-gray-300 text-center text-[11px]"
        />
      ) : (
        <button
          type="button"
          title="クリックして開始位置を入力"
          aria-label={`${label}の開始位置を直接入力`}
          onClick={() => {
            setInput(String(rangeStart));
            setIsEditing(true);
          }}
          className="cursor-text tabular-nums text-gray-500"
        >
          {rangeStart.toLocaleString()}
        </button>
      )}
      <span className="tabular-nums">〜{rangeEnd.toLocaleString()}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        aria-label={`${label}の開始位置`}
        value={current}
        onChange={e => commit(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 tabular-nums text-gray-400">/{total.toLocaleString()}</span>
      <span className="flex shrink-0">
        {ARROW_PATHS.map(([delta, path, title]) => {
          // 1ページぶん送る。1件ずつだと41位から先へ行くのに40回押すことになる
          const step = () => commit(current + delta * limit);
          return (
            <button
              key={delta}
              type="button"
              title={title}
              aria-label={`${label}の表示位置を${title}`}
              {...repeat(step)}
              onClick={e => {
                if (e.detail === 0) step();
              }}
              className="flex w-4 items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555">
                <path d={path} />
              </svg>
            </button>
          );
        })}
      </span>
    </div>
  );
}
