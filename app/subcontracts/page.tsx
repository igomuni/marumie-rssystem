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

/** "1.26億", "100億", "1兆", "1兆2000億", "456789" などを1円単位の数値に変換。解析失敗時 null */
function parseAmountToYen(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/[,，\s]/g, '');
  if (!trimmed) return null;
  const combo = trimmed.match(/^([\d.]+)兆([\d.]+)億?$/);
  if (combo) {
    const cho = parseFloat(combo[1]);
    const oku = parseFloat(combo[2]);
    if (!isNaN(cho) && !isNaN(oku)) return (cho * 10000 + oku) * 1e8;
  }
  const m = trimmed.match(/^([\d.]+)\s*(兆|億|万|千)?円?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (isNaN(v)) return null;
  switch (m[2]) {
    case '兆': return v * 1e12;
    case '億': return v * 1e8;
    case '万': return v * 1e4;
    case '千': return v * 1e3;
    default: return v;
  }
}

/** sankey-svg 風の複数選択ドロップダウン */
interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  placeholder?: string;
  minWidth?: number;
}

/** sankey-svg 風の label + control + ✕ 行 */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#555', width: 40, flexShrink: 0, fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

/** 部分一致テキスト入力（クリアボタン付き） */
function FilterTextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 12,
          border: '1px solid #ddd',
          borderRadius: 4,
          padding: '3px 22px 3px 6px',
          background: '#fafafa',
          color: '#333',
          outline: 'none',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="クリア"
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Min-Max 金額入力ペア */
function MinMaxInput({
  minVal, maxVal, onMinChange, onMaxChange,
}: {
  minVal: string; maxVal: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
}) {
  const minOk = !minVal || parseAmountToYen(minVal) !== null;
  const maxOk = !maxVal || parseAmountToYen(maxVal) !== null;
  const inputStyle = (ok: boolean): React.CSSProperties => ({
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    border: `1px solid ${ok ? '#ddd' : '#e53935'}`,
    borderRadius: 4,
    padding: '3px 6px',
    background: '#fafafa',
    color: '#333',
    outline: 'none',
  });
  return (
    <>
      <input
        type="text"
        value={minVal}
        onChange={(e) => onMinChange(e.target.value)}
        placeholder="下限"
        title="下限 (例: 100億, 1兆)"
        style={inputStyle(minOk)}
      />
      <span style={{ color: '#aaa', fontSize: 11 }}>〜</span>
      <input
        type="text"
        value={maxVal}
        onChange={(e) => onMaxChange(e.target.value)}
        placeholder="上限"
        title="上限 (例: 1兆, 5000億)"
        style={inputStyle(maxOk)}
      />
      {(minVal || maxVal) && (
        <button
          type="button"
          onClick={() => { onMinChange(''); onMaxChange(''); }}
          aria-label="クリア"
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11, flexShrink: 0 }}
        >
          ✕
        </button>
      )}
    </>
  );
}

