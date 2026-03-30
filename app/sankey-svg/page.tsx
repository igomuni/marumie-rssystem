'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// ── Types ──

interface RawNode {
  id: string;
  name: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  value: number;
  /** Actual value preserved when layout height is capped (used for tooltip display) */
  rawValue?: number;
  /** If set, layout engine caps node height to this value after computing link-sum */
  layoutCap?: number;
  aggregated?: boolean;
  projectId?: number;
  ministry?: string;
}

interface RawEdge {
  source: string;
  target: string;
  value: number;
}

interface GraphData {
  metadata: {
    totalBudget: number;
    totalSpending: number;
    directSpending: number;
    indirectSpending: number;
    ministryCount: number;
    projectCount: number;
    recipientCount: number;
  };
  nodes: RawNode[];
  edges: RawEdge[];
}

interface LayoutNode extends RawNode {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sourceLinks: LayoutLink[];
  targetLinks: LayoutLink[];
}

interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  value: number;
  sourceWidth: number;
  targetWidth: number;
  y0: number;
  y1: number;
}

// ── Layout constants ──

const COL_MAP: Record<string, number> = {
  'total': 0,
  'ministry': 1,
  'project-budget': 2,
  'project-spending': 3,
  'recipient': 4,
};

function getColumn(node: { type: string }): number {
  return COL_MAP[node.type] ?? 0;
}

function sortPriority(node: { id: string; name: string; aggregated?: boolean }): number {
  if (node.aggregated) return 2;
  if (node.name === 'その他') return 1;
  return 0;
}

const SVG_H_MIN = 400;
const MARGIN = { top: 30, right: 20, bottom: 10, left: 20 };
const NODE_W = 18;
const NODE_PAD = 2;

const TYPE_COLORS: Record<string, string> = {
  'total': '#2d7d46',
  'ministry': '#3a9a5c',
  'project-budget': '#4db870',
  'project-spending': '#e07040',
  'recipient': '#d94545',
};

function getNodeColor(node: { type: string; aggregated?: boolean }): string {
  if (node.aggregated) return '#999';
  return TYPE_COLORS[node.type] || '#999';
}

function getLinkColor(link: { target: { type: string } }): string {
  const tgtType = link.target.type;
  if (tgtType === 'project-spending' || tgtType === 'recipient') return '#e07040';
  return '#4db870';
}

// ── Client-side TopN filtering ──

