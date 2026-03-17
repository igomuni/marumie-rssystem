'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Sankey2LayoutData, LayoutNode, LayoutEdge } from '@/client/components/Sankey2/types';

// ─── 定数 ──────────────────────────────────────────────

/** typeごとの色 */
const TYPE_COLORS: Record<string, string> = {
  'total':            '#6b7280', // gray-500
  'ministry':         '#3b82f6', // blue-500
  'project-budget':   '#22c55e', // green-500
  'project-spending': '#f97316', // orange-500
  'recipient':        '#ef4444', // red-500
};

/** typeの日本語表示名 */
const TYPE_LABELS: Record<string, string> = {
  'total':            '予算総計',
  'ministry':         '府省庁',
  'project-budget':   '事業（予算）',
  'project-spending': '事業（支出）',
  'recipient':        '支出先',
};

/** 面積ベースLOD: スクリーン上でこの面積(px²)未満のノードは描画しない */
const MIN_SCREEN_AREA = 1;

/** 面積ベースLOD: スクリーン上でこの面積(px²)以上ならラベル表示 */
const LABEL_SCREEN_AREA = 400; // ~20×20px

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 100;
const ZOOM_SENSITIVITY = 0.002;

/** ビューポート外のマージン（px、仮想座標系） */
const VIEWPORT_MARGIN = 100;

/** サイドパネル幅 */
const PANEL_WIDTH = 320;

/** BFS最大ホップ数（Shift押下時） */
const BFS_MAX_DEPTH = 3;

/** ホップ距離に応じたopacity */
const DEPTH_OPACITY = [1.0, 0.8, 0.5, 0.3];

/** サイドパネルの接続先表示上限 */
const PANEL_MAX_CONNECTIONS = 20;

/** Minimap設定 */
const MINIMAP_WIDTH = 200;
const MINIMAP_PADDING = 12;

/** 検索デバウンス(ms) */
const SEARCH_DEBOUNCE = 150;

/** 検索候補の最大表示数 */
const SEARCH_MAX_RESULTS = 20;

/** 金額スライダーの対数スケール範囲 (10^4 = 1万 〜 10^14 = 100兆) */
const MIN_AMOUNT_LOG_MIN = 4;
const MIN_AMOUNT_LOG_MAX = 14;

// ─── 型 ──────────────────────────────────────────────────

interface EdgeIndex {
  bySource: Map<string, LayoutEdge[]>;
  byTarget: Map<string, LayoutEdge[]>;
}

// ─── ユーティリティ ──────────────────────────────────────

/** 金額フォーマット */
function formatAmount(amount: number): string {
  if (amount >= 1e12) return `${(amount / 1e12).toFixed(1)}兆円`;
  if (amount >= 1e8) return `${(amount / 1e8).toFixed(0)}億円`;
  if (amount >= 1e4) return `${(amount / 1e4).toFixed(0)}万円`;
  return `${amount.toLocaleString()}円`;
}

/** polyline points文字列を生成 */
function pathToPolyline(path: [number, number][]): string {
  return path.map(([x, y]) => `${x},${y}`).join(' ');
}

/** BFS探索: startIdから上流・下流をmaxDepthホップまで探索 */
function bfsHighlight(
  startId: string,
  edgeIndex: EdgeIndex,
  maxDepth: number,
): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue: [string, number][] = [[startId, 0]];

  while (queue.length > 0) {
    const [nodeId, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const edge of edgeIndex.bySource.get(nodeId) ?? []) {
      if (!distances.has(edge.target)) {
        distances.set(edge.target, depth + 1);
        queue.push([edge.target, depth + 1]);
      }
    }
    for (const edge of edgeIndex.byTarget.get(nodeId) ?? []) {
      if (!distances.has(edge.source)) {
        distances.set(edge.source, depth + 1);
        queue.push([edge.source, depth + 1]);
      }
    }
  }
  return distances;
}

// ─── コンポーネント ──────────────────────────────────────

interface Props {
  data: Sankey2LayoutData | null;
}

