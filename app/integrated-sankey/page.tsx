'use client';

/**
 * /integrated-sankey — MOF項とRS事業を「目」のエッジで結ぶ2列サンキー。
 *
 * 描画の約束（docs/integrated-sankey-graph-model.md）:
 * - 帯の太さとノード高は金額に線形比例する。平方根スケールを使わない
 * - 帯はノードの縦方向へ順に積み上げる。ノード中心へ集約しない
 * - viewBox は内容の実寸に合わせる。初期表示で必ず全体が収まる
 * - 左右の列は同じ帯集合を共有するので、列の合計高は必ず一致する
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import type {
  IntegratedGraph,
  IntegratedItemEdge,
  IntegratedProjectNode,
  IntegratedSectionNode,
} from '@/app/lib/integrated-sankey';

// ── 寸法 ──
const CANVAS_W = 1560;
const NODE_W = 18; // /sankey-svg の NODE_W と揃える
const NODE_GAP = 3;
const LABEL_GUTTER = 300;
const COL_LEFT_X = LABEL_GUTTER + 20;
const COL_RIGHT_X = CANVAS_W - LABEL_GUTTER - 20 - NODE_W;
const COL_H = 860;
const PAD_TOP = 110; // 左上カード・右上クラスタの下に列見出しが出るだけの余白
const PAD_BOTTOM = 28;
const MIN_NODE_H = 1.5; // 0だと消えてしまうので下限だけ置く。比例関係は保つ
const LABEL_MIN_H = 9; // これ未満のノードはラベルを省く（重なり防止）
const VALUE_LABEL_MIN_H = 15;
const PANEL_W = 420; // 詳細パネル幅。右上クラスタの退避量と共用する

// ── 配色 ──
// /sankey-svg の意味づけ（緑＝予算側、灰＝集約、赤＝要注意）に合わせる。
// 左右は位置で区別できるので、左列の色は会計区分に充てる。
const NODE_COLORS = {
  general: '#2d7d46',
  special: '#8ec9a8',
  project: '#4db870',
  aggregate: '#9aa0a6',
  excess: '#e53935',
} as const;
const EDGE_COLORS = {
  connected: '#4db870',
  unconnected: '#b3b8b3',
  excess: '#e53935',
} as const;

const money = (v: number) =>
  v >= 1e12 ? `${(v / 1e12).toFixed(2)}兆円`
    : v >= 1e8 ? `${(v / 1e8).toFixed(1)}億円`
      : `${Math.round(v / 1e4).toLocaleString()}万円`;
const trim = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n)}…` : s);

type NodeKind = 'section' | 'project' | 'unconnected' | 'other-projects' | 'other-sections' | 'excess';
type DisplayNode = {
  id: string;
  name: string;
  value: number;
  side: 'left' | 'right';
  kind: NodeKind;
  section?: IntegratedSectionNode;
  project?: IntegratedProjectNode;
};
type PlacedNode = DisplayNode & { x: number; y: number; h: number };
/** 描画上の1本の帯。同じ項・同じ相手・同じ状態の目エッジを束ねる（内訳は members に残す） */
type RenderEdge = {
  id: string;
  source: string;
  target: string;
  value: number;
  status: IntegratedItemEdge['status'];
  members: IntegratedItemEdge[];
};

const OTHER_SECTIONS = 'other-sections';
const OTHER_PROJECTS = 'other-projects';

function nodeColor(n: DisplayNode) {
  if (n.kind === 'section') return n.section?.accountType === 'general' ? NODE_COLORS.general : NODE_COLORS.special;
  if (n.kind === 'project') return NODE_COLORS.project;
  if (n.kind === 'excess') return NODE_COLORS.excess;
  return NODE_COLORS.aggregate;
}