function filterTopN(
  allNodes: RawNode[],
  allEdges: RawEdge[],
  topMinistry: number,
  topProject: number,
  topRecipient: number,
  recipientOffset: number,
): { nodes: RawNode[]; edges: RawEdge[]; totalRecipientCount: number } {
  // Build O(1) lookup map
  const nodeById = new Map(allNodes.map(n => [n.id, n]));

  // 1. TopN ministries by total value (stable ranking)
  const ministries = allNodes.filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value);
  const topMinistryNodes = ministries.slice(0, topMinistry);
  const topMinistryIds = new Set(topMinistryNodes.map(n => n.id));
  const topMinistryNames = new Set(topMinistryNodes.map(n => n.name));
  const otherMinistries = ministries.slice(topMinistry);

  // 2. Recipient window — ranked by total amount across ALL edges (stable ranking)
  const allRecipientAmounts = new Map<string, number>();
  for (const e of allEdges) {
    if (e.target.startsWith('r-')) {
      allRecipientAmounts.set(e.target, (allRecipientAmounts.get(e.target) || 0) + e.value);
    }
  }
  const allSortedRecipients = Array.from(allRecipientAmounts.entries()).sort((a, b) => b[1] - a[1]);
  const totalRecipientCount = allSortedRecipients.length;
  const windowRecipients = allSortedRecipients.slice(recipientOffset, recipientOffset + topRecipient);
  const windowRecipientIds = new Set(windowRecipients.map(([id]) => id));
  const tailRecipients = allSortedRecipients.slice(recipientOffset + topRecipient);
  const tailRecipientIds = new Set(tailRecipients.map(([id]) => id));

  // 3. Per-project window spending (all projects, used for re-ranking)
  const projectWindowValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      projectWindowValue.set(e.source, (projectWindowValue.get(e.source) || 0) + e.value);
    }
  }

  // 4. TopN projects re-ranked by WINDOW spending (dynamic as offset changes)
  //    Scope: projects belonging to top ministries only
  const topMinistryAllProjects = allNodes.filter(
    n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || '')
  );
  topMinistryAllProjects.sort(
    (a, b) => (projectWindowValue.get(b.id) || 0) - (projectWindowValue.get(a.id) || 0)
  );
  const topProjectNodes = topMinistryAllProjects
    .slice(0, topProject)
    .filter(n => (projectWindowValue.get(n.id) || 0) > 0);
  const topProjectIds = new Set(topProjectNodes.map(n => n.id));

  const otherMinistryProjects = allNodes.filter(
    n => n.type === 'project-spending' && !topMinistryNames.has(n.ministry || '')
  );
  const otherProjects = [
    ...topMinistryAllProjects.filter(n => !topProjectIds.has(n.id)),
    ...otherMinistryProjects,
  ];
  const otherProjectSpendingIds = new Set(otherProjects.map(n => n.id));

  // 5. Aggregated values
  let otherProjectWindowTotal = 0;
  for (const e of allEdges) {
    if (otherProjectSpendingIds.has(e.source) && windowRecipientIds.has(e.target)) {
      otherProjectWindowTotal += e.value;
    }
  }
  let otherProjectTailTotal = 0;
  for (const e of allEdges) {
    if (otherProjectSpendingIds.has(e.source) && tailRecipientIds.has(e.target)) {
      otherProjectTailTotal += e.value;
    }
  }

  const totalWindowSpending = windowRecipients.reduce((s, [, v]) => s + v, 0);

  // 6. Ministry window values
  const ministryWindowValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      const spNode = nodeById.get(e.source);
      if (spNode?.type === 'project-spending' && spNode.ministry) {
        ministryWindowValue.set(spNode.ministry, (ministryWindowValue.get(spNode.ministry) || 0) + e.value);
      }
    }
  }
  const otherMinistryWindowValue = otherMinistries.reduce((s, n) => s + (ministryWindowValue.get(n.name) || 0), 0);

  // ── Build nodes ──
  const nodes: RawNode[] = [];
  const totalNode = allNodes.find(n => n.type === 'total');
  if (totalNode) nodes.push({ ...totalNode, value: totalWindowSpending });

  for (const n of topMinistryNodes) {
    const wv = ministryWindowValue.get(n.name) || 0;
    if (wv > 0) nodes.push({ ...n, value: wv });
  }
  if (otherMinistryWindowValue > 0) {
    nodes.push({ id: '__agg-ministry', name: `${otherMinistries.length.toLocaleString()}省庁`, type: 'ministry', value: otherMinistryWindowValue, aggregated: true });
  }

  for (const n of topProjectNodes) {
    const wv = projectWindowValue.get(n.id) || 0;
    const budgetNode = nodeById.get(`project-budget-${n.projectId}`);
    if (budgetNode) nodes.push({ ...budgetNode, value: wv });
    // layoutCap = wv: the tail edge (project-spending → __agg-recipient) makes srcSum > tgtSum,
    // causing computeLayout to inflate the node height to window + tail. Cap it to window only.
    nodes.push({ ...n, value: wv, layoutCap: wv });
  }
  // Create __agg-project-budget only when there is window spending (needs ministry→budget edges).
  // Create __agg-project-spending whenever there is ANY flow through it (window OR tail),
  // so that the tail edge __agg-project-spending→__agg-recipient always has a valid source node.
  if (otherProjectWindowTotal > 0 || otherProjectTailTotal > 0) {
    const minTopProjectWindowValue = topProjectNodes.length > 0
      ? Math.min(...topProjectNodes.map(n => projectWindowValue.get(n.id) || 0))
      : 0;
    const projectLayoutCap = minTopProjectWindowValue > 0 ? minTopProjectWindowValue * topProject : otherProjectTailTotal;
    if (otherProjectWindowTotal > 0) {
      nodes.push({ id: '__agg-project-budget', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-budget', value: otherProjectWindowTotal, layoutCap: projectLayoutCap, aggregated: true });
    }
    nodes.push({ id: '__agg-project-spending', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-spending', value: otherProjectWindowTotal, layoutCap: projectLayoutCap, aggregated: true });
  }

  for (const [rid] of windowRecipients) {
    const rNode = nodeById.get(rid);
    if (rNode) nodes.push({ ...rNode, value: allRecipientAmounts.get(rid) || rNode.value });
  }
  const tailValue = tailRecipients.reduce((s, [, v]) => s + v, 0);
  const aggRecipientValue = tailValue + otherProjectTailTotal;
  if (aggRecipientValue > 0) {
    // Cap layout height so the aggregate bar doesn't overwhelm the window recipients.
    // Cap = min window-recipient value × topRecipient  (≈ total height of all window bars if all were minimum-sized).
    const minWindowRecipientValue = windowRecipients.length > 0
      ? Math.min(...windowRecipients.map(([, v]) => v))
      : aggRecipientValue;
    const layoutCap = minWindowRecipientValue * topRecipient;
    nodes.push({
      id: '__agg-recipient',
      name: `${tailRecipients.length.toLocaleString()}支出先`,
      type: 'recipient',
      value: aggRecipientValue,
      layoutCap: layoutCap,
      aggregated: true,
    });
  }

  // ── Build edges ──
  const edges: RawEdge[] = [];

  // total → ministry
  for (const mn of topMinistryNodes) {
    const wv = ministryWindowValue.get(mn.name) || 0;
    if (wv > 0) edges.push({ source: 'total', target: mn.id, value: wv });
  }
  if (otherMinistryWindowValue > 0) {
    edges.push({ source: 'total', target: '__agg-ministry', value: otherMinistryWindowValue });
  }

  // ministry → project-budget
  for (const n of topProjectNodes) {
    const wv = projectWindowValue.get(n.id) || 0;
    if (wv > 0) edges.push({ source: `ministry-${n.ministry}`, target: `project-budget-${n.projectId}`, value: wv });
  }
  if (otherProjectWindowTotal > 0) {
    for (const mn of topMinistryNodes) {
      const v = otherProjects
        .filter(p => p.ministry === mn.name)
        .reduce((s, p) => s + (projectWindowValue.get(p.id) || 0), 0);
      if (v > 0) edges.push({ source: mn.id, target: '__agg-project-budget', value: v });
    }
    const otherMinRemain = otherProjects
      .filter(p => !topMinistryNames.has(p.ministry || ''))
      .reduce((s, p) => s + (projectWindowValue.get(p.id) || 0), 0);
    if (otherMinRemain > 0) edges.push({ source: '__agg-ministry', target: '__agg-project-budget', value: otherMinRemain });
  }

  // project-budget → project-spending
  for (const n of topProjectNodes) {
    const wv = projectWindowValue.get(n.id) || 0;
    edges.push({ source: `project-budget-${n.projectId}`, target: n.id, value: wv });
  }
  if (otherProjectWindowTotal > 0) {
    edges.push({ source: '__agg-project-budget', target: '__agg-project-spending', value: otherProjectWindowTotal });
  }

  // project-spending → window recipients
  const topProjectSpendingIds = new Set(topProjectNodes.map(n => n.id));
  for (const e of allEdges) {
    if (topProjectSpendingIds.has(e.source) && windowRecipientIds.has(e.target)) edges.push(e);
  }
  // project-spending → __agg-recipient (tail)
  for (const sp of topProjectNodes) {
    const v = allEdges.filter(e => e.source === sp.id && tailRecipientIds.has(e.target)).reduce((s, e) => s + e.value, 0);
    if (v > 0) edges.push({ source: sp.id, target: '__agg-recipient', value: v });
  }

  // __agg-project-spending → window recipients
  for (const rid of windowRecipientIds) {
    const v = allEdges.filter(e => otherProjectSpendingIds.has(e.source) && e.target === rid).reduce((s, e) => s + e.value, 0);
    if (v > 0) edges.push({ source: '__agg-project-spending', target: rid, value: v });
  }
  // __agg-project-spending → __agg-recipient (tail)
  if (otherProjectTailTotal > 0) {
    edges.push({ source: '__agg-project-spending', target: '__agg-recipient', value: otherProjectTailTotal });
  }

  return { nodes, edges, totalRecipientCount };
}

// ── Custom Layout Engine ──

function computeLayout(filteredNodes: RawNode[], filteredEdges: RawEdge[], containerWidth: number, containerHeight: number) {
  const innerW = containerWidth - MARGIN.left - MARGIN.right;
  const innerH = containerHeight - MARGIN.top - MARGIN.bottom;
  const usedCols = new Set<number>();
  for (const n of filteredNodes) usedCols.add(getColumn(n));
  const maxCol = Math.max(...usedCols, 1);
  const colSpacing = (innerW - NODE_W) / maxCol;

  const nodeMap = new Map<string, LayoutNode>();
  for (const n of filteredNodes) {
    nodeMap.set(n.id, { ...n, x0: 0, x1: 0, y0: 0, y1: 0, sourceLinks: [], targetLinks: [] });
  }

  const links: LayoutLink[] = [];
  for (const l of filteredEdges) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;
    const link: LayoutLink = { source: src, target: tgt, value: l.value, sourceWidth: 0, targetWidth: 0, y0: 0, y1: 0 };
    links.push(link);
    src.sourceLinks.push(link);
    tgt.targetLinks.push(link);
  }

  const nodes = Array.from(nodeMap.values());
  for (const node of nodes) {
    const srcSum = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const tgtSum = node.targetLinks.reduce((s, l) => s + l.value, 0);
    const linkValue = Math.max(srcSum, tgtSum);
    if (linkValue > 0) node.value = linkValue;
    // Apply layout cap: preserve actual value in rawValue, shrink value for height computation
    if (node.layoutCap !== undefined && node.value > node.layoutCap) {
      node.rawValue = node.value;
      node.value = node.layoutCap;
    }
  }

  const columns: Map<number, LayoutNode[]> = new Map();
  for (const node of nodes) {
    const col = getColumn(node);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  for (const [, colNodes] of columns) {
    colNodes.sort((a, b) => {
      const ap = sortPriority(a);
      const bp = sortPriority(b);
      if (ap !== bp) return ap - bp;
      return b.value - a.value;
    });
  }

  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + n.value, 0);
    const totalPadding = Math.max(0, (colNodes.length - 1) * NODE_PAD);
    const available = innerH - totalPadding;
    if (totalValue > 0) ky = Math.min(ky, available / totalValue);
  }
  if (!isFinite(ky)) ky = 1;

  for (const [col, colNodes] of columns) {
    for (const node of colNodes) {
      node.x0 = col * colSpacing;
      node.x1 = node.x0 + NODE_W;
    }
    let y = 0;
    for (const node of colNodes) {
      const h = Math.max(1, node.value * ky);
      node.y0 = y;
      node.y1 = y + h;
      y += h + NODE_PAD;
    }
  }

  // Sort links by target/source y-position so ribbons don't cross unnecessarily
  for (const node of nodes) {
    node.sourceLinks.sort((a, b) => a.target.y0 - b.target.y0);
    node.targetLinks.sort((a, b) => a.source.y0 - b.source.y0);
  }

  for (const node of nodes) {
    const nodeHeight = node.y1 - node.y0;
    const totalSrcValue = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const totalTgtValue = node.targetLinks.reduce((s, l) => s + l.value, 0);
    let sy = node.y0;
    for (const link of node.sourceLinks) {
      const proportion = totalSrcValue > 0 ? link.value / totalSrcValue : 0;
      link.sourceWidth = nodeHeight * proportion;
      link.y0 = sy;
      sy += link.sourceWidth;
    }
    let ty = node.y0;
    for (const link of node.targetLinks) {
      const proportion = totalTgtValue > 0 ? link.value / totalTgtValue : 0;
      link.targetWidth = nodeHeight * proportion;
      link.y1 = ty;
      ty += link.targetWidth;
    }
  }

  // Content bounding box (in inner coords, before MARGIN)
  let contentMaxX = 0, contentMaxY = 0;
  for (const node of nodes) {
    contentMaxX = Math.max(contentMaxX, node.x1);
    contentMaxY = Math.max(contentMaxY, node.y1);
  }

  const LABEL_SPACE = 200; // approximate space for rightmost column labels
  return { nodes, links, ky, maxCol, innerW, innerH, contentW: contentMaxX + NODE_W + LABEL_SPACE, contentH: contentMaxY };
}

function ribbonPath(link: LayoutLink): string {
  const sx = link.source.x1;
  const tx = link.target.x0;
  const sTop = link.y0;
  const sBot = sTop + link.sourceWidth;
  const tTop = link.y1;
  const tBot = tTop + link.targetWidth;
  const mx = (sx + tx) / 2;
  return `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}`
    + `L${tx},${tBot}`
    + `C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`;
}

function formatYen(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}兆円`;
  if (value >= 1e8) return `${Math.round(value / 1e8).toLocaleString()}億円`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}万円`;
  return `${value.toLocaleString()}円`;
}

