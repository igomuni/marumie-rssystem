'use client';

/**
 * 階層サンキーの描画（自前 SVG）。
 *
 * 列が6つあり1列あたりのノードが多いので、`/mof-budget-overview` の描画とは
 * ラベルの出し方が違う（列見出しを上に置き、ラベルはノードの右に短く出す）。
 * 配置計算は `app/lib/mof-sankey-layout.ts` を共有する。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  computeMOFSankeyLayout,
  mofRibbonPath,
  type MOFLayoutLink,
  type MOFLayoutNode,
} from '@/app/lib/mof-sankey-layout';
import {
  HIERARCHY_COLUMN_INDEX,
  MOF_HIERARCHY_LAYOUT,
  hierarchyNodeColor,
} from '@/app/lib/mof-hierarchy-constants';
import {
  MOF_HIERARCHY_COLUMNS,
  MOF_HIERARCHY_COLUMN_LABELS,
  type LabelDensity,
  type MOFHierarchyColumn,
  type MOFHierarchyNode,
} from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';
import { focusHierarchy, relatedNodeIds } from '@/app/lib/mof-hierarchy-focus';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { HierarchySearch } from './HierarchySearch';
import { MinimapOverlay } from '@/client/components/SankeySvg/MinimapOverlay';
import { E2E_TEST_IDS_ENABLED, testId } from '@/client/lib/testId';

/** ラベルの既定サイズ（px） */
export const LABEL_FONT_PX_DEFAULT = 11;

/**
 * ラベル1行が占める高さ（px）。
 * ノードをこの間隔まで押し広げることで文字の重なりを防ぐので、
 * 文字を大きくしたらこちらも連動させないと即座に重なる。
 */
const labelSlot = (fontPx: number) => fontPx + 2;

/** 集約ノードの手前に空ける余白（px）。実体のあるノードと視覚的に切り離す */
const AGGREGATE_GAP = 14;

/** ズームの範囲。/sankey-svg と同じ操作感に合わせる */
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