function buildView(data: IntegratedGraph, limit: number, query: string) {
  const q = query.trim().toLowerCase();
  const matchSection = (s: IntegratedSectionNode) =>
    !q || `${s.name} ${s.ministry} ${s.organization}`.toLowerCase().includes(q);
  const matchProject = (p: IntegratedProjectNode) =>
    !q || `${p.name} ${p.ministry} ${p.projectId}`.toLowerCase().includes(q);

  const matchedProjectIds = new Set(data.projects.filter(matchProject).map(p => p.id));
  // 項そのものが一致するか、一致した事業へ繋がる項を残す
  const kept = data.sections.filter(
    s => matchSection(s) || data.edges.some(e => e.source === s.id && matchedProjectIds.has(e.target)),
  );
  const keptIds = new Set(kept.map(s => s.id));

  // 並び順は描画に使う合計（＝その項から出る帯の合計）で決める。高さと順序をずらさない
  const sectionDrawn = new Map<string, number>();
  for (const e of data.edges) {
    if (keptIds.has(e.source)) sectionDrawn.set(e.source, (sectionDrawn.get(e.source) ?? 0) + e.value);
  }
  const ranked = [...kept].sort((a, b) => (sectionDrawn.get(b.id) ?? 0) - (sectionDrawn.get(a.id) ?? 0));
  const shown = ranked.slice(0, limit);
  const shownIds = new Set(shown.map(s => s.id));
  const hasOtherSections = ranked.length > shown.length;

  // 表示外の項は捨てずに「その他の項」へ束ねる（内訳へ到達できるようにする）
  const sourceOf = (e: IntegratedItemEdge) =>
    shownIds.has(e.source) ? e.source : keptIds.has(e.source) ? OTHER_SECTIONS : null;

  const inflow = new Map<string, number>();
  for (const e of data.edges) {
    if (!sourceOf(e) || !e.target.startsWith('project:')) continue;
    inflow.set(e.target, (inflow.get(e.target) ?? 0) + e.value);
  }
  // 絞り込みは左列（項）で効かせる。残った項から流入する事業はすべて右列の候補にする
  const projectPool = data.projects.filter(p => inflow.has(p.id));
  const rankedProjects = [...projectPool].sort((a, b) => (inflow.get(b.id) ?? 0) - (inflow.get(a.id) ?? 0));
  const shownProjects = rankedProjects.slice(0, limit);
  const shownProjectIds = new Set(shownProjects.map(p => p.id));
  const hasOtherProjects = rankedProjects.length > shownProjects.length;

  const targetOf = (e: IntegratedItemEdge) =>
    !e.target.startsWith('project:') ? e.target : shownProjectIds.has(e.target) ? e.target : OTHER_PROJECTS;

  // 同じ (source, target, status) の目エッジを1本の帯へ束ねる
  const bundles = new Map<string, RenderEdge>();
  for (const e of data.edges) {
    const source = sourceOf(e);
    if (!source) continue;
    const target = targetOf(e);
    const id = `${source}|${target}|${e.status}`;
    const found = bundles.get(id);
    if (found) {
      found.value += e.value;
      found.members.push(e);
    } else {
      bundles.set(id, { id, source, target, value: e.value, status: e.status, members: [e] });
    }
  }
  const edges = [...bundles.values()];

  const outTotals = new Map<string, number>();
  const inTotals = new Map<string, number>();
  for (const e of edges) {
    outTotals.set(e.source, (outTotals.get(e.source) ?? 0) + e.value);
    inTotals.set(e.target, (inTotals.get(e.target) ?? 0) + e.value);
  }

  const left: DisplayNode[] = shown
    .map((s): DisplayNode => ({ id: s.id, name: s.name, value: outTotals.get(s.id) ?? 0, side: 'left', kind: 'section', section: s }))
    .filter(n => n.value > 0)
    .sort((a, b) => b.value - a.value);
  if (hasOtherSections && (outTotals.get(OTHER_SECTIONS) ?? 0) > 0) {
    left.push({ id: OTHER_SECTIONS, name: `その他の項（${ranked.length - shown.length}件）`, value: outTotals.get(OTHER_SECTIONS)!, side: 'left', kind: 'other-sections' });
  }

  const right: DisplayNode[] = shownProjects
    .map((p): DisplayNode => ({ id: p.id, name: p.name, value: inTotals.get(p.id) ?? 0, side: 'right', kind: 'project', project: p }))
    .filter(n => n.value > 0);
  const special: [string, string, NodeKind][] = [
    ['rs-unconnected', 'RS未接続', 'unconnected'],
    ['rs-excess', '超過・要確認', 'excess'],
  ];
  for (const [id, name, kind] of special) {
    const value = inTotals.get(id) ?? 0;
    if (value > 0) right.push({ id, name, value, side: 'right', kind });
  }
  right.sort((a, b) => b.value - a.value);
  if (hasOtherProjects && (inTotals.get(OTHER_PROJECTS) ?? 0) > 0) {
    right.push({ id: OTHER_PROJECTS, name: `その他のRS事業（${rankedProjects.length - shownProjects.length}件）`, value: inTotals.get(OTHER_PROJECTS)!, side: 'right', kind: 'other-projects' });
  }

  const sumOf = (status: IntegratedItemEdge['status']) =>
    edges.filter(e => e.status === status).reduce((a, e) => a + e.value, 0);
  const totals = {
    // 帯の合計 = 接続 + 未接続 + 超過。超過は「MOF目金額を上回った分」を独立した
    // 流出として描くので、MOF総額とは 2×超過 だけずれる（意図的。丸めて隠さない）
    all: edges.reduce((a, e) => a + e.value, 0),
    connected: sumOf('connected'),
    unconnected: sumOf('unconnected'),
    excess: sumOf('excess'),
  };
  return { left, right, edges, totals, sectionCount: ranked.length, projectCount: rankedProjects.length };
}

