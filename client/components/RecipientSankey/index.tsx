'use client';

/**
 * 企業中心Sankeyの描画コンポーネント。
 * データは props で受け取り、API コールは行わない（呼び出しは page 側の責務）。
 */
import { useMemo } from 'react';
import type {
  RecipientSankeyData,
  RecipientSankeyNode,
} from '@/app/lib/recipient-sankey-generator';
import { formatYen } from '@/app/lib/format/yen';

const COLORS = {
  direct: '#3b82f6',
  subcontract: '#f59e0b',
  neutral: '#cbd5e1',
  node: '#475569',
  center: '#0f172a',
  aggregate: '#94a3b8',
} as const;

const VIEW_W = 960;
const NODE_W = 12;
const COL_X = [40, 280, 560, 800];
const TOP_PAD = 8;
const NODE_GAP = 10;
const MAX_H = 520;
const MIN_NODE_H = 3;

interface PlacedNode extends RecipientSankeyNode {
  x: number;
  y: number;
  h: number;
}

interface PlacedLink {
  path: string;
  width: number;
  color: string;
  title: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export default function RecipientSankey({ data }: { data: RecipientSankeyData }) {
  const { placedNodes, placedLinks, height } = useMemo(() => {
    const byColumn: RecipientSankeyNode[][] = [[], [], [], []];
    for (const n of data.nodes) byColumn[n.column].push(n);
    // 各列とも金額降順（集約ノードは末尾）
    for (const col of byColumn) {
      col.sort((a, b) => (a.isAggregate ? 1 : 0) - (b.isAggregate ? 1 : 0) || b.value - a.value);
    }

    // スケール: 最も合計の大きい列が MAX_H に収まるように
    const colSums = byColumn.map(col =>
      col.reduce((s, n) => s + n.value, 0)
    );
    const colGaps = byColumn.map(col => Math.max(0, col.length - 1) * NODE_GAP);
    const scale = Math.min(
      ...byColumn.map((col, i) =>
        colSums[i] > 0 ? (MAX_H - colGaps[i]) / colSums[i] : Infinity
      )
    );

    const placed = new Map<string, PlacedNode>();
    let maxBottom = 0;
    byColumn.forEach((col, ci) => {
      let y = TOP_PAD;
      for (const n of col) {
        const h = Math.max(MIN_NODE_H, n.value * scale);
        placed.set(n.id, { ...n, x: COL_X[ci], y, h });
        y += h + NODE_GAP;
      }
      maxBottom = Math.max(maxBottom, y - NODE_GAP);
    });

    // リンク配置: ノードごとに上から順に出入口を割り当てる
    const outOffset = new Map<string, number>();
    const inOffset = new Map<string, number>();
    const sortedLinks = [...data.links].sort((a, b) => {
      const ay = placed.get(a.target)?.y ?? 0;
      const by = placed.get(b.target)?.y ?? 0;
      return (placed.get(a.source)?.y ?? 0) - (placed.get(b.source)?.y ?? 0) || ay - by;
    });

    const pLinks: PlacedLink[] = [];
    for (const l of sortedLinks) {
      const s = placed.get(l.source);
      const t = placed.get(l.target);
      if (!s || !t) continue;
      const w = Math.max(1, l.value * scale);
      const sy = s.y + (outOffset.get(l.source) ?? 0) + w / 2;
      const ty = t.y + (inOffset.get(l.target) ?? 0) + w / 2;
      outOffset.set(l.source, (outOffset.get(l.source) ?? 0) + w);
      inOffset.set(l.target, (inOffset.get(l.target) ?? 0) + w);

      const x0 = s.x + NODE_W;
      const x1 = t.x;
      const mx = (x0 + x1) / 2;
      pLinks.push({
        path: `M ${x0} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${x1} ${ty}`,
        width: w,
        color: l.kind ? COLORS[l.kind] : COLORS.neutral,
        title: `${s.label} → ${t.label}: ${formatYen(l.value)}${l.kind === 'direct' ? '（直接受注）' : l.kind === 'subcontract' ? '（再委託受注）' : ''}`,
      });
    }

    return {
      placedNodes: [...placed.values()],
      placedLinks: pLinks,
      height: Math.max(maxBottom + TOP_PAD, 120),
    };
  }, [data]);

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        style={{ width: '100%', minWidth: 720, height: 'auto', display: 'block' }}
        role="img"
        aria-label="企業中心サンキー図"
      >
        {placedLinks.map((l, i) => (
          <path
            key={i}
            d={l.path}
            fill="none"
            stroke={l.color}
            strokeWidth={l.width}
            strokeOpacity={0.45}
          >
            <title>{l.title}</title>
          </path>
        ))}
        {placedNodes.map(n => {
          const href =
            n.pid != null
              ? `/subcontracts/${n.pid}`
              : n.recipientKey
                ? `/recipients/${encodeURIComponent(n.recipientKey)}`
                : undefined;
          const fill =
            n.id === 'center' ? COLORS.center : n.isAggregate ? COLORS.aggregate : COLORS.node;
          const labelX = n.column === 0 ? n.x - 6 : n.x + NODE_W + 6;
          const anchor = n.column === 0 ? 'end' : 'start';
          const rect = (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={NODE_W} height={n.h} fill={fill} rx={2}>
                <title>{`${n.label}: ${formatYen(n.value)}`}</title>
              </rect>
              <text
                x={labelX}
                y={n.y + n.h / 2}
                dominantBaseline="middle"
                textAnchor={anchor}
                fontSize={11}
                fill="#334155"
              >
                {truncate(n.label, n.column === 1 ? 22 : 18)}
              </text>
            </g>
          );
          return href ? (
            <a key={n.id} href={href} style={{ cursor: 'pointer' }}>
              {rect}
            </a>
          ) : (
            rect
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b', marginTop: 4 }}>
        <span>
          <span style={{ color: COLORS.direct }}>■</span> 直接受注
        </span>
        <span>
          <span style={{ color: COLORS.subcontract }}>■</span> 再委託・別起点での受注
        </span>
        <span>※ 左の受注額と右の再委託額は資金の次元が異なるため合算できません</span>
      </div>
    </div>
  );
}
