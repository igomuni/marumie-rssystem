'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { GraphData, LayoutNode, LayoutLink } from '@/types/sankey-svg';
import {
  COL_LABELS, MARGIN, NODE_W, NODE_PAD,
  TYPE_LABELS,
  getColumn, getNodeColor, getLinkColor, ribbonPath, formatYen,
} from '@/app/lib/sankey-svg-constants';
import { filterTopN, computeLayout } from '@/app/lib/sankey-svg-filter';

// ── URL state serialization ──

interface SankeyUrlState {
  selectedNodeId: string | null;
  pinnedProjectId: string | null;
  pinnedRecipientId: string | null;
  pinnedMinistryName: string | null;
  recipientOffset: number;
  topMinistry: number;
  topProject: number;
  topRecipient: number;
  showLabels: boolean;
  includeZeroSpending: boolean;
  showAggRecipient: boolean;
  scaleBudgetToVisible: boolean;
  focusRelated: boolean;
}

function parseSearchParams(search: string): Partial<SankeyUrlState> {
  const p = new URLSearchParams(search);
  const result: Partial<SankeyUrlState> = {};
  const sel = p.get('sel'); if (sel !== null) result.selectedNodeId = sel;
  const pp = p.get('pp'); if (pp !== null) result.pinnedProjectId = pp;
  const pr = p.get('pr'); if (pr !== null) result.pinnedRecipientId = pr;
  const pm = p.get('pm'); if (pm !== null) result.pinnedMinistryName = pm;
  const ro = p.get('ro'); if (ro !== null) { const n = parseInt(ro, 10); if (!isNaN(n)) result.recipientOffset = Math.max(0, n); }
  const tm = p.get('tm'); if (tm !== null) { const n = parseInt(tm, 10); if (!isNaN(n)) result.topMinistry = Math.max(1, Math.min(37, n)); }
  const tp = p.get('tp'); if (tp !== null) { const n = parseInt(tp, 10); if (!isNaN(n)) result.topProject = Math.max(1, Math.min(100, n)); }
  const tr = p.get('tr'); if (tr !== null) { const n = parseInt(tr, 10); if (!isNaN(n)) result.topRecipient = Math.max(1, Math.min(100, n)); }
  const sl = p.get('sl'); if (sl !== null) result.showLabels = sl !== '0';
  const iz = p.get('iz'); if (iz !== null) result.includeZeroSpending = iz !== '0';
  const ar = p.get('ar'); if (ar !== null) result.showAggRecipient = ar !== '0';
  const sb = p.get('sb'); if (sb !== null) result.scaleBudgetToVisible = sb !== '0';
  const fr = p.get('fr'); if (fr !== null) result.focusRelated = fr !== '0';
  return result;
}

/**
 * 事業統合ノードの SVG パスを生成する。
 * x0 = 予算ノード左端, nodeW = NODE_W, bH = 予算高さ, sH = 支出高さ (共通 y0=0 基準)
 * 上辺: 直線, 下辺: 予算下端 ↔ 支出下端を結ぶベジェ曲線
 */
function mergedProjectPath(x0: number, nodeW: number, bH: number, sH: number): string {
  const x2 = x0 + nodeW * 2;
  const mx = (x0 + x2) / 2;
  return `M${x0},0 L${x2},0 L${x2},${sH} C${mx},${sH} ${mx},${bH} ${x0},${bH} Z`;
}

/** ノードID → フォーカスピン状態を導出する純粋ヘルパー */
function computeFocusPins(
  nodeId: string,
  nodes: Array<{ id: string; name: string }> | undefined,
): { pinnedProjectId: string | null; pinnedRecipientId: string | null; pinnedMinistryName: string | null } {
  if (nodeId.startsWith('r-')) {
    return { pinnedProjectId: null, pinnedRecipientId: nodeId, pinnedMinistryName: null };
  }
  if (nodeId.startsWith('project-budget-') || nodeId.startsWith('project-spending-')) {
    const spendingId = nodeId.startsWith('project-budget-')
      ? nodeId.replace('project-budget-', 'project-spending-')
      : nodeId;
    return { pinnedProjectId: spendingId, pinnedRecipientId: null, pinnedMinistryName: null };
  }
  if (nodeId.startsWith('ministry-')) {
    return { pinnedProjectId: null, pinnedRecipientId: null, pinnedMinistryName: nodes?.find(n => n.id === nodeId)?.name ?? null };
  }
  return { pinnedProjectId: null, pinnedRecipientId: null, pinnedMinistryName: null };
}