type ViewModel = ReturnType<typeof buildView>;

function buildLayout(view: ViewModel) {
  const total = view.left.reduce((a, n) => a + n.value, 0) || 1;
  const availLeft = COL_H - Math.max(0, view.left.length - 1) * NODE_GAP;
  const availRight = COL_H - Math.max(0, view.right.length - 1) * NODE_GAP;
  // 左右で同じ縮尺を使う。帯の太さが両端で変わらないようにするため
  const ky = Math.max(0, Math.min(availLeft, availRight)) / total;

  const place = (nodes: DisplayNode[], x: number): PlacedNode[] => {
    let y = PAD_TOP;
    return nodes.map(n => {
      const h = Math.max(MIN_NODE_H, n.value * ky);
      const placed: PlacedNode = { ...n, x, y, h };
      y += h + NODE_GAP;
      return placed;
    });
  };
  const left = place(view.left, COL_LEFT_X);
  const right = place(view.right, COL_RIGHT_X);
  const byId = new Map<string, PlacedNode>([...left, ...right].map(n => [n.id, n]));

  // 帯を各ノードの縦方向へ積み上げる。相手側ノードのy順に並べると交差が減る
  const outAcc = new Map<string, number>();
  const inAcc = new Map<string, number>();
  const bands = view.edges
    .filter(e => byId.has(e.source) && byId.has(e.target))
    .sort((a, b) =>
      (byId.get(a.source)!.y - byId.get(b.source)!.y) || (byId.get(a.target)!.y - byId.get(b.target)!.y))
    .map(e => {
      const s = byId.get(e.source)!;
      const t = byId.get(e.target)!;
      const w = Math.max(0.6, e.value * ky);
      const sy = s.y + (outAcc.get(s.id) ?? 0);
      const ty = t.y + (inAcc.get(t.id) ?? 0);
      outAcc.set(s.id, (outAcc.get(s.id) ?? 0) + w);
      inAcc.set(t.id, (inAcc.get(t.id) ?? 0) + w);
      return { edge: e, sy, ty, w };
    });

  const bottom = (nodes: PlacedNode[]) => (nodes.length ? nodes[nodes.length - 1].y + nodes[nodes.length - 1].h : PAD_TOP);
  const contentH = Math.max(bottom(left), bottom(right)) + PAD_BOTTOM;
  return { left, right, byId, bands, contentH };
}

