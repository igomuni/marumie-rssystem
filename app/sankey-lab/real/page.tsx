'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';

// ── Types ──

interface ApiNode {
  id: string;
  name: string;
  type: string;
  value: number;
  originalId?: number;
}

interface ApiLink {
  source: string;
  target: string;
  value: number;
}

interface LayoutNode extends ApiNode {
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

// Column assignment: total-budget gets its own column (0), ministries shift to 1
function getColumn(node: { id: string; type: string }): number {
  if (node.id === 'total-budget') return 0;
  const COL_MAP: Record<string, number> = {
    'ministry-budget': 1,
    'project-budget': 2,
    'project-spending': 3,
    'recipient': 4,
    'subcontract-recipient': 5,
    'other': 4,
  };
  return COL_MAP[node.type] ?? 0;
}

// Sort priority: 0 = normal, 1 = "その他" (named), 2 = "TopN以外" (aggregated, always bottom)
function sortPriority(node: { id: string; name: string }): number {
  // "以外" in name = TopN以外 aggregation → always last
  if (node.name.includes('以外')) return 2;
  // IDs ending with -other-aggregated or -other-global → last
  if (node.id.endsWith('-other-aggregated') || node.id.endsWith('-other-global')) return 2;
  // "その他" named node → after TopN but before TopN以外
  if (node.id.endsWith('-other-named') || node.name === 'その他') return 1;
  return 0;
}

const SVG_W = 1100;
const SVG_H = 700;
const MARGIN = { top: 30, right: 120, bottom: 10, left: 100 };
const INNER_W = SVG_W - MARGIN.left - MARGIN.right;
const INNER_H = SVG_H - MARGIN.top - MARGIN.bottom;
const NODE_W = 20;
const NODE_PAD = 4;

// Budget side = green tones, Spending side = red/warm tones
const TYPE_COLORS: Record<string, string> = {
  'total-budget': '#2d7d46',
  'ministry-budget': '#3a9a5c',
  'project-budget': '#4db870',
  'project-spending': '#e07040',
  'recipient': '#d94545',
  'subcontract-recipient': '#b03a5a',
  'other': '#999',
};

function getNodeColor(node: { id: string; type: string }): string {
  if (node.id === 'total-budget') return TYPE_COLORS['total-budget'];
  return TYPE_COLORS[node.type] || '#999';
}

function getLinkColor(link: { source: { type: string }; target: { type: string } }): string {
  // If target is spending-side, use warm color; otherwise green
  const tgtType = link.target.type;
  if (tgtType === 'project-spending' || tgtType === 'recipient' || tgtType === 'subcontract-recipient') {
    return '#e07040';
  }
  return '#4db870';
}

// ── Custom Layout Engine ──

function computeLayout(apiNodes: ApiNode[], apiLinks: ApiLink[]) {
  // Determine how many columns are actually used
  const usedCols = new Set<number>();
  for (const n of apiNodes) {
    usedCols.add(getColumn(n));
  }
  const maxCol = Math.max(...usedCols, 1);
  const colSpacing = (INNER_W - NODE_W) / maxCol;

  // Build nodes
  const nodeMap = new Map<string, LayoutNode>();
  for (const n of apiNodes) {
    nodeMap.set(n.id, {
      ...n,
      x0: 0, x1: 0, y0: 0, y1: 0,
      sourceLinks: [],
      targetLinks: [],
    });
  }

  // Build links
  const links: LayoutLink[] = [];
  for (const l of apiLinks) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;
    const link: LayoutLink = {
      source: src, target: tgt, value: l.value,
      sourceWidth: 0, targetWidth: 0, y0: 0, y1: 0,
    };
    links.push(link);
    src.sourceLinks.push(link);
    tgt.targetLinks.push(link);
  }

  const nodes = Array.from(nodeMap.values());

  // Node values = max(in, out) — use API value as fallback
  for (const node of nodes) {
    const srcSum = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const tgtSum = node.targetLinks.reduce((s, l) => s + l.value, 0);
    const linkValue = Math.max(srcSum, tgtSum);
    if (linkValue > 0) node.value = linkValue;
  }

  // Group by column
  const columns: Map<number, LayoutNode[]> = new Map();
  for (const node of nodes) {
    const col = getColumn(node);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  // Sort: TopN以外 always at bottom, rest by value descending (incl. その他)
  for (const [, colNodes] of columns) {
    colNodes.sort((a, b) => {
      const ap = sortPriority(a);
      const bp = sortPriority(b);
      if (ap !== bp) return ap - bp;
      return b.value - a.value;
    });
  }

  // Global ky
  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + n.value, 0);
    const totalPadding = Math.max(0, (colNodes.length - 1) * NODE_PAD);
    const available = INNER_H - totalPadding;
    if (totalValue > 0) ky = Math.min(ky, available / totalValue);
  }
  if (!isFinite(ky)) ky = 1;

  // Assign x/y
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

  // Compute link widths and y positions
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

  return { nodes, links, ky, maxCol };
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

