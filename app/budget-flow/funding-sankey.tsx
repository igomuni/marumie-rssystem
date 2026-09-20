/**
 * RS Funding Graph（5-1/5-2由来の一般有向グラフ）を可視化する軽量コンポーネント。
 * レイアウト計算は./funding-layout.ts（純粋関数・vitestでテスト済み）に分離してある。
 * 循環・孤立・重複関係は削除・整形せず警告として明示する。
 */
import { layoutFundingGraph } from './funding-layout';
import type { RsFundingGraph } from './rs-model';

const NODE_WIDTH = 160;
const NODE_HEIGHT = 36;
const LAYER_GAP = 220;
const ROW_GAP = 56;
const MARGIN = 24;

function nodeCenter(layer: number, row: number) {
  return { x: MARGIN + layer * LAYER_GAP + NODE_WIDTH / 2, y: MARGIN + row * ROW_GAP + NODE_HEIGHT / 2 };
}

export function FundingSankey({ graph }: { graph: RsFundingGraph }) {
  const layout = layoutFundingGraph(graph);
  const width = MARGIN * 2 + Math.max(1, layout.layerCount) * LAYER_GAP;
  const height = MARGIN * 2 + Math.max(1, layout.maxRowCount) * ROW_GAP;
  const posById = new Map(layout.nodes.map(n => [n.nodeId, n]));
  const orphanIds = new Set(graph.metrics.orphanBlockIds.map(id => graph.nodes.find(n => n.blockId === id)?.nodeId).filter((x): x is string => Boolean(x)));

  return (
    <div>
      {graph.metrics.hasCycle && <p role="alert" style={{ color: '#a15c00' }}>⚠ この資金フローには循環関係があります（{graph.metrics.cyclicComponents.length}件）。図はそのまま表示し、削除・整形していません。</p>}
      {graph.metrics.duplicateRelationPairCount > 0 && <p style={{ color: '#555' }}>ℹ 同一の支出先どうしを複数回結ぶ関係が{graph.metrics.duplicateRelationPairCount}件あります（統合せず、辺のラベルに件数を表示しています）。</p>}
      {orphanIds.size > 0 && <p style={{ color: '#555' }}>ℹ 資金の出入りが記録されていないブロックが{orphanIds.size}件あります（孤立ノードとして点線枠で表示）。</p>}
      <p style={{ color: '#777', fontSize: '0.85em' }}>5-2（支出先のつながり）に金額列が無いため、辺の太さは金額を表しません。</p>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, minHeight: 120 }} role="img" aria-label="資金フロー図">
        <defs>
          <marker id="fs-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#888" /></marker>
          <marker id="fs-arrow-cycle" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#a15c00" /></marker>
        </defs>
        {layout.edges.map(e => {
          const s = posById.get(e.sourceNodeId), t = posById.get(e.targetNodeId);
          if (!s || !t) return null;
          const sc = nodeCenter(s.layer, s.row), tc = nodeCenter(t.layer, t.row);
          const x1 = sc.x + NODE_WIDTH / 2, y1 = sc.y, x2 = tc.x - NODE_WIDTH / 2, y2 = tc.y;
          const mx = (x1 + x2) / 2;
          return <g key={e.edgeId}>
            <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={e.isCycleEdge ? '#a15c00' : '#999'} strokeWidth={e.isCycleEdge ? 2 : 1.5} strokeDasharray={e.isCycleEdge ? '4 3' : undefined} markerEnd={e.isCycleEdge ? 'url(#fs-arrow-cycle)' : 'url(#fs-arrow)'} />
            {e.evidenceCount > 1 && <text x={mx} y={(y1 + y2) / 2 - 4} fontSize="10" fill="#a15c00" textAnchor="middle">×{e.evidenceCount}</text>}
          </g>;
        })}
        {layout.nodes.map(n => {
          const c = nodeCenter(n.layer, n.row);
          const isOrphan = orphanIds.has(n.nodeId);
          return <g key={n.nodeId}>
            <rect x={c.x - NODE_WIDTH / 2} y={c.y - NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT} rx={6}
              fill={n.nodeType === 'responsible_organization' ? '#eef4ff' : '#f7f7f5'}
              stroke={isOrphan ? '#999' : n.nodeType === 'responsible_organization' ? '#3a63c8' : '#444'}
              strokeDasharray={isOrphan ? '3 3' : undefined} />
            <text x={c.x} y={c.y + 4} fontSize="11" textAnchor="middle" fill="#222">
              {n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name || n.nodeId}
            </text>
          </g>;
        })}
      </svg>
    </div>
  );
}