export default function RealDataSankeyPage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topMinistry, setTopMinistry] = useState(37);
  const [topProject, setTopProject] = useState(40);
  const [topRecipient, setTopRecipient] = useState(40);
  const [recipientOffset, setRecipientOffset] = useState(0);
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(null);
  const [pinnedRecipientId, setPinnedRecipientId] = useState<string | null>(null);
  const [pinnedMinistryName, setPinnedMinistryName] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<LayoutLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [hoveredColIndex, setHoveredColIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [includeZeroSpending, setIncludeZeroSpending] = useState(false);
  const [showAggRecipient, setShowAggRecipient] = useState(true);
  const [scaleBudgetToVisible, setScaleBudgetToVisible] = useState(true);
  const [focusRelated, setFocusRelated] = useState(true);
  const [baseZoom, setBaseZoom] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [isEditingOffset, setIsEditingOffset] = useState(false);
  const [offsetInputValue, setOffsetInputValue] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchCursorIndex, setSearchCursorIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  // Tracks whether the next URL update should push (navigation) or replace (slider/toggle)
  const pendingHistoryAction = useRef<'push' | 'replace' | null>(null);
  const pendingFocusId = useRef<string | null>(null);

  // Container size (responsive to window)
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(1200);
  const [svgHeight, setSvgHeight] = useState(800);

  useEffect(() => {
    const updateSize = () => {
      const el = containerRef.current;
      if (!el) return;
      setSvgWidth(el.clientWidth);
      setSvgHeight(el.clientHeight);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateSize);
    return () => { ro.disconnect(); window.removeEventListener('resize', updateSize); };
  }, []);

  // Initialize state from URL on mount
  useEffect(() => {
    const parsed = parseSearchParams(window.location.search);
    if (parsed.selectedNodeId !== undefined) { setSelectedNodeId(parsed.selectedNodeId); pendingFocusId.current = parsed.selectedNodeId; }
    if (parsed.pinnedProjectId !== undefined) setPinnedProjectId(parsed.pinnedProjectId);
    if (parsed.pinnedRecipientId !== undefined) setPinnedRecipientId(parsed.pinnedRecipientId);
    if (parsed.pinnedMinistryName !== undefined) setPinnedMinistryName(parsed.pinnedMinistryName);
    if (parsed.recipientOffset !== undefined) setRecipientOffset(parsed.recipientOffset);
    if (parsed.topMinistry !== undefined) setTopMinistry(parsed.topMinistry);
    if (parsed.topProject !== undefined) setTopProject(parsed.topProject);
    if (parsed.topRecipient !== undefined) setTopRecipient(parsed.topRecipient);
    if (parsed.showLabels !== undefined) setShowLabels(parsed.showLabels);
    if (parsed.includeZeroSpending !== undefined) setIncludeZeroSpending(parsed.includeZeroSpending);
    if (parsed.showAggRecipient !== undefined) setShowAggRecipient(parsed.showAggRecipient);
    if (parsed.scaleBudgetToVisible !== undefined) setScaleBudgetToVisible(parsed.scaleBudgetToVisible);
    if (parsed.focusRelated !== undefined) setFocusRelated(parsed.focusRelated);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only init; state setters and refs are stable
  }, []);

  // Restore state on browser back/forward
  useEffect(() => {
    const handler = () => {
      const parsed = parseSearchParams(window.location.search);
      setSelectedNodeId(parsed.selectedNodeId ?? null);
      setPinnedProjectId(parsed.pinnedProjectId ?? null);
      setPinnedRecipientId(parsed.pinnedRecipientId ?? null);
      setPinnedMinistryName(parsed.pinnedMinistryName ?? null);
      setRecipientOffset(parsed.recipientOffset ?? 0);
      setTopMinistry(parsed.topMinistry ?? 37);
      setTopProject(parsed.topProject ?? 40);
      setTopRecipient(parsed.topRecipient ?? 40);
      setShowLabels(parsed.showLabels ?? true);
      setIncludeZeroSpending(parsed.includeZeroSpending ?? false);
      setShowAggRecipient(parsed.showAggRecipient ?? true);
      setScaleBudgetToVisible(parsed.scaleBudgetToVisible ?? true);
      setFocusRelated(parsed.focusRelated ?? true);
      if (parsed.selectedNodeId) pendingFocusId.current = parsed.selectedNodeId;
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL after user actions (push for node selection, replace for sliders/toggles)
  useEffect(() => {
    const action = pendingHistoryAction.current;
    if (action === null) return;
    pendingHistoryAction.current = null;
    const p = new URLSearchParams();
    if (selectedNodeId !== null) p.set('sel', selectedNodeId);
    if (pinnedProjectId !== null) p.set('pp', pinnedProjectId);
    if (pinnedRecipientId !== null) p.set('pr', pinnedRecipientId);
    if (pinnedMinistryName !== null) p.set('pm', pinnedMinistryName);
    if (recipientOffset !== 0) p.set('ro', String(recipientOffset));
    if (topMinistry !== 37) p.set('tm', String(topMinistry));
    if (topProject !== 40) p.set('tp', String(topProject));
    if (topRecipient !== 40) p.set('tr', String(topRecipient));
    if (!showLabels) p.set('sl', '0');
    if (includeZeroSpending) p.set('iz', '1');
    if (!showAggRecipient) p.set('ar', '0');
    if (!scaleBudgetToVisible) p.set('sb', '0');
    if (!focusRelated) p.set('fr', '0');
    const qs = p.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    if (action === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
  }, [selectedNodeId, pinnedProjectId, pinnedRecipientId, pinnedMinistryName, recipientOffset, topMinistry, topProject, topRecipient, showLabels, includeZeroSpending, showAggRecipient, scaleBudgetToVisible, focusRelated]);

  // Zoom/Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const didPanRef = useRef(false);
  const offsetRepeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopOffsetRepeat = useCallback(() => {
    if (offsetRepeatRef.current !== null) { clearTimeout(offsetRepeatRef.current); clearInterval(offsetRepeatRef.current); offsetRepeatRef.current = null; }
  }, []);
  useEffect(() => {
    const onBlur = () => stopOffsetRepeat();
    window.addEventListener('blur', onBlur);
    return () => { stopOffsetRepeat(); window.removeEventListener('blur', onBlur); };
  }, [stopOffsetRepeat]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Prevent overlay control interactions from bubbling into canvas pan/zoom
  const isOverlayControlTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest('[data-pan-disabled],button,input,select,textarea,label');

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isOverlayControlTarget(e.target)) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Mouse position relative to SVG
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(baseZoom * 10, zoom * delta));

    // Adjust pan so zoom centers on mouse position
    const newPanX = mx - (mx - pan.x) * (newZoom / zoom);
    const newPanY = my - (my - pan.y) * (newZoom / zoom);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan, baseZoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isOverlayControlTarget(e.target)) return; // left click only
    didPanRef.current = false;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrigin.current = { ...pan };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPanRef.current = true;
    setPan({
      x: panOrigin.current.x + dx,
      y: panOrigin.current.y + dy,
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const layoutRef = useRef<{ contentW: number; contentH: number } | null>(null);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    setRecipientOffset(0);
    if (container && l) {
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const totalW = MARGIN.left + l.contentW;
      const totalH = MARGIN.top + l.contentH;
      const k = Math.max(0.2, Math.min(10, Math.min(cW / totalW, cH / totalH) * 0.9));
      setZoom(k);
      setBaseZoom(k);
      setPan({ x: (cW - totalW * k) / 2, y: (cH - totalH * k) / 2 });
    } else {
      setZoom(1);
      setBaseZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, []);

  // Viewport-only reset (zoom/pan only, recipientOffset unchanged)
  const resetViewport = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    if (container && l) {
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const totalW = MARGIN.left + l.contentW;
      const totalH = MARGIN.top + l.contentH;
      const k = Math.max(0.2, Math.min(10, Math.min(cW / totalW, cH / totalH) * 0.9));
      setZoom(k);
      setBaseZoom(k);
      setPan({ x: (cW - totalW * k) / 2, y: (cH - totalH * k) / 2 });
    } else {
      setZoom(1);
      setBaseZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, []);

  // Minimap refs (hooks must be unconditional)
  const MINIMAP_W = 200;
  const minimapH = Math.round(MINIMAP_W * (svgHeight / (svgWidth || 1)));
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapDragging = useRef(false);
  const showMinimap = true;

  useEffect(() => {
    fetch('/data/sankey3-graph.json')
      .then(res => {
        if (!res.ok) throw new Error(`Fetch error: ${res.status}`);
        return res.json();
      })
      .then(data => { setGraphData(data); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    if (!graphData) return null;
    const maxOffset = Math.max(0, (graphData.nodes.filter(n => n.type === 'recipient').length) - topRecipient);
    const clampedOffset = Math.min(recipientOffset, maxOffset);
    return filterTopN(graphData.nodes, graphData.edges, topMinistry, topProject, topRecipient, clampedOffset, pinnedProjectId, includeZeroSpending, showAggRecipient, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName);
  }, [graphData, topMinistry, topProject, topRecipient, recipientOffset, pinnedProjectId, includeZeroSpending, showAggRecipient, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName]);

  const minNodeGap = showLabels ? 14 / zoom : undefined;

  const layout = useMemo(() => {
    if (!filtered) return null;
    const result = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight, minNodeGap);
    layoutRef.current = { contentW: result.contentW, contentH: result.contentH };
    return result;
  }, [filtered, svgWidth, svgHeight, minNodeGap]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    // First: try current layout
    const layoutNode = layout?.nodes.find(n => n.id === selectedNodeId) ?? null;
    if (layoutNode) return layoutNode;
    // Fallback: synthesize from graphData for nodes outside current layout
    // (ministry/project not in TopN — panel shows info but no highlight)
    const rawNode = graphData?.nodes.find(n => n.id === selectedNodeId) ?? null;
    if (!rawNode) return null;
    return { ...rawNode, x0: 0, x1: 0, y0: 0, y1: 0, sourceLinks: [], targetLinks: [] } as LayoutNode;
  }, [selectedNodeId, layout, graphData]);

  // The selected node in the current layout (null if not in layout)
  const selectedNodeInLayout = useMemo(
    () => (selectedNodeId !== null ? (layout?.nodes.find(n => n.id === selectedNodeId) ?? null) : null),
    [selectedNodeId, layout],
  );

  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeInLayout) return null;
    const ids = new Set<string>();
    // BFS upstream (follow targetLinks → source recursively) — separate visited set
    const uVisited = new Set<string>();
    const uQueue = [selectedNodeInLayout];
    while (uQueue.length) {
      const n = uQueue.shift()!;
      if (uVisited.has(n.id)) continue;
      uVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.targetLinks) if (!uVisited.has(l.source.id)) uQueue.push(l.source);
    }
    // BFS downstream (follow sourceLinks → target recursively) — separate visited set
    const dVisited = new Set<string>();
    const dQueue = [selectedNodeInLayout];
    while (dQueue.length) {
      const n = dQueue.shift()!;
      if (dVisited.has(n.id)) continue;
      dVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.sourceLinks) if (!dVisited.has(l.target.id)) dQueue.push(l.target);
    }
    return ids;
  }, [selectedNodeInLayout]);

  // Per-ministry project stats — for total/ministry node side panel
  type ProjectStat = { pid: number; name: string; budgetId: string; spendingId: string; budgetValue: number; spendingValue: number };
  type MinistryStat = { total: number; budgetTotal: number; spendingTotal: number; budgetOnly: number; spendingOnly: number; neither: number; projects: ProjectStat[] };
  const ministryProjectStats = useMemo(() => {
    if (!graphData) return new Map<string, MinistryStat>();
    const spendingByPid = new Map(
      graphData.nodes
        .filter((n): n is typeof n & { projectId: number } => n.type === 'project-spending' && n.projectId != null)
        .map(n => [n.projectId, n] as const)
    );
    const stats = new Map<string, MinistryStat>();
    for (const n of graphData.nodes) {
      if (n.type !== 'project-budget' || !n.projectId || !n.ministry) continue;
      const sn = spendingByPid.get(n.projectId);
      const b = n.value;
      const s = sn?.value ?? 0;
      const m = n.ministry;
      if (!stats.has(m)) stats.set(m, { total: 0, budgetTotal: 0, spendingTotal: 0, budgetOnly: 0, spendingOnly: 0, neither: 0, projects: [] });
      const st = stats.get(m)!;
      st.total++;
      st.budgetTotal += b;
      st.spendingTotal += s;
      if (b === 0 && s === 0) st.neither++;
      else if (b === 0) st.spendingOnly++;
      else if (s === 0) st.budgetOnly++;
      if (s === 0) st.projects.push({ pid: n.projectId, name: n.name, budgetId: n.id, spendingId: sn?.id ?? `project-spending-${n.projectId}`, budgetValue: b, spendingValue: s });
    }
    return stats;
  }, [graphData]);

  // Global recipient rank (0-indexed, value-descending) — for offset jump
  const allRecipientRanks = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const amounts = new Map<string, number>();
    for (const e of graphData.edges) {
      if (e.target.startsWith('r-')) amounts.set(e.target, (amounts.get(e.target) || 0) + e.value);
    }
    const sorted = Array.from(amounts.entries()).sort((a, b) => b[1] - a[1]);
    return new Map(sorted.map(([id], i) => [id, i]));
  }, [graphData]);

  // Recipient count per project-spending node (from raw graphData)
  const projectRecipientCount = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const countMap = new Map<string, number>();
    for (const e of graphData.edges) {
      if (e.target.startsWith('r-')) countMap.set(e.source, (countMap.get(e.source) || 0) + 1);
    }
    return countMap;
  }, [graphData]);

  // Full connection list from raw graphData (bypasses TopN aggregation)
  const selectedNodeAllConnections = useMemo(() => {
    if (!selectedNode || !graphData) return null;
    const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));
    const nodeNameById = new Map(graphData.nodes.map(n => [n.id, n.name]));
    if (selectedNode.aggregated) {
      // Aggregated nodes: use layout links as-is
      return {
        inEdges: [...selectedNode.targetLinks]
          .sort((a, b) => b.value - a.value)
          .map(l => ({ id: l.source.id, name: l.source.name, value: l.value, aggregated: l.source.aggregated, ministry: l.source.ministry })),
        outEdges: [...selectedNode.sourceLinks]
          .sort((a, b) => b.value - a.value)
          .map(l => ({ id: l.target.id, name: l.target.name, value: l.value, aggregated: l.target.aggregated, ministry: l.target.ministry })),
      };
    }
    // Real nodes: sum all raw edges from graphData
    const inMap = new Map<string, number>();
    const outMap = new Map<string, number>();
    for (const e of graphData.edges) {
      if (e.target === selectedNode.id) inMap.set(e.source, (inMap.get(e.source) || 0) + e.value);
      if (e.source === selectedNode.id) outMap.set(e.target, (outMap.get(e.target) || 0) + e.value);
    }
    // For ministry nodes: also add project-budget nodes with no edge (value=0) so they appear in outEdges
    if (selectedNode.type === 'ministry') {
      for (const n of graphData.nodes) {
        if (n.type === 'project-budget' && n.ministry === selectedNode.name && !outMap.has(n.id)) {
          outMap.set(n.id, 0);
        }
      }
    }
    // For project-budget nodes: ensure the paired project-spending node appears in outEdges even if spending=0
    if (selectedNode.type === 'project-budget' && selectedNode.projectId != null) {
      const pid = selectedNode.projectId;
      const spendingNode = graphData.nodes.find(n => n.type === 'project-spending' && n.projectId === pid);
      if (spendingNode && !outMap.has(spendingNode.id)) outMap.set(spendingNode.id, spendingNode.value);
    }
    // For project-spending nodes: ensure the paired project-budget node appears in inEdges even if budget=0
    if (selectedNode.type === 'project-spending' && selectedNode.projectId != null) {
      const pid = selectedNode.projectId;
      const budgetNode = graphData.nodes.find(n => n.type === 'project-budget' && n.projectId === pid);
      if (budgetNode && !inMap.has(budgetNode.id)) inMap.set(budgetNode.id, budgetNode.value);
    }
    return {
      inEdges: Array.from(inMap.entries())
        .map(([id, value]) => ({ id, name: nodeNameById.get(id) ?? id, value, aggregated: false, ministry: nodeById.get(id)?.ministry }))
        .sort((a, b) => b.value - a.value),
      outEdges: Array.from(outMap.entries())
        .map(([id, value]) => ({ id, name: nodeNameById.get(id) ?? id, value, aggregated: false, ministry: nodeById.get(id)?.ministry }))
        .sort((a, b) => b.value - a.value),
    };
  }, [selectedNode, graphData]);

  const [inDisplayCount, setInDisplayCount] = useState(8);
  const [outDisplayCount, setOutDisplayCount] = useState(8);
  const [collapsedMinistries, setCollapsedMinistries] = useState<Set<string>>(new Set());
  const [ministryDisplayCounts, setMinistryDisplayCounts] = useState<Map<string, number>>(new Map());
  const [connectionTab, setConnectionTab] = useState<'in' | 'out'>('in');
  useEffect(() => { setInDisplayCount(8); setOutDisplayCount(8); setCollapsedMinistries(new Set()); setMinistryDisplayCounts(new Map()); setConnectionTab('in'); }, [selectedNodeId]);

  const selectNode = useCallback((id: string | null) => {
    pendingHistoryAction.current = id !== null ? 'push' : 'replace';
    setSelectedNodeId(id);
    if (id === null) { setPinnedProjectId(null); setPinnedRecipientId(null); setPinnedMinistryName(null); }
  }, [setPinnedRecipientId, setPinnedMinistryName]);

  // Auto-clear stale selection when node no longer exists in graphData at all
  useEffect(() => {
    if (selectedNodeId !== null && !selectedNode) {
      selectNode(null);
    }
  }, [selectedNode, selectedNodeId, selectNode]);

  // Imperatively focus a layout node (direct call + pending effect)
  const focusOnNode = useCallback((node: LayoutNode) => {
    const container = containerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const cx = MARGIN.left + node.x0 + NODE_W / 2;
    const cy = MARGIN.top + node.y0 + (node.y1 - node.y0) / 2;
    const h = node.y1 - node.y0;
    const minZoomForLabel = 10 / (h + NODE_PAD);
    const panelW = isPanelCollapsed ? 0 : 280;
    const availableW = cW - panelW;
    const targetK = Math.max(zoom, Math.min(baseZoom * 10, minZoomForLabel * 1.2));
    setZoom(targetK);
    setPan({ x: panelW + availableW / 2 - cx * targetK, y: cH / 2 - cy * targetK });
  }, [zoom, baseZoom, isPanelCollapsed]);

  const focusOnNeighborhood = useCallback((nodeOverride?: LayoutNode) => {
    const node = nodeOverride ?? selectedNode;
    if (!node || (!nodeOverride && !selectedNodeInLayout) || !layout || !containerRef.current) return;
    const container = containerRef.current;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const neighborIds = new Set<string>([node.id]);
    for (const l of node.sourceLinks) neighborIds.add(l.target.id);
    for (const l of node.targetLinks) neighborIds.add(l.source.id);
    const neighborNodes = layout.nodes.filter(n => neighborIds.has(n.id));
    if (neighborNodes.length === 0) return;
    const minX = Math.min(...neighborNodes.map(n => n.x0));
    const minY = Math.min(...neighborNodes.map(n => n.y0));
    const maxX = Math.max(...neighborNodes.map(n => n.x1));
    const maxY = Math.max(...neighborNodes.map(n => n.y1));
    const PADDING = 40;
    const boxW = (maxX - minX) + PADDING * 2;
    const boxH = (maxY - minY) + PADDING * 2;
    const panelW = isPanelCollapsed ? 0 : 280;
    const availableW = cW - panelW;
    const targetK = Math.max(0.2, Math.min(baseZoom * 10, Math.min(availableW / boxW, cH / boxH) * 0.9));
    const centerX = MARGIN.left + (minX + maxX) / 2;
    const centerY = MARGIN.top + (minY + maxY) / 2;
    setZoom(targetK);
    setPan({ x: panelW + availableW / 2 - centerX * targetK, y: cH / 2 - centerY * targetK });
  }, [selectedNode, selectedNodeInLayout, layout, isPanelCollapsed, baseZoom]);

  const handleConnectionClick = useCallback((nodeId: string) => {
    // If already in layout, select and focus directly (no effect needed)
    const inLayoutNode = layout?.nodes.find(n => n.id === nodeId);
    if (inLayoutNode) {
      if (focusRelated && (nodeId.startsWith('r-') || inLayoutNode.type === 'ministry') && !inLayoutNode.aggregated) {
        const pins = computeFocusPins(nodeId, graphData?.nodes);
        setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
        selectNode(nodeId);
        focusOnNeighborhood(inLayoutNode);
        return;
      }
      // Preserve pin if the clicked node belongs to the same pinned project
      const derivedPinnedId = nodeId.startsWith('project-budget-')
        ? nodeId.replace('project-budget-', 'project-spending-')
        : nodeId.startsWith('project-spending-')
          ? nodeId
          : null;
      const nextPinnedProjectId =
        focusRelated && derivedPinnedId !== null
          ? derivedPinnedId
          : derivedPinnedId !== null && derivedPinnedId === pinnedProjectId
            ? pinnedProjectId
            : null;
      if (focusRelated && derivedPinnedId !== null) { setPinnedRecipientId(null); setPinnedMinistryName(null); }
      const needsDeferredFocus = nextPinnedProjectId !== pinnedProjectId || isPanelCollapsed;
      setPinnedProjectId(nextPinnedProjectId);
      if (needsDeferredFocus) pendingFocusId.current = nodeId;
      selectNode(nodeId);
      if (!needsDeferredFocus) focusOnNeighborhood(inLayoutNode);
      return;
    }
    // Helper: jump recipientOffset to center on a recipient rank
    const jumpToRecipientRank = (rank: number, totalCount: number) => {
      const maxOffset = Math.max(0, totalCount - topRecipient);
      const newOffset = Math.max(0, Math.min(rank - Math.floor(topRecipient / 2), maxOffset));
      setRecipientOffset(newOffset);
    };

    if (focusRelated) {
      // focusRelated ON: 現在のフォーカスコンテキストをクリアして新しいノードに切り替える
      const pins = computeFocusPins(nodeId, graphData?.nodes);
      setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
    } else if (nodeId.startsWith('r-') && filtered) {
      // Recipient outside window: jump offset so it's visible
      const rank = allRecipientRanks.get(nodeId);
      if (rank !== undefined) jumpToRecipientRank(rank, filtered.totalRecipientCount);
    } else if ((nodeId.startsWith('project-spending-') || nodeId.startsWith('project-budget-')) && filtered && graphData) {
      // Project outside TopN: pin it (TopN+1) and jump offset to its best recipient
      const spendingId = nodeId.startsWith('project-budget-')
        ? nodeId.replace('project-budget-', 'project-spending-')
        : nodeId;
      setPinnedProjectId(spendingId);
      let bestRecipientId: string | null = null;
      let bestRecipientTotal = -1;
      const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));
      for (const e of graphData.edges) {
        if (e.source === spendingId && e.target.startsWith('r-')) {
          const total = nodeById.get(e.target)?.value ?? 0;
          if (total > bestRecipientTotal) { bestRecipientTotal = total; bestRecipientId = e.target; }
        }
      }
      if (bestRecipientId !== null) {
        const rank = allRecipientRanks.get(bestRecipientId);
        if (rank !== undefined) jumpToRecipientRank(rank, filtered.totalRecipientCount);
      }
    } else {
      setPinnedProjectId(null);
    }
    // Out-of-layout node: focus via effect once it appears in layout after pin/offset jump
    pendingFocusId.current = nodeId;
    selectNode(nodeId);
  }, [layout, filtered, allRecipientRanks, topRecipient, selectNode, graphData, focusOnNeighborhood, pinnedProjectId, isPanelCollapsed, focusRelated, setPinnedRecipientId, setPinnedMinistryName]);

  const handleNodeClick = useCallback((node: LayoutNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (didPanRef.current) return;
    const newId = selectedNodeId === node.id ? null : node.id;
    if (focusRelated && newId !== null && !node.aggregated) {
      const pins = computeFocusPins(node.id, graphData?.nodes);
      setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
    } else if (!focusRelated || newId === null) {
      setPinnedRecipientId(null);
      setPinnedMinistryName(null);
    }
    selectNode(newId);
  }, [selectedNodeId, selectNode, focusRelated, graphData]);

  // ── Search ──

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim();
    if (!graphData || q.length < 2) return [];
    const results: { id: string; name: string; type: string; value: number }[] = [];
    // PID search: pure numeric query matches project-spending nodes by projectId
    const pidQuery = /^\d+$/.test(q) ? Number(q) : null;
    for (const n of graphData.nodes) {
      if (pidQuery !== null) {
        if (n.type === 'project-spending' && n.projectId === pidQuery) results.push({ id: n.id, name: n.name, type: n.type, value: n.value });
      } else {
        if (n.name.includes(q)) results.push({ id: n.id, name: n.name, type: n.type, value: n.value });
      }
    }
    return results.sort((a, b) => b.value - a.value).slice(0, 20);
  }, [graphData, debouncedQuery]);

  const handleSearchSelect = useCallback((nodeId: string) => {
    setShowSearchResults(false);
    handleConnectionClick(nodeId);
  }, [handleConnectionClick]);

  // Center on initial load / layout change
  const initialCentered = useRef(false);
  useEffect(() => {
    if (layout && !initialCentered.current) {
      initialCentered.current = true;
      resetView();
    }
  }, [layout, resetView]);

  // Focus on node after selection — fires when node appears in layout (pinned TopN+1 case)
  // Also watches isPanelCollapsed: when panel opens, recalculate fit with updated panel width
  useEffect(() => {
    if (!pendingFocusId.current || !layout || isPanelCollapsed) return;
    const node = layout.nodes.find(n => n.id === pendingFocusId.current);
    if (!node) return;
    pendingFocusId.current = null;
    focusOnNeighborhood(node);
  }, [layout, focusOnNeighborhood, isPanelCollapsed]);

  // Draw minimap
  useEffect(() => {
    if (!showMinimap || !layout) return;
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The "world" that the minimap represents = the full SVG content area
    // Nodes are at (MARGIN.left + x0, MARGIN.top + y0) in SVG coords
    // The SVG transform: translate(pan.x, pan.y) scale(zoom) then translate(MARGIN, MARGIN)
    // So a node at inner (x0,y0) appears at screen (pan.x + (MARGIN.left+x0)*zoom, pan.y + (MARGIN.top+y0)*zoom)
    const worldW = svgWidth;
    const worldH = svgHeight;
    const scaleX = MINIMAP_W / worldW;
    const scaleY = minimapH / worldH;

    ctx.clearRect(0, 0, MINIMAP_W, minimapH);
    ctx.fillStyle = 'rgba(245,245,245,0.95)';
    ctx.fillRect(0, 0, MINIMAP_W, minimapH);

    // Draw nodes (at their SVG-coord positions including MARGIN)
    for (const node of layout.nodes) {
      const x = (MARGIN.left + node.x0) * scaleX;
      const y = (MARGIN.top + node.y0) * scaleY;
      const w = Math.max(1, NODE_W * scaleX);
      const h = Math.max(0.5, (node.y1 - node.y0) * scaleY);
      ctx.fillStyle = getNodeColor(node);
      ctx.fillRect(x, y, w, h);
    }

    // Viewport: what part of the SVG world is visible in the container?
    // Container shows screen coords (0,0) to (containerW, containerH)
    // Screen to SVG: svgX = (screenX - pan.x) / zoom
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const vpLeft = -pan.x / zoom;
    const vpTop = -pan.y / zoom;
    const vpW = cW / zoom;
    const vpH = cH / zoom;

    // Convert to minimap coords
    const mX = vpLeft * scaleX;
    const mY = vpTop * scaleY;
    const mW = vpW * scaleX;
    const mH = vpH * scaleY;

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mX, mY, mW, mH);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(mX, mY, mW, mH);
  }, [showMinimap, layout, zoom, pan, svgWidth, minimapH]);

  const minimapNavigate = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Minimap coord to SVG world coord
    const scaleX = MINIMAP_W / svgWidth;
    const scaleY = minimapH / svgHeight;
    const svgX = mx / scaleX;
    const svgY = my / scaleY;
    // Center the container on this SVG coord
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    setPan({ x: cW / 2 - svgX * zoom, y: cH / 2 - svgY * zoom });
  }, [svgWidth, minimapH, zoom]);

  // Escape key deselects via window listener (reliable regardless of focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') selectNode(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectNode]);

  const focusOnSelectedNode = useCallback(() => {
    if (!selectedNode || !selectedNodeInLayout) return;
    focusOnNode(selectedNode);
  }, [selectedNode, selectedNodeInLayout, focusOnNode]);


  const applyZoom = useCallback((factor: number) => {
    const nz = Math.max(0.2, Math.min(baseZoom * 10, zoom * factor));
    setPan({ x: svgWidth / 2 - (svgWidth / 2 - pan.x) * (nz / zoom), y: svgHeight / 2 - (svgHeight / 2 - pan.y) * (nz / zoom) });
    setZoom(nz);
  }, [zoom, pan, svgWidth, svgHeight, baseZoom]);

  const iconBtnStyle: React.CSSProperties = { color: '#4a90d9', background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 2px', display: 'inline-flex', alignItems: 'center', flexShrink: 0 };
  const svgExpandAll = <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#4a90d9" style={{pointerEvents:'none'}}><path transform="rotate(180 480 -480)" d="m291-192-51-51 240-240 240 240-51 51-189-189-189 189Zm0-285-51-51 240-240 240 240-51 51-189-189-189 189Z"/></svg>;
  const svgCollapseAll = <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#4a90d9" style={{pointerEvents:'none'}}><path d="m291-192-51-51 240-240 240 240-51 51-189-189-189 189Zm0-285-51-51 240-240 240 240-51 51-189-189-189 189Z"/></svg>;

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#fff', fontFamily: 'system-ui, sans-serif', cursor: isPanning ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >

      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Loading sankey3-graph.json...</p>
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
          <p style={{ color: 'red', fontSize: 14 }}>{error}</p>
        </div>
      )}

      {layout && (
        <>
            <style>{`
              @keyframes snk-fade-in { from { opacity: 0 } to { opacity: 1 } }
              .snk-node { animation: snk-fade-in 0.25s ease forwards; }
            `}</style>
            <svg
              ref={svgRef}
              width={svgWidth}
              height={svgHeight}
              overflow="visible"
              style={{ position: 'absolute', inset: 0, display: 'block' }}
            >
              {/* Backdrop: full-SVG invisible rect for deselection on background click */}
              <rect
                x={0} y={0} width={svgWidth} height={svgHeight}
                fill="transparent"
                onClick={() => { if (!didPanRef.current) selectNode(null); }}
              />
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {/* Gradient for merged project nodes */}
                <defs>
                  <linearGradient id="proj-node-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#4db870" />
                    <stop offset="100%" stopColor="#e07040" />
                  </linearGradient>
                </defs>

                {/* Column labels with totals */}
                {(() => {
                  const maxCol = layout.maxCol || 1;
                  const amt = (n: LayoutNode) => n.value;
                  const colNodeTypes = ['total', 'ministry', 'project-budget', 'recipient'] as const;
                  const colNodes = colNodeTypes.map(t =>
                    t === 'total'
                      ? layout.nodes.filter(n => n.type === 'total')
                      : layout.nodes.filter(n => n.type === t)
                  );
                  const colTotals: (number | null)[] = colNodes.map((nodes, i) =>
                    i === 0 ? (nodes[0] ? amt(nodes[0]) : null) : nodes.reduce((s, n) => s + amt(n), 0)
                  );
                  const colCounts: (number | null)[] = colNodes.map((nodes, i) =>
                    i === 0 ? null : nodes.length
                  );
                  return COL_LABELS.map((label, i) => {
                    const x = (i / maxCol) * (layout.innerW - NODE_W);
                    const total = colTotals[i];
                    return (
                      <text
                        key={i}
                        x={x + NODE_W / 2} y={-13}
                        textAnchor="middle" fontSize={15} fill="#999"
                        style={{ cursor: 'default', userSelect: 'none' }}
                        onMouseEnter={(e) => {
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                          setHoveredColIndex(i);
                        }}
                        onMouseMove={(e) => {
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                        }}
                        onMouseLeave={() => setHoveredColIndex(null)}
                      >
                        {label}{total != null ? ` ${formatYen(total)}` : ''}
                      </text>
                    );
                  });
                })()}

                {/* Links (skip internal project-budget → project-spending links) */}
                {layout.links.filter(link => !(link.source.type === 'project-budget' && link.target.type === 'project-spending')).map((link) => (
                  <path
                    key={`${link.source.id}→${link.target.id}`}
                    fill={getLinkColor(link)}
                    fillOpacity={
                      connectedNodeIds
                        ? (connectedNodeIds.has(link.source.id) && connectedNodeIds.has(link.target.id))
                          ? (hoveredLink === link ? 0.45 : 0.35)
                          : 0.05
                        : hoveredLink === link ? 0.6
                          : hoveredNode && (link.source === hoveredNode || link.target === hoveredNode) ? 0.5
                          : (hoveredNode || hoveredLink) ? 0.1
                          : 0.25
                    }
                    stroke="none"
                    strokeWidth={0}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                      setHoveredLink(link);
                    }}
                    onMouseMove={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                    }}
                    onMouseLeave={() => setHoveredLink(null)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'grab', transition: 'fill-opacity 0.2s ease, d 0.3s ease', d: `path("${ribbonPath(link)}")` } as React.CSSProperties}
                  />
                ))}

                {/* Label clip regions per non-last column */}
                {(() => {
                  const colSpacing = layout.maxCol > 0 ? (layout.innerW - NODE_W) / layout.maxCol : layout.innerW;
                  const lastCol = layout.maxCol;
                  const cols = new Set(layout.nodes.map(n => getColumn(n)));
                  return Array.from(cols).filter(c => c < lastCol).map(c => (
                    <defs key={`clip-col-${c}`}>
                      <clipPath id={`clip-col-${c}`}>
                        <rect x={c * colSpacing + NODE_W} y={-1000} width={colSpacing - NODE_W} height={10000} />
                      </clipPath>
                    </defs>
                  ));
                })()}

                {/* Nodes */}
                {(() => {
                  const lastCol = layout.maxCol;
                  // Build spending node lookup for merged project rendering
                  const spendingByBudgetId = new Map<string, LayoutNode>();
                  for (const n of layout.nodes) {
                    if (n.type === 'project-spending' && n.projectId != null) {
                      spendingByBudgetId.set(`project-budget-${n.projectId}`, n);
                    } else if (n.id === '__agg-project-spending') {
                      spendingByBudgetId.set('__agg-project-budget', n);
                    }
                  }
                  // project-spending nodes are rendered as part of their budget node
                  return layout.nodes.filter(node => node.type !== 'project-spending').map((node) => {
                    if (node.type === 'project-budget' || node.id === '__agg-project-budget') {
                      // Merged project node: budget (left) + spending (right) as one shape
                      const spendingNode = spendingByBudgetId.get(node.id);
                      const bH = Math.max(1, node.y1 - node.y0);
                      const sH = spendingNode ? Math.max(1, spendingNode.y1 - spendingNode.y0) : bH;
                      const isConnected = connectedNodeIds
                        ? (connectedNodeIds.has(node.id) || (spendingNode != null && connectedNodeIds.has(spendingNode.id)))
                        : null;
                      const isSelectedMerged = node.id === selectedNodeId || spendingNode?.id === selectedNodeId;
                      const labelVisible = showLabels || Math.max(bH, sH) * zoom > 10 || isSelectedMerged;
                      const nodeOpacity = connectedNodeIds
                        ? (isConnected ? 1 : 0.3)
                        : (hoveredNode && hoveredNode !== node ? 0.4 : 1);
                      const nodeFill = node.aggregated ? '#999' : 'url(#proj-node-grad)';
                      if (!spendingNode) {
                        // No paired spending node — render as plain budget rect
                        return (
                          <g key={node.id} className="snk-node" style={{ transform: `translateY(${node.y0}px)`, transition: 'transform 0.3s ease' }}>
                            <rect x={node.x0} y={0} width={NODE_W} fill={getNodeColor(node)} rx={1}
                              style={{ height: bH, opacity: nodeOpacity, cursor: 'pointer', transition: 'opacity 0.2s ease, height 0.3s ease' }}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onClick={(e) => handleNodeClick(node, e)}
                            />
                            {labelVisible && (
                              <text x={node.x1 + 3} y={bH / 2} fontSize={11 / zoom} dominantBaseline="middle"
                                fill={connectedNodeIds && !isConnected ? '#bbb' : '#333'}
                                style={{ userSelect: 'none', pointerEvents: 'none' }} clipPath={`url(#clip-col-${getColumn(node)})`}>
                                {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(node.rawValue ?? node.value)})
                              </text>
                            )}
                          </g>
                        );
                      }
                      return (
                        <g key={node.id} className="snk-node" style={{ transform: `translateY(${node.y0}px)`, transition: 'transform 0.3s ease' }}>
                          <path
                            d={mergedProjectPath(node.x0, NODE_W, bH, sH)}
                            fill={nodeFill}
                            style={{ opacity: nodeOpacity, cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                            onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                            onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                            onMouseLeave={() => setHoveredNode(null)}
                            onClick={(e) => handleNodeClick(node, e)}
                          />
                          {labelVisible && (<>
                            {/* Left label: budget amount */}
                            <text x={node.x0 - 3} y={bH / 2} fontSize={11 / zoom} dominantBaseline="middle" textAnchor="end"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : '#888'}
                              style={{ userSelect: 'none', pointerEvents: 'none' }}>
                              {formatYen(node.rawValue ?? node.value)}
                            </text>
                            {/* Right label: project name + spending amount */}
                            <text x={spendingNode.x1 + 3} y={sH / 2} fontSize={11 / zoom} dominantBaseline="middle"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', pointerEvents: 'none' }} clipPath={`url(#clip-col-${getColumn(node)})`}>
                              {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(spendingNode.value)}){spendingNode.isScaled && spendingNode.rawValue != null && (<tspan fill="#777"> / {formatYen(spendingNode.rawValue)}</tspan>)}
                            </text>
                          </>)}
                        </g>
                      );
                    }
                    // Regular node (total, ministry, recipient)
                    const h = node.y1 - node.y0;
                    const isSelected = node.id === selectedNodeId;
                    const labelVisible = showLabels || (h + NODE_PAD) * zoom > 10 || isSelected;
                    const col = getColumn(node);
                    const isLastCol = col === lastCol;
                    return (
                      <g key={node.id} className="snk-node" style={{ transform: `translateY(${node.y0}px)`, transition: 'transform 0.3s ease' }}>
                        <rect
                          x={node.x0}
                          y={0}
                          width={NODE_W}
                          fill={getNodeColor(node)}
                          rx={1}
                          style={{
                            height: Math.max(1, h),
                            opacity: connectedNodeIds
                              ? (connectedNodeIds.has(node.id) ? 1 : 0.3)
                              : (hoveredNode && hoveredNode !== node ? 0.4 : 1),
                            cursor: 'pointer',
                            transition: 'opacity 0.2s ease, height 0.3s ease',
                          }}
                          onMouseEnter={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                            setHoveredNode(node);
                          }}
                          onMouseMove={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                          }}
                          onMouseLeave={() => setHoveredNode(null)}
                          onClick={(e) => handleNodeClick(node, e)}
                        />
                        {labelVisible && (
                          <text
                            x={node.x1 + 3}
                            y={h / 2}
                            fontSize={11 / zoom}
                            dominantBaseline="middle"
                            fill={connectedNodeIds && !connectedNodeIds.has(node.id) ? '#bbb' : '#333'}
                            style={{ userSelect: 'none', pointerEvents: 'none' }}
                            clipPath={isLastCol ? undefined : `url(#clip-col-${col})`}
                          >
                            {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(node.value)}){node.isScaled && node.rawValue != null && (<tspan fill="#777"> / {formatYen(node.rawValue)}</tspan>)}
                          </text>
                        )}
                      </g>
                    );
                  });
                })()}
              </g>
              </g>
            </svg>

            {/* Minimap */}
            {showMinimap && (
              <canvas
                ref={minimapRef}
                width={MINIMAP_W}
                height={minimapH}
                onClick={(e) => { e.stopPropagation(); minimapNavigate(e); }}
                onMouseDown={(e) => { e.stopPropagation(); minimapDragging.current = true; minimapNavigate(e); }}
                onMouseMove={(e) => { if (minimapDragging.current) minimapNavigate(e); }}
                onMouseUp={() => { minimapDragging.current = false; }}
                onMouseLeave={() => { minimapDragging.current = false; }}
                style={{
                  position: 'absolute',
                  left: selectedNodeId !== null ? (isPanelCollapsed ? 26 : 288) : 8,
                  bottom: 8,
                  zIndex: 10,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  cursor: 'crosshair',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  transition: 'left 0.2s ease',
                }}
              />
            )}

          {/* DOM tooltip — link hover */}
          {hoveredLink && !hoveredNode && (
            <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y - 10, background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '6px 10px', borderRadius: 4, fontSize: 12, lineHeight: 1.4, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20 }}>
              <div>{hoveredLink.source.name} → {hoveredLink.target.name}</div>
              <div style={{ color: '#adf' }}>{formatYen(hoveredLink.value)}</div>
              <div style={{ color: '#aaa', fontSize: 11 }}>{Math.round(hoveredLink.value).toLocaleString()}円</div>
            </div>
          )}
          {/* DOM tooltip — node hover (mini: name + amount only) */}
          {hoveredNode && (
            <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y - 10, background: 'rgba(0,0,0,0.78)', color: '#fff', padding: '5px 9px', borderRadius: 4, fontSize: 12, lineHeight: 1.4, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20 }}>
              <div style={{ fontWeight: 500 }}>{hoveredNode.name}</div>
              <div style={{ color: '#7df', fontSize: 11 }}>{formatYen(hoveredNode.value)}</div>
              <div style={{ color: '#aaa', fontSize: 10 }}>{Math.round(hoveredNode.value).toLocaleString()}円</div>
              {hoveredNode.isScaled && hoveredNode.rawValue != null && (
                <div style={{ color: '#888', fontSize: 10 }}>/ {formatYen(hoveredNode.rawValue)}</div>
              )}
            </div>
          )}
          {/* DOM tooltip — column label hover */}
          {hoveredColIndex !== null && layout && (() => {
            const amt = (n: LayoutNode) => n.value;
            const colNodeTypes = ['total', 'ministry', 'project-budget', 'recipient'] as const;
            const nodes = hoveredColIndex === 0
              ? layout.nodes.filter(n => n.type === 'total')
              : layout.nodes.filter(n => n.type === colNodeTypes[hoveredColIndex]);
            const total = hoveredColIndex === 0
              ? (nodes[0] ? amt(nodes[0]) : 0)
              : nodes.reduce((s, n) => s + amt(n), 0);
            const count = hoveredColIndex === 0 ? null : nodes.length;
            const colDescs = [
              '全事業の予算額合計（予算案ベース）',
              '各府省庁所管事業の予算額合計',
              '各事業の予算額（左：予算 / 右：支出）',
              '全エッジ合計（ウィンドウ外流入含む）',
            ];
            return (
              <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y + 16, background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '8px 12px', borderRadius: 4, fontSize: 12, lineHeight: 1.5, pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap' }}>
                <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{COL_LABELS[hoveredColIndex]}</div>
                {count != null && <div style={{ color: '#aaa', fontSize: 11 }}>{count.toLocaleString()}件</div>}
                <div style={{ color: '#7df' }}>{formatYen(total)}</div>
                <div style={{ color: '#aaa', fontSize: 11 }}>{Math.round(total).toLocaleString()}円</div>
                <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>{colDescs[hoveredColIndex]}</div>
              </div>
            );
          })()}
        </>
      )}

      {/* Left side panel — node detail */}
      {selectedNodeId !== null && (
        <div
          data-pan-disabled="true"
          style={{
            position: 'fixed', left: 0, top: 0, height: '100%',
            width: isPanelCollapsed ? 0 : 280,
            background: '#fff',
            borderRight: isPanelCollapsed ? 'none' : '1px solid #e0e0e0',
            boxShadow: isPanelCollapsed ? 'none' : '2px 0 8px rgba(0,0,0,0.1)',
            zIndex: 25,
            transition: 'width 0.2s ease',
            overflow: 'visible',
            cursor: 'default',
          }}
        >
          {/* Collapse/expand toggle + close buttons on right edge */}
          <div
            data-pan-disabled="true"
            style={{
              position: 'absolute', right: -25, top: '50%', transform: 'translateY(-50%)',
              width: 25,
              background: '#fff', border: '1px solid #e0e0e0', borderLeft: 'none',
              borderRadius: '0 6px 6px 0',
              boxShadow: '2px 0 4px rgba(0,0,0,0.08)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
          >
            {/* Collapse/expand button: panel folds, node stays selected */}
            <button
              data-pan-disabled="true"
              onClick={() => setIsPanelCollapsed(c => !c)}
              title={isPanelCollapsed ? 'パネルを展開' : 'パネルを折りたたむ'}
              style={{
                width: 25, height: 56,
                background: 'transparent', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, borderRadius: '0 6px 6px 0',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {isPanelCollapsed
                  ? <polyline points="9 6 15 12 9 18"/>
                  : <polyline points="15 6 9 12 15 18"/>}
              </svg>
            </button>
          </div>

          {/* Panel content */}
          {!isPanelCollapsed && selectedNode && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header — fixed, never scrolls */}
              <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>
                      {selectedNode.name}
                    </div>
                    {(() => {
                      // Main value (予算額 for budget types, 支出額 for spending type)
                      let mainValue = 0;
                      let mainLabel = '';
                      let subValue: number | null = null;
                      let subLabel = '';
                      if (selectedNode.type === 'total' || selectedNode.type === 'ministry') {
                        const stats = selectedNode.type === 'total'
                          ? Array.from(ministryProjectStats.values())
                          : (ministryProjectStats.has(selectedNode.name) ? [ministryProjectStats.get(selectedNode.name)!] : []);
                        mainValue = selectedNode.value;
                        mainLabel = '予算額';
                        subValue = stats.reduce((s, v) => s + v.spendingTotal, 0);
                        subLabel = '支出額';
                      } else if (selectedNode.type === 'project-budget') {
                        mainValue = selectedNode.value;
                        mainLabel = '予算額';
                        if (selectedNode.projectId != null) {
                          const sn = filtered?.nodes.find(n => n.type === 'project-spending' && n.projectId === selectedNode.projectId);
                          if (sn) { subValue = sn.value; subLabel = '支出額'; }
                        }
                      } else if (selectedNode.type === 'project-spending') {
                        mainValue = selectedNode.value;
                        mainLabel = '支出額';
                        if (selectedNode.projectId != null) {
                          const bn = filtered?.nodes.find(n => n.type === 'project-budget' && n.projectId === selectedNode.projectId);
                          if (bn) { subValue = bn.value; subLabel = '予算額'; }
                        }
                      } else {
                        mainValue = selectedNode.value;
                      }
                      const rawMain = selectedNode.isScaled && selectedNode.rawValue != null ? selectedNode.rawValue : null;
                      const rawMainLabel = mainLabel ? `元の${mainLabel}` : '元の値';
                      return (<>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#222', marginTop: 3 }}>
                          {mainLabel && <span style={{ fontSize: 10, color: '#aaa', fontWeight: 400, marginRight: 4 }}>{mainLabel}</span>}
                          {formatYen(mainValue)}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{Math.round(mainValue).toLocaleString()}円</div>
                        {rawMain !== null && (
                          <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>
                            <span style={{ fontSize: 10, color: '#ccc', marginRight: 4 }}>{rawMainLabel}</span>
                            {formatYen(rawMain)}
                            <span style={{ fontSize: 10, color: '#ccc', marginLeft: 4 }}>{Math.round(rawMain).toLocaleString()}円</span>
                          </div>
                        )}
                        {subValue !== null && (
                          <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: '#aaa', marginRight: 4 }}>{subLabel}</span>
                            {formatYen(subValue)}
                            <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>{Math.round(subValue).toLocaleString()}円</span>
                          </div>
                        )}
                      </>);
                    })()}
                  </div>
                  <button
                    onClick={() => selectNode(null)}
                    title="閉じる（選択解除）"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 16, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
                  >✕</button>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ background: getNodeColor(selectedNode), color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                    {TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                  </span>
                  {selectedNode.aggregated && (
                    <span style={{ background: '#999', color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>集約</span>
                  )}
                  {selectedNode.ministry && selectedNode.type !== 'ministry' && (
                    <span style={{ fontSize: 11, color: '#666' }}>{selectedNode.ministry}</span>
                  )}
                </div>
              </div>

              {/* 事業統計（total / ministry ノード） */}
              {(selectedNode?.type === 'total' || selectedNode?.type === 'ministry') && (() => {
                const isTotalNode = selectedNode.type === 'total';
                const allStats = isTotalNode
                  ? Array.from(ministryProjectStats.values())
                  : (ministryProjectStats.has(selectedNode.name) ? [ministryProjectStats.get(selectedNode.name)!] : []);
                const totalProjects = allStats.reduce((s, v) => s + v.total, 0);
                return (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      事業 <span style={{ fontWeight: 400 }}>{totalProjects.toLocaleString()}件</span>
                    </div>
                  </div>
                );
              })()}


              {/* 流入元 / 流出先 タブ */}
              {selectedNodeAllConnections && (() => {
                const hasIn = selectedNodeAllConnections.inEdges.length > 0;
                const hasOut = selectedNodeAllConnections.outEdges.length > 0;
                const activeTab = connectionTab;
                const tabBtnBase: React.CSSProperties = { flex: 1, padding: '6px 4px', fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', color: '#999' };
                const tabBtnActive: React.CSSProperties = { ...tabBtnBase, color: '#333', borderBottom: '2px solid #4a90d9' };
                // grouped list helper (for recipient / agg-project nodes)
                type GroupItem = { id: string; name: string; value: number; ministry?: string; aggregated?: boolean };
                const renderGrouped = (rawMembers: GroupItem[]) => {
                  const grouped = new Map<string, GroupItem[]>();
                  for (const item of rawMembers) {
                    const key = item.ministry ?? '(不明)';
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key)!.push(item);
                  }
                  const sortedGroups = Array.from(grouped.entries()).sort((a, b) =>
                    b[1].reduce((s, x) => s + x.value, 0) - a[1].reduce((s, x) => s + x.value, 0)
                  );
                  const btnStyle: React.CSSProperties = { fontSize: 11, color: '#4a90d9', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' };
                  return sortedGroups.map(([ministry, items]) => {
                    const isCollapsed = collapsedMinistries.has(ministry);
                    const displayCount = ministryDisplayCounts.get(ministry) ?? 10;
                    const total = items.reduce((s, x) => s + x.value, 0);
                    const remaining = items.length - displayCount;
                    return (
                      <div key={ministry} style={{ marginBottom: 4 }}>
                        <button type="button" aria-expanded={!isCollapsed}
                          onClick={() => setCollapsedMinistries(prev => { const next = new Set(prev); if (next.has(ministry)) next.delete(ministry); else next.add(ministry); return next; })}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: '#f8f8f8', border: 'none', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', gap: 6 }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isCollapsed ? '▶' : '▼'} {ministry}</span>
                          <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>{items.length}件 {formatYen(total)}</span>
                        </button>
                        {!isCollapsed && (<>
                          {items.slice(0, displayCount).map((item, i) => {
                            const spId = item.id.startsWith('project-budget-') ? item.id.replace('project-budget-', 'project-spending-') : item.id;
                            const rCount = projectRecipientCount.get(spId);
                            return (
                              <button key={i} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 6px', borderBottom: '1px solid #f5f5f5', width: '100%', background: 'transparent', border: 'none', cursor: item.aggregated ? 'default' : 'pointer', gap: 6, textAlign: 'left' }}
                              >
                                <span title={item.name} style={{ flex: 1, fontSize: 12, color: item.aggregated ? '#999' : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {rCount != null && <span style={{ fontSize: 10, color: '#bbb', marginRight: 4 }}>{rCount.toLocaleString()}先</span>}
                                  {formatYen(item.value)}
                                </span>
                              </button>
                            );
                          })}
                          <div style={{ display: 'flex', gap: 0, padding: '2px 4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                            {remaining > 0 && <>
                              <button onClick={() => setMinistryDisplayCounts(prev => new Map(prev).set(ministry, displayCount + 10))} style={btnStyle}>さらに{Math.min(10, remaining)}件（残{remaining}）</button>
                              <button onClick={() => setMinistryDisplayCounts(prev => new Map(prev).set(ministry, items.length))} style={iconBtnStyle} title="すべて表示" aria-label="すべて表示">{svgExpandAll}</button>
                            </>}
                            {displayCount > 10 && <button onClick={() => setMinistryDisplayCounts(prev => new Map(prev).set(ministry, 10))} style={iconBtnStyle} title="折りたたむ" aria-label="折りたたむ">{svgCollapseAll}</button>}
                          </div>
                        </>)}
                      </div>
                    );
                  });
                };
                // collapse-all toggle for grouped views
                const renderGroupToggle = (members: GroupItem[]) => {
                  const allMinistries = Array.from(new Set(members.map(m => m.ministry ?? '(不明)')));
                  const allCollapsed = allMinistries.every(m => collapsedMinistries.has(m));
                  return (
                    <button type="button" onClick={() => setCollapsedMinistries(allCollapsed ? new Set() : new Set(allMinistries))}
                      style={iconBtnStyle} title={allCollapsed ? 'すべて展開' : 'すべて折りたたむ'} aria-label={allCollapsed ? 'すべて展開' : 'すべて折りたたむ'}>
                      {allCollapsed ? svgExpandAll : svgCollapseAll}
                    </button>
                  );
                };
                return (
                  <div style={{ borderTop: '1px solid #f0f0f0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fff' }}>
                      <button type="button" style={activeTab === 'in' ? tabBtnActive : tabBtnBase} onClick={() => setConnectionTab('in')}>
                        流入元 <span style={{ fontWeight: 400, fontSize: 11 }}>({
                          (selectedNode?.id === '__agg-project-spending' || selectedNode?.id === '__agg-project-budget') && filtered?.aggNodeMembers?.has('__agg-project-budget')
                            ? filtered.aggNodeMembers.get('__agg-project-budget')!.length
                            : selectedNode?.id === '__agg-recipient' && filtered?.aggNodeMembers?.has('__agg-project-spending')
                              ? selectedNodeAllConnections.inEdges.reduce((s, item) =>
                                  s + (item.id === '__agg-project-spending' ? (filtered.aggNodeMembers.get('__agg-project-spending')?.length ?? 1) : 1), 0)
                              : selectedNodeAllConnections.inEdges.length
                        })</span>
                      </button>
                      <button type="button" style={activeTab === 'out' ? tabBtnActive : tabBtnBase} onClick={() => setConnectionTab('out')}>
                        流出先 <span style={{ fontWeight: 400, fontSize: 11 }}>({
                          selectedNode?.id === '__agg-project-budget' && filtered?.aggNodeMembers?.has('__agg-project-spending')
                            ? filtered.aggNodeMembers.get('__agg-project-spending')!.length
                            : selectedNode?.id === '__agg-project-spending' && filtered?.aggNodeMembers?.has('__agg-recipient')
                              ? selectedNodeAllConnections.outEdges.reduce((s, item) =>
                                  s + (item.id === '__agg-recipient' ? (filtered.aggNodeMembers.get('__agg-recipient')?.length ?? 1) : 1), 0)
                              : selectedNodeAllConnections.outEdges.length
                        })</span>
                      </button>
                    </div>

                    {/* Tab content */}
                    <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
                      {activeTab === 'in' && !hasIn && <p style={{ fontSize: 12, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>}
                      {activeTab === 'in' && hasIn && (() => {
                        const useGrouped = selectedNode?.type === 'recipient' || selectedNode?.id === '__agg-project-spending' || selectedNode?.id === '__agg-project-budget';
                        const aggMembers: GroupItem[] = selectedNode?.id === '__agg-project-spending' && filtered?.aggNodeMembers?.has('__agg-project-budget')
                          ? filtered.aggNodeMembers.get('__agg-project-budget')!
                          : selectedNode?.id === '__agg-project-budget' && filtered?.aggNodeMembers?.has('__agg-project-budget')
                          ? filtered.aggNodeMembers.get('__agg-project-budget')!
                          : selectedNode?.type === 'recipient'
                            // expand __agg-project-spending within inEdges before grouping
                            ? selectedNodeAllConnections.inEdges.flatMap(item =>
                                item.id === '__agg-project-spending' && filtered?.aggNodeMembers?.has('__agg-project-spending')
                                  ? filtered.aggNodeMembers.get('__agg-project-spending')!
                                  : [item]
                              )
                            : selectedNodeAllConnections.inEdges;
                        return (<>
                          {useGrouped && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>{renderGroupToggle(aggMembers)}</div>}
                          {useGrouped ? renderGrouped(aggMembers) : (<>
                            {(() => {
                              // expand __agg-project-spending inline when rendering __agg-recipient inEdges
                              const expandedInEdges = selectedNode?.id === '__agg-recipient'
                                ? selectedNodeAllConnections.inEdges.flatMap(item =>
                                    item.id === '__agg-project-spending' && filtered?.aggNodeMembers?.has('__agg-project-spending')
                                      ? filtered.aggNodeMembers.get('__agg-project-spending')!
                                      : [item]
                                  )
                                : selectedNodeAllConnections.inEdges;
                              return (<>
                                {expandedInEdges.slice(0, inDisplayCount).map((item, i) => {
                                  const spId = item.id.startsWith('project-budget-') ? item.id.replace('project-budget-', 'project-spending-') : item.id;
                                  const rCount = projectRecipientCount.get(spId);
                                  return (
                                    <button key={i} type="button" onClick={() => handleConnectionClick(item.id)}
                                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f5f5f5', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', gap: 6, textAlign: 'left' }}
                                    >
                                      <span title={item.name} style={{ flex: 1, fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {item.name}
                                      </span>
                                      <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {rCount != null && <span style={{ fontSize: 10, color: '#bbb', marginRight: 4 }}>{rCount.toLocaleString()}先</span>}
                                        {formatYen(item.value)}
                                      </span>
                                    </button>
                                  );
                                })}
                                {(() => { const rem = expandedInEdges.length - inDisplayCount; return (
                                  <div style={{ display: 'flex', gap: 0, padding: '2px 0', alignItems: 'center', justifyContent: 'flex-end' }}>
                                    {rem > 0 && <>
                                      <button onClick={() => setInDisplayCount(c => c + 10)} style={{ fontSize: 11, color: '#4a90d9', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>さらに{Math.min(10, rem)}件（残{rem}）</button>
                                      <button onClick={() => setInDisplayCount(expandedInEdges.length)} style={iconBtnStyle} title="すべて表示" aria-label="すべて表示">{svgExpandAll}</button>
                                    </>}
                                    {inDisplayCount > 8 && <button onClick={() => setInDisplayCount(8)} style={iconBtnStyle} title="折りたたむ" aria-label="折りたたむ">{svgCollapseAll}</button>}
                                  </div>
                                ); })()}
                              </>);
                            })()}
                          </>)}
                        </>);
                      })()}

                      {activeTab === 'out' && !hasOut && <p style={{ fontSize: 12, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>}
                      {activeTab === 'out' && hasOut && (() => {
                        const useGrouped = selectedNode?.id === '__agg-project-budget' && filtered?.aggNodeMembers?.has('__agg-project-spending');
                        const aggMembers = useGrouped ? filtered!.aggNodeMembers.get('__agg-project-spending')! : [];
                        // expand __agg-recipient inline when rendering __agg-project-spending outEdges
                        const expandedOutEdges = (selectedNode?.id === '__agg-project-spending'
                          ? selectedNodeAllConnections.outEdges.flatMap(item =>
                              item.id === '__agg-recipient' && filtered?.aggNodeMembers?.has('__agg-recipient')
                                ? filtered.aggNodeMembers.get('__agg-recipient')!
                                : [item]
                            )
                          : selectedNodeAllConnections.outEdges
                        ).slice().sort((a, b) => b.value - a.value);
                        return (<>
                          {useGrouped && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>{renderGroupToggle(aggMembers)}</div>}
                          {useGrouped ? renderGrouped(aggMembers) : (<>
                            {expandedOutEdges.slice(0, outDisplayCount).map((item, i) => {
                              const spId = item.id.startsWith('project-budget-') ? item.id.replace('project-budget-', 'project-spending-') : item.id;
                              const rCount = projectRecipientCount.get(spId);
                              return (
                                <button key={i} type="button" onClick={() => handleConnectionClick(item.id)}
                                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #f5f5f5', cursor: 'pointer', gap: 6, textAlign: 'left' }}
                                >
                                  <span title={item.name} style={{ flex: 1, fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                  <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {rCount != null && <span style={{ fontSize: 10, color: '#bbb', marginRight: 4 }}>{rCount.toLocaleString()}先</span>}
                                    {formatYen(item.value)}
                                  </span>
                                </button>
                              );
                            })}
                            {(() => { const rem = expandedOutEdges.length - outDisplayCount; return (
                              <div style={{ display: 'flex', gap: 0, padding: '2px 0', alignItems: 'center', justifyContent: 'flex-end' }}>
                                {rem > 0 && <>
                                  <button onClick={() => setOutDisplayCount(c => c + 10)} style={{ fontSize: 11, color: '#4a90d9', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>さらに{Math.min(10, rem)}件（残{rem}）</button>
                                  <button onClick={() => setOutDisplayCount(expandedOutEdges.length)} style={iconBtnStyle} title="すべて表示" aria-label="すべて表示">{svgExpandAll}</button>
                                </>}
                                {outDisplayCount > 8 && <button onClick={() => setOutDisplayCount(8)} style={iconBtnStyle} title="折りたたむ" aria-label="折りたたむ">{svgCollapseAll}</button>}
                              </div>
                            ); })()}
                          </>)}
                        </>);
                      })()}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Search box — top left */}
      <div
        data-pan-disabled="true"
        style={{ position: 'absolute', top: 12, left: selectedNodeId !== null && !isPanelCollapsed ? 292 : 12, zIndex: 100, width: 260, transition: 'left 0.2s ease' }}
      >
        <div style={{ position: 'relative' }}>
          {/* Search icon */}
          <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999"
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowSearchResults(true); setSearchCursorIndex(-1); }}
            onFocus={() => { if (debouncedQuery.trim().length >= 2) setShowSearchResults(true); }}
            onKeyDown={e => {
              if (e.key === 'Escape') { setShowSearchResults(false); setSearchQuery(''); setDebouncedQuery(''); setSearchCursorIndex(-1); return; }
              if (!showSearchResults || searchResults.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSearchCursorIndex(i => {
                  const next = Math.min(i + 1, searchResults.length - 1);
                  setTimeout(() => searchDropdownRef.current?.children[next]?.scrollIntoView({ block: 'nearest' }), 0);
                  return next;
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSearchCursorIndex(i => {
                  const next = Math.max(i - 1, 0);
                  setTimeout(() => searchDropdownRef.current?.children[next]?.scrollIntoView({ block: 'nearest' }), 0);
                  return next;
                });
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (searchCursorIndex >= 0 && searchCursorIndex < searchResults.length) {
                  handleSearchSelect(searchResults[searchCursorIndex].id);
                  setSearchCursorIndex(-1);
                }
              }
            }}
            placeholder="ノード検索（2文字以上）"
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 30, paddingRight: searchQuery ? 28 : 10, paddingTop: 7, paddingBottom: 7,
              fontSize: 13, border: '1px solid #e0e0e0', borderRadius: 8,
              background: 'rgba(255,255,255,0.95)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              outline: 'none', color: '#333',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setDebouncedQuery(''); setShowSearchResults(false); searchInputRef.current?.focus(); }}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
            >✕</button>
          )}
        </div>
        {/* Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div ref={searchDropdownRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto', zIndex: 20 }}>
            {searchResults.map((node, i) => (
              <button
                key={node.id}
                type="button"
                onClick={() => { handleSearchSelect(node.id); setSearchCursorIndex(-1); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: i === searchCursorIndex ? '#e8f0fe' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => { if (i !== searchCursorIndex) e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={e => { e.currentTarget.style.background = i === searchCursorIndex ? '#e8f0fe' : 'transparent'; }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: getNodeColor(node) }} />
                <span title={node.name} style={{ flex: 1, fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(node.value)}</span>
              </button>
            ))}
          </div>
        )}
        {/* No results */}
        {showSearchResults && debouncedQuery.trim().length >= 2 && searchResults.length === 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '10px 12px', fontSize: 12, color: '#999', zIndex: 20 }}>
            該当なし
          </div>
        )}
      </div>

      {/* Top-right panel: offset slider */}
      {filtered && (() => {
        const maxOffset = Math.max(0, filtered.totalRecipientCount - topRecipient);
        const clampedOffset = Math.min(recipientOffset, maxOffset);
        const rangeStart = clampedOffset + 1;
        const rangeEnd = Math.min(clampedOffset + topRecipient, filtered.totalRecipientCount);
        const maxStartRank = maxOffset + 1;
        return (
          <div style={{ position: 'absolute', top: 12, right: 52, zIndex: 15, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.92)', padding: '5px 10px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#555', fontSize: 11 }}>支出先:</span>
              {isEditingOffset ? (
                <input
                  type="number"
                  autoFocus
                  min={1} max={maxStartRank} step={1}
                  value={offsetInputValue}
                  onChange={e => { setOffsetInputValue(e.target.value); const v = Number(e.target.value); if (!isNaN(v) && v >= 1) { pendingHistoryAction.current = 'replace'; setRecipientOffset(Math.max(0, Math.min(maxOffset, v - 1))); } }}
                  onBlur={() => setIsEditingOffset(false)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setIsEditingOffset(false); }}
                  style={{ width: `${Math.max(40, String(maxStartRank).length * 8 + 20)}px`, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                />
              ) : (
                <button
                  onClick={() => { setOffsetInputValue(String(rangeStart)); setIsEditingOffset(true); }}
                  title="クリックして開始位置を入力"
                  style={{ color: '#999', fontSize: 11, background: 'transparent', border: 'none', cursor: 'text', padding: 0 }}
                >{rangeStart}</button>
              )}
              <span style={{ color: '#999', fontSize: 11 }}>〜{rangeEnd}位</span>
              <input type="range" min={0} max={maxOffset} value={clampedOffset} onChange={e => { pendingHistoryAction.current = 'replace'; setRecipientOffset(Number(e.target.value)); }} style={{ width: 100 }} />
              <span style={{ color: '#999', fontSize: 11 }}>/{filtered.totalRecipientCount}件</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
                {([
                  [1,  'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '次へ'],
                  [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '前へ'],
                ] as [number, string, string][]).map(([delta, path, title]) => (
                  <button key={delta} title={title} aria-label={title}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      const step = () => { pendingHistoryAction.current = 'replace'; setRecipientOffset(prev => Math.max(0, Math.min(maxOffset, prev + delta))); };
                      stopOffsetRepeat();
                      step();
                      offsetRepeatRef.current = setTimeout(() => {
                        offsetRepeatRef.current = setInterval(step, 150);
                      }, 400);
                    }}
                    onPointerUp={stopOffsetRepeat} onPointerLeave={stopOffsetRepeat} onPointerCancel={stopOffsetRepeat}
                    onClick={(e) => { if (e.detail === 0) { pendingHistoryAction.current = 'replace'; setRecipientOffset(prev => Math.max(0, Math.min(maxOffset, prev + delta))); } }}
                    style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none' }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path}/></svg>
                  </button>
                ))}
              </div>
              {/* Material Icons: vertical_align_top — オフセットリセット */}
              <button onClick={e => { e.preventDefault(); pendingHistoryAction.current = 'replace'; setRecipientOffset(0); }} title="先頭へリセット" aria-label="先頭へリセット"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#555" style={{ transform: 'rotate(-90deg)' }}><path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z"/></svg>
                </button>
            </label>
          </div>
        );
      })()}

      {/* Settings button — independent, top right */}
      <div style={{ position: 'absolute', top: 14, right: 12, zIndex: 15 }}>
        <button
          onClick={() => setShowSettings(s => !s)}
          aria-label="TopN 設定を開く"
          aria-expanded={showSettings}
          aria-controls="sankey-topn-settings"
          aria-haspopup="dialog"
          style={{ width: 32, height: 32, border: 'none', borderRadius: 6, background: showSettings ? 'rgba(255,255,255,0.92)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Material Icons: more_vert */}
          <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill={showSettings ? '#333' : '#888'}>
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
        {showSettings && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 18 }} onMouseDown={() => setShowSettings(false)} />
            <div id="sankey-topn-settings" role="dialog" aria-label="TopN 設定" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowSettings(false); }} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 19, background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '12px 16px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', fontSize: 12, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10, colorScheme: 'light', color: '#333' }}>
              <div style={{ fontWeight: 'bold', color: '#333', marginBottom: 2 }}>TopN 設定</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 48, color: '#555' }}>省庁:</span>
                <input type="number" min={1} max={37} value={topMinistry} onChange={e => { pendingHistoryAction.current = 'replace'; setTopMinistry(Math.max(1, Math.min(37, Number(e.target.value) || 1))); }} style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                <input type="range" min={1} max={37} value={topMinistry} onChange={e => { pendingHistoryAction.current = 'replace'; setTopMinistry(Number(e.target.value)); }} style={{ flex: 1 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 48, color: '#555' }}>事業:</span>
                <input type="number" min={1} max={100} value={topProject} onChange={e => { pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(100, Number(e.target.value) || 1))); }} style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                <input type="range" min={1} max={100} value={topProject} onChange={e => { pendingHistoryAction.current = 'replace'; setTopProject(Number(e.target.value)); }} style={{ flex: 1 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 48, color: '#555' }}>支出先:</span>
                <input type="number" min={1} max={100} value={topRecipient} onChange={e => { pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(100, Number(e.target.value) || 1))); }} style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                <input type="range" min={1} max={100} value={topRecipient} onChange={e => { pendingHistoryAction.current = 'replace'; setTopRecipient(Number(e.target.value)); }} style={{ flex: 1 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showLabels} onChange={e => { pendingHistoryAction.current = 'replace'; setShowLabels(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>すべてのノードラベルを表示</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={includeZeroSpending} onChange={e => { pendingHistoryAction.current = 'replace'; setIncludeZeroSpending(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>支出が0円の事業を対象にする</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showAggRecipient} onChange={e => { pendingHistoryAction.current = 'replace'; setShowAggRecipient(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>支出先の集約ノードを表示</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={scaleBudgetToVisible} onChange={e => { pendingHistoryAction.current = 'replace'; setScaleBudgetToVisible(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>事業の予算額を支出額に合わせて調整</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={focusRelated} onChange={e => { pendingHistoryAction.current = 'replace'; setFocusRelated(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>選択ノードの関連ノードのみ表示</span>
              </label>
            </div>
          </>
        )}
      </div>

      {/* Zoom controls — bottom right (sankey2 style) */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* + / vertical slider / - */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Material Icons: add */}
          <button aria-label="ズームイン" onClick={() => applyZoom(1.5)} title="ズームイン" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
          <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
            <input
              type="range"
              aria-label="ズーム倍率"
              min={Math.log10(0.2)}
              max={Math.log10(baseZoom * 10)}
              step={0.01}
              value={Math.log10(Math.max(0.2, Math.min(baseZoom * 10, zoom)))}
              onChange={e => { const newK = Math.pow(10, parseFloat(e.target.value)); applyZoom(newK / zoom); }}
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16, height: 80 }}
              title={`Zoom: ${Math.round(zoom / baseZoom * 100)}%`}
            />
          </div>
          {/* Material Icons: remove */}
          <button aria-label="ズームアウト" onClick={() => applyZoom(1 / 1.5)} title="ズームアウト" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13H5v-2h14v2z"/></svg>
          </button>
        </div>
        {/* Zoom% — 非編集時は "N%" 表示、クリックで数値入力 */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
          {isEditingZoom ? (
            <input
              type="number"
              autoFocus
              min={1} max={1000} step={1}
              value={zoomInputValue}
              onChange={e => { setZoomInputValue(e.target.value); const v = Number(e.target.value); if (!isNaN(v) && v > 0) applyZoom((v / 100 * baseZoom) / zoom); }}
              onBlur={() => setIsEditingZoom(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setIsEditingZoom(false); }}
              style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '3px 0', border: 'none', outline: 'none', background: 'transparent', color: '#555', boxSizing: 'border-box' }}
            />
          ) : (
            <button
              onClick={() => { setZoomInputValue(String(Math.round(zoom / baseZoom * 100))); setIsEditingZoom(true); }}
              title="クリックしてZoom率を入力"
              style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '4px 0', border: 'none', background: 'transparent', color: '#888', cursor: 'text' }}
            >{Math.round(zoom / baseZoom * 100)}%</button>
          )}
        </div>
        {/* 全体表示ボタン */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
          {/* fit screen */}
          <button aria-label="全体表示" onClick={resetViewport} title="全体表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path d="M792-576v-120H672v-72h120q30 0 51 21.15T864-696v120h-72Zm-696 0v-120q0-30 21.15-51T168-768h120v72H168v120H96Zm576 384v-72h120v-120h72v120q0 30-21.15 51T792-192H672Zm-504 0q-30 0-51-21.15T96-264v-120h72v120h120v72H168Zm72-144v-288h480v288H240Zm72-72h336v-144H312v144Zm0 0v-144 144Z"/></svg>
          </button>
        </div>
        {/* 選択ノードフォーカスボタン — 選択中のみ表示 */}
        {selectedNodeInLayout && (
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            {/* Material Icons: account_tree (flowchart) */}
            <button aria-label="選択ノードと接続先をフィット表示" onClick={() => focusOnNeighborhood()} title="選択ノードと接続先をフィット表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path transform="scale(-1, 1) translate(-960, 0)" d="M576-168v-84H444v-192h-60v84H96v-240h288v84h60v-192h132v-84h288v240H576v-84h-60v312h60v-84h288v240H576Zm72-72h144v-96H648v96ZM168-432h144v-96H168v96Zm480-192h144v-96H648v96Zm0 384v-96 96ZM312-432v-96 96Zm336-192v-96 96Z"/></svg>
            </button>
            {/* Focus */}
            <button aria-label="選択ノードにフォーカス" onClick={focusOnSelectedNode} title="選択ノードにフォーカス" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', borderTop: '1px solid #eee', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path transform="rotate(180 480 -480)" d="M168-360h240v-240H168v240Zm312 72H96v-384h384v156h384v72H480v156ZM288-480Z"/></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