export default function Sankey2View({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // Transform state: pan + zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.15 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Hover / Selection state
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  // コンテナサイズ
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // ── フィルタ・検索 state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [ministryFilter, setMinistryFilter] = useState<Set<string>>(new Set());
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [minAmount, setMinAmount] = useState(0);
  const [maxAmount, setMaxAmount] = useState(Infinity);
  const [labelFilter, setLabelFilter] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const urlUpdateRef = useRef(false);

  // ── エッジインデックス（O(1)接続検索） ──

  const edgeIndex = useMemo<EdgeIndex>(() => {
    if (!data) return { bySource: new Map(), byTarget: new Map() };
    const bySource = new Map<string, LayoutEdge[]>();
    const byTarget = new Map<string, LayoutEdge[]>();
    for (const edge of data.edges) {
      let s = bySource.get(edge.source);
      if (!s) { s = []; bySource.set(edge.source, s); }
      s.push(edge);
      let t = byTarget.get(edge.target);
      if (!t) { t = []; byTarget.set(edge.target, t); }
      t.push(edge);
    }
    return { bySource, byTarget };
  }, [data]);

  // ── ノードMap ──

  const nodeMap = useMemo(() => {
    if (!data) return new Map<string, LayoutNode>();
    const m = new Map<string, LayoutNode>();
    for (const node of data.nodes) m.set(node.id, node);
    return m;
  }, [data]);

  // ── stable hover handlers (4-4メモ化) ──

  const hoverHandlers = useMemo(() => {
    if (!data) return new Map<string, { start: () => void; end: () => void }>();
    const map = new Map<string, { start: () => void; end: () => void }>();
    for (const node of data.nodes) {
      map.set(node.id, {
        start: () => setHoveredNodeId(node.id),
        end: () => setHoveredNodeId(null),
      });
    }
    return map;
  }, [data]);

  // ── 府省庁リスト（金額降順） ──

  const ministryList = useMemo(() => {
    if (!data) return [];
    return data.nodes
      .filter(n => n.type === 'ministry')
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  // ── フィルタ状態の集計 ──

  const activeFilterCount = (ministryFilter.size > 0 ? 1 : 0) + (minAmount > 0 ? 1 : 0) + (maxAmount < Infinity ? 1 : 0) + (labelFilter ? 1 : 0);
  const hasActiveFilter = activeFilterCount > 0;

  // ── URLパラメータからの初期復元 ──

  useEffect(() => {
    if (!data) return;
    const m = searchParams.get('m');
    const min = searchParams.get('min');
    const max = searchParams.get('max');
    const l = searchParams.get('l');
    const q = searchParams.get('q');
    const s = searchParams.get('s');

    if (m) setMinistryFilter(new Set(m.split(',')));
    if (min) setMinAmount(Number(min) || 0);
    if (max) setMaxAmount(Number(max) || Infinity);
    if (l) setLabelFilter(l);
    if (q) { setSearchQuery(q); setDebouncedQuery(q); }
    if (s) setSelectedNodeId(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── 検索デバウンス ──

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── URLパラメータ同期 ──

  useEffect(() => {
    if (!data || urlUpdateRef.current) { urlUpdateRef.current = false; return; }
    const params = new URLSearchParams();
    if (ministryFilter.size > 0) params.set('m', [...ministryFilter].join(','));
    if (minAmount > 0) params.set('min', String(minAmount));
    if (maxAmount < Infinity) params.set('max', String(maxAmount));
    if (labelFilter) params.set('l', labelFilter);
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (selectedNodeId) params.set('s', selectedNodeId);

    const str = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (str !== current) {
      router.replace(str ? `?${str}` : window.location.pathname, { scroll: false });
    }
  }, [data, ministryFilter, minAmount, maxAmount, labelFilter, debouncedQuery, selectedNodeId, router]);

  // ── 検索結果 ──

  const searchResults = useMemo(() => {
    if (!data || debouncedQuery.length < 2) return [];
    const q = debouncedQuery;
    return data.nodes
      .filter(n => n.label.includes(q))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, SEARCH_MAX_RESULTS);
  }, [data, debouncedQuery]);

  // ── Shiftキー追跡 ──

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setIsShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setIsShiftHeld(false); };
    const blur = () => setIsShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ── Escキーで選択解除・パネル閉じ ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSearchResults) { setShowSearchResults(false); return; }
        if (showFilterPanel) { setShowFilterPanel(false); return; }
        setSelectedNodeId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSearchResults, showFilterPanel]);

  // ── コンテナサイズをResizeObserverで追跡 ──

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 初期表示: データの中央にフィット
  useEffect(() => {
    if (!data || !containerRef.current) return;
    const { totalWidth, totalHeight } = data.metadata.layout;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    setContainerSize({ w: cw, h: ch });

    const scaleX = cw / totalWidth;
    const scaleY = ch / totalHeight;
    const k = Math.min(scaleX, scaleY) * 0.9;

    const tx = (cw - totalWidth * k) / 2;
    const ty = (ch - totalHeight * k) / 2;

    setTransform({ x: tx, y: ty, k });
  }, [data]);

  // ── 面積ベースLOD + ビューポートカリング ──

  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (!data) return { visibleNodes: [], visibleEdges: [] };

    const { k, x: tx, y: ty } = transform;
    const { w: cw, h: ch } = containerSize;
    const k2 = k * k;
    const hasMinistryFilter = ministryFilter.size > 0;

    const vpLeft   = (-tx / k) - VIEWPORT_MARGIN;
    const vpTop    = (-ty / k) - VIEWPORT_MARGIN;
    const vpRight  = (cw - tx) / k + VIEWPORT_MARGIN;
    const vpBottom = (ch - ty) / k + VIEWPORT_MARGIN;

    const nodeSet = new Set<string>();
    const filteredNodes: LayoutNode[] = [];

    for (const node of data.nodes) {
      // 金額閾値フィルタ（totalは常に表示）
      if (node.type !== 'total') {
        if (minAmount > 0 && node.amount < minAmount) continue;
        if (maxAmount < Infinity && node.amount > maxAmount) continue;
      }

      // ノード名フィルタ
      if (labelFilter && !node.label.includes(labelFilter)) continue;

      // 府省庁フィルタ
      if (hasMinistryFilter) {
        if (node.type === 'ministry') {
          if (!ministryFilter.has(node.label)) continue;
        } else if (node.type !== 'total') {
          if (!node.ministry || !ministryFilter.has(node.ministry)) continue;
        }
      }

      // 面積ベースLOD
      const screenArea = (node.area ?? node.width * node.height) * k2;
      if (screenArea < MIN_SCREEN_AREA) continue;

      // ビューポートカリング
      if (node.x + node.width < vpLeft || node.x > vpRight) continue;
      if (node.y + node.height < vpTop || node.y > vpBottom) continue;

      nodeSet.add(node.id);
      filteredNodes.push(node);
    }

    const filteredEdges: LayoutEdge[] = [];
    for (const edge of data.edges) {
      if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
        filteredEdges.push(edge);
      }
    }

    return { visibleNodes: filteredNodes, visibleEdges: filteredEdges };
  }, [data, transform, containerSize, ministryFilter, minAmount, maxAmount, labelFilter]);

  // ── ハイライト: BFS or 1-hop ──

  const activeNodeId = selectedNodeId ?? hoveredNodeId;

  const highlightMap = useMemo(() => {
    if (!activeNodeId) return new Map<string, number>();
    const maxDepth = isShiftHeld ? BFS_MAX_DEPTH : 1;
    return bfsHighlight(activeNodeId, edgeIndex, maxDepth);
  }, [activeNodeId, edgeIndex, isShiftHeld]);

  const isHighlighting = highlightMap.size > 0;

  // ── ノードクリック ──

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(prev => prev === nodeId ? null : nodeId);
  }, []);

  // ── パネル内接続先クリック → 選択切替 + ズーム移動 ──

  const handlePanelNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowSearchResults(false);
    const node = nodeMap.get(nodeId);
    if (!node || !containerRef.current) return;
    const cw = containerRef.current.clientWidth - (selectedNodeId ? PANEL_WIDTH : 0);
    const ch = containerRef.current.clientHeight;
    const targetK = Math.max(transform.k, 0.5);
    setTransform({
      x: cw / 2 - (node.x + node.width / 2) * targetK,
      y: ch / 2 - (node.y + node.height / 2) * targetK,
      k: targetK,
    });
  }, [nodeMap, transform.k, selectedNodeId]);

  // ── Wheel zoom ──

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      setTransform(prev => {
        const factor = 1 - e.deltaY * ZOOM_SENSITIVITY;
        const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor));
        const ratio = newK / prev.k;

        return {
          x: mx - (mx - prev.x) * ratio,
          y: my - (my - prev.y) * ratio,
          k: newK,
        };
      });
    };

    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [data]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // ── SVG背景クリックで選択解除 ──

  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('bg-rect')) {
      setSelectedNodeId(null);
    }
  }, []);

  // ── Minimap描画 ──

  const minimapHeight = useMemo(() => {
    if (!data) return 0;
    const { totalWidth, totalHeight } = data.metadata.layout;
    return Math.round(MINIMAP_WIDTH * (totalHeight / totalWidth));
  }, [data]);

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { totalWidth, totalHeight } = data.metadata.layout;
    const scale = MINIMAP_WIDTH / totalWidth;

    ctx.clearRect(0, 0, MINIMAP_WIDTH, minimapHeight);

    // クラスタ背景
    const { clusterWidth, clusterHeight, clusterGap } = data.metadata.layout;
    for (let i = 0; i < 5; i++) {
      const cx = (clusterWidth + clusterGap) * i * scale;
      const cw = clusterWidth * scale;
      const ch = clusterHeight * scale;
      ctx.fillStyle = 'rgba(100, 116, 139, 0.15)';
      ctx.fillRect(cx, 0, cw, ch);
    }

    // ビューポート矩形
    const { k, x: tx, y: ty } = transform;
    const { w: cw, h: ch } = containerSize;
    const vpX = (-tx / k) * scale;
    const vpY = (-ty / k) * scale;
    const vpW = (cw / k) * scale;
    const vpH = (ch / k) * scale;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.max(0, vpX),
      Math.max(0, vpY),
      Math.min(vpW, totalWidth * scale - Math.max(0, vpX)),
      Math.min(vpH, totalHeight * scale - Math.max(0, vpY)),
    );
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fillRect(
      Math.max(0, vpX),
      Math.max(0, vpY),
      Math.min(vpW, totalWidth * scale - Math.max(0, vpX)),
      Math.min(vpH, totalHeight * scale - Math.max(0, vpY)),
    );
  }, [data, transform, containerSize, minimapHeight]);

  // ── Minimapクリック → ビューポート移動 ──

  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { totalWidth } = data.metadata.layout;
    const scale = MINIMAP_WIDTH / totalWidth;
    const { w: cw, h: ch } = containerSize;
    const { k } = transform;

    const worldX = mx / scale;
    const worldY = my / scale;

    setTransform(prev => ({
      ...prev,
      x: cw / 2 - worldX * k,
      y: ch / 2 - worldY * k,
    }));
  }, [data, containerSize, transform]);

  // ── 描画 ──

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400 text-lg">読み込み中...</div>
      </div>
    );
  }

  const k2 = transform.k * transform.k;
  const showPanel = selectedNodeId !== null;
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : undefined;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-gray-50 dark:bg-gray-950 select-none flex"
    >
      {/* SVG領域 */}
      <div
        className="relative flex-1 h-full overflow-hidden"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {/* ヘッダー情報 + 検索 + フィルタ */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-2" style={{ maxWidth: 320 }}>
          {/* 統計情報 */}
          <div className="bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-2 text-xs text-gray-600 dark:text-gray-300 shadow-sm backdrop-blur-sm">
            <div className="font-semibold mb-1">/sankey2 予算フロー</div>
            <div>描画: {visibleNodes.length.toLocaleString()} nodes / {visibleEdges.length.toLocaleString()} edges</div>
            <div>Zoom: {(transform.k * 100).toFixed(0)}%</div>
            {isShiftHeld && <div className="text-blue-500 font-semibold mt-1">Shift: BFS {BFS_MAX_DEPTH}ホップ</div>}
            {minAmount > 0 && <div className="text-orange-500 mt-0.5">最小金額: {formatAmount(minAmount)}</div>}
            {maxAmount < Infinity && <div className="text-orange-500 mt-0.5">最大金額: {formatAmount(maxAmount)}</div>}
            {labelFilter && <div className="text-green-500 mt-0.5">名前: &quot;{labelFilter}&quot;</div>}
            {ministryFilter.size > 0 && <div className="text-blue-500 mt-0.5">府省庁: {ministryFilter.size}件選択</div>}
          </div>

          {/* 検索バー */}
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setShowSearchResults(true); }}
              onFocus={() => { if (debouncedQuery.length >= 2) setShowSearchResults(true); }}
              placeholder="ノード検索（2文字以上）"
              className="w-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-400"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setDebouncedQuery(''); setShowSearchResults(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >✕</button>
            )}
            {/* 検索結果ドロップダウン */}
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
                {searchResults.map(node => (
                  <button
                    key={node.id}
                    onClick={() => {
                      setShowSearchResults(false);
                      handlePanelNodeClick(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm"
                  >
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: TYPE_COLORS[node.type] || '#999' }} />
                    <span className="truncate flex-1 text-gray-800 dark:text-gray-200">{node.label}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatAmount(node.amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* フィルタボタン群 */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowFilterPanel(prev => !prev)}
              className={`text-xs px-2.5 py-1.5 rounded-lg shadow-sm backdrop-blur-sm border transition-colors flex items-center gap-1 ${
                hasActiveFilter
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              フィルタ{hasActiveFilter ? ` (${activeFilterCount})` : ''}
            </button>
            {hasActiveFilter && (
              <button
                onClick={() => { setMinistryFilter(new Set()); setMinAmount(0); setMaxAmount(Infinity); setLabelFilter(''); }}
                className="text-xs px-2 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 text-red-500 border border-gray-200 dark:border-gray-700 shadow-sm backdrop-blur-sm hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                リセット
              </button>
            )}
          </div>

          {/* フィルタパネル */}
          {showFilterPanel && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3 max-h-[70vh] overflow-y-auto">
              {/* 金額範囲スライダー */}
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">金額範囲</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  最小: {minAmount > 0 ? formatAmount(minAmount) : 'なし'}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minAmount <= 0 ? 0 : ((Math.log10(minAmount) - MIN_AMOUNT_LOG_MIN) / (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN)) * 100}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setMinAmount(v <= 0 ? 0 : Math.pow(10, MIN_AMOUNT_LOG_MIN + (v / 100) * (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN)));
                  }}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5 mb-2">
                  <span>なし</span>
                  <span>1億</span>
                  <span>100兆</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  最大: {maxAmount < Infinity ? formatAmount(maxAmount) : 'なし'}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={maxAmount >= Infinity ? 100 : ((Math.log10(maxAmount) - MIN_AMOUNT_LOG_MIN) / (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN)) * 100}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setMaxAmount(v >= 100 ? Infinity : Math.pow(10, MIN_AMOUNT_LOG_MIN + (v / 100) * (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN)));
                  }}
                  className="w-full h-1.5 accent-orange-500"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>1万</span>
                  <span>1億</span>
                  <span>なし</span>
                </div>
              </div>

              {/* ノード名フィルタ */}
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">ノード名フィルタ</div>
                <input
                  type="text"
                  value={labelFilter}
                  onChange={e => setLabelFilter(e.target.value)}
                  placeholder="含む文字列..."
                  className="w-full text-xs bg-gray-50 dark:bg-gray-700 rounded px-2 py-1.5 border border-gray-200 dark:border-gray-600 outline-none focus:ring-1 focus:ring-blue-400 text-gray-800 dark:text-gray-200"
                />
              </div>

              {/* 府省庁フィルタ */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">府省庁</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setMinistryFilter(new Set(ministryList.map(n => n.label)))}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >全選択</button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setMinistryFilter(new Set())}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >全解除</button>
                  </div>
                </div>
                <div className="space-y-0.5">
                  {ministryList.map(m => (
                    <label key={m.id} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ministryFilter.has(m.label)}
                        onChange={e => {
                          setMinistryFilter(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m.label); else next.delete(m.label);
                            return next;
                          });
                        }}
                        className="accent-blue-500"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{m.label}</span>
                      <span className="text-[10px] text-gray-400">{formatAmount(m.amount)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 凡例 */}
        <div className="absolute top-3 right-3 z-10 bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 mb-0.5 last:mb-0">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-gray-700 dark:text-gray-300">{TYPE_LABELS[type] ?? type}</span>
            </div>
          ))}
        </div>

        {/* Minimap */}
        <div
          className="absolute z-10 bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm overflow-hidden"
          style={{ bottom: MINIMAP_PADDING, left: MINIMAP_PADDING }}
        >
          <canvas
            ref={minimapCanvasRef}
            width={MINIMAP_WIDTH}
            height={minimapHeight}
            className="cursor-crosshair block"
            onClick={handleMinimapClick}
          />
        </div>

        <svg
          ref={svgRef}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleSvgClick}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {/* エッジ描画 */}
            <g className="edges">
              {visibleEdges.map((edge, i) => {
                const srcDist = highlightMap.get(edge.source);
                const tgtDist = highlightMap.get(edge.target);
                const edgeConnected = srcDist !== undefined && tgtDist !== undefined;
                const edgeDepth = edgeConnected ? Math.max(srcDist, tgtDist) : -1;

                return (
                  <MemoEdgeLine
                    key={`${edge.source}-${edge.target}-${i}`}
                    edge={edge}
                    isHighlighting={isHighlighting}
                    isConnected={edgeConnected}
                    depthOpacity={edgeConnected ? (DEPTH_OPACITY[edgeDepth] ?? 0.3) : 0}
                  />
                );
              })}
            </g>

            {/* ノード矩形 */}
            <g className="node-rects">
              {visibleNodes.map(node => {
                const depth = highlightMap.get(node.id);
                const handlers = hoverHandlers.get(node.id);
                return (
                  <MemoNodeRect
                    key={node.id}
                    node={node}
                    zoom={transform.k}
                    isHighlighting={isHighlighting}
                    isConnected={depth !== undefined}
                    isHovered={hoveredNodeId === node.id}
                    isSelected={selectedNodeId === node.id}
                    depthOpacity={depth !== undefined ? (DEPTH_OPACITY[depth] ?? 0.3) : 0}
                    onHoverStart={handlers?.start ?? noop}
                    onHoverEnd={handlers?.end ?? noop}
                    onClick={handleNodeClick}
                  />
                );
              })}
            </g>

            {/* ラベル */}
            <g className="node-labels">
              {visibleNodes.map(node => {
                const screenArea = (node.area ?? node.width * node.height) * k2;
                if (screenArea < LABEL_SCREEN_AREA) return null;

                const screenW = node.width * transform.k;
                const screenH = node.height * transform.k;
                if (screenW < 20 || screenH < 10) return null;

                const fontSize = Math.min(node.height * 0.25, node.width * 0.18, 150);
                if (fontSize * transform.k < 6) return null;

                const depth = highlightMap.get(node.id);
                const opacity = isHighlighting
                  ? (depth !== undefined ? (DEPTH_OPACITY[depth] ?? 0.3) : 0.08)
                  : 1;

                const text = (hoveredNodeId === node.id || selectedNodeId === node.id)
                  ? `${node.label} (${formatAmount(node.amount)})`
                  : node.label;

                return (
                  <foreignObject
                    key={node.id}
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    opacity={opacity}
                    style={{ pointerEvents: 'none', overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: `${fontSize}px`,
                        color: '#fff',
                        textShadow: '0 0 3px rgba(0,0,0,0.9)',
                        lineHeight: 1.1,
                        textAlign: 'center',
                        wordBreak: 'break-all',
                        overflow: 'hidden',
                        padding: `${fontSize * 0.1}px`,
                      }}
                    >
                      {text}
                    </div>
                  </foreignObject>
                );
              })}
            </g>
          </g>
        </svg>
      </div>

      {/* サイドパネル */}
      {showPanel && selectedNode && (
        <DetailPanel
          node={selectedNode}
          edgeIndex={edgeIndex}
          nodeMap={nodeMap}
          onClose={() => setSelectedNodeId(null)}
          onNodeClick={handlePanelNodeClick}
        />
      )}
    </div>
  );
}

// ─── noop ──────────────────────────────────────────────

const noop = () => {};

// ─── サイドパネル ──────────────────────────────────────

interface DetailPanelProps {
  node: LayoutNode;
  edgeIndex: EdgeIndex;
  nodeMap: Map<string, LayoutNode>;
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

function DetailPanel({ node, edgeIndex, nodeMap, onClose, onNodeClick }: DetailPanelProps) {
  const inEdges = (edgeIndex.byTarget.get(node.id) ?? [])
    .slice()
    .sort((a, b) => b.value - a.value);
  const outEdges = (edgeIndex.bySource.get(node.id) ?? [])
    .slice()
    .sort((a, b) => b.value - a.value);

  const color = TYPE_COLORS[node.type] || '#999';

  return (
    <div
      className="h-full border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-y-auto"
      style={{ width: PANEL_WIDTH, minWidth: PANEL_WIDTH }}
    >
      {/* ヘッダー */}
      <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 z-10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-gray-900 dark:text-gray-100 break-all leading-tight">
              {node.label}
            </div>
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-1">
              {formatAmount(node.amount)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none p-1"
          >
            ✕
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {TYPE_LABELS[node.type] ?? node.type}
          </span>
          {node.ministry && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{node.ministry}</span>
          )}
        </div>
      </div>

      {/* 流入元 */}
      <ConnectionList
        title="流入元"
        arrow="←"
        edges={inEdges}
        getNodeId={e => e.source}
        nodeMap={nodeMap}
        onNodeClick={onNodeClick}
      />

      {/* 流出先 */}
      <ConnectionList
        title="流出先"
        arrow="→"
        edges={outEdges}
        getNodeId={e => e.target}
        nodeMap={nodeMap}
        onNodeClick={onNodeClick}
      />
    </div>
  );
}

interface ConnectionListProps {
  title: string;
  arrow: string;
  edges: LayoutEdge[];
  getNodeId: (e: LayoutEdge) => string;
  nodeMap: Map<string, LayoutNode>;
  onNodeClick: (nodeId: string) => void;
}

function ConnectionList({ title, arrow, edges, getNodeId, nodeMap, onNodeClick }: ConnectionListProps) {
  if (edges.length === 0) return null;

  const shown = edges.slice(0, PANEL_MAX_CONNECTIONS);
  const remaining = edges.length - shown.length;

  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
        {arrow} {title}（{edges.length}件）
      </div>
      <div className="space-y-1">
        {shown.map((edge, i) => {
          const targetId = getNodeId(edge);
          const targetNode = nodeMap.get(targetId);
          const color = targetNode ? (TYPE_COLORS[targetNode.type] || '#999') : '#999';
          return (
            <button
              key={`${targetId}-${i}`}
              onClick={() => onNodeClick(targetId)}
              className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
            >
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {targetNode?.label ?? targetId}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                {formatAmount(edge.value)}
              </span>
            </button>
          );
        })}
      </div>
      {remaining > 0 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 pl-2">
          …他 {remaining.toLocaleString()} 件
        </div>
      )}
    </div>
  );
}

// ─── メモ化サブコンポーネント ──────────────────────────────

interface NodeRectProps {
  node: LayoutNode;
  zoom: number;
  isHighlighting: boolean;
  isConnected: boolean;
  isHovered: boolean;
  isSelected: boolean;
  depthOpacity: number;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onClick: (nodeId: string) => void;
}

const MemoNodeRect = React.memo(function NodeRect({
  node, zoom,
  isHighlighting, isConnected, isHovered, isSelected, depthOpacity,
  onHoverStart, onHoverEnd, onClick,
}: NodeRectProps) {
  const color = TYPE_COLORS[node.type] || '#999';
  const opacity = isHighlighting ? (isConnected ? depthOpacity : 0.08) : 1;
  const highlighted = isHovered || isSelected;

  return (
    <g
      opacity={opacity}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={(e) => { e.stopPropagation(); onClick(node.id); }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={color}
        stroke={highlighted ? '#fff' : 'none'}
        strokeWidth={highlighted ? 2 / zoom : 0}
      >
        <title>{`${node.label}\n${formatAmount(node.amount)}`}</title>
      </rect>
    </g>
  );
});

interface EdgeLineProps {
  edge: LayoutEdge;
  isHighlighting: boolean;
  isConnected: boolean;
  depthOpacity: number;
}

const MemoEdgeLine = React.memo(function EdgeLine({ edge, isHighlighting, isConnected, depthOpacity }: EdgeLineProps) {
  const opacity = isHighlighting ? (isConnected ? depthOpacity * 0.6 : 0.02) : 0.04;

  return (
    <polyline
      points={pathToPolyline(edge.path)}
      fill="none"
      stroke={isConnected ? '#3b82f6' : '#9ca3af'}
      strokeWidth={Math.max(edge.width, 0.3)}
      opacity={opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
});
