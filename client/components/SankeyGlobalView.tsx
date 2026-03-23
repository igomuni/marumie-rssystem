'use client';

import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  sankey as d3Sankey,
  sankeyLinkHorizontal,
  sankeyJustify,
  sankeyLeft,
} from 'd3-sankey';
import type { SankeyNode, SankeyLink } from '@/types/preset';

// d3-sankey augmented types
interface D3Node {
  id: string;
  name: string;
  type: string;
  value: number;
  details?: SankeyNode['details'];
  // d3-sankey computed
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  index?: number;
  sourceLinks?: D3Link[];
  targetLinks?: D3Link[];
}

interface D3Link {
  source: D3Node;
  target: D3Node;
  value: number;
  details?: SankeyLink['details'];
  width?: number;
  y0?: number;
  y1?: number;
  index?: number;
}

// ── Color helpers ──

function getNodeColor(type: string, name: string): string {
  if (
    name.startsWith('その他') ||
    name.match(/^府省庁\(Top\d+以外.*\)$/) ||
    name.match(/^事業\(Top\d+以外.*\)$/) ||
    name.match(/^事業\n\(Top\d+以外.*\)$/) ||
    name.match(/^支出先\(Top\d+以外.*\)$/) ||
    name.match(/^支出先\n\(Top\d+以外.*\)$/) ||
    name.match(/^再委託先\n?\(Top\d+以外.*\)$/)
  ) {
    return '#6b7280';
  }
  if (type === 'ministry-budget' || type === 'project-budget') return '#10b981';
  if (type === 'project-spending' || type === 'recipient' || type === 'subcontract-recipient') return '#ef4444';
  return '#6b7280';
}

// ── Memoized sub-components ──

const MemoNode = React.memo(function MemoNode({
  node,
  opacity,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  node: D3Node;
  opacity: number;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const x = node.x0 ?? 0;
  const y = node.y0 ?? 0;
  const w = (node.x1 ?? 0) - x;
  const h = (node.y1 ?? 0) - y;
  const color = getNodeColor(node.type, node.name);

  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill={color}
      opacity={opacity}
      style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    />
  );
});

