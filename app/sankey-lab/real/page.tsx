'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// ── Types ──

interface RawNode {
  id: string;
  name: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  value: number;
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

const SVG_H = 800;
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
): { nodes: RawNode[]; edges: RawEdge[] } {
  // 1. TopN ministries by value
  const ministries = allNodes.filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value);
  const topMinistryNodes = ministries.slice(0, topMinistry);
  const topMinistryIds = new Set(topMinistryNodes.map(n => n.id));
  const topMinistryNames = new Set(topMinistryNodes.map(n => n.name));

  // Aggregated ministry node
  const otherMinistries = ministries.slice(topMinistry);
  const otherMinistryValue = otherMinistries.reduce((s, n) => s + n.value, 0);

  // 2. TopN projects by spending value (from top ministries only for ranking)
  const topMinistryProjectSpending = allNodes.filter(n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || ''));
  topMinistryProjectSpending.sort((a, b) => b.value - a.value);
  const topProjectNodes = topMinistryProjectSpending.slice(0, topProject);
  // Other projects = remaining from top ministries + ALL from other ministries
  const otherProjectsFromTopMinistries = topMinistryProjectSpending.slice(topProject);
  const otherMinistryProjects = allNodes.filter(n => n.type === 'project-spending' && !topMinistryNames.has(n.ministry || ''));
  const otherProjects = [...otherProjectsFromTopMinistries, ...otherMinistryProjects];
  const otherProjectValue = otherProjects.reduce((s, n) => s + n.value, 0);

  // Corresponding budget nodes
  const topBudgetIds = new Set(topProjectNodes.map(n => `project-budget-${n.projectId}`));
  const topSpendingIds = new Set(topProjectNodes.map(n => n.id));

  // 3. TopN recipients (from edges connected to top projects)
  const recipientAmounts = new Map<string, number>();
  for (const e of allEdges) {
    if (topSpendingIds.has(e.source) && e.target.startsWith('recipient-')) {
      recipientAmounts.set(e.target, (recipientAmounts.get(e.target) || 0) + e.value);
    }
  }
  // Also include recipients from other (non-top) projects
  const otherProjectSpendingIds = new Set(otherProjects.map(n => n.id));
  let otherProjectRecipientTotal = 0;
  for (const e of allEdges) {
    if (otherProjectSpendingIds.has(e.source) && e.target.startsWith('recipient-')) {
      otherProjectRecipientTotal += e.value;
    }
  }

  const sortedRecipients = Array.from(recipientAmounts.entries()).sort((a, b) => b[1] - a[1]);
  const topRecipientIds = new Set(sortedRecipients.slice(0, topRecipient).map(([id]) => id));
  const otherRecipientValue = sortedRecipients.slice(topRecipient).reduce((s, [, v]) => s + v, 0) + otherProjectRecipientTotal;

  // Build filtered nodes
  const nodes: RawNode[] = [];
  const totalNode = allNodes.find(n => n.type === 'total');
  if (totalNode) nodes.push(totalNode);

  // Top ministries
  for (const n of topMinistryNodes) nodes.push(n);
  if (otherMinistryValue > 0) {
    nodes.push({ id: 'ministry-other', name: `その他(${otherMinistries.length}省庁)`, type: 'ministry', value: otherMinistryValue, aggregated: true });
  }

  // Top project budget + spending
  for (const n of topProjectNodes) {
    const budgetNode = allNodes.find(bn => bn.id === `project-budget-${n.projectId}`);
    if (budgetNode) nodes.push(budgetNode);
    nodes.push(n);
  }
  if (otherProjectValue > 0) {
    const otherBudgetValue = otherProjects.reduce((s, n) => {
      const bn = allNodes.find(b => b.id === `project-budget-${n.projectId}`);
      return s + (bn?.value || 0);
    }, 0);
    nodes.push({ id: 'project-budget-other', name: `その他(${otherProjects.length}事業)`, type: 'project-budget', value: otherBudgetValue, aggregated: true });
    nodes.push({ id: 'project-spending-other', name: `その他(${otherProjects.length}事業)`, type: 'project-spending', value: otherProjectValue, aggregated: true });
  }

  // Top recipients
  for (const [rid] of sortedRecipients.slice(0, topRecipient)) {
    const rNode = allNodes.find(n => n.id === rid);
    if (rNode) nodes.push({ ...rNode, value: recipientAmounts.get(rid) || rNode.value });
  }
  if (otherRecipientValue > 0) {
    nodes.push({ id: 'recipient-other', name: `その他の支出先`, type: 'recipient', value: otherRecipientValue, aggregated: true });
  }

  // Build filtered edges
  const edges: RawEdge[] = [];

  // total → ministry
  for (const e of allEdges) {
    if (e.source === 'total' && topMinistryIds.has(e.target)) edges.push(e);
  }
  if (otherMinistryValue > 0) {
    edges.push({ source: 'total', target: 'ministry-other', value: otherMinistryValue });
  }

  // ministry → project-budget
  for (const e of allEdges) {
    if (e.source.startsWith('ministry-') && topMinistryIds.has(e.source) && topBudgetIds.has(e.target)) {
      edges.push(e);
    }
  }
  // ministry → project-budget-other (aggregated)
  if (otherProjectValue > 0) {
    // From top ministries (their non-top projects)
    for (const mn of topMinistryNodes) {
      const otherBudgetForMinistry = otherProjectsFromTopMinistries
        .filter(p => p.ministry === mn.name)
        .reduce((s, p) => {
          const bn = allNodes.find(b => b.id === `project-budget-${p.projectId}`);
          return s + (bn?.value || 0);
        }, 0);
      if (otherBudgetForMinistry > 0) {
        edges.push({ source: mn.id, target: 'project-budget-other', value: otherBudgetForMinistry });
      }
    }
    // From ministry-other (all projects of non-top ministries)
    if (otherMinistryValue > 0) {
      const otherMinistryBudgetTotal = otherMinistryProjects.reduce((s, p) => {
        const bn = allNodes.find(b => b.id === `project-budget-${p.projectId}`);
        return s + (bn?.value || 0);
      }, 0);
      if (otherMinistryBudgetTotal > 0) {
        edges.push({ source: 'ministry-other', target: 'project-budget-other', value: otherMinistryBudgetTotal });
      }
    }
  }

  // project-budget → project-spending
  for (const e of allEdges) {
    if (topBudgetIds.has(e.source) && topSpendingIds.has(e.target)) edges.push(e);
  }
  if (otherProjectValue > 0) {
    const otherBudgetNode = nodes.find(n => n.id === 'project-budget-other');
    edges.push({ source: 'project-budget-other', target: 'project-spending-other', value: Math.min(otherBudgetNode?.value || 0, otherProjectValue) });
  }

  // project-spending → recipient
  for (const e of allEdges) {
    if (topSpendingIds.has(e.source) && topRecipientIds.has(e.target)) edges.push(e);
  }
  // Top spending → recipient-other
  if (otherRecipientValue > 0) {
    for (const sp of topProjectNodes) {
      const otherForProject = allEdges
        .filter(e => e.source === sp.id && e.target.startsWith('recipient-') && !topRecipientIds.has(e.target))
        .reduce((s, e) => s + e.value, 0);
      if (otherForProject > 0) {
        edges.push({ source: sp.id, target: 'recipient-other', value: otherForProject });
      }
    }
    // other spending → recipient-other
    if (otherProjectRecipientTotal > 0) {
      edges.push({ source: 'project-spending-other', target: 'recipient-other', value: otherProjectRecipientTotal });
    }
  }

  return { nodes, edges };
}