// ── Component ──

const COL_LABELS = ['総計', '省庁', '事業(予算)', '事業(支出)', '支出先'];

export default function RealDataSankeyPage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topMinistry, setTopMinistry] = useState(37);
  const [topProject, setTopProject] = useState(50);
  const [topRecipient, setTopRecipient] = useState(100);
  const [recipientOffset, setRecipientOffset] = useState(0);
  const [hoveredLink, setHoveredLink] = useState<LayoutLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Container size (responsive to window)
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(1200);
  const [svgHeight, setSvgHeight] = useState(800);

  useEffect(() => {
    const updateSize = () => {
      const el = containerRef.current;
      if (!el) return;
      setSvgWidth(el.clientWidth);
      // Fill remaining viewport height (container top to window bottom, minus padding)
      const rect = el.getBoundingClientRect();
      const h = Math.max(SVG_H_MIN, window.innerHeight - rect.top - 40);
      setSvgHeight(h);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateSize);
    return () => { ro.disconnect(); window.removeEventListener('resize', updateSize); };
  }, []);

  // Zoom/Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Mouse position relative to SVG
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(50, zoom * delta));

    // Adjust pan so zoom centers on mouse position
    const newPanX = mx - (mx - pan.x) * (newZoom / zoom);
    const newPanY = my - (my - pan.y) * (newZoom / zoom);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // left click only
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrigin.current = { ...pan };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panOrigin.current.x + (e.clientX - panStart.current.x),
      y: panOrigin.current.y + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const layoutRef = useRef<{ contentW: number; contentH: number } | null>(null);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    setZoom(1);
    setRecipientOffset(0);
    if (container && l) {
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const totalW = MARGIN.left + l.contentW;
      const totalH = MARGIN.top + l.contentH;
      setPan({ x: (cW - totalW) / 2, y: (cH - totalH) / 2 });
    } else {
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
    // Clamp offset to valid range
    const maxOffset = Math.max(0, (graphData.nodes.filter(n => n.type === 'recipient').length) - topRecipient);
    const clampedOffset = Math.min(recipientOffset, maxOffset);
    return filterTopN(graphData.nodes, graphData.edges, topMinistry, topProject, topRecipient, clampedOffset);
  }, [graphData, topMinistry, topProject, topRecipient, recipientOffset]);

  const layout = useMemo(() => {
    if (!filtered) return null;
    const result = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight);
    layoutRef.current = { contentW: result.contentW, contentH: result.contentH };
    return result;
  }, [filtered, svgWidth, svgHeight]);

  // Center on initial load / layout change
  const initialCentered = useRef(false);
  useEffect(() => {
    if (layout && !initialCentered.current) {
      initialCentered.current = true;
      resetView();
    }
  }, [layout, resetView]);

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

  const applyZoom = useCallback((factor: number) => {
    const nz = Math.max(0.2, Math.min(50, zoom * factor));
    setPan({ x: svgWidth / 2 - (svgWidth / 2 - pan.x) * (nz / zoom), y: svgHeight / 2 - (svgHeight / 2 - pan.y) * (nz / zoom) });
    setZoom(nz);
  }, [zoom, pan, svgWidth, svgHeight]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sankey3 — 直接支出先のみ（sankey3-graph.json）</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        自前レイアウトエンジン + sankey3-graph.json（直接支出のみ、5-2 CSV判定）
        {graphData && (
          <> / 直接支出: {formatYen(graphData.metadata.directSpending)} / 間接支出: {formatYen(graphData.metadata.indirectSpending)}（データ外）</>
        )}
      </p>

      {loading && <p>Loading sankey3-graph.json...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {layout && (
        <>
          <div
            ref={containerRef}
            style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden', position: 'relative', cursor: isPanning ? 'grabbing' : 'grab' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Controls overlay */}
            <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.92)', padding: '6px 10px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                省庁:
                <input type="number" min={1} max={37} value={topMinistry} onChange={e => setTopMinistry(Math.max(1, Math.min(37, Number(e.target.value) || 1)))} style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                <input type="range" min={1} max={37} value={topMinistry} onChange={e => setTopMinistry(Number(e.target.value))} style={{ width: 80 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                事業:
                <input type="number" min={1} max={50} value={topProject} onChange={e => setTopProject(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                <input type="range" min={1} max={50} value={topProject} onChange={e => setTopProject(Number(e.target.value))} style={{ width: 80 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                支出先:
                <input type="number" min={1} max={100} value={topRecipient} onChange={e => setTopRecipient(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                <input type="range" min={1} max={100} value={topRecipient} onChange={e => setTopRecipient(Number(e.target.value))} style={{ width: 80 }} />
              </label>
              {filtered && (() => {
                const maxOffset = Math.max(0, filtered.totalRecipientCount - topRecipient);
                const clampedOffset = Math.min(recipientOffset, maxOffset);
                const rangeStart = clampedOffset + 1;
                const rangeEnd = Math.min(clampedOffset + topRecipient, filtered.totalRecipientCount);
                return (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min={1} max={rangeEnd} value={rangeStart} onChange={e => setRecipientOffset(Math.max(0, Math.min(maxOffset, (Number(e.target.value) || 1) - 1)))} style={{ width: 40, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
                    <span style={{ color: '#999', fontSize: 11 }}>〜{rangeEnd}位</span>
                    <input type="range" min={0} max={maxOffset} value={clampedOffset} onChange={e => setRecipientOffset(Number(e.target.value))} style={{ width: 100 }} />
                    <span style={{ color: '#999', fontSize: 11 }}>/{filtered.totalRecipientCount}件</span>
                  </label>
                );
              })()}
              <span style={{ color: '#ccc' }}>|</span>
              <button onClick={() => applyZoom(1.3)} style={{ width: 26, height: 26, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: '24px' }}>+</button>
              <button onClick={() => applyZoom(0.7)} style={{ width: 26, height: 26, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: '24px' }}>-</button>
              <button onClick={resetView} style={{ height: 26, padding: '0 6px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11 }}>Reset</button>
              <input
                type="number"
                min={20} max={5000} step={10}
                value={Math.round(zoom * 100)}
                onChange={e => { const nz = Math.max(0.2, Math.min(50, Number(e.target.value) / 100 || 1)); setZoom(nz); }}
                style={{ width: 48, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 11 }}
              />
              <span style={{ color: '#999', fontSize: 11 }}>%</span>
            </div>
            <svg
              ref={svgRef}
              width={svgWidth}
              height={svgHeight}
              overflow="visible"
              style={{ display: 'block' }}
            >
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {/* Column labels */}
                {COL_LABELS.map((label, i) => {
                  const maxCol = layout.maxCol || 1;
                  const x = (i / maxCol) * (layout.innerW - NODE_W);
                  return (
                    <text key={i} x={x + NODE_W / 2} y={-10} textAnchor="middle" fontSize={11} fill="#999">
                      {label}
                    </text>
                  );
                })}

                {/* Links */}
                {layout.links.map((link, i) => (
                  <path
                    key={i}
                    d={ribbonPath(link)}
                    fill={getLinkColor(link)}
                    fillOpacity={
                      hoveredLink === link ? 0.6
                      : hoveredNode && (link.source === hoveredNode || link.target === hoveredNode) ? 0.5
                      : (hoveredNode || hoveredLink) ? 0.1
                      : 0.25
                    }
                    stroke={hoveredLink === link || (hoveredNode && (link.source === hoveredNode || link.target === hoveredNode)) ? getLinkColor(link) : 'none'}
                    strokeWidth={hoveredLink === link || (hoveredNode && (link.source === hoveredNode || link.target === hoveredNode)) ? Math.min(1, Math.min(link.sourceWidth, link.targetWidth) * 0.3) : 0}
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
                    style={{ cursor: 'pointer' }}
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
                  return layout.nodes.map((node) => {
                    const h = node.y1 - node.y0;
                    // Label is 9px on screen (fontSize 9/zoom * zoom = 9).
                    // Available space per node on screen = (h + NODE_PAD) * zoom.
                    // Show label when available space exceeds font height.
                    const showLabel = (h + NODE_PAD) * zoom > 10;
                    const col = getColumn(node);
                    const isLastCol = col === lastCol;
                    return (
                      <g key={node.id}>
                        <rect
                          x={node.x0}
                          y={node.y0}
                          width={NODE_W}
                          height={Math.max(1, h)}
                          fill={getNodeColor(node)}
                          opacity={hoveredNode && hoveredNode !== node ? 0.4 : 1}
                          rx={1}
                          style={{ cursor: 'pointer' }}
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
                        />
                        {showLabel && (
                          <text
                            x={node.x1 + 3}
                            y={node.y0 + h / 2}
                            fontSize={9 / zoom}
                            dominantBaseline="middle"
                            fill="#333"
                            clipPath={isLastCol ? undefined : `url(#clip-col-${col})`}
                          >
                            {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(node.rawValue ?? node.value)})
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
                onClick={minimapNavigate}
                onMouseDown={(e) => { e.stopPropagation(); minimapDragging.current = true; minimapNavigate(e); }}
                onMouseMove={(e) => { if (minimapDragging.current) minimapNavigate(e); }}
                onMouseUp={() => { minimapDragging.current = false; }}
                onMouseLeave={() => { minimapDragging.current = false; }}
                style={{
                  position: 'absolute',
                  left: 8,
                  bottom: 8,
                  zIndex: 10,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  cursor: 'crosshair',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                }}
              />
            )}

            {/* DOM tooltip — outside SVG zoom group so it stays visible */}
            {/* DOM tooltip — link hover */}
            {hoveredLink && !hoveredNode && (
              <div
                style={{
                  position: 'absolute',
                  left: mousePos.x + 12,
                  top: mousePos.y - 10,
                  background: 'rgba(0,0,0,0.85)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  lineHeight: 1.4,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                }}
              >
                <div>{hoveredLink.source.name} → {hoveredLink.target.name}</div>
                <div style={{ color: '#adf' }}>{formatYen(hoveredLink.value)}</div>
                <div style={{ color: '#aaa', fontSize: 11 }}>{hoveredLink.value.toLocaleString()}円</div>
              </div>
            )}
            {/* DOM tooltip — node hover */}
            {hoveredNode && (
              <div
                style={{
                  position: 'absolute',
                  left: mousePos.x + 12,
                  top: mousePos.y - 10,
                  background: 'rgba(0,0,0,0.85)',
                  color: '#fff',
                  padding: '8px 12px',
                  borderRadius: 4,
                  fontSize: 12,
                  lineHeight: 1.5,
                  pointerEvents: 'none',
                  zIndex: 10,
                  maxWidth: 360,
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{hoveredNode.name}</div>
                <div style={{ color: '#7df' }}>{formatYen(hoveredNode.rawValue ?? hoveredNode.value)}</div>
                <div style={{ color: '#aaa', fontSize: 11 }}>{(hoveredNode.rawValue ?? hoveredNode.value).toLocaleString()}円</div>
                {hoveredNode.rawValue !== undefined && (
                  <div style={{ color: '#fa8', fontSize: 11 }}>※表示高さは上限値で制限</div>
                )}
                {hoveredNode.sourceLinks.length > 0 && (
                  <div style={{ marginTop: 4, color: '#ddd' }}>
                    {hoveredNode.sourceLinks.slice(0, 3).map((l, i) => (
                      <div key={i}>→ {l.target.name} ({formatYen(l.value)})</div>
                    ))}
                    {hoveredNode.sourceLinks.length > 3 && <div style={{ color: '#aaa' }}>他{hoveredNode.sourceLinks.length - 3}件</div>}
                  </div>
                )}
                {hoveredNode.targetLinks.length > 0 && (
                  <div style={{ marginTop: 4, color: '#ddd' }}>
                    {hoveredNode.targetLinks.slice(0, 3).map((l, i) => (
                      <div key={i}>← {l.source.name} ({formatYen(l.value)})</div>
                    ))}
                    {hoveredNode.targetLinks.length > 3 && <div style={{ color: '#aaa' }}>他{hoveredNode.targetLinks.length - 3}件</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12 }}>
            {[
              { label: '予算側', color: '#4db870' },
              { label: '支出側', color: '#e07040' },
              { label: '集約ノード', color: '#999' },
            ].map(({ label, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
                {label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
