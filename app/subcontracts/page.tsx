'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import type { SubcontractGraph } from '@/types/subcontract';

type SortKey =
  | 'projectId'
  | 'budget'
  | 'execution'
  | 'totalBlockCount'
  | 'directBlockCount'
  | 'subcontractBlockCount'
  | 'indirectCostCount'
  | 'separateOriginCount'
  | 'totalRecipientCount'
  | 'branchingBlockCount'
  | 'maxBranchWidth'
  | 'mergeTargetCount'
  | 'maxMergeWidth';
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
  const [selectedMinistry, setSelectedMinistry] = useState<string>('');
  const [page, setPage] = useState(1);

  const ministries = useMemo(() => {
    const set = new Set<string>();
    for (const g of graphs) if (g.ministry) set.add(g.ministry);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
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

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return graphs.filter((g) => {
      if (selectedMinistry && g.ministry !== selectedMinistry) return false;
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
  }, [graphs, query, structureFilter, selectedMinistry]);

  function subcontractBlockCount(g: SubcontractGraph): number {
    return g.totalBlockCount - g.directBlockCount - g.separateOriginCount;
  }

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: number, vb: number;
      if (sortKey === 'projectId') { va = a.projectId; vb = b.projectId; }
      else if (sortKey === 'budget') { va = a.budget; vb = b.budget; }
      else if (sortKey === 'execution') { va = a.execution; vb = b.execution; }
      else if (sortKey === 'totalBlockCount') { va = a.totalBlockCount; vb = b.totalBlockCount; }
      else if (sortKey === 'directBlockCount') { va = a.directBlockCount; vb = b.directBlockCount; }
      else if (sortKey === 'subcontractBlockCount') { va = subcontractBlockCount(a); vb = subcontractBlockCount(b); }
      else if (sortKey === 'indirectCostCount') { va = a.indirectCosts.length; vb = b.indirectCosts.length; }
      else if (sortKey === 'separateOriginCount') { va = a.separateOriginCount; vb = b.separateOriginCount; }
      else if (sortKey === 'branchingBlockCount') { va = a.branchingBlockCount; vb = b.branchingBlockCount; }
      else if (sortKey === 'maxBranchWidth') { va = a.maxBranchWidth; vb = b.maxBranchWidth; }
      else if (sortKey === 'mergeTargetCount') { va = a.mergeTargetCount; vb = b.mergeTargetCount; }
      else if (sortKey === 'maxMergeWidth') { va = a.maxMergeWidth; vb = b.maxMergeWidth; }
      else { va = a.totalRecipientCount; vb = b.totalRecipientCount; }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [filtered, sortKey, sortDir]);

  // フィルタ・ソート・年度変更時はページ1へ戻す
  const filterKey = `${year}|${selectedMinistry}|${structureFilter}|${query}|${sortKey}|${sortDir}`;
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
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
  };

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
            <select
              value={year}
              onChange={(e) => { const y = Number(e.target.value); setYear(y); router.replace(`/subcontracts?year=${y}`); }}
              style={{ marginLeft: 8, padding: '4px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff', cursor: 'pointer' }}
            >
              <option value={2025}>2025年度</option>
              <option value={2024}>2024年度</option>
            </select>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 0 }}>
            {graphs.length.toLocaleString()}事業 ／ 別財源 {totalSeparateOrigin.toLocaleString()} ／ 合流 {totalMerge.toLocaleString()} ／ 制度フロー {totalInstitutional.toLocaleString()}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '12px 16px' }}>
        {/* コントロール */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="事業名・PID・府省庁・ブロック名・支出先名で検索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: 260,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 13,
              background: '#fff',
            }}
          />
          <select
            value={selectedMinistry}
            onChange={(e) => setSelectedMinistry(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff', cursor: 'pointer' }}
          >
            <option value="">全府省庁</option>
            {ministries.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {filtered.length.toLocaleString()}件表示
          </span>
        </div>

        {/* 構造フィルタ */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginRight: 4 }}>構造:</span>
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

        {/* テーブル */}
        {loading && <p style={{ color: '#6b7280', fontSize: 14 }}>読み込み中...</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 14 }}>エラー: {error}</p>}
        {!loading && !error && (
          <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('projectId')}>
                    PID <SortIndicator k="projectId" />
                  </th>
                  <th style={{ ...thStyle, minWidth: 200 }}>事業名</th>
                  <th style={thStyle}>府省庁</th>
                  <th style={thStyle} onClick={() => toggleSort('budget')}>
                    予算額 <SortIndicator k="budget" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('execution')}>
                    執行額 <SortIndicator k="execution" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('totalBlockCount')}>
                    ブロック数 <SortIndicator k="totalBlockCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('directBlockCount')}>
                    直接支出数 <SortIndicator k="directBlockCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('subcontractBlockCount')}>
                    再委託数 <SortIndicator k="subcontractBlockCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('indirectCostCount')}>
                    間接経費数 <SortIndicator k="indirectCostCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('separateOriginCount')}>
                    別財源数 <SortIndicator k="separateOriginCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('totalRecipientCount')}>
                    支出先数 <SortIndicator k="totalRecipientCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('branchingBlockCount')}>
                    分岐数 <SortIndicator k="branchingBlockCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('maxBranchWidth')}>
                    最大分岐 <SortIndicator k="maxBranchWidth" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('mergeTargetCount')}>
                    合流数 <SortIndicator k="mergeTargetCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('maxMergeWidth')}>
                    最大合流 <SortIndicator k="maxMergeWidth" />
                  </th>
                  <th style={thStyle}>構造</th>
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
                    <td style={{ padding: '8px 10px', color: '#6b7280' }}>{g.projectId}</td>
                    <td style={{ padding: '8px 10px', maxWidth: 280, minWidth: 200 }}>
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
                    <td style={{ padding: '8px 10px', color: '#374151', whiteSpace: 'nowrap' }}>{g.ministry}</td>
                    <td style={{ padding: '8px 10px', color: '#374151', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {g.budget > 0 ? formatYen(g.budget) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#374151', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {g.execution > 0 ? formatYen(g.execution) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{g.totalBlockCount}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.directBlockCount > 0 ? g.directBlockCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {subcontractBlockCount(g) > 0 ? subcontractBlockCount(g) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.indirectCosts.length > 0 ? g.indirectCosts.length.toLocaleString() : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.separateOriginCount > 0 ? g.separateOriginCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{g.totalRecipientCount.toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.branchingBlockCount > 0 ? g.branchingBlockCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.maxBranchWidth >= 2 ? g.maxBranchWidth : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.mergeTargetCount > 0 ? g.mergeTargetCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {g.maxMergeWidth >= 2 ? g.maxMergeWidth : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {g.isInstitutionalFlowOnly ? (
                        <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#991b1b' }}>
                          制度フロー
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
