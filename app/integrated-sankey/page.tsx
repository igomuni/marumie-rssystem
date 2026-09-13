'use client';

/**
 * /integrated-sankey — MOF項とRS事業を「目」のエッジで結ぶ2列サンキー。
 *
 * 描画の約束（docs/integrated-sankey-graph-model.md）:
 * - 帯の太さとノード高は金額に線形比例する。平方根スケールを使わない
 * - 帯はノードの縦方向へ順に積み上げる。ノード中心へ集約しない
 * - 横幅は固定し、Zoom は金額に比例する縦寸法だけを変える
 * - 左右の帯の合計高は一致する。ラベル用の余白は列ごとに確保する
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel, SIDE_PANEL_WIDTH_MIN, SIDE_PANEL_WIDTH_MAX } from '@/client/hooks/useSidePanel';
import { RangeWindowRow } from '@/client/components/SankeySvg/RangeWindowRows';
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
const PAD_TOP = 110; // 操作クラスタの下に列見出しを置く余白
const PAD_BOTTOM = 28;
const LABEL_MIN_H = 0; // 小さいノードも縦間隔を確保してラベルを表示する
const VALUE_LABEL_MIN_H = 15;

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
/** 描画上の1本の帯。目の接続を一件ずつ保持する。 */
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

export interface RangeWindow {
  /** 表示件数（窓の大きさ） */
  topN: number;
  /** 表示開始オフセット（0始まり） */
  offset: number;
}

function windowSlice<T>(ranked: T[], w: RangeWindow) {
  const maxOffset = Math.max(0, ranked.length - w.topN);
  const offset = Math.max(0, Math.min(w.offset, maxOffset));
  return { shown: ranked.slice(offset, offset + w.topN), offset, maxOffset, total: ranked.length };
}

function buildView(
  data: IntegratedGraph,
  sectionWindow: RangeWindow,
  projectWindow: RangeWindow,
  query: string,
) {
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
  const rankedSections = [...kept].sort((a, b) => (sectionDrawn.get(b.id) ?? 0) - (sectionDrawn.get(a.id) ?? 0));
  const sectionRange = windowSlice(rankedSections, sectionWindow);
  const shown = sectionRange.shown;
  const shownIds = new Set(shown.map(s => s.id));
  const hasOtherSections = sectionRange.total > shown.length;

  // 表示外の項は捨てずに「その他の項」へ束ねる（内訳へ到達できるようにする）
  const sourceOf = (e: IntegratedItemEdge) =>
    shownIds.has(e.source) ? e.source : keptIds.has(e.source) ? OTHER_SECTIONS : null;

  // 右列（RS事業）の母集合は、いま窓に入っている項だけでなく「絞り込みで残った項全体」から
  // 流入する事業とする。左の窓を動かしても右の総件数・並び順が揺れ動かないようにするため
  // （/sankey-svg の recipientUniverseCount と同じ考え方）
  const inflowAll = new Map<string, number>();
  for (const e of data.edges) {
    if (!keptIds.has(e.source) || !e.target.startsWith('project:')) continue;
    inflowAll.set(e.target, (inflowAll.get(e.target) ?? 0) + e.value);
  }
  const projectPool = data.projects.filter(p => inflowAll.has(p.id));
  const rankedProjects = [...projectPool].sort((a, b) => (inflowAll.get(b.id) ?? 0) - (inflowAll.get(a.id) ?? 0));
  const projectRange = windowSlice(rankedProjects, projectWindow);
  const shownProjects = projectRange.shown;
  const shownProjectIds = new Set(shownProjects.map(p => p.id));
  const hasOtherProjects = projectRange.total > shownProjects.length;

  const targetOf = (e: IntegratedItemEdge) =>
    !e.target.startsWith('project:') ? e.target : shownProjectIds.has(e.target) ? e.target : OTHER_PROJECTS;

  // 目ごとの配線を保持する。表示外ノードへ接続する場合も束ねない。
  const edges: RenderEdge[] = data.edges.flatMap(e => {
    const source = sourceOf(e);
    return source ? [{ id: e.id, source, target: targetOf(e), value: e.value, status: e.status, members: [e] }] : [];
  });

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
    left.push({ id: OTHER_SECTIONS, name: `その他の項（${sectionRange.total - shown.length}件）`, value: outTotals.get(OTHER_SECTIONS)!, side: 'left', kind: 'other-sections' });
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
    right.push({ id: OTHER_PROJECTS, name: `その他のRS事業（${projectRange.total - shownProjects.length}件）`, value: inTotals.get(OTHER_PROJECTS)!, side: 'right', kind: 'other-projects' });
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
  return {
    left, right, edges, totals,
    sectionUniverse: sectionRange.total, sectionMaxOffset: sectionRange.maxOffset, sectionOffset: sectionRange.offset,
    projectUniverse: projectRange.total, projectMaxOffset: projectRange.maxOffset, projectOffset: projectRange.offset,
  };
}