// ── Custom Layout Engine ──

function computeLayout(filteredNodes: RawNode[], filteredEdges: RawEdge[], containerWidth: number) {
  const innerW = containerWidth - MARGIN.left - MARGIN.right;
  const innerH = SVG_H - MARGIN.top - MARGIN.bottom;
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

  return { nodes, links, ky, maxCol, innerW, innerH };
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
  if (value >= 1e8) return `${(value / 1e8).toFixed(0)}億円`;
  return `${value.toLocaleString()}円`;
}

// ── Component ──

const COL_LABELS = ['総計', '省庁', '事業(予算)', '事業(支出)', '支出先'];

export default function RealDataSankeyPage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topMinistry, setTopMinistry] = useState(5);
  const [topProject, setTopProject] = useState(10);
  const [topRecipient, setTopRecipient] = useState(10);
  const [hoveredLink, setHoveredLink] = useState<LayoutLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Container width
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSvgWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
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

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

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
    return filterTopN(graphData.nodes, graphData.edges, topMinistry, topProject, topRecipient);
  }, [graphData, topMinistry, topProject, topRecipient]);

  const layout = useMemo(() => {
    if (!filtered) return null;
    return computeLayout(filtered.nodes, filtered.edges, svgWidth);
  }, [filtered, svgWidth]);

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
              <span style={{ color: '#ccc' }}>|</span>
              <button onClick={() => { const nz = Math.min(50, zoom * 1.3); setPan({ x: svgWidth/2 - (svgWidth/2 - pan.x) * (nz/zoom), y: SVG_H/2 - (SVG_H/2 - pan.y) * (nz/zoom) }); setZoom(nz); }} style={{ width: 26, height: 26, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: '24px' }}>+</button>
              <button onClick={() => { const nz = Math.max(0.2, zoom * 0.7); setPan({ x: svgWidth/2 - (svgWidth/2 - pan.x) * (nz/zoom), y: SVG_H/2 - (SVG_H/2 - pan.y) * (nz/zoom) }); setZoom(nz); }} style={{ width: 26, height: 26, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: '24px' }}>-</button>
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
              height={SVG_H}
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
                    const showLabel = h * zoom > 10;
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
                            {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(node.value)})
                          </text>
                        )}
                      </g>
                    );
                  });
                })()}
              </g>
              </g>
            </svg>

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
                <div style={{ color: '#7df' }}>{formatYen(hoveredNode.value)}</div>
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