/** 帯は塗りで描く。線幅で描くと両端の位置合わせができない */
function ribbonPath(x0: number, sy: number, x1: number, ty: number, w: number) {
  const c1 = x0 + (x1 - x0) * 0.45;
  const c2 = x1 - (x1 - x0) * 0.45;
  return `M${x0},${sy} C${c1},${sy} ${c2},${ty} ${x1},${ty} L${x1},${ty + w} C${c2},${ty + w} ${c1},${sy + w} ${x0},${sy + w} Z`;
}

function App() {
  const [data, setData] = useState<IntegratedGraph | null>(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(35);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<RenderEdge | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    fetch('/api/integrated-sankey?year=2025')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  const view = useMemo(() => (data ? buildView(data, limit, query) : null), [data, limit, query]);
  const layout = useMemo(() => (view ? buildLayout(view) : null), [view]);

  const selectedNode = layout?.byId.get(selected ?? '') ?? null;
  const selectedEdges = useMemo(
    () => (view && selected ? view.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => e.members) : []),
    [view, selected],
  );

  if (error) return <div className="flex h-screen items-center justify-center text-red-600">{error}</div>;
  if (!data || !view || !layout) return <div className="flex h-screen items-center justify-center text-neutral-500">読み込み中…</div>;

  const isRelated = (e: RenderEdge) => !selected || e.source === selected || e.target === selected;
  const nodeActive = (n: PlacedNode) =>
    !selected || n.id === selected || view.edges.some(e => isRelated(e) && (e.source === n.id || e.target === n.id));
  const cx = CANVAS_W / 2;
  const cy = layout.contentH / 2;
  const reset = () => { setScale(1); setPan({ x: 0, y: 0 }); };
  // /sankey-svg の rightControlsOffset と同じ方式。右パネルの幅だけ図と右上クラスタを退避させる
  const rightControlsOffset = selected ? PANEL_W : 0;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#f7f8f5] text-neutral-800">
      {/* 図の領域。詳細パネル展開時はその幅ぶん狭める。viewBox の fit で図が描き直される */}
      <div
        className="absolute inset-y-0 left-0"
        style={{ right: rightControlsOffset, transition: 'right 0.2s ease' }}
      >
          <svg
            data-testid="integrated-canvas"
            className="h-full w-full cursor-grab"
            viewBox={`0 0 ${CANVAS_W} ${layout.contentH}`}
            preserveAspectRatio="xMidYMid meet"
            onWheel={e => setScale(s => Math.max(0.5, Math.min(6, s * (e.deltaY > 0 ? 0.9 : 1.1))))}
            onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
            onMouseMove={e => {
              setCursor({ x: e.clientX, y: e.clientY });
              if (drag.current) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
            }}
            onMouseUp={() => { drag.current = null; }}
            onMouseLeave={() => { drag.current = null; setHover(null); }}
          >
            <g transform={`translate(${pan.x} ${pan.y}) translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
              <text x={COL_LEFT_X + NODE_W + 8} y={PAD_TOP - 22} fontSize="13" fontWeight="700" fill="#555">MOFの項</text>
              <text x={COL_RIGHT_X} y={PAD_TOP - 22} fontSize="13" fontWeight="700" fill="#555">RSの事業</text>

              <g>
                {layout.bands.map(({ edge, sy, ty, w }) => {
                  const active = isRelated(edge);
                  return (
                    <path
                      key={edge.id}
                      data-testid="integrated-edge"
                      data-status={edge.status}
                      d={ribbonPath(COL_LEFT_X + NODE_W, sy, COL_RIGHT_X, ty, w)}
                      fill={EDGE_COLORS[edge.status]}
                      fillOpacity={active ? (hover?.id === edge.id ? 0.85 : 0.45) : 0.06}
                      className="cursor-pointer"
                      onMouseEnter={() => setHover(edge)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setSelected(edge.target)}
                    >
                      <title>{`${money(edge.value)}｜目 ${edge.members.length}件`}</title>
                    </path>
                  );
                })}
              </g>

              <g>
                {[...layout.left, ...layout.right].map(n => {
                  const active = nodeActive(n);
                  const isLeft = n.side === 'left';
                  return (
                    <g
                      key={n.id}
                      data-testid="sankey-node"
                      data-kind={n.kind}
                      className="cursor-pointer"
                      opacity={active ? 1 : 0.2}
                      onClick={() => setSelected(selected === n.id ? null : n.id)}
                    >
                      <rect
                        x={n.x}
                        y={n.y}
                        width={NODE_W}
                        height={n.h}
                        rx="2"
                        fill={nodeColor(n)}
                        stroke={selected === n.id ? '#111' : 'none'}
                        strokeWidth={selected === n.id ? 2 : 0}
                      />
                      {n.h >= LABEL_MIN_H && (
                        <text
                          x={isLeft ? n.x - 8 : n.x + NODE_W + 8}
                          y={n.y + n.h / 2 + 4}
                          textAnchor={isLeft ? 'end' : 'start'}
                          fontSize="12"
                          fill="#333"
                        >
                          {trim(n.name)}
                          {n.h >= VALUE_LABEL_MIN_H && <tspan fill="#8a8f8a">　{money(n.value)}</tspan>}
                        </text>
                      )}
                      <title>{`${n.name}｜${money(n.value)}`}</title>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>


          {/* 左上: 表題と集計。図の上端に重ならないよう幅を抑える */}
          <div className="absolute left-3 top-3 z-30 w-[430px] rounded-xl border border-black/10 bg-white/95 px-3 py-2 shadow-md backdrop-blur">
            <h1 className="text-sm font-bold leading-tight">MOF項 × RS事業</h1>
            <p className="text-[11px] leading-tight text-neutral-500">目をエッジとして結ぶファーストカット（2024年度当初予算）</p>
            <div className="mt-1.5 flex flex-col gap-0.5 text-[11px]">
              <div className="flex flex-wrap gap-x-3">
                <span className="text-neutral-400">全体</span>
                <span>MOF {money(data.metadata.mofAmount)}</span>
                <span className="text-emerald-700">接続 {money(data.metadata.connectedAmount)}</span>
                <span className="text-neutral-500">未接続 {money(data.metadata.unconnectedAmount)}</span>
                {data.metadata.excessAmount > 0 && <span className="text-rose-600">超過 {money(data.metadata.excessAmount)}</span>}
              </div>
              <div className="flex flex-wrap gap-x-3">
                <span className="text-neutral-400">描画</span>
                <span title="接続 + 未接続 + 超過。超過を独立した流出として描くため、MOF総額とは2×超過だけずれる">
                  帯 {money(view.totals.all)}
                </span>
                <span className="text-emerald-700">接続 {money(view.totals.connected)}</span>
                <span className="text-neutral-500">未接続 {money(view.totals.unconnected)}</span>
                {view.totals.excess > 0 && <span className="text-rose-600">超過 {money(view.totals.excess)}</span>}
                <span className="text-neutral-400">項 {view.left.length}／事業 {view.right.length}</span>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-black/5 pt-1.5 text-[11px]">
              <Swatch color={NODE_COLORS.general} label="一般会計の項" />
              <Swatch color={NODE_COLORS.special} label="特別会計の項" />
              <Swatch color={NODE_COLORS.project} label="RS事業／接続した目" />
              <Swatch color={EDGE_COLORS.unconnected} label="RS未接続の残差" />
              <Swatch color={NODE_COLORS.excess} label="超過・要確認" />
              <Swatch color={NODE_COLORS.aggregate} label="その他（集約）" />
              <span className="text-neutral-400">帯の太さ＝金額（線形）</span>
            </div>
          </div>

          {hover && (
            <div
              data-testid="integrated-hover"
              className="pointer-events-none fixed z-40 max-w-sm rounded-lg border border-black/10 bg-white/97 p-2.5 text-xs shadow-xl"
              style={{ left: Math.min(cursor.x + 14, window.innerWidth - 340), top: cursor.y + 16 }}
            >
              <div className="font-bold">
                {hover.members.length === 1 ? `目：${hover.members[0].itemName}` : `目 ${hover.members.length}件をまとめて表示`}
              </div>
              <div className="mt-1">
                この帯 {money(hover.value)}
                {hover.members.length === 1 && <> ／ MOF目 {money(hover.members[0].mofAmount)}</>}
              </div>
              <div className="mt-1 text-neutral-500">
                {hover.status === 'connected' ? 'MOF接続済み' : hover.status === 'excess' ? '超過・要確認' : 'RS未接続・差額'}
              </div>
              {hover.members.length > 1 && (
                <div className="mt-1 text-neutral-400">{hover.members.slice(0, 3).map(m => m.itemName).join('、')} ほか</div>
              )}
            </div>
          )}
      </div>

        {/* 右上クラスタ: ［検索 - 表示件数 - ズーム - ページ切替］。/sankey-svg と同じく
            右パネル展開時は rightControlsOffset ぶん左へ退避する。ページ切替メニューは
            ドロップダウンが右端基準で開くため、必ずクラスタの右端に置く */}
        <div
          style={{
            position: 'absolute', top: 12, right: 12 + rightControlsOffset, zIndex: 200,
            display: 'flex', gap: 8, alignItems: 'flex-start', transition: 'right 0.2s ease',
          }}
        >
          <input
            data-testid="search-input"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); }}
            placeholder="項・事業を検索"
            className="h-9 w-52 rounded-lg border border-black/10 bg-white/90 px-3 text-sm shadow-md backdrop-blur"
          />
          <select
            aria-label="表示件数"
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="h-9 rounded-lg border border-black/10 bg-white/90 px-2 text-sm shadow-md backdrop-blur"
          >
            <option value={25}>上位25</option>
            <option value={35}>上位35</option>
            <option value={50}>上位50</option>
          </select>
          <button data-testid="zoom-out" onClick={() => setScale(v => Math.max(0.5, v - 0.2))} className="h-9 w-9 rounded-lg border border-black/10 bg-white/90 shadow-md backdrop-blur hover:bg-white">−</button>
          <button data-testid="zoom-in" onClick={() => setScale(v => Math.min(6, v + 0.2))} className="h-9 w-9 rounded-lg border border-black/10 bg-white/90 shadow-md backdrop-blur hover:bg-white">＋</button>
          <button onClick={reset} className="h-9 rounded-lg border border-black/10 bg-white/90 px-3 text-xs shadow-md backdrop-blur hover:bg-white">全体</button>
          <PageNavMenu current="/integrated-sankey" theme="light" />
        </div>

      {selected && (
        <aside
          data-testid="integrated-detail"
          className="absolute inset-y-0 right-0 z-20 overflow-auto border-l border-black/10 bg-white p-5"
          style={{ width: PANEL_W }}
        >
          <button onClick={() => setSelected(null)} className="float-right rounded border px-2 py-1 text-xs">閉じる</button>
          {selectedNode?.section ? (
            <>
              <p className="text-xs font-semibold text-neutral-500">MOF項</p>
              <h2 className="mt-1 pr-10 text-lg font-bold">{selectedNode.name}</h2>
              <SectionDetail section={selectedNode.section} edges={selectedEdges} />
            </>
          ) : selectedNode?.project ? (
            <>
              <p className="text-xs font-semibold text-neutral-500">RS予算事業</p>
              <h2 className="mt-1 pr-10 text-lg font-bold">{selectedNode.name}</h2>
              <ProjectDetail project={selectedNode.project} />
            </>
          ) : (
            <SpecialDetail id={selected} name={selectedNode?.name ?? ''} edges={selectedEdges} />
          )}
        </aside>
      )}
    </main>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function SectionDetail({ section, edges }: { section: IntegratedSectionNode; edges: IntegratedItemEdge[] }) {
  return (
    <div className="mt-4 space-y-4 text-sm">
      <div className="rounded-xl bg-neutral-100 p-3">
        <div>{section.ministry} / {section.organization}{section.subAccount ? ` / ${section.subAccount}` : ''}</div>
        <div className="mt-2 font-bold">MOF項額 {money(section.amount)}</div>
        <div className="text-xs text-neutral-500">目 {section.itemCount}件</div>
      </div>
      <div>
        <h3 className="mb-2 font-bold">目エッジ</h3>
        {[...edges].sort((a, b) => b.value - a.value).slice(0, 80).map(e => (
          <div key={e.id} className="border-t py-2">
            <div className="font-medium">{e.itemName}</div>
            <div className="text-xs text-neutral-500">
              {money(e.value)}・{e.status === 'connected' ? 'RS接続済み' : e.status === 'excess' ? '超過・要確認' : 'RS未接続'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectDetail({ project }: { project: IntegratedProjectNode }) {
  return (
    <div className="mt-4 text-sm">
      <div className="rounded-xl bg-emerald-50 p-3">
        <div>{project.ministry}・事業ID {project.projectId}</div>
        <div className="mt-2">MOF接続済み <b>{money(project.linkedAmount)}</b></div>
        <div>RS当初予算 <b>{money(project.initialBudget)}</b></div>
        <div>MOF未接続差額 <b>{money(project.mofUnlinkedAmount)}</b></div>
      </div>
      <h3 className="mb-2 mt-5 font-bold">目</h3>
      {project.budgetItems.length === 0 ? (
        <p className="text-neutral-500">目内訳がありません</p>
      ) : (
        project.budgetItems.map((i, n) => (
          <div key={`${i.item}-${i.subItem}-${n}`} className="border-t py-2">
            <div className="flex gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${i.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-700'}`}>
                {i.connected ? 'MOF接続済み' : 'MOF未接続'}
              </span>
              <span>{i.subItem || i.item}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">{i.accountCategory} / {i.item} / {money(i.amount)}</div>
          </div>
        ))
      )}
    </div>
  );
}

function SpecialDetail({ id, name, edges }: { id: string; name: string; edges: IntegratedItemEdge[] }) {
  const note =
    id === 'rs-unconnected' ? 'MOFの目金額のうち、RS事業への接続で説明されない部分です。制度上の対象外とは断定していません。'
      : id === 'rs-excess' ? 'RS計上額がMOF目金額を上回る分です。0へ丸めず、原因を調べるために表に出しています。'
        : id === OTHER_SECTIONS ? '表示件数の外に出たMOF項の集約です。'
          : '表示件数の外に出たRS事業の集約です。';
  return (
    <div className="mt-4 text-sm">
      <h2 className="text-lg font-bold">{name || id}</h2>
      <p className="mt-2 text-neutral-600">{note}</p>
      <p className="mt-2 text-xs text-neutral-500">内訳 {edges.length}件のうち金額の大きい順に最大100件</p>
      {[...edges].sort((a, b) => b.value - a.value).slice(0, 100).map(e => (
        <div key={e.id} className="border-t py-2">
          <div>{e.itemName}</div>
          <div className="text-xs text-neutral-500">{money(e.value)}</div>
        </div>
      ))}
    </div>
  );
}

export default function IntegratedSankeyPage() {
  return <App />;
}