type ViewModel = ReturnType<typeof buildView>;

function fitZoom(view: ViewModel) {
  let low = 0.1;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (buildLayout(view, mid).contentH <= 1070) low = mid;
    else high = mid;
  }
  return low;
}

function buildLayout(view: ViewModel, zoom: number) {
  const total = view.left.reduce((a, n) => a + n.value, 0) || 1;
  const availLeft = COL_H - Math.max(0, view.left.length - 1) * NODE_GAP;
  const availRight = COL_H - Math.max(0, view.right.length - 1) * NODE_GAP;
  // 左右で同じ縮尺を使う。帯の太さが両端で変わらないようにするため
  const ky = Math.max(0, Math.min(availLeft, availRight)) / total;

  const place = (nodes: DisplayNode[], x: number): PlacedNode[] => {
    let y = PAD_TOP;
    return nodes.map(n => {
      const h = n.value * ky * zoom;
      const slot = Math.max(18, h);
      y += (slot - h) / 2;
      const placed: PlacedNode = { ...n, x, y, h };
      y += h + (slot - h) / 2 + NODE_GAP;
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
      const w = e.value * ky * zoom;
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
  // 表示範囲。/sankey-svg の RangeWindowRow と同じ「件数＋開始オフセット」の2軸を、
  // MOF項（左列）・RS事業（右列）それぞれに独立して持つ
  const [topSection, setTopSection] = useState(35);
  const [sectionOffset, setSectionOffset] = useState(0);
  const [topProject, setTopProject] = useState(35);
  const [projectOffset, setProjectOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<RenderEdge | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [scrollMode, setScrollMode] = useState<'zoom' | 'pan'>('zoom');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accounts, setAccounts] = useState<string[]>(['general', 'special']);
  const [ministries, setMinistries] = useState<string[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // 詳細パネルの幅・折りたたみ・リサイズは /sankey-svg・/subcontracts と同じ共有フックに委ねる
  const detailPanel = useSidePanel({ side: 'right' });

  useEffect(() => {
    fetch('/api/integrated-sankey?year=2025')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  const filteredData = useMemo(() => {
    if (!data) return null;
    const sections = data.sections.filter(s => accounts.includes(s.accountType) && (!ministries.length || ministries.includes(s.ministry)));
    const ids = new Set(sections.map(s => s.id));
    return { ...data, sections, edges: data.edges.filter(e => ids.has(e.source) && (!itemQuery || e.itemName.includes(itemQuery))) };
  }, [data, accounts, ministries, itemQuery]);
  useEffect(() => { setSectionOffset(0); setProjectOffset(0); }, [accounts, ministries, itemQuery]);
  const view = useMemo(
    () => (filteredData ? buildView(filteredData, { topN: topSection, offset: sectionOffset }, { topN: topProject, offset: projectOffset }, query) : null),
    [filteredData, topSection, sectionOffset, topProject, projectOffset, query],
  );
  const layout = useMemo(() => (view ? buildLayout(view, scale) : null), [view, scale]);
  const initiallyFitted = useRef(false);
  useEffect(() => {
    if (view && !initiallyFitted.current) {
      initiallyFitted.current = true;
      setScale(fitZoom(view));
    }
  }, [view]);

  // /sankey-svg の「Reset offset when topN changes」「Reset offsets when filter changes」に倣う。
  // 窓の大きさを変えた・絞り込みを変えたときは先頭へ戻し、母集合が縮んで今の窓が指す範囲の
  // 外に出た場合の混乱を避ける
  const prevTopSection = useRef(topSection);
  useEffect(() => { if (prevTopSection.current !== topSection) { prevTopSection.current = topSection; setSectionOffset(0); } }, [topSection]);
  const prevTopProject = useRef(topProject);
  useEffect(() => { if (prevTopProject.current !== topProject) { prevTopProject.current = topProject; setProjectOffset(0); } }, [topProject]);
  const prevQuery = useRef(query);
  useEffect(() => { if (prevQuery.current !== query) { prevQuery.current = query; setSectionOffset(0); setProjectOffset(0); } }, [query]);

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
  const zoomAt = (next: number, anchor: number) => {
    const z = Math.max(0.1, Math.min(50, next));
    setPan(p => ({ ...p, y: anchor - (anchor - p.y) * buildLayout(view, z).contentH / layout.contentH }));
    setScale(z);
    setHover(null);
  };
  const reset = () => { setScale(fitZoom(view)); setPan({ x: 0, y: 0 }); };
  // /sankey-svg の rightControlsOffset と同じ方式。パネルの実効幅だけ図と右上クラスタを退避させる
  const rightControlsOffset = selected && !detailPanel.collapsed ? detailPanel.effectiveWidth : 0;

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
            viewBox={`0 0 ${CANVAS_W} 1100`}
            preserveAspectRatio="xMidYMid meet"
            onWheel={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const unit = Math.min(rect.width / CANVAS_W, rect.height / 1100);
              if (scrollMode === 'pan' && !e.ctrlKey && !e.metaKey) setPan(p => ({ x: p.x - e.deltaX * 1.2 / unit, y: p.y - e.deltaY * 1.2 / unit }));
              else zoomAt(scale * (e.deltaY > 0 ? 0.9 : 1.1), (e.clientY - rect.top - (rect.height - 1100 * unit) / 2) / unit);
            }}
            onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
            onMouseMove={e => {
              setCursor({ x: e.clientX, y: e.clientY });
              if (drag.current) {
                const rect = e.currentTarget.getBoundingClientRect();
                const unit = Math.min(rect.width / CANVAS_W, rect.height / 1100);
                setPan({ x: drag.current.px + (e.clientX - drag.current.x) / unit, y: drag.current.py + (e.clientY - drag.current.y) / unit });
              }
            }}
            onMouseUp={() => { drag.current = null; }}
            onMouseLeave={() => { drag.current = null; setHover(null); }}
          >
            <g transform={`translate(${pan.x} ${pan.y})`}>
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
                      data-edge-id={edge.id}
                      data-item-count={edge.members.length}
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
                        height={Math.max(0.3, n.h)}
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
          {/* 表示範囲。/sankey-svg の rangeCard と同じ「スライダー＝窓の位置、矢印＝件数」の
              RangeWindowRow を、MOF項・RS事業それぞれの軸に独立して1行ずつ並べる */}
          <div className="flex w-[300px] flex-col gap-1 rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 shadow-md backdrop-blur">
            <RangeWindowRow
              label="MOF項" total={view.sectionUniverse}
              topN={topSection} setTopN={setTopSection}
              offset={view.sectionOffset} maxOffset={view.sectionMaxOffset}
              onOffsetChange={setSectionOffset} markReplace={() => {}} metaFontPx={11}
            />
            <RangeWindowRow
              label="RS事業" total={view.projectUniverse}
              topN={topProject} setTopN={setTopProject}
              offset={view.projectOffset} maxOffset={view.projectMaxOffset}
              onOffsetChange={setProjectOffset} markReplace={() => {}} metaFontPx={11}
            />
          </div>
          <button aria-label="フィルタ を表示" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)} className="h-9 rounded-lg border bg-white px-2 text-xs">フィルタ ▾</button>
          <button aria-label="フィルタを解除" onClick={() => { setQuery(''); setAccounts(['general', 'special']); setMinistries([]); setItemQuery(''); }} className="h-9 rounded-lg border bg-white px-2 text-xs">解除</button>
          {filtersOpen && <div className="absolute right-12 top-20 flex w-72 flex-col gap-3 rounded-xl border bg-white p-4 text-xs shadow-lg">
            <details><summary className="cursor-pointer">会計区分（{accounts.length}件）</summary>
              <button onClick={() => setAccounts(accounts.length === 2 ? [] : ['general', 'special'])}>すべて選択 / 解除</button>
              {(['general', 'special'] as const).map(a => <label key={a} className="flex gap-2 p-1"><input type="checkbox" checked={accounts.includes(a)} onChange={() => setAccounts(v => v.includes(a) ? v.filter(x => x !== a) : [...v, a])} />{a === 'general' ? '一般会計' : '特別会計'}</label>)}
            </details>
            <details><summary className="cursor-pointer">所管（{ministries.length ? ministries.length + '件' : 'すべて'}）</summary>
              <button onClick={() => setMinistries([])}>選択解除</button>
              <div className="max-h-60 overflow-auto">{[...new Set(data.sections.map(s => s.ministry))].sort().map(m => <label key={m} className="flex gap-2 p-1"><input type="checkbox" checked={ministries.includes(m)} onChange={() => setMinistries(v => v.includes(m) ? v.filter(x => x !== m) : [...v, m])} />{m}</label>)}</div>
            </details>
            <label>目名 <input aria-label="目名" value={itemQuery} onChange={e => setItemQuery(e.target.value)} className="border rounded px-2" /></label>
          </div>}
          <PageNavMenu current="/integrated-sankey" theme="light" />
        </div>

      <div data-testid="zoom-controls" className="absolute bottom-6 z-30 flex w-12 flex-col items-center gap-2 rounded-xl border bg-white/95 p-2 shadow-md" style={{ right: 16 + rightControlsOffset }}>
        <button aria-label="スクロール移動モードに切替" aria-pressed={scrollMode === 'pan'} onClick={() => setScrollMode(m => m === 'zoom' ? 'pan' : 'zoom')} className="text-xs">{scrollMode === 'pan' ? '移動' : 'ズーム'}</button>
        <button data-testid="zoom-in" aria-label="拡大" onClick={() => zoomAt(scale * 1.5, 550)}>＋</button>
        <input aria-label="ズーム倍率" type="range" min={Math.log(0.1)} max={Math.log(50)} step="0.01" value={Math.log(scale)} onChange={e => zoomAt(Math.exp(Number(e.target.value)), 550)} style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 120, width: 20 }} />
        <button data-testid="zoom-out" aria-label="縮小" onClick={() => zoomAt(scale / 1.5, 550)}>−</button>
        <input aria-label="ズーム率" type="number" min={10} max={5000} value={Math.round(scale * 100)} onChange={e => { if (e.target.value) zoomAt(Number(e.target.value) / 100, 550); }} className="w-10 text-center text-[10px]" />
        <span className="text-[10px]">%</span>
        <button onClick={reset} className="text-xs">全体</button>
      </div>

      {selected && (
        <SidePanelChrome
          side="right"
          open={!detailPanel.collapsed}
          onToggle={detailPanel.toggleCollapsed}
          width={detailPanel.effectiveWidth}
          minWidth={SIDE_PANEL_WIDTH_MIN}
          maxWidth={SIDE_PANEL_WIDTH_MAX}
          onResizeStart={detailPanel.onResizeStart}
          isResizing={detailPanel.isResizing}
          onResetWidth={detailPanel.resetWidth}
          testId="integrated-detail"
        >
          <div className="overflow-auto p-5">
            <button onClick={() => setSelected(null)} className="float-right rounded border px-2 py-1 text-xs">選択解除</button>
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
          </div>
        </SidePanelChrome>
      )}
    </main>
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
