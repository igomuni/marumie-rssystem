'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import type { SubcontractGraph } from '@/types/subcontract';

type SortKey =
  | 'projectId'
  | 'projectName'
  | 'ministry'
  | 'bureau'
  | 'accountCategory'
  | 'budget'
  | 'execution'
  | 'directExpenseTotal'
  | 'totalExpense'
  | 'totalMinusDirect'
  | 'executionMinusDirect'
  | 'maxDepth'
  | 'totalBlockCount'
  | 'directBlockCount'
  | 'subcontractBlockCount'
  | 'indirectCostCount'
  | 'separateOriginCount'
  | 'totalRecipientCount'
  | 'branchingBlockCount'
  | 'maxBranchWidth'
  | 'mergeTargetCount'
  | 'maxMergeWidth'
  | 'institutional';

const STRING_SORT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  'projectName',
  'ministry',
  'bureau',
  'accountCategory',
]);
type SortDir = 'asc' | 'desc';
type StructureFilter = 'all' | 'separate-origin' | 'merge' | 'institutional';

const PAGE_SIZE = 50;

function formatYen(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
  if (v >= 1e10) return `${Math.round(v / 1e8).toLocaleString()}億円`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}億円`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}万円`;
  return `${Math.round(v).toLocaleString()}円`;
}

/** sankey-svg と同じ会計区分ラベル表記 */
function accountCategoryLabel(cat: string): string {
  if (cat === '一般会計+特別会計') return '一般・特別';
  if (cat === '一般会計') return '一般会計';
  if (cat === '特別会計') return '特別会計';
  return cat;
}

/** 担当組織の末端要素を取り出す */
function bureauLeaf(bureau: string): string {
  if (!bureau) return '';
  const parts = bureau.split(' / ');
  return parts[parts.length - 1] ?? '';
}

function SubcontractsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [year, setYear] = useState(() => {
    const y = parseInt(searchParams.get('year') ?? '2024', 10);
    return [2024, 2025].includes(y) ? y : 2024;
  });
  const [graphs, setGraphs] = useState<SubcontractGraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('projectId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [structureFilter, setStructureFilter] = useState<StructureFilter>('all');
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  // 会計区分フィルタ（sankey-svg と同じ4区分）
  const [acGeneral, setAcGeneral] = useState(true);
  const [acSpecial, setAcSpecial] = useState(true);
  const [acBoth, setAcBoth] = useState(true);
  const [acNone, setAcNone] = useState(true);
  const [showMinistryDropdown, setShowMinistryDropdown] = useState(false);
  const [ministryDropdownRect, setMinistryDropdownRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const ministryButtonRef = useRef<HTMLButtonElement>(null);
  const ministryDropdownRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);

  const ministries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of graphs) {
      if (!g.ministry) continue;
      counts.set(g.ministry, (counts.get(g.ministry) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .map(([m]) => m);
  }, [graphs]);

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    if (!showMinistryDropdown) return;
    function onPointerDown(e: MouseEvent) {
      if (ministryDropdownRef.current?.contains(e.target as Node)) return;
      if (ministryButtonRef.current?.contains(e.target as Node)) return;
      setShowMinistryDropdown(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showMinistryDropdown]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/data/subcontracts-${year}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Record<string, SubcontractGraph>) => {
        setGraphs(Object.values(data));
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [year]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return graphs.filter((g) => {
      if (selectedMinistries.length > 0 && !selectedMinistries.includes(g.ministry)) return false;
      // 会計区分フィルタ
      const cat = g.accountCategory;
      const isGeneral = cat === '一般会計';
      const isSpecial = cat === '特別会計';
      const isBoth = cat === '一般会計+特別会計';
      const isNone = !cat;
      if (isGeneral && !acGeneral) return false;
      if (isSpecial && !acSpecial) return false;
      if (isBoth && !acBoth) return false;
      if (isNone && !acNone) return false;
      if (structureFilter === 'separate-origin' && !g.hasSeparateOrigin) return false;
      if (structureFilter === 'merge' && !g.hasMerge) return false;
      if (structureFilter === 'institutional' && !g.isInstitutionalFlowOnly) return false;
      if (!q) return true;
      return (
        String(g.projectId).includes(q) ||
        g.projectName.toLocaleLowerCase().includes(q) ||
        g.ministry.toLocaleLowerCase().includes(q) ||
        g.blocks.some(
          (b) =>
            b.blockName.toLocaleLowerCase().includes(q) ||
            b.recipients.some((r) => r.name.toLocaleLowerCase().includes(q))
        )
      );
    });
  }, [graphs, query, structureFilter, selectedMinistries, acGeneral, acSpecial, acBoth, acNone]);

  function subcontractBlockCount(g: SubcontractGraph): number {
    return g.totalBlockCount - g.directBlockCount - g.separateOriginCount;
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (STRING_SORT_KEYS.has(sortKey)) {
        const sa: string =
          sortKey === 'projectName' ? a.projectName :
          sortKey === 'ministry' ? a.ministry :
          sortKey === 'bureau' ? bureauLeaf(a.bureau) :
          sortKey === 'accountCategory' ? accountCategoryLabel(a.accountCategory) :
          '';
        const sb: string =
          sortKey === 'projectName' ? b.projectName :
          sortKey === 'ministry' ? b.ministry :
          sortKey === 'bureau' ? bureauLeaf(b.bureau) :
          sortKey === 'accountCategory' ? accountCategoryLabel(b.accountCategory) :
          '';
        return sa.localeCompare(sb, 'ja') * dir;
      }
      let va: number, vb: number;
      if (sortKey === 'projectId') { va = a.projectId; vb = b.projectId; }
      else if (sortKey === 'budget') { va = a.budget; vb = b.budget; }
      else if (sortKey === 'execution') { va = a.execution; vb = b.execution; }
      else if (sortKey === 'directExpenseTotal') { va = a.directExpenseTotal; vb = b.directExpenseTotal; }
      else if (sortKey === 'totalExpense') { va = a.totalExpense; vb = b.totalExpense; }
      else if (sortKey === 'totalMinusDirect') { va = a.totalExpense - a.directExpenseTotal; vb = b.totalExpense - b.directExpenseTotal; }
      else if (sortKey === 'executionMinusDirect') { va = a.execution - a.directExpenseTotal; vb = b.execution - b.directExpenseTotal; }
      else if (sortKey === 'maxDepth') { va = a.maxDepth; vb = b.maxDepth; }
      else if (sortKey === 'totalBlockCount') { va = a.totalBlockCount; vb = b.totalBlockCount; }
      else if (sortKey === 'directBlockCount') { va = a.directBlockCount; vb = b.directBlockCount; }
      else if (sortKey === 'subcontractBlockCount') { va = subcontractBlockCount(a); vb = subcontractBlockCount(b); }
      else if (sortKey === 'indirectCostCount') { va = a.indirectCosts.length; vb = b.indirectCosts.length; }
      else if (sortKey === 'separateOriginCount') { va = a.separateOriginCount; vb = b.separateOriginCount; }
      else if (sortKey === 'branchingBlockCount') { va = a.branchingBlockCount; vb = b.branchingBlockCount; }
      else if (sortKey === 'maxBranchWidth') { va = a.maxBranchWidth; vb = b.maxBranchWidth; }
      else if (sortKey === 'mergeTargetCount') { va = a.mergeTargetCount; vb = b.mergeTargetCount; }
      else if (sortKey === 'maxMergeWidth') { va = a.maxMergeWidth; vb = b.maxMergeWidth; }
      else if (sortKey === 'institutional') { va = a.isInstitutionalFlowOnly ? 1 : 0; vb = b.isInstitutionalFlowOnly ? 1 : 0; }
      else { va = a.totalRecipientCount; vb = b.totalRecipientCount; }
      return (va - vb) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  // フィルタ・ソート・年度変更時はページ1へ戻す
  const acKey = `${acGeneral ? 'g' : ''}${acSpecial ? 's' : ''}${acBoth ? 'b' : ''}${acNone ? 'n' : ''}`;
  const filterKey = `${year}|${selectedMinistries.join(',')}|${structureFilter}|${query}|${acKey}|${sortKey}|${sortDir}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'projectId' ? 'asc' : 'desc');
    }
  }

  function SortIndicator({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span style={{ color: '#bbb', marginLeft: 4 }}>↕</span>;
    return <span style={{ color: '#3b82f6', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 8px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: '#6b7280',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  const tdNumStyle: React.CSSProperties = {
    padding: '8px 8px',
    textAlign: 'right',
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const tdTextStyle: React.CSSProperties = {
    padding: '8px 8px',
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  // 列幅: 事業名(idx 1) と 担当組織(idx 3) は null=auto で残り幅を分配。
  // ウィンドウ幅に合わせて伸縮し、長文は truncate で吸収。
  const COL_WIDTHS: (number | null)[] = [
    50,    // PID
    null,  // 事業名 (auto, truncate)
    88,    // 省庁
    null,  // 担当組織 (auto, truncate)
    72,    // 会計区分
    80,    // 予算額
    80,    // 執行額
    96,    // 直接支出合計
    96,    // 支出額合計
    88,    // 支出計−直接
    88,    // 執行−直接
    60,    // ブロック
    64,    // 直接支出
    56,    // 再委託
    64,    // 間接経費
    56,    // 別財源
    64,    // 支出先
    52,    // 階層
    52,    // 分岐
    60,    // 最大分岐
    52,    // 合流
    60,    // 最大合流
    76,    // 構造
  ];
  const FIXED_TOTAL = COL_WIDTHS.filter((w): w is number => w !== null).reduce((s, w) => s + w, 0);
  const MIN_TABLE_WIDTH = FIXED_TOTAL + 240 * 2; // auto列を最低240pxずつ確保

  // 集計
  const totalSeparateOrigin = graphs.filter(g => g.hasSeparateOrigin).length;
  const totalMerge = graphs.filter(g => g.hasMerge).length;
  const totalInstitutional = graphs.filter(g => g.isInstitutionalFlowOnly).length;

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* ヘッダー（白背景） */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px' }}>
        <div style={{ maxWidth: 1600, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← トップ</Link>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>
              再委託構造ブラウザ
            </h1>
            {/* 年度切替（/sankey-svg と同じスタイル） */}
            <div style={{ position: 'relative', marginLeft: 4 }}>
              <select
                value={year}
                onChange={(e) => { const y = Number(e.target.value); setYear(y); router.replace(`/subcontracts?year=${y}`); }}
                style={{
                  fontSize: 13,
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: '6px 28px 6px 10px',
                  background: 'rgba(255,255,255,0.95)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  color: '#333',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                }}
              >
                <option value={2025}>2025年度</option>
                <option value={2024}>2024年度</option>
              </select>
              <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#999" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 0 }}>
            {graphs.length.toLocaleString()}事業 ／ 別財源 {totalSeparateOrigin.toLocaleString()} ／ 合流 {totalMerge.toLocaleString()} ／ 制度フロー {totalInstitutional.toLocaleString()}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '12px 16px' }}>
        {/* コントロール（/sankey-svg と同じトーン） */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 検索 */}
          <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder="事業名・PID・府省庁・ブロック名・支出先名で検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 28px 6px 30px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                fontSize: 13,
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                color: '#333',
                outline: 'none',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="検索クリア"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#999', cursor: 'pointer', padding: 4, fontSize: 12 }}
              >
                ✕
              </button>
            )}
          </div>

          {/* 府省庁（複数選択ドロップダウン） */}
          {(() => {
            const allSelected = selectedMinistries.length === 0;
            const label = allSelected
              ? '全府省庁'
              : selectedMinistries.length === 1
                ? selectedMinistries[0]
                : `選択中 (${selectedMinistries.length}/${ministries.length})`;
            return (
              <div style={{ position: 'relative', minWidth: 180 }}>
                <button
                  type="button"
                  ref={ministryButtonRef}
                  onClick={() => {
                    if (ministryButtonRef.current) {
                      const r = ministryButtonRef.current.getBoundingClientRect();
                      setMinistryDropdownRect({
                        top: r.bottom + 2,
                        left: r.left,
                        width: Math.max(r.width, 240),
                        maxHeight: Math.max(160, window.innerHeight - r.bottom - 24),
                      });
                    }
                    setShowMinistryDropdown((v) => !v);
                  }}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: '6px 28px 6px 10px',
                    background: 'rgba(255,255,255,0.95)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                    color: allSelected ? '#999' : '#333',
                    cursor: 'pointer',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
                <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#999"
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: showMinistryDropdown ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)',
                    transition: 'transform 0.15s', pointerEvents: 'none',
                  }}>
                  <path d="M7 10l5 5 5-5z"/>
                </svg>
                {!allSelected && (
                  <button
                    type="button"
                    onClick={() => setSelectedMinistries([])}
                    aria-label="府省庁フィルタをクリア"
                    style={{ position: 'absolute', right: 26, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11 }}
                  >
                    ✕
                  </button>
                )}
                {showMinistryDropdown && ministryDropdownRect && typeof document !== 'undefined' && createPortal(
                  <div
                    ref={ministryDropdownRef}
                    style={{
                      position: 'fixed',
                      top: ministryDropdownRect.top,
                      left: ministryDropdownRect.left,
                      width: ministryDropdownRect.width,
                      maxHeight: ministryDropdownRect.maxHeight,
                      overflowY: 'auto',
                      zIndex: 9999,
                      background: '#fff',
                      border: '1px solid #ddd',
                      borderRadius: 6,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setSelectedMinistries([])}
                        style={{ width: 13, height: 13 }}
                      />
                      <span style={{ fontSize: 12, color: '#333' }}>すべて解除</span>
                    </label>
                    {ministries.map((m) => (
                      <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedMinistries.includes(m)}
                          onChange={() =>
                            setSelectedMinistries((prev) =>
                              prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
                            )
                          }
                          style={{ width: 13, height: 13 }}
                        />
                        <span style={{ fontSize: 12, color: '#333' }}>{m}</span>
                      </label>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            );
          })()}

          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {filtered.length.toLocaleString()}件表示
          </span>
        </div>

        {/* 会計区分フィルタ + 構造フィルタ */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>会計区分:</span>
            {([
              { label: '一般会計', value: acGeneral, setter: setAcGeneral },
              { label: '特別会計', value: acSpecial, setter: setAcSpecial },
              { label: '一般・特別', value: acBoth, setter: setAcBoth },
              { label: '区分なし', value: acNone, setter: setAcNone },
            ] as const).map(({ label, value, setter }) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  style={{ width: 13, height: 13 }}
                />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>構造:</span>
            {([
              ['all', 'すべて'],
              ['separate-origin', '別財源あり'],
              ['merge', '合流あり'],
              ['institutional', '制度フローのみ'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStructureFilter(key)}
                style={{
                  border: `1px solid ${structureFilter === key ? '#94a3b8' : '#d1d5db'}`,
                  background: structureFilter === key ? '#f1f5f9' : '#fff',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* テーブル */}
        {loading && <p style={{ color: '#6b7280', fontSize: 14 }}>読み込み中...</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 14 }}>エラー: {error}</p>}
        {!loading && !error && (
          <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <table style={{ width: '100%', minWidth: MIN_TABLE_WIDTH, borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <colgroup>
                {COL_WIDTHS.map((w, i) => (
                  <col key={i} style={w !== null ? { width: w } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={thStyle} onClick={() => toggleSort('projectId')}>PID<SortIndicator k="projectId" /></th>
                  <th style={thStyle} onClick={() => toggleSort('projectName')}>事業名<SortIndicator k="projectName" /></th>
                  <th style={thStyle} onClick={() => toggleSort('ministry')}>省庁<SortIndicator k="ministry" /></th>
                  <th style={thStyle} onClick={() => toggleSort('bureau')}>担当組織<SortIndicator k="bureau" /></th>
                  <th style={thStyle} onClick={() => toggleSort('accountCategory')}>会計区分<SortIndicator k="accountCategory" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('budget')}>予算額<SortIndicator k="budget" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('execution')}>執行額<SortIndicator k="execution" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('directExpenseTotal')}>直接支出合計<SortIndicator k="directExpenseTotal" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('totalExpense')}>支出額合計<SortIndicator k="totalExpense" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} title="支出額合計 − 直接支出合計（再委託・別財源など下流ブロック分）" onClick={() => toggleSort('totalMinusDirect')}>支出計−直接<SortIndicator k="totalMinusDirect" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} title="執行額(2-1) − 直接支出合計(5-1)。間接経費分とほぼ一致するケースあり" onClick={() => toggleSort('executionMinusDirect')}>執行−直接<SortIndicator k="executionMinusDirect" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('totalBlockCount')}>ブロック<SortIndicator k="totalBlockCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('directBlockCount')}>直接支出<SortIndicator k="directBlockCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('subcontractBlockCount')}>再委託<SortIndicator k="subcontractBlockCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('indirectCostCount')}>間接経費<SortIndicator k="indirectCostCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('separateOriginCount')}>別財源<SortIndicator k="separateOriginCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('totalRecipientCount')}>支出先<SortIndicator k="totalRecipientCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('maxDepth')}>階層<SortIndicator k="maxDepth" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('branchingBlockCount')}>分岐<SortIndicator k="branchingBlockCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('maxBranchWidth')}>最大分岐<SortIndicator k="maxBranchWidth" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('mergeTargetCount')}>合流<SortIndicator k="mergeTargetCount" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('maxMergeWidth')}>最大合流<SortIndicator k="maxMergeWidth" /></th>
                  <th style={{ ...thStyle, textAlign: 'center' }} onClick={() => toggleSort('institutional')}>構造<SortIndicator k="institutional" /></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((g, i) => (
                  <tr
                    key={g.projectId}
                    style={{
                      background: i % 2 === 0 ? '#fff' : '#f9fafb',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <td style={{ ...tdTextStyle, color: '#6b7280' }}>{g.projectId}</td>
                    <td style={tdTextStyle}>
                      <Link
                        href={`/subcontracts/${g.projectId}?year=${year}`}
                        title={g.projectName}
                        style={{
                          color: '#2563eb',
                          textDecoration: 'none',
                          fontWeight: 500,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {g.projectName}
                      </Link>
                    </td>
                    <td style={tdTextStyle} title={g.ministry}>{g.ministry}</td>
                    <td style={tdTextStyle} title={g.bureau || undefined}>
                      {bureauLeaf(g.bureau) || <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdTextStyle}>
                      {g.accountCategory ? accountCategoryLabel(g.accountCategory) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.budget > 0 ? formatYen(g.budget) : '—'}
                    </td>
                    <td style={tdNumStyle}>
                      {g.execution > 0 ? formatYen(g.execution) : '—'}
                    </td>
                    <td style={tdNumStyle}>
                      {g.directExpenseTotal > 0 ? formatYen(g.directExpenseTotal) : '—'}
                    </td>
                    <td style={tdNumStyle}>
                      {g.totalExpense > 0 ? formatYen(g.totalExpense) : '—'}
                    </td>
                    {(() => {
                      const totalMinusDirect = g.totalExpense - g.directExpenseTotal;
                      const executionMinusDirect = g.execution - g.directExpenseTotal;
                      const fmtDiff = (v: number, hasBase: boolean) => {
                        if (!hasBase) return <span style={{ color: '#cbd5e1' }}>—</span>;
                        if (v === 0) return <span style={{ color: '#cbd5e1' }}>0</span>;
                        return formatYen(Math.abs(v)).replace(/^/, v < 0 ? '−' : '');
                      };
                      return (
                        <>
                          <td style={tdNumStyle}>
                            {fmtDiff(totalMinusDirect, g.totalExpense > 0 || g.directExpenseTotal > 0)}
                          </td>
                          <td style={tdNumStyle}>
                            {fmtDiff(executionMinusDirect, g.execution > 0 || g.directExpenseTotal > 0)}
                          </td>
                        </>
                      );
                    })()}
                    <td style={tdNumStyle}>{g.totalBlockCount}</td>
                    <td style={tdNumStyle}>
                      {g.directBlockCount > 0 ? g.directBlockCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {subcontractBlockCount(g) > 0 ? subcontractBlockCount(g) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.indirectCosts.length > 0 ? g.indirectCosts.length.toLocaleString() : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.separateOriginCount > 0 ? g.separateOriginCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>{g.totalRecipientCount.toLocaleString()}</td>
                    <td style={tdNumStyle}>{g.maxDepth}</td>
                    <td style={tdNumStyle}>
                      {g.branchingBlockCount > 0 ? g.branchingBlockCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.maxBranchWidth >= 2 ? g.maxBranchWidth : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.mergeTargetCount > 0 ? g.mergeTargetCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.maxMergeWidth >= 2 ? g.maxMergeWidth : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ ...tdTextStyle, textAlign: 'center' }}>
                      {g.isInstitutionalFlowOnly ? (
                        <span style={{ display: 'inline-block', padding: '2px 4px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#991b1b' }}>
                          制度
                        </span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ページネーション */}
        {!loading && !error && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: '4px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.3 : 1,
              }}
            >
              ← 前へ
            </button>
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                padding: '4px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
                opacity: page === totalPages ? 0.3 : 1,
              }}
            >
              次へ →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubcontractsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <SubcontractsPageInner />
    </Suspense>
  );
}
