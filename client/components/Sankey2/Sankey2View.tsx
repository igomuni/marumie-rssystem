'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { Sankey2LayoutData, LayoutNode, LayoutEdge } from './types';

// ─── 定数 ──────────────────────────────────────────────

/** typeごとの色 */
const TYPE_COLORS: Record<string, string> = {
  'total':            '#6b7280', // gray-500
  'ministry':         '#3b82f6', // blue-500
  'project-budget':   '#22c55e', // green-500
  'project-spending': '#f97316', // orange-500
  'recipient':        '#ef4444', // red-500
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

// ─── コンポーネント ──────────────────────────────────────

interface Props {
  data: Sankey2LayoutData | null;
}

export default function Sankey2View({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Transform state: pan + zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.15 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Hover state
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // コンテナサイズ
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // 初期表示: データの中央にフィット
  // コンテナサイズをResizeObserverで追跡
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

    // ビューポート範囲（仮想座標系）
    const vpLeft   = (-tx / k) - VIEWPORT_MARGIN;
    const vpTop    = (-ty / k) - VIEWPORT_MARGIN;
    const vpRight  = (cw - tx) / k + VIEWPORT_MARGIN;
    const vpBottom = (ch - ty) / k + VIEWPORT_MARGIN;

    // 面積ベースLOD + ビューポートカリング
    const nodeSet = new Set<string>();
    const filteredNodes: LayoutNode[] = [];

    for (const node of data.nodes) {
      // 面積LOD: スクリーン上の面積が閾値未満なら描画しない
      const screenArea = (node.area ?? node.width * node.height) * k2;
      if (screenArea < MIN_SCREEN_AREA) continue;

      // ビューポートカリング
      if (node.x + node.width < vpLeft || node.x > vpRight) continue;
      if (node.y + node.height < vpTop || node.y > vpBottom) continue;

      nodeSet.add(node.id);
      filteredNodes.push(node);
    }

    // 表示ノード両端が見えるエッジのみ描画
    const filteredEdges: LayoutEdge[] = [];
    for (const edge of data.edges) {
      if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
        filteredEdges.push(edge);
      }
    }

    return { visibleNodes: filteredNodes, visibleEdges: filteredEdges };
  }, [data, transform, containerSize]);

  // ホバー時の接続ノードID集合
  const connectedSet = useMemo(() => {
    if (!hoveredNodeId || !data) return new Set<string>();
    const set = new Set<string>([hoveredNodeId]);
    for (const edge of data.edges) {
      if (edge.source === hoveredNodeId) set.add(edge.target);
      if (edge.target === hoveredNodeId) set.add(edge.source);
    }
    return set;
  }, [hoveredNodeId, data]);

  // ── Wheel zoom（ネイティブリスナーでpreventDefault対応） ──

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
    setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    }));
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // ── 描画 ──

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400 text-lg">読み込み中...</div>
      </div>
    );
  }

  const isHovering = hoveredNodeId !== null;
  const k2 = transform.k * transform.k;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-gray-50 dark:bg-gray-950 select-none"
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
    >
      {/* ヘッダー情報 */}
      <div className="absolute top-3 left-3 z-10 bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-2 text-xs text-gray-600 dark:text-gray-300 shadow-sm backdrop-blur-sm">
        <div className="font-semibold mb-1">/sankey2 予算フロー</div>
        <div>描画: {visibleNodes.length.toLocaleString()} nodes / {visibleEdges.length.toLocaleString()} edges</div>
        <div>全量: {data.nodes.length.toLocaleString()} nodes / {data.edges.length.toLocaleString()} edges</div>
        <div>Zoom: {(transform.k * 100).toFixed(0)}%</div>
      </div>

      {/* 凡例 */}
      <div className="absolute top-3 right-3 z-10 bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 mb-0.5 last:mb-0">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-gray-700 dark:text-gray-300">{type}</span>
          </div>
        ))}
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* エッジ描画 */}
          <g className="edges">
            {visibleEdges.map((edge, i) => (
              <EdgeLine
                key={`${edge.source}-${edge.target}-${i}`}
                edge={edge}
                isHovering={isHovering}
                isConnected={connectedSet.has(edge.source) && connectedSet.has(edge.target)}
              />
            ))}
          </g>

          {/* ノード矩形（下層） */}
          <g className="node-rects">
            {visibleNodes.map(node => (
              <NodeRect
                key={node.id}
                node={node}
                zoom={transform.k}
                isHovering={isHovering}
                isConnected={connectedSet.has(node.id)}
                isHovered={hoveredNodeId === node.id}
                onHoverStart={() => setHoveredNodeId(node.id)}
                onHoverEnd={() => setHoveredNodeId(null)}
              />
            ))}
          </g>

          {/* ラベル（上層 — foreignObjectで折り返し対応） */}
          <g className="node-labels">
            {visibleNodes.map(node => {
              // 面積ベースLOD: スクリーン面積がラベル閾値未満なら非表示
              const screenArea = (node.area ?? node.width * node.height) * k2;
              if (screenArea < LABEL_SCREEN_AREA) return null;

              // 矩形のスクリーンサイズが小さすぎるなら非表示
              const screenW = node.width * transform.k;
              const screenH = node.height * transform.k;
              if (screenW < 20 || screenH < 10) return null;

              // フォントサイズ: 矩形の短辺ベース、折り返し前提
              const fontSize = Math.min(node.height * 0.25, node.width * 0.18, 150);

              // スクリーン上で6px未満なら非表示
              if (fontSize * transform.k < 6) return null;

              const opacity = isHovering
                ? (connectedSet.has(node.id) ? 1 : 0.08)
                : 1;

              const text = hoveredNodeId === node.id
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
  );
}

// ─── サブコンポーネント ──────────────────────────────────

interface NodeRectProps {
  node: LayoutNode;
  zoom: number;
  isHovering: boolean;
  isConnected: boolean;
  isHovered: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}

function NodeRect({
  node, zoom,
  isHovering, isConnected, isHovered,
  onHoverStart, onHoverEnd,
}: NodeRectProps) {
  const color = TYPE_COLORS[node.type] || '#999';
  const opacity = isHovering ? (isConnected ? 1 : 0.08) : 1;

  return (
    <g
      opacity={opacity}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={color}
        stroke={isHovered ? '#fff' : 'none'}
        strokeWidth={isHovered ? 2 / zoom : 0}
      >
        <title>{`${node.label}\n${formatAmount(node.amount)}`}</title>
      </rect>
    </g>
  );
}

interface EdgeLineProps {
  edge: LayoutEdge;
  isHovering: boolean;
  isConnected: boolean;
}

function EdgeLine({ edge, isHovering, isConnected }: EdgeLineProps) {
  const opacity = isHovering ? (isConnected ? 0.6 : 0.02) : 0.04;

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
}
