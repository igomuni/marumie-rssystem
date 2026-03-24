'use client';

import React, { useMemo, useState, useCallback, useRef } from 'react';
import type { SankeyNode, SankeyLink } from '@/types/preset';

// Pre-computed layout node (from sankey-global-layout.json)
interface LayoutNode {
  id: string;
  name: string;
  type: string;
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  originalId?: number;
  details?: SankeyNode['details'];
}

// Pre-computed layout link (from sankey-global-layout.json)
interface LayoutLink {
  source: string;
  target: string;
  value: number;
  path: string;
  width: number;
  y0: number;
  y1: number;
  details?: SankeyLink['details'];
}

// Pre-computed level layout
export interface LevelLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
}

// Full pre-computed layout data
export interface GlobalLayoutData {
  metadata: {
    totalLevels: number;
    recipientsPerLevel: number;
    totalRecipients: number;
    svgWidth: number;
    svgHeight: number;
    margin: { top: number; right: number; bottom: number; left: number };
  };
  levels: Record<string, LevelLayout>;
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
  node: LayoutNode;
  opacity: number;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const color = getNodeColor(node.type, node.name);

  return (
    <rect
      x={node.x0}
      y={node.y0}
      width={node.x1 - node.x0}
      height={node.y1 - node.y0}
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
  onMouseEnter,
  onMouseLeave,
}: {
  link: LayoutLink;
  opacity: number;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}) {
  if (!link.path) return null;

  return (
    <path
      d={link.path}
      fill="none"
      stroke="#9ca3af"
      strokeWidth={Math.max(link.width, 1)}
      strokeOpacity={opacity}
      style={{ transition: 'stroke-opacity 0.15s' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
});

// ── Main component ──

interface Props {
  layout: LevelLayout;
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onNodeClick: (node: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatCurrency: (value: number | undefined, nodeOrDetails?: any) => string;
  viewState: { mode: string; projectDrilldownLevel: number; spendingDrilldownLevel: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topNSettings: any;
}

export default function SankeyGlobalView({
  layout,
  width,
  height,
  margin = { top: 40, right: 100, bottom: 40, left: 100 },
  onNodeClick,
  formatCurrency,
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
    node?: LayoutNode;
    link?: LayoutLink;
  } | null>(null);

  // Use pre-computed layout directly (no d3-sankey computation)
  const layoutNodes = layout.nodes;
  const layoutLinks = layout.links;

  // ── Adjacency map for hover highlight ──
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of layoutLinks) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
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
    (link: LayoutLink) => {
      if (!hoveredNodeId) return true;
      return link.source === hoveredNodeId || link.target === hoveredNodeId;
    },
    [hoveredNodeId]
  );

  // ── Event handlers ──
  const handleNodeMouseEnter = useCallback(
    (node: LayoutNode, event: React.MouseEvent) => {
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
    (link: LayoutLink, index: number, event: React.MouseEvent) => {
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
    (node: LayoutNode): string => {
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
    (node: LayoutNode): string => {
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

  const isClickable = useCallback((node: LayoutNode): boolean => {
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
    (node: LayoutNode) => {
      const name = node.name;
      const nodeType = node.type || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = node.details as any;
      const value = formatCurrency(node.value, node);

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
    [formatCurrency]
  );

  // ── Node map for tooltip lookups ──
  const nodeMap = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    for (const n of layoutNodes) map.set(n.id, n);
    return map;
  }, [layoutNodes]);

  // ── Link tooltip renderer ──
  const renderLinkTooltip = useCallback(
    (link: LayoutLink) => {
      const sourceNode = nodeMap.get(link.source);
      const targetNode = nodeMap.get(link.target);

      const sourceName = sourceNode?.name || link.source;
      const targetName = targetNode?.name || link.target;
      const sourceValue = formatCurrency(sourceNode?.value, sourceNode);
      const targetValue = formatCurrency(targetNode?.value, targetNode);
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
          {link.details && (link.details.contractMethod || link.details.blockName) && (
            <div className="mt-3 pt-2 border-t border-gray-200">
              {link.details.contractMethod && (
                <div className="mb-1">
                  <span className="text-xs text-gray-500">契約方式: </span>
                  <span className="text-xs font-medium text-gray-900">{link.details.contractMethod}</span>
                </div>
              )}
              {link.details.blockName && (
                <div>
                  <span className="text-xs text-gray-500">支出ブロック: </span>
                  <span className="text-xs font-medium text-gray-900">{link.details.blockName}</span>
                </div>
              )}
            </div>
          )}
        </div>
      );
    },
    [nodeMap, formatCurrency]
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
                  key={`${link.source}-${link.target}-${i}`}
                  link={link}
                  opacity={linkOpacity}
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
                  onClick={() => onNodeClick({ id: node.id, x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0 })}
                />
              );
            })}
          </g>

          {/* Labels */}
          <g>
            {layoutNodes.map((node) => {
              const isBudgetNode = node.type === 'ministry-budget' || node.type === 'project-budget';
              const x = isBudgetNode ? node.x0 - 4 : node.x1 + 4;
              const textAnchor = isBudgetNode ? 'end' : 'start';
              const amountX = (node.x0 + node.x1) / 2;
              const nodeY = node.y0;
              const nodeH = node.y1 - nodeY;
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
                    onClick={() => clickable && onNodeClick({ id: node.id, x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0 })}
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