// ── Component ──

const PRESETS = [
  { label: 'Global View (top3省庁×top3事業×top10支出先)', params: 'limit=3&projectLimit=3&spendingLimit=10' },
  { label: 'Global View (top5省庁×top5事業×top5支出先)', params: 'limit=5&projectLimit=5&spendingLimit=5' },
  { label: '厚生労働省', params: 'limit=3&projectLimit=5&spendingLimit=10&ministry=厚生労働省' },
  { label: '国土交通省', params: 'limit=3&projectLimit=5&spendingLimit=10&ministry=国土交通省' },
  { label: '防衛省', params: 'limit=3&projectLimit=5&spendingLimit=10&ministry=防衛省' },
];

export default function RealDataSankeyPage() {
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [apiNodes, setApiNodes] = useState<ApiNode[]>([]);
  const [apiLinks, setApiLinks] = useState<ApiLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<LayoutLink | null>(null);

  const fetchData = useCallback(async (presetIndex: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sankey?${PRESETS[presetIndex].params}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setApiNodes(data.sankey.nodes);
      setApiLinks(data.sankey.links);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selectedPreset);
  }, [selectedPreset, fetchData]);

  const layout = useMemo(() => {
    if (apiNodes.length === 0) return null;
    return computeLayout(apiNodes, apiLinks);
  }, [apiNodes, apiLinks]);

  const colLabels = useMemo(() => {
    if (!layout) return [];
    const labels = ['総計', '省庁', '事業(予算)', '事業(支出)', '支出先', '再委託先'];
    return labels.slice(0, layout.maxCol + 1);
  }, [layout]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Custom Sankey — Real Data</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>自前レイアウトエンジン + 実データ（API経由）</p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => setSelectedPreset(i)}
            style={{
              padding: '6px 12px', fontSize: 12,
              border: '1px solid #ccc', borderRadius: 4,
              background: i === selectedPreset ? '#333' : '#fff',
              color: i === selectedPreset ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {layout && (
        <>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            Nodes: {layout.nodes.length} / Links: {layout.links.length} / ky: {layout.ky.toFixed(8)}
          </p>

          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 4, overflowX: 'auto' }}>
            <svg width={SVG_W} height={SVG_H}>
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {/* Column labels */}
                {colLabels.map((label, i) => {
                  const maxCol = layout.maxCol || 1;
                  const x = (i / maxCol) * INNER_W;
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
                    fillOpacity={hoveredLink === link ? 0.6 : 0.25}
                    stroke={hoveredLink === link ? getLinkColor(link) : 'none'}
                    strokeWidth={hoveredLink === link ? 1 : 0}
                    onMouseEnter={() => setHoveredLink(link)}
                    onMouseLeave={() => setHoveredLink(null)}
                    style={{ cursor: 'pointer' }}
                  />
                ))}

                {/* Nodes */}
                {layout.nodes.map((node) => {
                  const h = node.y1 - node.y0;
                  const showLabel = h > 8;
                  return (
                    <g key={node.id}>
                      <rect
                        x={node.x0}
                        y={node.y0}
                        width={NODE_W}
                        height={Math.max(1, h)}
                        fill={getNodeColor(node)}
                        rx={1}
                      />
                      {showLabel && (
                        <text
                          x={node.x1 + 3}
                          y={node.y0 + h / 2}
                          fontSize={9}
                          dominantBaseline="middle"
                          fill="#333"
                        >
                          {node.name.length > 15 ? node.name.slice(0, 15) + '…' : node.name}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Hover tooltip */}
                {hoveredLink && (
                  <g>
                    <rect
                      x={INNER_W / 2 - 160}
                      y={INNER_H - 30}
                      width={320}
                      height={24}
                      fill="rgba(0,0,0,0.8)"
                      rx={4}
                    />
                    <text
                      x={INNER_W / 2}
                      y={INNER_H - 14}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#fff"
                    >
                      {hoveredLink.source.name} → {hoveredLink.target.name}: ¥{hoveredLink.value.toLocaleString()}
                    </text>
                  </g>
                )}
              </g>
            </svg>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12 }}>
            {[
              { label: '予算側', color: '#4db870' },
              { label: '支出側', color: '#e07040' },
            ].map(({ label, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
                {label}
              </div>
            ))}
            <span style={{ color: '#999' }}>|</span>
            <span>Nodes: {layout.nodes.length} / Links: {layout.links.length}</span>
          </div>
        </>
      )}
    </div>
  );
}