const MemoLink = React.memo(function MemoLink({
  link,
  opacity,
  pathGenerator,
  onMouseEnter,
  onMouseLeave,
}: {
  link: D3Link;
  opacity: number;
  pathGenerator: (link: D3Link) => string | null;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}) {
  const d = pathGenerator(link);
  if (!d) return null;

  return (
    <path
      d={d}
      fill="none"
      stroke="#9ca3af"
      strokeWidth={Math.max(link.width ?? 1, 1)}
      strokeOpacity={opacity}
      style={{ transition: 'stroke-opacity 0.15s' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
});

// ── Main component ──

interface Props {
  data: { nodes: SankeyNode[]; links: SankeyLink[] };
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  hasSubcontractNodes?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onNodeClick: (node: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatCurrency: (value: number | undefined, nodeOrDetails?: any) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActualValue: (value: number | undefined, nodeOrDetails?: any) => number | undefined;
  viewState: { mode: string; projectDrilldownLevel: number; spendingDrilldownLevel: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topNSettings: any;
}

export default function SankeyGlobalView({
  data,
  width,
  height,
  margin = { top: 40, right: 100, bottom: 40, left: 100 },
  hasSubcontractNodes = false,
  onNodeClick,
  formatCurrency,
  getActualValue,
  viewState,
  topNSettings,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkIndex, setHoveredLinkIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{
    type: 'node' | 'link';
    x: number;
    y: number;
    node?: D3Node;
    link?: D3Link;
  } | null>(null);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // ── d3-sankey layout ──
  const { layoutNodes, layoutLinks, pathGenerator } = useMemo(() => {
    const nodes: D3Node[] = data.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      value: n.value,
      details: n.details,
    }));

    const nodeMap = new Map(nodes.map((n, i) => [n.id, i]));
    const links: D3Link[] = data.links
      .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
      .map((l) => ({
        source: nodes[nodeMap.get(l.source)!],
        target: nodes[nodeMap.get(l.target)!],
        value: l.value,
        details: l.details,
      }));

    const generator = d3Sankey<D3Node, D3Link>()
      .nodeId((d) => d.id)
      .nodeWidth(44)
      .nodePadding(22)
      .nodeAlign(hasSubcontractNodes ? sankeyLeft : sankeyJustify)
      .nodeSort(null) // preserve input order
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ]);

    const { nodes: layoutNodes, links: layoutLinks } = generator({
      nodes,
      links,
    });

    const pathGen = sankeyLinkHorizontal<D3Node, D3Link>();

    return { layoutNodes, layoutLinks, pathGenerator: pathGen };
  }, [data, innerWidth, innerHeight, hasSubcontractNodes]);

  // ── Adjacency map for hover highlight ──
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of layoutLinks) {
      const sId = link.source.id;
      const tId = link.target.id;
      if (!map.has(sId)) map.set(sId, new Set());
      if (!map.has(tId)) map.set(tId, new Set());
      map.get(sId)!.add(tId);
      map.get(tId)!.add(sId);
    }
    return map;
  }, [layoutLinks]);

  const isConnected = useCallback(
    (nodeId: string) => {
      if (!hoveredNodeId) return true;
      if (nodeId === hoveredNodeId) return true;
      return adjacency.get(hoveredNodeId)?.has(nodeId) ?? false;
    },
    [hoveredNodeId, adjacency]
  );

  const isLinkConnected = useCallback(
    (link: D3Link) => {
      if (!hoveredNodeId) return true;
      return link.source.id === hoveredNodeId || link.target.id === hoveredNodeId;
    },
    [hoveredNodeId]
  );

  // ── Event handlers ──
  const handleNodeMouseEnter = useCallback(
    (node: D3Node, event: React.MouseEvent) => {
      setHoveredNodeId(node.id);
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        setTooltip({
          type: 'node',
          x: event.clientX - svgRect.left,
          y: event.clientY - svgRect.top,
          node,
        });
      }
    },
    []
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
    setTooltip(null);
  }, []);

  const handleLinkMouseEnter = useCallback(
    (link: D3Link, index: number, event: React.MouseEvent) => {
      setHoveredLinkIndex(index);
      setHoveredNodeId(null);
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        setTooltip({
          type: 'link',
          x: event.clientX - svgRect.left,
          y: event.clientY - svgRect.top,
          link,
        });
      }
    },
    []
  );

  const handleLinkMouseLeave = useCallback(() => {
    setHoveredLinkIndex(null);
    setTooltip(null);
  }, []);

  // ── Label helpers (ported from nivo custom layer) ──
  const getDisplayAmount = useCallback(
    (node: D3Node): string => {
      let displayAmount: number | undefined = node.value;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = node.details as any;
      if (details && 'actualValue' in details) {
        displayAmount = details.actualValue as number;
      } else if (node.value === 0.001) {
        if (node.type === 'project-budget' && details?.totalBudget === 0) {
          displayAmount = 0;
        } else if (node.type === 'ministry-budget') {
          displayAmount = 0;
        }
      }
      return formatCurrency(displayAmount);
    },
    [formatCurrency]
  );

  const getDisplayName = useCallback(
    (node: D3Node): string => {
      let name = node.name;
      if (
        (name.match(/^事業\(Top\d+以外.*\)$/) || name.match(/^事業\n\(Top\d+以外.*\)$/)) &&
        viewState.mode === 'ministry'
      ) {
        const currentEnd = (viewState.projectDrilldownLevel + 1) * topNSettings.ministry.project;
        return `事業\n(Top${currentEnd}以外)`;
      }
      if (!name.includes('\n') && name.length > 10) {
        name = name.substring(0, 10) + '...';
      }
      return name;
    },
    [viewState, topNSettings]
  );

  const isClickable = useCallback((node: D3Node): boolean => {
    const name = node.name;
    const isProjectOtherNode = name.match(/^事業\n?\(Top\d+以外.*\)$/);
    const isSubcontractOtherNode = name.match(/^再委託先\n?\(Top\d+以外.*\)$/);

    return (
      node.id === 'ministry-budget-other' ||
      node.id === 'total-budget' ||
      node.id === 'recipient-top10-summary' ||
      node.id === 'recipient-other-aggregated' ||
      (node.type === 'ministry-budget' && node.id !== 'total-budget' && node.id !== 'ministry-budget-other') ||
      ((node.type === 'project-budget' || node.type === 'project-spending') && !isProjectOtherNode) ||
      (node.type === 'recipient' && node.id !== 'recipient-top10-summary' && node.id !== 'recipient-other-aggregated') ||
      (node.type === 'subcontract-recipient' && !isSubcontractOtherNode)
    );
  }, []);

  // ── Node tooltip renderer ──
  const renderNodeTooltip = useCallback(
    (node: D3Node) => {
      const actualNode = data.nodes.find((n) => n.id === node.id);
      if (!actualNode) return null;
      const name = actualNode.name;
      const nodeType = actualNode.type || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = actualNode.details as any;
      const value = formatCurrency(node.value, actualNode);

      return (
        <div className="bg-white px-3 py-2 rounded shadow-lg border border-gray-200 min-w-[280px]">
          <div className="font-bold text-gray-900 mb-1">{name}</div>
          <div className="text-sm text-gray-600">金額: {value}</div>
          {details && (
            <div className="text-xs text-gray-500 mt-1 space-y-0.5">
              {details.projectCount !== undefined && <div>選択事業数: {details.projectCount}</div>}
              {details.bureauCount !== undefined && <div>局・庁数: {details.bureauCount}</div>}
              {details.ministry && <div>府省庁: {details.ministry}</div>}
              {details.bureau && <div>局・庁: {details.bureau}</div>}
              {details.accountCategory && <div>会計区分: {details.accountCategory}</div>}
              {details.initialBudget !== undefined && <div>当初予算: {formatCurrency(details.initialBudget)}</div>}
              {details.supplementaryBudget !== undefined && details.supplementaryBudget > 0 && (
                <div>補正予算: {formatCurrency(details.supplementaryBudget)}</div>
              )}
              {details.carryoverBudget !== undefined && details.carryoverBudget > 0 && (
                <div>前年度繰越: {formatCurrency(details.carryoverBudget)}</div>
              )}
              {details.reserveFund !== undefined && details.reserveFund > 0 && (
                <div>予備費等: {formatCurrency(details.reserveFund)}</div>
              )}
              {details.totalBudget !== undefined && nodeType === 'project-budget' && (
                <div className="font-semibold">歳出予算現額: {formatCurrency(details.totalBudget)}</div>
              )}
              {details.executedAmount !== undefined && nodeType === 'project-budget' && details.executedAmount > 0 && (
                <div>執行額: {formatCurrency(details.executedAmount)}</div>
              )}
              {details.carryoverToNext !== undefined && details.carryoverToNext > 0 && (
                <div>翌年度繰越: {formatCurrency(details.carryoverToNext)}</div>
              )}
              {details.executionRate !== undefined && details.executionRate > 0 && (
                <div>執行率: {details.executionRate.toFixed(1)}%</div>
              )}
              {details.spendingCount !== undefined && <div>支出先数: {details.spendingCount}</div>}
              {details.corporateNumber && <div>法人番号: {details.corporateNumber}</div>}
              {details.location && <div>所在地: {details.location}</div>}
              {details.tags && (
                <div className="mt-1 pt-1 border-t border-gray-300">
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                      {details.tags.secondaryCategory}
                    </span>
                    <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs font-medium">
                      {details.tags.primaryIndustryTag}
                    </span>
                  </div>
                </div>
              )}
              {nodeType === 'subcontract-recipient' && details.sourceRecipient && (
                <div className="mt-1 pt-1 border-t border-gray-300">
                  <div className="font-semibold">委託元: {details.sourceRecipient}</div>
                  {details.flowTypes && <div>資金の流れ: {details.flowTypes}</div>}
                  {details.projects && details.projects.length > 0 && (
                    <div className="mt-1">
                      <div className="font-semibold">関連事業:</div>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {details.projects.slice(0, 5).map((proj: any, idx: number) => (
                        <div key={idx} className="ml-2">
                          &#x2022; {proj.projectName}: {formatCurrency(proj.amount)}
                        </div>
                      ))}
                      {details.projects.length > 5 && (
                        <div className="ml-2 text-gray-400">... 他{details.projects.length - 5}事業</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    },
    [data.nodes, formatCurrency]
  );

  // ── Link tooltip renderer ──
  const renderLinkTooltip = useCallback(
    (link: D3Link) => {
      const sourceNode = data.nodes.find((n) => n.id === link.source.id);
      const targetNode = data.nodes.find((n) => n.id === link.target.id);
      const actualLink = data.links.find((l) => l.source === link.source.id && l.target === link.target.id);

      const sourceName = sourceNode?.name || link.source.id;
      const targetName = targetNode?.name || link.target.id;
      const sourceValue = formatCurrency(link.source.value, sourceNode);
      const targetValue = formatCurrency(link.target.value, targetNode);
      const linkValue = formatCurrency(link.value, sourceNode);

      const isProjectBudgetToSpending =
        sourceNode?.type === 'project-budget' && targetNode?.type === 'project-spending';

      let title = '';
      if (isProjectBudgetToSpending) {
        title = sourceName;
      } else if (sourceNode?.type === 'ministry-budget') {
        title = `${sourceName} → 事業`;
      } else if (sourceNode?.type === 'project-spending') {
        title = `${sourceName} → 支出先`;
      } else {
        title = '資金の流れ';
      }

      return (
        <div className="bg-white px-4 py-3 rounded shadow-lg border border-gray-200 min-w-[280px] max-w-md">
          <div className="text-sm font-bold text-gray-900 mb-2 border-b border-gray-200 pb-2">{title}</div>
          <div className="mb-2">
            {isProjectBudgetToSpending ? (
              <div className="text-xs text-gray-500">予算</div>
            ) : (
              <div className="text-sm font-semibold text-gray-900 truncate">{sourceName}</div>
            )}
            <div className="text-sm font-medium text-gray-700">{sourceValue}</div>
          </div>
          <div className="text-center my-2">
            <div className="text-sm font-bold text-gray-900">↓ {linkValue}</div>
          </div>
          <div className="mb-2">
            {isProjectBudgetToSpending ? (
              <div className="text-xs text-gray-500">支出</div>
            ) : (
              <div className="text-sm font-semibold text-gray-900 truncate">{targetName}</div>
            )}
            <div className="text-sm font-medium text-gray-700">{targetValue}</div>
          </div>
          {actualLink?.details && (actualLink.details.contractMethod || actualLink.details.blockName) && (
            <div className="mt-3 pt-2 border-t border-gray-200">
              {actualLink.details.contractMethod && (
                <div className="mb-1">
                  <span className="text-xs text-gray-500">契約方式: </span>
                  <span className="text-xs font-medium text-gray-900">{actualLink.details.contractMethod}</span>
                </div>
              )}
              {actualLink.details.blockName && (
                <div>
                  <span className="text-xs text-gray-500">支出ブロック: </span>
                  <span className="text-xs font-medium text-gray-900">{actualLink.details.blockName}</span>
                </div>
              )}
            </div>
          )}
        </div>
      );
    },
    [data.nodes, data.links, formatCurrency]
  );

  return (
    <div style={{ position: 'relative', width, height }}>
      <svg ref={svgRef} width={width} height={height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Links */}
          <g>
            {layoutLinks.map((link, i) => {
              const linkOpacity = hoveredLinkIndex === i ? 0.8 : isLinkConnected(link) ? 0.5 : 0.1;
              return (
                <MemoLink
                  key={`${link.source.id}-${link.target.id}-${i}`}
                  link={link}
                  opacity={linkOpacity}
                  pathGenerator={pathGenerator}
                  onMouseEnter={(e: React.MouseEvent) => handleLinkMouseEnter(link, i, e)}
                  onMouseLeave={handleLinkMouseLeave}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {layoutNodes.map((node) => {
              const nodeOpacity = isConnected(node.id) ? 1 : 0.35;
              return (
                <MemoNode
                  key={node.id}
                  node={node}
                  opacity={nodeOpacity}
                  onMouseEnter={(e: React.MouseEvent) => handleNodeMouseEnter(node, e)}
                  onMouseLeave={handleNodeMouseLeave}
                  onClick={() => onNodeClick({ id: node.id, x: node.x0, y: node.y0, width: (node.x1 ?? 0) - (node.x0 ?? 0), height: (node.y1 ?? 0) - (node.y0 ?? 0) })}
                />
              );
            })}
          </g>

          {/* Labels */}
          <g>
            {layoutNodes.map((node) => {
              const isBudgetNode = node.type === 'ministry-budget' || node.type === 'project-budget';
              const x = isBudgetNode ? (node.x0 ?? 0) - 4 : (node.x1 ?? 0) + 4;
              const textAnchor = isBudgetNode ? 'end' : 'start';
              const amountX = ((node.x0 ?? 0) + (node.x1 ?? 0)) / 2;
              const nodeY = node.y0 ?? 0;
              const nodeH = (node.y1 ?? 0) - nodeY;
              const clickable = isClickable(node);
              const color = clickable ? '#2563eb' : '#1f2937';
              const fontWeight = clickable ? 'bold' : 500;
              const cursorStyle = clickable ? 'pointer' : 'default';
              const displayName = getDisplayName(node);
              const amount = getDisplayAmount(node);
              const labelOpacity = isConnected(node.id) ? 1 : 0.35;

              return (
                <g key={`label-${node.id}`} style={{ cursor: cursorStyle, opacity: labelOpacity, transition: 'opacity 0.15s' }}>
                  {/* 金額ラベル */}
                  <text
                    x={amountX}
                    y={nodeY - 6}
                    textAnchor="middle"
                    dominantBaseline="auto"
                    style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937', pointerEvents: 'none' }}
                  >
                    {amount}
                  </text>
                  {/* 名前ラベル */}
                  <text
                    x={x}
                    y={nodeY + nodeH / 2}
                    textAnchor={textAnchor}
                    dominantBaseline="middle"
                    style={{ fill: color, fontSize: 12, fontWeight, pointerEvents: clickable ? 'auto' : 'none', cursor: cursorStyle }}
                    onClick={() => clickable && onNodeClick({ id: node.id, x: node.x0, y: node.y0, width: (node.x1 ?? 0) - (node.x0 ?? 0), height: (node.y1 ?? 0) - (node.y0 ?? 0) })}
                  >
                    {displayName.includes('\n') ? (
                      displayName.split('\n').map((line, i) => (
                        <tspan key={i} x={x} dy={i === 0 ? '-0.5em' : '1.2em'}>
                          {line}
                        </tspan>
                      ))
                    ) : (
                      displayName
                    )}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Tooltip overlay */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 10,
            top: tooltip.y - 10,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {tooltip.type === 'node' && tooltip.node && renderNodeTooltip(tooltip.node)}
          {tooltip.type === 'link' && tooltip.link && renderLinkTooltip(tooltip.link)}
        </div>
      )}
    </div>
  );
}
