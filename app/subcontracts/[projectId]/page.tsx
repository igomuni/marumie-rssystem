'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SubcontractGraph, BlockNode, BlockRecipient } from '@/types/subcontract';
import {
  computeSubcontractLayout,
  bezierPath,
  formatYen,
  COLOR_DIRECT,
  COLOR_SUBCONTRACT,
  COLOR_ROOT,
  COLOR_EDGE,
  NODE_W,
  NODE_PAD,
} from '@/app/lib/subcontract-layout';

const RECIPIENT_TOP_N = 5;

// ─── ブロックパネル ──────────────────────────────────────────────

function BlockPanel({ block, onClose }: { block: BlockNode; onClose: () => void }) {
  const [expandedRecipients, setExpandedRecipients] = useState<Set<number>>(new Set());

  function toggleRecipient(i: number) {
    setExpandedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, right: 0,
      width: 360,
      height: '100vh',
      background: '#fff',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
      overflowY: 'auto',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        position: 'sticky',
        top: 0,
        background: '#fff',
        zIndex: 1,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            background: block.isDirect ? '#dbeafe' : '#ffedd5',
            color: block.isDirect ? '#1d4ed8' : '#c2410c',
            marginBottom: 4,
          }}>
            {block.isDirect ? '直接支出' : '再委託'}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{block.blockName}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            ブロック {block.blockId} ／ {formatYen(block.totalAmount)}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280', fontSize: 18 }}
          aria-label="閉じる"
        >✕</button>
      </div>

      {/* 支出先リスト */}
      <div style={{ padding: 12, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          支出先 ({block.recipients.length}件)
        </div>
        {block.recipients.map((r, i) => (
          <RecipientCard
            key={i}
            recipient={r}
            index={i}
            expanded={expandedRecipients.has(i)}
            onToggle={() => toggleRecipient(i)}
          />
        ))}
        {block.recipients.length === 0 && (
          <p style={{ fontSize: 12, color: '#9ca3af' }}>支出先データなし</p>
        )}
      </div>
    </div>
  );
}