function MultiSelectDropdown({ options, selected, onChange, allLabel, minWidth = 160 }: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const allSelected = selected.length === 0;
  const label = allSelected
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `選択中 (${selected.length}/${options.length})`;

  return (
    <div style={{ position: 'relative', minWidth, flex: 1 }}>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => {
          if (buttonRef.current) {
            const r = buttonRef.current.getBoundingClientRect();
            setRect({
              top: r.bottom + 2,
              left: r.left,
              width: Math.max(r.width, 200),
              maxHeight: Math.max(160, window.innerHeight - r.bottom - 24),
            });
          }
          setOpen((v) => !v);
        }}
        style={{
          width: '100%',
          fontSize: 12,
          border: '1px solid #ddd',
          borderRadius: 4,
          padding: '3px 22px 3px 6px',
          background: '#fafafa',
          color: allSelected ? '#aaa' : '#333',
          cursor: 'pointer',
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          outline: 'none',
        }}
      >
        {label}
      </button>
      <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#aaa"
        style={{ position: 'absolute', right: 6, top: '50%', transform: open ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)', transition: 'transform 0.15s', pointerEvents: 'none' }}>
        <path d="M7 10l5 5 5-5z"/>
      </svg>
      {!allSelected && (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="クリア"
          style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11 }}
        >
          ✕
        </button>
      )}
      {open && rect && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            overflowY: 'auto',
            zIndex: 9999,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange([])}
              style={{ width: 12, height: 12 }}
            />
            <span style={{ fontSize: 12, color: '#333' }}>すべて解除</span>
          </label>
          {options.map((opt) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() =>
                  onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt])
                }
                style={{ width: 12, height: 12 }}
              />
              <span style={{ fontSize: 12, color: '#333' }}>{opt}</span>
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
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
  // 複数選択フィルタ
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  // 会計区分（'一般会計' | '特別会計' | '一般・特別' | '区分なし'）の複数選択
  const [selectedAccountCategories, setSelectedAccountCategories] = useState<string[]>([]);
  // 構造（'別財源あり' | '合流あり' | '制度フローのみ'）の複数選択（OR）
  const [selectedStructures, setSelectedStructures] = useState<string[]>([]);
  // 名称・組織テキストフィルタ
  const [filterProjectName, setFilterProjectName] = useState('');
  const [filterBureau, setFilterBureau] = useState('');
  // 金額 Min/Max
  const [filterBudgetMin, setFilterBudgetMin] = useState('');
  const [filterBudgetMax, setFilterBudgetMax] = useState('');
  const [filterExecutionMin, setFilterExecutionMin] = useState('');
  const [filterExecutionMax, setFilterExecutionMax] = useState('');
  const [filterDirectMin, setFilterDirectMin] = useState('');
  const [filterDirectMax, setFilterDirectMax] = useState('');
  const [filterTotalExpenseMin, setFilterTotalExpenseMin] = useState('');
  const [filterTotalExpenseMax, setFilterTotalExpenseMax] = useState('');
  // 折りたたみパネル
  const [showFilterPanel, setShowFilterPanel] = useState(false);
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

  // 金額フィルタの解析
  const budgetMinYen = parseAmountToYen(filterBudgetMin);
  const budgetMaxYen = parseAmountToYen(filterBudgetMax);
  const executionMinYen = parseAmountToYen(filterExecutionMin);
  const executionMaxYen = parseAmountToYen(filterExecutionMax);
  const directMinYen = parseAmountToYen(filterDirectMin);
  const directMaxYen = parseAmountToYen(filterDirectMax);
  const totalExpenseMinYen = parseAmountToYen(filterTotalExpenseMin);
  const totalExpenseMaxYen = parseAmountToYen(filterTotalExpenseMax);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const projectQ = filterProjectName.trim().toLocaleLowerCase();
    const bureauQ = filterBureau.trim().toLocaleLowerCase();
    return graphs.filter((g) => {
      // 府省庁
      if (selectedMinistries.length > 0 && !selectedMinistries.includes(g.ministry)) return false;
      // 会計区分（複数選択 OR）
      if (selectedAccountCategories.length > 0) {
        const label = g.accountCategory ? accountCategoryLabel(g.accountCategory) : '区分なし';
        if (!selectedAccountCategories.includes(label)) return false;
      }
      // 事業名
      if (projectQ && !g.projectName.toLocaleLowerCase().includes(projectQ)) return false;
      // 担当組織
      if (bureauQ && !g.bureau.toLocaleLowerCase().includes(bureauQ)) return false;
      // 金額 Min/Max
      if (budgetMinYen !== null && g.budget < budgetMinYen) return false;
      if (budgetMaxYen !== null && g.budget > budgetMaxYen) return false;
      if (executionMinYen !== null && g.execution < executionMinYen) return false;
      if (executionMaxYen !== null && g.execution > executionMaxYen) return false;
      if (directMinYen !== null && g.directExpenseTotal < directMinYen) return false;
      if (directMaxYen !== null && g.directExpenseTotal > directMaxYen) return false;
      if (totalExpenseMinYen !== null && g.totalExpense < totalExpenseMinYen) return false;
      if (totalExpenseMaxYen !== null && g.totalExpense > totalExpenseMaxYen) return false;
      // 構造（複数選択 OR）
      if (selectedStructures.length > 0) {
        const matchAny =
          (selectedStructures.includes('別財源あり') && g.hasSeparateOrigin) ||
          (selectedStructures.includes('合流あり') && g.hasMerge) ||
          (selectedStructures.includes('制度フローのみ') && g.isInstitutionalFlowOnly);
        if (!matchAny) return false;
      }
      // フリーテキスト検索（既存）
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
  }, [
    graphs, query, selectedMinistries, selectedAccountCategories,
    filterProjectName, filterBureau, selectedStructures,
    budgetMinYen, budgetMaxYen, executionMinYen, executionMaxYen,
    directMinYen, directMaxYen, totalExpenseMinYen, totalExpenseMaxYen,
  ]);

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
  const filterKey = [
    year, query, selectedMinistries.join(','), selectedAccountCategories.join(','),
    selectedStructures.join(','), filterProjectName, filterBureau,
    filterBudgetMin, filterBudgetMax, filterExecutionMin, filterExecutionMax,
    filterDirectMin, filterDirectMax, filterTotalExpenseMin, filterTotalExpenseMax,
    sortKey, sortDir,
  ].join('|');
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
    background: '#f9fafb',
    position: 'sticky',
    top: 0,
    zIndex: 2,
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
  // 数値列は列名（fontSize 11 + ↕ アイコン）が切れない最低幅を確保。
  const COL_WIDTHS: (number | null)[] = [
    56,    // PID
    null,  // 事業名 (auto, truncate)
    72,    // 省庁
    null,  // 担当組織 (auto, truncate)
    80,    // 会計区分
    88,    // 予算額
    88,    // 執行額
    104,   // 直接支出合計
    96,    // 支出額合計
    100,   // 支出計−直接
    96,    // 執行−直接
    76,    // ブロック
    80,    // 直接支出
    68,    // 再委託
    80,    // 間接経費
    68,    // 別財源
    68,    // 支出先
    56,    // 階層
    56,    // 分岐
    80,    // 最大分岐
    56,    // 合流
    80,    // 最大合流
    64,    // 構造
  ];
  const FIXED_TOTAL = COL_WIDTHS.filter((w): w is number => w !== null).reduce((s, w) => s + w, 0);
  const MIN_TABLE_WIDTH = FIXED_TOTAL + 240 * 2; // auto列を最低240pxずつ確保

  return (
    <div style={{ height: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── 上部: フィルタ群 ── */}
      <div style={{ flexShrink: 0, padding: '12px 16px', maxWidth: 1600, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* コントロール（/sankey-svg と同じトーン） */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* トップへ戻る（矢印のみ） */}
          <Link
            href="/"
            aria-label="トップへ戻る"
            title="トップへ戻る"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#666',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </Link>

          {/* 年度切替 */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
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

          {/* 検索 */}
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder="PID・事業名・省庁・ブロック・支出先で検索..."
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

          {/* フィルタ展開トグル */}
          <button
            type="button"
            onClick={() => setShowFilterPanel((v) => !v)}
            title={showFilterPanel ? 'フィルタを閉じる' : 'フィルタを開く'}
            aria-pressed={showFilterPanel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: 600,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '6px 10px',
              background: showFilterPanel ? '#f1f5f9' : 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#334155',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            フィルタ
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="currentColor"
              style={{ transform: showFilterPanel ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </button>

          <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
            {filtered.length.toLocaleString()}件表示
          </span>
        </div>

        {/* 折りたたみフィルタパネル（/sankey-svg ライク） */}
        {showFilterPanel && (
          <div style={{
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            columnGap: 16,
            rowGap: 8,
          }}>
            {/* 会計区分 */}
            <FilterRow label="会計">
              <MultiSelectDropdown
                options={['一般会計', '特別会計', '一般・特別', '区分なし']}
                selected={selectedAccountCategories}
                onChange={setSelectedAccountCategories}
                allLabel="全会計区分"
              />
            </FilterRow>

            {/* 省庁 */}
            <FilterRow label="省庁">
              <MultiSelectDropdown
                options={ministries}
                selected={selectedMinistries}
                onChange={setSelectedMinistries}
                allLabel="全府省庁"
              />
            </FilterRow>

            {/* 事業名 */}
            <FilterRow label="事業">
              <FilterTextInput value={filterProjectName} onChange={setFilterProjectName} placeholder="事業名（部分一致）" />
            </FilterRow>

            {/* 担当組織 */}
            <FilterRow label="組織">
              <FilterTextInput value={filterBureau} onChange={setFilterBureau} placeholder="担当組織（局・部・課）" />
            </FilterRow>

            {/* MinMax 4種 */}
            <FilterRow label="予算">
              <MinMaxInput minVal={filterBudgetMin} maxVal={filterBudgetMax} onMinChange={setFilterBudgetMin} onMaxChange={setFilterBudgetMax} />
            </FilterRow>
            <FilterRow label="執行">
              <MinMaxInput minVal={filterExecutionMin} maxVal={filterExecutionMax} onMinChange={setFilterExecutionMin} onMaxChange={setFilterExecutionMax} />
            </FilterRow>
            <FilterRow label="直接">
              <MinMaxInput minVal={filterDirectMin} maxVal={filterDirectMax} onMinChange={setFilterDirectMin} onMaxChange={setFilterDirectMax} />
            </FilterRow>
            <FilterRow label="支出計">
              <MinMaxInput minVal={filterTotalExpenseMin} maxVal={filterTotalExpenseMax} onMinChange={setFilterTotalExpenseMin} onMaxChange={setFilterTotalExpenseMax} />
            </FilterRow>

            {/* 構造 */}
            <FilterRow label="構造">
              <MultiSelectDropdown
                options={['別財源あり', '合流あり', '制度フローのみ']}
                selected={selectedStructures}
                onChange={setSelectedStructures}
                allLabel="すべて"
              />
            </FilterRow>
          </div>
        )}
      </div>

      {/* ── 中部: スクロールテーブル ── */}
      <div style={{ flex: 1, minHeight: 0, padding: '0 16px', maxWidth: 1600, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {loading && <p style={{ color: '#6b7280', fontSize: 14 }}>読み込み中...</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 14 }}>エラー: {error}</p>}
        {!loading && !error && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
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
      </div>

      {/* ── 下部: ページネーション ── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ flexShrink: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '8px 16px' }}>
          <div style={{ maxWidth: 1600, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
        </div>
      )}
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
