'use client';

/**
 * ノード検索。
 *
 * 6列・数百ノードあると目当ての省庁や事項を目で探せない。
 * `/sankey-svg` と同じく左上に置き、選ぶとそのノードが選択される。
 */

import { useMemo, useRef, useState } from 'react';
import type { MOFHierarchyNode } from '@/types/mof-hierarchy';
import { MOF_HIERARCHY_COLUMN_LABELS } from '@/types/mof-hierarchy';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { testId } from '@/client/lib/testId';

/** 候補の上限。多すぎると選べないので絞る */
const MAX_RESULTS = 30;

/** 検索を始める最小文字数。1文字だとほぼ全件が並ぶ */
const MIN_QUERY_LENGTH = 2;

export function HierarchySearch({
  nodes,
  onSelect,
}: {
  nodes: MOFHierarchyNode[];
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  /** 矢印キーで指している候補。-1 は未選択 */
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) return [];
    return nodes
      .filter(n => !n.details.passThrough && n.name.includes(q))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, MAX_RESULTS);
  }, [nodes, query]);

  /** 検索語や候補一覧が変わったら、指している候補も無効になるので戻す */
  const resetCursor = (next: string) => {
    setQuery(next);
    setOpen(true);
    setCursor(-1);
  };

  /** 選択して一覧を閉じる。マウスとキーボードの両方から呼ぶ */
  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div
      className="relative w-72"
      onMouseDown={e => e.stopPropagation()}
      // 一覧の中へフォーカスが移ったときは閉じない。
      // input の blur だけで閉じると、Tab で候補へ移った瞬間に消えて
      // キーボードでは選べなくなる
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        type="search"
        value={query}
        placeholder={`検索（${MIN_QUERY_LENGTH}文字以上）`}
        onChange={e => resetCursor(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (results.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor(i => {
              const next = Math.min(i + 1, results.length - 1);
              listRef.current?.children[next + 1]?.scrollIntoView({ block: 'nearest' });
              return next;
            });
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor(i => {
              const next = Math.max(i - 1, -1);
              listRef.current?.children[next + 1]?.scrollIntoView({ block: 'nearest' });
              return next;
            });
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (cursor >= 0 && cursor < results.length) choose(results[cursor].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-lg border border-black/10 bg-white/90 px-3 text-xs text-neutral-700 shadow-md backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
      {open && results.length > 0 && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 px-3 py-1 text-[11px] text-gray-400">
            {results.length}件{results.length === MAX_RESULTS ? '（上位のみ）' : ''}
          </div>
          {results.map((node, i) => (
            <button
              key={node.id}
              type="button"
              data-testid={testId('hierarchy-search-result')}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={e => {
                // blur より先に拾う。blur が走ると一覧が閉じてクリックが届かない
                e.preventDefault();
                choose(node.id);
              }}
              // キーボード操作では onMouseDown が発火しないので、こちらでも拾う
              onClick={() => choose(node.id)}
              className={`block w-full px-3 py-1.5 text-left ${i === cursor ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <div className="text-[10px] text-gray-400">
                {MOF_HIERARCHY_COLUMN_LABELS[node.details.column]}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-gray-800">{node.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
                  {formatBudgetFromYen(node.value ?? 0)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
