'use client';

/**
 * TopN と表示位置のパネル。
 *
 * /sankey-svg の TopN／オフセットパネルと同じ作りにしてある。
 * 探索しながら何度も動かす操作なので、ダイアログに畳まず右上に常時出し、
 * 邪魔なときだけパネル外のトグルで隠せるようにする。
 *
 * 表示位置は対象を1列だけ選んで動かす（/sankey-svg の「事業／支出先」と同じ）。
 * 列ごとに行を並べるとパネルが縦に伸びて図を覆うため。
 */

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { TopNSliderRow } from '@/client/components/SankeySvg/TopNSliders';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';
import {
  MOF_HIERARCHY_COLUMNS,
  MOF_HIERARCHY_COLUMN_LABELS,
  type MOFHierarchyColumn,
  type MOFHierarchyOffset,
  type MOFHierarchyTopN,
} from '@/types/mof-hierarchy';
import { DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';

/** TopN スライダーの上限。/sankey-svg と同じ */
const TOP_N_MAX = 300;

/**
 * 表示数を出す列。
 *
 * 根（予算合計）は1件しかないので対象外。所管も省庁の数（実測25件）で
 * どの年度でも収まるため、上限を掛けても何も起きない。
 * 表示位置の対象には残す（列の候補件数を読めるようにするため）。
 */
type RankableColumn = Exclude<MOFHierarchyColumn, 'total'>;
const OFFSET_COLUMNS = MOF_HIERARCHY_COLUMNS.filter(
  (c): c is RankableColumn => c !== 'total'
);
const TOP_N_COLUMNS = OFFSET_COLUMNS.filter(c => c !== 'ministry');

// [delta, SVGパス, ラベル]
const ARROW_PATHS: [number, string, string][] = [
  [-1, 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z', '前へ'],
  [1, 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z', '次へ'],
];

const SELECT_CLASS =
  'h-6 cursor-pointer rounded border border-gray-300 bg-white px-1 text-[11px] text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function HierarchyControls({
  topN,
  offset,
  columnCounts,
  onTopNChange,
  onOffsetChange,
}: {
  topN: MOFHierarchyTopN;
  /** 列ごとの表示開始位置 */
  offset: MOFHierarchyOffset;
  /** 列ごとの候補件数。表示位置の上限を出すのに使う */
  columnCounts: Partial<Record<MOFHierarchyColumn, number>>;
  onTopNChange: (next: MOFHierarchyTopN) => void;
  onOffsetChange: (next: MOFHierarchyOffset) => void;
}) {
  const [open, setOpen] = useState(true);
  /** 表示位置を動かす対象の列 */
  const [target, setTarget] = useState<RankableColumn>('item');
  const [isEditing, setIsEditing] = useState(false);
  const [input, setInput] = useState('');
  const repeat = useRepeatPress();

  /** その列の窓幅。上限を掛けていない列は候補件数そのもの */
  const limitOf = (column: RankableColumn) =>
    topN[column] ?? DEFAULT_TOP_N[column] ?? columnCounts[column] ?? 0;

  const targetLabel = MOF_HIERARCHY_COLUMN_LABELS[target];
  const limit = limitOf(target);
  const total = columnCounts[target] ?? 0;
  const max = Math.max(0, total - limit);
  const current = Math.min(offset[target] ?? 0, max);
  const rangeStart = total === 0 ? 0 : current + 1;
  const rangeEnd = Math.min(current + limit, total);
  const commitOffset = (next: number) =>
    onOffsetChange({ ...offset, [target]: Math.max(0, Math.min(max, next)) });

  return (
    <div className="flex flex-col items-end" data-pan-disabled="true">
      <div className="rounded-t-md rounded-bl-md border border-gray-200 bg-white/95 px-2.5 py-1.5 shadow-md backdrop-blur">
        {/* 1行目: 表示位置。対象を1列選んで窓をずらす */}
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <select
            aria-label="表示位置の対象"
            value={target}
            onChange={e => setTarget(e.target.value as RankableColumn)}
            className={SELECT_CLASS}
          >
            {OFFSET_COLUMNS.map(column => (
              <option key={column} value={column}>
                {MOF_HIERARCHY_COLUMN_LABELS[column]}
              </option>
            ))}
          </select>
          <span className="shrink-0">Top</span>
          {isEditing ? (
            <input
              type="number"
              autoFocus
              min={1}
              max={max + 1}
              step={1}
              aria-label={`${targetLabel}の開始位置(数値)`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onBlur={() => {
                const value = Number(input);
                if (!Number.isNaN(value) && value >= 1) commitOffset(value - 1);
                setIsEditing(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape')
                  (e.target as HTMLInputElement).blur();
              }}
              className="w-14 rounded border border-gray-300 text-center text-[11px]"
            />
          ) : (
            <button
              type="button"
              title="クリックして開始位置を入力"
              aria-label={`${targetLabel}の開始位置を直接入力`}
              onClick={() => {
                setInput(String(rangeStart));
                setIsEditing(true);
              }}
              className="cursor-text tabular-nums"
            >
              {rangeStart.toLocaleString()}
            </button>
          )}
          <span className="shrink-0 tabular-nums">〜{rangeEnd.toLocaleString()}</span>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            disabled={max === 0}
            aria-label={`${targetLabel}の開始位置`}
            value={current}
            onChange={e => commitOffset(Number(e.target.value))}
            className="w-16 min-w-0"
          />
          <span className="shrink-0 tabular-nums text-gray-400">
            /{total.toLocaleString()}件
          </span>
          {ARROW_PATHS.map(([delta, path, title]) => {
            // 1ページぶん送る。1件ずつだと41位から先へ行くのに40回押すことになる
            const step = () => commitOffset(current + delta * limit);
            return (
              <button
                key={delta}
                type="button"
                title={title}
                aria-label={`${targetLabel}の表示位置を${title}`}
                {...repeat(step)}
                onClick={e => {
                  if (e.detail === 0) step();
                }}
                className="flex w-4 shrink-0 items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555">
                  <path d={path} />
                </svg>
              </button>
            );
          })}
          <button
            type="button"
            title="先頭に戻す"
            aria-label={`${targetLabel}の表示位置を先頭に戻す`}
            onClick={() => commitOffset(0)}
            className="flex w-4 shrink-0 items-center justify-center"
          >
            {/* Material Icons: vertical_align_top を横向きに */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="12"
              width="12"
              viewBox="0 0 24 24"
              fill="#555"
              style={{ transform: 'rotate(-90deg)' }}
            >
              <path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z" />
            </svg>
          </button>
        </div>

        {/* 2行目以降: 列ごとの表示数。2列に並べて縦に伸びるのを抑える */}
        {open && (
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-gray-100 pt-1">
            {TOP_N_COLUMNS.map(column => {
              const label = MOF_HIERARCHY_COLUMN_LABELS[column];
              const value = limitOf(column);
              // 増減ボタンは更新関数の形で呼ぶので、それを受けられるようにする
              const setValue: Dispatch<SetStateAction<number>> = next =>
                onTopNChange({
                  ...topN,
                  [column]: typeof next === 'function' ? next(value) : next,
                });
              return (
                <TopNSliderRow
                  key={column}
                  label={label}
                  inputLabel={`${label}の表示数`}
                  value={value}
                  setValue={setValue}
                  markReplace={() => {}}
                  metaFontPx={11}
                  max={TOP_N_MAX}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* トグル（パネル外・下部）。/sankey-svg の TopN パネルと同じ作法 */}
      <button
        type="button"
        title={open ? '表示数 を隠す' : '表示数 を表示'}
        aria-label={open ? '表示数 を隠す' : '表示数 を表示'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="-mt-px flex items-center justify-center rounded-b border border-t-0 border-gray-200 bg-white/95 px-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
          <path
            d={
              open
                ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z'
                : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'
            }
          />
        </svg>
      </button>
    </div>
  );
}