function RecipientCard({
  recipient, index, expanded, onToggle,
}: {
  recipient: BlockRecipient;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = recipient.contractSummaries.length > 0 || recipient.expenses.length > 0;

  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 12,
    }}>
      <div
        style={{
          padding: '8px 10px',
          background: index % 2 === 0 ? '#f9fafb' : '#fff',
          cursor: hasDetails ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
        }}
        onClick={hasDetails ? onToggle : undefined}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, color: '#111827' }}>{recipient.name || '（氏名なし）'}</div>
          <div style={{ color: '#6b7280', marginTop: 2 }}>{formatYen(recipient.amount)}</div>
          {recipient.corporateNumber && (
            <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 1 }}>法人番号: {recipient.corporateNumber}</div>
          )}
        </div>
        {hasDetails && (
          <span style={{ color: '#9ca3af', fontSize: 14, marginTop: 2 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '8px 10px', background: '#f0f9ff', borderTop: '1px solid #e0f2fe' }}>
          {recipient.contractSummaries.map((cs, j) => (
            <div key={j} style={{ color: '#0c4a6e', marginBottom: 4 }}>📋 {cs}</div>
          ))}
          {recipient.expenses.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>費目・使途</div>
              {recipient.expenses.map((e, j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: '#374151', gap: 8 }}>
                  <span style={{ color: '#6b7280' }}>{e.category} / {e.purpose}</span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatYen(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── メインページ ──────────────────────────────────────────────

function SubcontractDetailPageInner() {
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const projectId = params.projectId;
  const year = parseInt(searchParams.get('year') ?? '2024', 10);

  const [graph, setGraph] = useState<SubcontractGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockNode | null>(null);

  // ズーム/パン
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedBlock(null);
    fetch(`/api/subcontracts/${projectId}?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SubcontractGraph) => {
        setGraph(data);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [projectId, year]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setTransform((prev) => {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(10, Math.max(0.1, prev.scale * factor));
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return {
        scale: newScale,
        x: cx - (cx - prev.x) * (newScale / prev.scale),
        y: cy - (cy - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  useEffect(() => {
    if (!graph) return; // SVGがレンダリングされるまで待つ
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel, graph]);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!isPanning.current) return;
    setTransform((prev) => ({ ...prev, x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }));
  }
  function onMouseUp() { isPanning.current = false; }

  // Hooks はすべて early return より前に呼ぶ必要がある
  const layout = useMemo(() => graph ? computeSubcontractLayout(graph) : null, [graph]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <p style={{ color: '#6b7280' }}>読み込み中...</p>
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', gap: 12 }}>
        <p style={{ color: '#ef4444' }}>エラー: {error ?? 'データなし'}</p>
        <Link href="/subcontracts" style={{ color: '#2563eb', fontSize: 14 }}>← 一覧に戻る</Link>
      </div>
    );
  }

  // ここに到達した時点で graph は必ず非 null
  const safeLayout = layout!;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f1f5f9', overflow: 'hidden' }}>
      {/* ヘッダーバー */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        zIndex: 10,
      }}>
        <Link href={`/subcontracts?year=${year}`} style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          ← 一覧
        </Link>

        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 6 }}>PID {graph.projectId}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{graph.projectName}</span>
          <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>{graph.ministry}</span>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280', flexWrap: 'wrap' }}>
          <span>予算: <strong style={{ color: '#111827' }}>{graph.budget > 0 ? formatYen(graph.budget) : '—'}</strong></span>
          <span>執行: <strong style={{ color: '#111827' }}>{graph.execution > 0 ? formatYen(graph.execution) : '—'}</strong></span>
          <span>最大{graph.maxDepth}層</span>
          <span>ブロック {graph.totalBlockCount}</span>
          <span>支出先 {graph.totalRecipientCount.toLocaleString()}</span>
        </div>

        {/* 年度切替 */}
        <select
          value={year}
          onChange={(e) => router.push(`/subcontracts/${projectId}?year=${e.target.value}`)}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, background: '#fff' }}
        >
          <option value={2024}>2024年度</option>
          <option value={2025}>2025年度</option>
        </select>

        <button
          onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
          style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, background: '#fff', cursor: 'pointer' }}
        >
          リセット
        </button>
      </div>

      {/* 凡例 */}
      <div style={{ padding: '6px 16px', background: '#fff', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 16, fontSize: 11, color: '#6b7280' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: COLOR_DIRECT, display: 'inline-block' }} />
          直接支出ブロック
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: COLOR_SUBCONTRACT, display: 'inline-block' }} />
          再委託ブロック
        </span>
        <span style={{ color: '#9ca3af' }}>ブロックをクリックで詳細表示 ／ ホイールでズーム ／ ドラッグでパン</span>
      </div>

      {/* SVGキャンバス */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ cursor: isPanning.current ? 'grabbing' : 'grab', display: 'block' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
            {/* エッジ */}
            {safeLayout.edges.map((edge, i) => (
              <path
                key={i}
                d={bezierPath(edge.x1, edge.y1, edge.x2, edge.y2)}
                fill="none"
                stroke={COLOR_EDGE}
                strokeWidth={2}
              />
            ))}

            {/* エッジラベル */}
            {safeLayout.edges.map((edge, i) =>
              edge.note ? (
                <text
                  key={`note-${i}`}
                  x={(edge.x1 + edge.x2) / 2}
                  y={(edge.y1 + edge.y2) / 2 - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#94a3b8"
                >
                  {edge.note}
                </text>
              ) : null
            )}

            {/* 担当組織ルートノード */}
            <g>
              <rect
                x={safeLayout.root.x}
                y={safeLayout.root.y}
                width={safeLayout.root.w}
                height={safeLayout.root.h}
                rx={6}
                fill={COLOR_ROOT}
              />
              <text
                x={safeLayout.root.x + safeLayout.root.w / 2}
                y={safeLayout.root.y + safeLayout.root.h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={600}
                fill="#fff"
              >
                {graph.ministry}
              </text>
            </g>

            {/* ブロックノード */}
            {safeLayout.blocks.map((lb) => {
              const isAmbiguous = lb.node.recipients.length >= 2 && safeLayout.edges.some((e) => e.sourceBlock === lb.blockId);
              const nodeColor = lb.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT;
              const topRecipients = lb.node.recipients.slice(0, RECIPIENT_TOP_N);
              const remaining = lb.node.recipients.length - RECIPIENT_TOP_N;

              return (
                <g
                  key={lb.blockId}
                  onClick={() => setSelectedBlock(lb.node)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={lb.x}
                    y={lb.y}
                    width={lb.w}
                    height={lb.h}
                    rx={5}
                    fill={nodeColor}
                    fillOpacity={0.85}
                    stroke={isAmbiguous ? '#dc2626' : 'transparent'}
                    strokeWidth={isAmbiguous ? 1.5 : 0}
                    strokeDasharray={isAmbiguous ? '4 2' : undefined}
                  />

                  {/* ブロック名 */}
                  <text
                    x={lb.x + NODE_PAD}
                    y={lb.y + 13}
                    fontSize={10}
                    fontWeight={700}
                    fill="#fff"
                    style={{ pointerEvents: 'none' }}
                  >
                    {lb.blockId}: {lb.blockName.length > 20 ? lb.blockName.slice(0, 20) + '…' : lb.blockName}
                  </text>

                  {/* 金額 */}
                  <text
                    x={lb.x + NODE_W - NODE_PAD}
                    y={lb.y + 13}
                    fontSize={10}
                    fill="rgba(255,255,255,0.85)"
                    textAnchor="end"
                    style={{ pointerEvents: 'none' }}
                  >
                    {formatYen(lb.totalAmount)}
                  </text>

                  {/* 支出先上位N件 */}
                  {lb.h > 36 && topRecipients.map((r, ri) => (
                    <text
                      key={ri}
                      x={lb.x + NODE_PAD}
                      y={lb.y + 26 + ri * 13}
                      fontSize={9}
                      fill="rgba(255,255,255,0.75)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {r.name.length > 22 ? r.name.slice(0, 22) + '…' : r.name}
                    </text>
                  ))}

                  {lb.h > 36 && remaining > 0 && (
                    <text
                      x={lb.x + NODE_PAD}
                      y={lb.y + 26 + RECIPIENT_TOP_N * 13}
                      fontSize={9}
                      fill="rgba(255,255,255,0.55)"
                      style={{ pointerEvents: 'none' }}
                    >
                      他{remaining}社
                    </text>
                  )}

                  {/* 委託元不特定バッジ */}
                  {isAmbiguous && (
                    <text
                      x={lb.x + lb.w - NODE_PAD}
                      y={lb.y + lb.h - 6}
                      textAnchor="end"
                      fontSize={8}
                      fill="#fca5a5"
                      style={{ pointerEvents: 'none' }}
                    >
                      委託元不特定
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* 詳細パネル */}
        {selectedBlock && (
          <BlockPanel block={selectedBlock} onClose={() => setSelectedBlock(null)} />
        )}
      </div>
    </div>
  );
}

export default function SubcontractDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <SubcontractDetailPageInner />
    </Suspense>
  );
}