/** ラベル欄に収まらない名前は詰める。全文はツールチップに出る */
function shorten(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function HierarchyChart({
  nodes,
  links,
  selectedId,
  onSelect,
  focusRelated = true,
  fontPx = LABEL_FONT_PX_DEFAULT,
  labelDensity = 'all',
}: {
  nodes: MOFHierarchyNode[];
  links: SankeyLink[];
  /** 選択中のノード。URL と同期させるためページ層が持つ */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 選択したときに関連ノードだけを表示するか */
  focusRelated?: boolean;
  /** ラベルの文字サイズ（px） */
  fontPx?: number;
  /** ラベルをどこまで出すか */
  labelDensity?: LabelDensity;
}) {
  // 画面いっぱいに描くため、実際の表示領域を測る
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1900, height: 900 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ズームとパン。/sankey-svg と同じくドラッグで動かし、ホイールで拡大縮小する。
  // 縦だけを伸縮させ、横は画面固定にする（列の位置が動くと読み進められないため）
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /**
   * ミニマップ。/sankey-svg と同じ MinimapOverlay を使う。
   *
   * パンを制限しないことにしたので、表示数を増やして図が伸びると
   * 今どこを見ているのか分からなくなりやすい。全体の中の現在位置を
   * 示す手段が要る
   */
  const MINIMAP_W = 200;
  const [showMinimap, setShowMinimap] = useState(false);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapDragging = useRef(false);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  /** タッチ中の指。2本になったらピンチとして扱う */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number; centerY: number } | null>(null);
  /**
   * 図の設計幅。
   *
   * 列が6つあり各列にラベルを出すので、狭い画面に合わせて詰めると
   * 隣の列と文字が重なる。最低幅を確保し、狭い画面は横パンで見てもらう
   * （縦は画面に合わせるので、横だけがはみ出す）。
   */
  const width = Math.max(viewport.width, 1500);
  const [hovered, setHovered] = useState<MOFLayoutNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<MOFLayoutLink | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  /** ドラッグと区別するため、押した位置からの移動量を見る */
  const dragged = useRef(false);

  /** 選択したノードに連なる集合。薄暗くする判定に使う */
  const related = useMemo(
    () => (selectedId ? relatedNodeIds(links, selectedId) : null),
    [selectedId, links]
  );

  /**
   * ホバー中のノードに連なる集合。
   *
   * 直接つながる隣だけを明るくすると、2列以上離れた祖先が薄暗いままになり
   * 「この事項はどの所管か」が見た目から追えない。選択と同じ relatedNodeIds を使い、
   * 上流〜下流の連なり全体を対象にする（/sankey-svg のホバーと同じ考え方）。
   *
   * 選択して絞り込んでいない（focusRelated=false）ときは選択のハイライトを
   * 優先し、ここでは計算しない。絞り込み中は表示自体が既に選択の筋だけなので、
   * その中でさらにホバーの筋を強調する意味がある
   */
  const hoveredRelated = useMemo(
    () => (hovered && (!selectedId || focusRelated) ? relatedNodeIds(links, hovered.id) : null),
    [hovered, selectedId, focusRelated, links]
  );

  /**
   * 配置に渡すノードとリンク。
   * 絞り込みが有効なら、関連だけを取り出して金額を付け替えたものを使う。
   */
  const visible = useMemo(() => {
    if (!focusRelated || !selectedId || !related) return { nodes, links };
    return focusHierarchy(nodes, links, selectedId);
  }, [nodes, links, related, focusRelated, selectedId]);

  const layout = useMemo(
    () =>
      computeMOFSankeyLayout(
        // 詳細型は配置計算では素通しなので、そのまま渡す
        { nodes: visible.nodes as Array<(typeof visible.nodes)[number]>, links: visible.links },
        {
          width,
          // ズームは縦の縮尺を変えて表現する。CSS で拡大すると文字まで伸びるため
          height: viewport.height * zoom,
          ...MOF_HIERARCHY_LAYOUT,
          // 狭い画面ではコントロールが2段になり、列見出しに被る
          margin: {
            ...MOF_HIERARCHY_LAYOUT.margin,
            top: viewport.width < 1200
              ? MOF_HIERARCHY_LAYOUT.margin.top + 40
              : MOF_HIERARCHY_LAYOUT.margin.top,
          },
          // ノード自体をずらしてラベル1行分の場所を確保する（/sankey-svg と同じ方式）。
          // ラベルだけをずらすと箱から離れ、引き出し線だらけになる
          // すべてに名前を出すときだけ1行分の場所を確保する。
          // major は詰めて見渡すのが目的なので、値どおりの高さのまま置く
          minNodeSlot: labelDensity === 'all' ? labelSlot(fontPx) : 0,
          // 集約ノードの手前を空けて、実体のあるノードと切り離す
          gapBefore: node => (node.id.startsWith('__others__') ? AGGREGATE_GAP : 0),
          // 階層は固定なので列を明示する。値の無い列を素通りした枝も正しい列に載る
          columnOf: node =>
            HIERARCHY_COLUMN_INDEX[node.type as MOFHierarchyColumn] ?? undefined,
        }
      ),
    [visible, width, viewport.height, viewport.width, zoom, fontPx, labelDensity]
  );

  /**
   * ミニマップの高さ。図の縦横比に合わせる。
   * `width`（SVGの実幅）・`layout.contentHeight`（同・実高）をそのまま使えるのは、
   * この図が CSS の left/top だけでパンし、内部に scale の transform を持たないため
   */
  const minimapH = Math.round(MINIMAP_W * (layout.contentHeight / (width || 1)));

  // ミニマップを描く
  useEffect(() => {
    if (!showMinimap) return;
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = MINIMAP_W / width;
    const scaleY = minimapH / layout.contentHeight;

    ctx.clearRect(0, 0, MINIMAP_W, minimapH);
    ctx.fillStyle = 'rgba(245,245,245,0.95)';
    ctx.fillRect(0, 0, MINIMAP_W, minimapH);

    for (const node of layout.nodes) {
      const details = node.details as MOFHierarchyNode['details'] | undefined;
      if (details?.passThrough) continue;
      ctx.fillStyle = hierarchyNodeColor({
        column: details?.column,
        aggregated: details?.aggregated,
      });
      ctx.fillRect(
        node.x * scaleX,
        node.y * scaleY,
        Math.max(1, node.width * scaleX),
        Math.max(0.5, node.height * scaleY)
      );
    }

    // 現在の表示範囲。CSS の left/top(=pan) だけでパンしているので、
    // 見えている世界座標はそのまま [-pan.x, -pan.x+画面幅] になる
    const mX = -pan.x * scaleX;
    const mY = -pan.y * scaleY;
    const mW = container.clientWidth * scaleX;
    const mH = container.clientHeight * scaleY;
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mX, mY, mW, mH);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(mX, mY, mW, mH);
  }, [showMinimap, layout, width, minimapH, pan]);

  const minimapNavigate = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = minimapRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scaleX = MINIMAP_W / width;
      const scaleY = minimapH / layout.contentHeight;
      const worldX = mx / scaleX;
      const worldY = my / scaleY;
      setPan({
        x: container.clientWidth / 2 - worldX,
        y: container.clientHeight / 2 - worldY,
      });
    },
    [width, minimapH, layout.contentHeight]
  );

  /** 図に実際に出ている列。値の無い列は見出しも出さない */
  const visibleColumns = useMemo(() => {
    const present = new Set(
      layout.nodes
        .filter(n => !(n.details as MOFHierarchyNode['details'] | undefined)?.passThrough)
        .map(n => n.column)
    );
    return MOF_HIERARCHY_COLUMNS.map((column, index) => ({ column, index })).filter(c =>
      present.has(c.index)
    );
  }, [layout]);

  const columnX = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) map.set(node.column, node.x);
    return map;
  }, [layout]);

  /** 列見出しの位置。ノードの上端の少し上に置く */
  const headerY = useMemo(
    () => Math.min(...layout.nodes.map(n => n.y), Number.POSITIVE_INFINITY) - 10,
    [layout.nodes]
  );

  /**
   * ラベルが縦に重なっている箇所。
   *
   * 「重なっていない」は目で見るしかない性質のものだが、それだと自動で
   * 確かめられず、文字サイズを変えられるようにした瞬間に崩れても気づけない。
   * 同じ列の隣り合うラベルの間隔が1行ぶんに満たない箇所を数え、
   * テストから件数を見られるようにする。
   *
   * 判定はラベルの縦位置だけで行う。横幅は文字ごとに違い、詰めた名前は
   * 「…」で終わるので、幅まで見ようとすると近似が当たらない。
   */
  const showsLabel = useCallback(
    (node: MOFLayoutNode) => {
      const details = node.details as MOFHierarchyNode['details'] | undefined;
      if (details?.passThrough) return false;
      // major では名前が収まらない高さのノードを飛ばす。
      // ツールチップと検索から辿れるので、名前が消えても行き止まりにはならない
      return labelDensity === 'all' || node.height >= labelSlot(fontPx);
    },
    [labelDensity, fontPx]
  );

  const labelOverlaps = useMemo(() => {
    if (!E2E_TEST_IDS_ENABLED) return [];
    const byColumn = new Map<number, Array<{ id: string; y: number }>>();
    for (const node of layout.nodes) {
      if (!showsLabel(node)) continue;
      const list = byColumn.get(node.column) ?? [];
      list.push({ id: node.id, y: node.y + node.height / 2 });
      byColumn.set(node.column, list);
    }
    const found: string[] = [];
    for (const list of byColumn.values()) {
      list.sort((a, b) => a.y - b.y);
      for (let i = 1; i < list.length; i += 1) {
        if (list[i].y - list[i - 1].y < fontPx) found.push(list[i].id);
      }
    }
    return found;
  }, [layout, fontPx, showsLabel]);

  /** 列ごとの合計。/sankey-svg と同じく見出しの下に出す */
  const columnTotal = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) {
      // 通過ノードはその列の実体ではないので合計に入れない
      if ((node.details as MOFHierarchyNode['details'] | undefined)?.passThrough) continue;
      map.set(node.column, (map.get(node.column) ?? 0) + node.value);
    }
    return map;
  }, [layout]);

  // 年度や予算種別を変えると、選んでいたノードが無くなることがある。
  // そのままだと関連が自分1つだけになり、ほぼ空の図になる
  useEffect(() => {
    if (selectedId && !nodes.some(n => n.id === selectedId)) onSelect(null);
  }, [selectedId, nodes, onSelect]);

  const selectedNode = useMemo(
    () => layout.nodes.find(n => n.id === selectedId) ?? null,
    [layout.nodes, selectedId]
  );
  const selectedDetails = selectedNode?.details as
    | MOFHierarchyNode['details']
    | undefined;

  /**
   * ズームはカーソル位置を基準にする。
   * 中心固定だと見ていた場所が画面外へ逃げ、拡大するたびに探し直しになる。
   */
  // React は更新関数を複数回評価することがある（開発時の StrictMode など）。
  // その中で setPan を呼ぶと移動が二重に効いて、見ていた場所からずれる。
  // 次のズームを外で求めてから両方を更新する。
  const zoomRef = useRef(1);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const zoomAt = useCallback((factor: number, anchorY: number) => {
    const prev = zoomRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
    if (next === prev) return;
    zoomRef.current = next;
    setZoom(next);
    setPan(p => ({ ...p, y: anchorY - (anchorY - p.y) * (next / prev) }));
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const anchorY = rect ? e.clientY - rect.top : 0;
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, anchorY);
    },
    [zoomAt]
  );

  /** ボタンからのズームは画面中央を基準にする */
  const zoomFromButton = useCallback(
    (factor: number) => zoomAt(factor, (containerRef.current?.clientHeight ?? 0) / 2),
    [zoomAt]
  );

  /**
   * パンは制限しない（/sankey-svg と同じ）。
   *
   * 可動域を「図がはみ出す分」に閉じると、表示数を増やして図が縦に伸びたときに
   * 見たい場所へ寄せられなくなる。行き過ぎても右下の「全体を表示」で戻せる。
   */

  // 検索から選んだノードが画面の外にあることがあるので、見える位置まで寄せる
  useLayoutEffect(() => {
    if (!selectedNode || viewport.height <= 0) return;
    setPan(p => {
      const screenY = selectedNode.y + p.y;
      const edge = 80;
      if (screenY >= edge && screenY <= viewport.height - edge) return p;
      return { ...p, y: viewport.height / 2 - selectedNode.y };
    });
  }, [selectedNode, viewport.height]);

  // Esc で選択解除。図の外をクリックしなくても戻せるようにする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onWheel={handleWheel}
      onPointerDown={e => {
        if (e.pointerType !== 'touch') return;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 1) {
          // 1本指はドラッグと同じ扱い。touchAction を切っているので自前で動かす
          panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          dragged.current = false;
        }
        if (touches.current.size === 2) {
          const [a, b2] = [...touches.current.values()];
          const rect = containerRef.current?.getBoundingClientRect();
          pinchStart.current = {
            distance: Math.hypot(a.x - b2.x, a.y - b2.y),
            zoom,
            centerY: (a.y + b2.y) / 2 - (rect?.top ?? 0),
          };
          // 2本指の間はドラッグ扱いにしない
          panStart.current = null;
        }
      }}
      onPointerMove={e => {
        if (e.pointerType !== 'touch') return;
        if (!touches.current.has(e.pointerId)) return;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 1 && panStart.current) {
          if (
            Math.abs(e.clientX - panStart.current.x) > 3 ||
            Math.abs(e.clientY - panStart.current.y) > 3
          ) {
            dragged.current = true;
          }
          setPan({
            x: panStart.current.panX + (e.clientX - panStart.current.x),
            y: panStart.current.panY + (e.clientY - panStart.current.y),
          });
          return;
        }
        if (touches.current.size === 2 && pinchStart.current) {
          const [a, b2] = [...touches.current.values()];
          const distance = Math.hypot(a.x - b2.x, a.y - b2.y);
          if (pinchStart.current.distance > 0) {
            const next = Math.min(
              ZOOM_MAX,
              Math.max(ZOOM_MIN, pinchStart.current.zoom * (distance / pinchStart.current.distance))
            );
            const prev = zoomRef.current;
            if (next !== prev) {
              const anchorY = pinchStart.current.centerY;
              zoomRef.current = next;
              setZoom(next);
              setPan(p => ({ ...p, y: anchorY - (anchorY - p.y) * (next / prev) }));
            }
          }
          dragged.current = true;
        }
      }}
      onPointerUp={e => {
        if (e.pointerType !== 'touch') return;
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinchStart.current = null;
        if (touches.current.size === 0) panStart.current = null;
      }}
      onPointerCancel={e => {
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinchStart.current = null;
      }}
      style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
      onMouseDown={e => {
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        dragged.current = false;
        setIsPanning(true);
      }}
      onMouseMove={e => {
        if (!panStart.current) return;
        if (
          Math.abs(e.clientX - panStart.current.x) > 3 ||
          Math.abs(e.clientY - panStart.current.y) > 3
        ) {
          dragged.current = true;
        }
        setPan({
          x: panStart.current.panX + (e.clientX - panStart.current.x),
          y: panStart.current.panY + (e.clientY - panStart.current.y),
        });
      }}
      onMouseUp={() => {
        panStart.current = null;
        setIsPanning(false);
      }}
      onClick={() => {
        // 背景クリックで選択解除（ドラッグの終わりは無視する）
        if (!dragged.current) onSelect(null);
      }}
      onMouseLeave={() => {
        panStart.current = null;
        setIsPanning(false);
        setHovered(null);
      }}
    >
      <svg
        data-testid={testId('hierarchy-canvas')}
        width={width}
        height={layout.contentHeight}
        style={{ position: 'absolute', left: pan.x, top: pan.y, display: 'block' }}
        role="img"
        aria-label="所管から事項までの予算の流れ"
      >
        {/* 列見出し */}
        <g>
          {visibleColumns.map(({ column, index }) => (
            <g key={column}>
              {/* 列見出しはノードの真上に置く。上に浮かせたコントロールと重ならない高さ */}
              <text
                x={columnX.get(index) ?? 0}
                y={headerY - 16}
                fontSize={12}
                fontWeight={600}
                fill="#374151"
              >
                {MOF_HIERARCHY_COLUMN_LABELS[column]}
              </text>
              <text
                x={columnX.get(index) ?? 0}
                y={headerY}
                fontSize={11}
                fill="#9ca3af"
              >
                {formatBudgetFromYen(columnTotal.get(index) ?? 0)}
              </text>
            </g>
          ))}
        </g>

        <g>
          {layout.links.map((link, i) => {
            const offSelection =
              !focusRelated &&
              related !== null &&
              !(related.has(link.source.id) && related.has(link.target.id));
            const offHover =
              hoveredRelated !== null &&
              !(hoveredRelated.has(link.source.id) && hoveredRelated.has(link.target.id));
            const dim = offSelection || (related === null && offHover);
            const isHovered = hoveredLink === link;
            return (
              <path
                key={`${link.source.id}-${link.target.id}-${i}`}
                data-testid={testId('hierarchy-link')}
                d={mofRibbonPath(link)}
                fill={hierarchyNodeColor({
                  column: link.target.details?.column as MOFHierarchyColumn | undefined,
                  aggregated: link.target.details?.aggregated,
                })}
                opacity={dim ? 0.06 : isHovered ? 0.5 : 0.28}
                style={{ cursor: 'default' }}
                onMouseEnter={e => {
                  setHoveredLink(link);
                  setPointer({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => setPointer({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => {
                  setHoveredLink(null);
                  setPointer(null);
                }}
              />
            );
          })}
        </g>

        <g>
          {layout.nodes.map(node => {
            const details = node.details as MOFHierarchyNode['details'] | undefined;
            // 通過ノードは場所を確保するだけ。箱もラベルも出さない
            if (details?.passThrough) return null;
            const color = hierarchyNodeColor({
              column: details?.column,
              aggregated: details?.aggregated,
            });
            // 根だけ左、それ以外はノードの右にラベルを出す
            const labelLeft = node.column === 0;
            const labelX = labelLeft ? node.x - 6 : node.x + node.width + 6;
            const centerY = node.y + node.height / 2;
            const textY = centerY;
            const offSelection =
              !focusRelated && related !== null && !related.has(node.id);
            const offHover = hoveredRelated !== null && !hoveredRelated.has(node.id);
            const dim = offSelection || (related === null && offHover);
            const isSelected = selectedId === node.id;
            return (
              <g
                key={node.id}
                data-testid={testId('hierarchy-node')}
                // 「値の無い列も畳まない」をテストから確かめられるよう列名を出す
                data-column={testId(details?.column ?? '')}
                onMouseEnter={e => {
                  setHovered(node);
                  setPointer({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => setPointer({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => {
                  setHovered(null);
                  setPointer(null);
                }}
                onClick={e => {
                  // パン操作の終わりとクリックを取り違えないよう、動かしていたら無視する
                  if (dragged.current) return;
                  e.stopPropagation();
                  onSelect(selectedId === node.id ? null : node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={2}
                  fill={color}
                  opacity={dim ? 0.25 : 1}
                  stroke={isSelected ? '#1f2937' : undefined}
                  strokeWidth={isSelected ? 1.5 : undefined}
                />
                {showsLabel(node) && (
                <text
                  data-testid={testId('hierarchy-label')}
                  x={labelX}
                  y={textY}
                  textAnchor={labelLeft ? 'end' : 'start'}
                  dominantBaseline="middle"
                  fontSize={fontPx}
                  fontWeight={isSelected ? 700 : details?.aggregated ? 400 : 500}
                  fill={details?.aggregated ? '#6b7280' : '#1f2937'}
                  stroke="#ffffff"
                  strokeWidth={3}
                  paintOrder="stroke"
                  opacity={dim ? 0.35 : 1}
                >
                  {`${shorten(node.name, labelLeft ? 24 : 18)} (${formatBudgetFromYen(node.value)})`}
                </text>
                )}
              </g>
            );
          })}
        </g>

        {/* 重なりの印。テストから数えるためだけの目印で、何も描かない */}
        {labelOverlaps.map(id => (
          <g key={`overlap-${id}`} data-testid={testId('hierarchy-label-overlap')} />
        ))}
      </svg>

      {hovered && pointer && (
        <HierarchyTooltip node={hovered} x={pointer.x} y={pointer.y} />
      )}
      {/* ノードにホバー中でなければ帯のツールチップを出す。両方は同時に出ない
          （ノードにマウスがあるとき、帯の onMouseLeave は既に発火済み） */}
      {!hovered && hoveredLink && pointer && (
        <HierarchyLinkTooltip link={hoveredLink} x={pointer.x} y={pointer.y} />
      )}

      {/* 検索。/sankey-svg と同じく左上に置く（見出しの下） */}
      <div className="absolute left-3 top-3 z-30">
        <HierarchySearch nodes={nodes} onSelect={onSelect} />
      </div>

      {/* 選択したノードの詳細。/sankey-svg と同じく左下に置く */}
      {selectedNode && (
        <div className="absolute bottom-3 left-3 z-30 max-w-sm rounded-lg border border-black/10 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-gray-400">
                {selectedDetails?.column
                  ? MOF_HIERARCHY_COLUMN_LABELS[selectedDetails.column]
                  : ''}
              </div>
              <div className="text-sm font-semibold text-gray-900">{selectedNode.name}</div>
              <div className="text-lg font-bold text-gray-800">
                {formatBudgetFromYen(selectedNode.value)}
              </div>
            </div>
            <button
              type="button"
              title="選択を解除"
              aria-label="選択を解除"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                onSelect(null);
              }}
              className="rounded px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          {selectedDetails?.aggregated && (
            <div className="mt-1 text-xs text-gray-600">
              表示数から溢れた {selectedDetails.aggregatedCount?.toLocaleString()} 件
            </div>
          )}
          {/* 集約の中身。件数だけだと何が隠れているのか分からない */}
          {selectedDetails?.aggregatedTop && selectedDetails.aggregatedTop.length > 0 && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <div className="mb-1 text-[11px] text-gray-400">内訳（金額の大きい順）</div>
              {/* 事項名は項をまたいで重複するので、名前だけだと鍵が衝突する */}
              {selectedDetails.aggregatedTop.map((member, index) => (
                <div
                  key={`${index}-${member.name}`}
                  className="flex justify-between gap-3 text-xs text-gray-700"
                >
                  <span className="truncate">{member.name}</span>
                  <span className="shrink-0 tabular-nums text-gray-500">
                    {formatBudgetFromYen(member.amount)}
                  </span>
                </div>
              ))}
              {(selectedDetails.aggregatedCount ?? 0) >
                selectedDetails.aggregatedTop.length && (
                <div className="text-[11px] text-gray-400">
                  ほか{' '}
                  {(
                    (selectedDetails.aggregatedCount ?? 0) -
                    selectedDetails.aggregatedTop.length
                  ).toLocaleString()}{' '}
                  件
                </div>
              )}
            </div>
          )}
          {selectedDetails?.majorExpenseName && (
            <div className="mt-1 text-xs text-gray-500">
              {selectedDetails.majorExpenseName}
            </div>
          )}
          {selectedDetails?.description && (
            <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
              {selectedDetails.description}
            </div>
          )}
          {focusRelated && (
            <div className="mt-2 text-[11px] text-gray-400">
              この筋に連なるノードだけを表示しています
            </div>
          )}
        </div>
      )}

      {/* ミニマップ。/sankey-svg と同じく左下に置く。
          パンを制限していないので、全体の中の現在位置を示す手段が要る */}
      <MinimapOverlay
        show={showMinimap}
        onShow={() => setShowMinimap(true)}
        onHide={() => setShowMinimap(false)}
        left={12}
        minimapW={MINIMAP_W}
        minimapH={minimapH}
        canvasRef={minimapRef}
        navigate={minimapNavigate}
        dragging={minimapDragging}
      />

      {/* ズーム操作。/sankey-svg と同じく右下に置く */}
      <div className="absolute bottom-3 right-3 z-30 flex flex-col gap-1">
        <ZoomButton
          label="＋"
          title="拡大"
          onClick={() => zoomFromButton(ZOOM_STEP)}
        />
        <ZoomButton
          label="－"
          title="縮小"
          onClick={() => zoomFromButton(1 / ZOOM_STEP)}
        />
        <ZoomButton
          label="⤢"
          title="全体を表示"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
        <div className="rounded border border-black/10 bg-white/90 px-1 py-0.5 text-center text-[10px] text-gray-500 shadow">
          {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={onClick}
      className="h-7 w-7 rounded border border-black/10 bg-white/90 text-sm text-gray-600 shadow hover:bg-white"
    >
      {label}
    </button>
  );
}

function HierarchyTooltip({
  node,
  x,
  y,
}: {
  node: MOFLayoutNode;
  x: number;
  y: number;
}) {
  const details = node.details as MOFHierarchyNode['details'] | undefined;
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-md rounded border border-gray-200 bg-white px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y + 12 }}
    >
      {details?.column && (
        <div className="text-[11px] font-medium text-gray-400">
          {MOF_HIERARCHY_COLUMN_LABELS[details.column]}
        </div>
      )}
      <div className="font-semibold text-gray-900">{node.name}</div>
      <div className="text-lg font-bold text-gray-800">
        {formatBudgetFromYen(node.value)}
      </div>
      {details?.aggregated && (
        <div className="mt-1 text-xs text-gray-600">
          TopN から溢れた {details.aggregatedCount} 件をまとめたもの
        </div>
      )}
      {details?.majorExpenseName && (
        <div className="mt-1 text-xs text-gray-500">{details.majorExpenseName}</div>
      )}
      {details?.description && (
        <div className="mt-1 max-h-32 overflow-hidden text-xs leading-relaxed text-gray-600">
          {details.description}
        </div>
      )}
    </div>
  );
}

function HierarchyLinkTooltip({
  link,
  x,
  y,
}: {
  link: MOFLayoutLink;
  x: number;
  y: number;
}) {
  return (
    <div
      data-testid={testId('hierarchy-link-tooltip')}
      className="pointer-events-none fixed z-50 max-w-md rounded border border-gray-200 bg-white px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y + 12 }}
    >
      <div className="text-xs text-gray-600">
        {link.source.name} → {link.target.name}
      </div>
      <div className="text-lg font-bold text-gray-800">
        {formatBudgetFromYen(link.value)}
      </div>
    </div>
  );
}
