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
import { parseAmountToYen } from '@/app/lib/format/yen';
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
  /** MOF項・RS事業それぞれ独立した検索ボックスの述語。部分一致・正規表現の切り替えは
   * 呼び出し側（App）が担う。ここは述語を適用するだけ */
  matchSectionText: (haystack: string) => boolean,
  matchProjectText: (haystack: string) => boolean,
) {
  const matchSection = (s: IntegratedSectionNode) =>
    matchSectionText(`${s.name} ${s.ministry} ${s.organization} ${s.accountType === 'general' ? '一般会計' : '特別会計'}`);
  const matchProject = (p: IntegratedProjectNode) =>
    matchProjectText(`${p.name} ${p.ministry} ${p.projectId}`);

  // MOF項・RS事業の検索は互いに独立。項の絞り込みはこの列自身の一致だけで決める
  // （RS事業側の検索語で項を引っ張り出す、といった相互連携はしない）
  const kept = data.sections.filter(matchSection);
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
  const projectPool = data.projects.filter(p => inflowAll.has(p.id) && matchProject(p));
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

/** 部分一致・正規表現の切り替えを1箇所に集約する。不正な正規表現は例外を投げず、
 * 「該当なし」として扱う（/sankey-svg の searchRegexError と同じ考え方）。
 * MOF項用・RS事業用のそれぞれ独立した検索ボックスから同じ形で呼ぶ */
function buildMatcher(query: string, useRegex: boolean): { match: (haystack: string) => boolean; error: boolean } {
  const q = query.trim();
  if (!q) return { match: () => true, error: false };
  if (useRegex) {
    try { const re = new RegExp(q, 'i'); return { match: s => re.test(s), error: false }; }
    catch { return { match: () => false, error: true }; }
  }
  const qLower = q.toLowerCase();
  return { match: s => s.toLowerCase().includes(qLower), error: false };
}

/** /sankey-svg と同じ「入力＋.*トグル＋クリア」の検索ボックス。MOF項・RS事業で1つずつ使う */
function SearchInput({ testId, label, placeholder, value, onChange, useRegex, onToggleRegex, error }: {
  testId: string; label: string; placeholder: string; value: string; onChange: (v: string) => void;
  useRegex: boolean; onToggleRegex: () => void; error: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-neutral-500">{label}</span>
      <div className="relative flex-1 min-w-0">
        <input
          data-testid={testId}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded border bg-neutral-50 pl-2 pr-14 text-sm outline-none"
          style={{ borderColor: error ? '#e53935' : '#d4d4d4' }}
        />
        <button
          type="button"
          aria-label={useRegex ? `${label}の正規表現検索をオフ` : `${label}を正規表現で検索`}
          aria-pressed={useRegex}
          title={useRegex ? '正規表現検索をオフ' : '正規表現で検索'}
          onClick={onToggleRegex}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-xs font-bold ${useRegex ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-600'}`}
        >.*</button>
        {value && (
          <button
            type="button"
            aria-label={`${label}の検索語をクリア`}
            onClick={() => onChange('')}
            className={`absolute top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 ${useRegex ? 'right-8' : 'right-1.5'}`}
          >✕</button>
        )}
      </div>
    </div>
  );
}

/** /sankey-svg の会計区分・省庁フィルタと同じ「チェックボックス付きコンボボックス」。
 * ボタンに選択状態の要約を出し、クリックで直下にチェックボックス一覧を開く。
 * selected が空配列＝未絞り込み（すべて含む）という約束はこのページの他フィルタと揃える */
function CheckboxCombobox({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[]; selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const allSelected = selected.length === 0;
  const summary = allSelected ? 'すべて'
    : selected.length === 1 ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : `選択中 (${selected.length}/${options.length})`;
  const isChecked = (v: string) => allSelected || selected.includes(v);
  const toggle = (v: string) => {
    const base = allSelected ? options.map(o => o.value) : selected;
    const next = base.includes(v) ? base.filter(x => x !== v) : [...base, v];
    onChange(next.length === options.length ? [] : next);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-neutral-500">{label}</span>
      <div className="relative flex-1 min-w-0">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between gap-1 rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-left"
        >
          <span className={`truncate ${allSelected ? 'text-neutral-400' : 'text-neutral-800'}`}>{summary}</span>
          <svg xmlns="http://www.w3.org/2000/svg" height="12" viewBox="0 -960 960 960" width="12" fill="#aaa"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M480-360 280-560h400L480-360Z" />
          </svg>
        </button>
        {open && (
          <>
            {/* 外クリックで閉じる。PageNavMenu と同じ全画面透明レイヤーの作法 */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="listbox"
              aria-label={label}
              className="absolute left-0 top-full z-50 mt-1 max-h-56 w-max min-w-full overflow-auto rounded border border-neutral-200 bg-white shadow-lg"
              onMouseDown={e => e.stopPropagation()}
            >
              <label className="flex cursor-pointer items-center gap-2 border-b border-neutral-100 px-2 py-1 font-semibold">
                <input type="checkbox" checked={allSelected} onChange={() => onChange([])} />
                すべて選択/解除
              </label>
              {options.map(o => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 whitespace-nowrap px-2 py-1 hover:bg-neutral-50">
                  <input type="checkbox" checked={isChecked(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-neutral-500">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** MOF金額・RS予算のレンジ入力。「1.26億」「500万」等は parseAmountToYen が解釈する。
 * 解釈できない非空文字は赤枠で知らせる（/sankey-svg の予算・支出フィルタと同じ検証表示） */
function AmountRangeRow({ label, minText, maxText, setMin, setMax }: {
  label: string; minText: string; maxText: string;
  setMin: (v: string) => void; setMax: (v: string) => void;
}) {
  const invalid = (t: string) => t !== '' && parseAmountToYen(t) === null;
  return (
    <FilterRow label={label}>
      <input value={minText} onChange={e => setMin(e.target.value)} placeholder="下限 例:100億"
        className="w-24 min-w-0 flex-1 rounded border bg-neutral-50 px-1.5 py-0.5"
        style={{ borderColor: invalid(minText) ? '#e53935' : '#d4d4d4' }} />
      <span className="text-neutral-400">〜</span>
      <input value={maxText} onChange={e => setMax(e.target.value)} placeholder="上限 例:1兆"
        className="w-24 min-w-0 flex-1 rounded border bg-neutral-50 px-1.5 py-0.5"
        style={{ borderColor: invalid(maxText) ? '#e53935' : '#d4d4d4' }} />
      {(minText || maxText) && (
        <button type="button" onClick={() => { setMin(''); setMax(''); }} className="text-neutral-400 hover:text-neutral-600">✕</button>
      )}
    </FilterRow>
  );
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
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<RenderEdge | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [scrollMode, setScrollMode] = useState<'zoom' | 'pan'>('zoom');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // 会計区分・所管は「空配列＝絞り込みなし（すべて含む）」の約束で統一する
  const [accounts, setAccounts] = useState<string[]>([]);
  const [ministries, setMinistries] = useState<string[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  // 検索: /sankey-svg と同じく部分一致・正規表現の2モードを切り替える。
  // MOF項・RS事業はそれぞれ独立した検索ボックスを持つ（相互に連携しない）
  const [sectionQuery, setSectionQuery] = useState('');
  const [sectionUseRegex, setSectionUseRegex] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectUseRegex, setProjectUseRegex] = useState(false);
  // 金額レンジ。MOF項の総額とRS事業の当初予算は別々の軸として独立に指定できる
  const [filterMofMinText, setFilterMofMinText] = useState('');
  const [filterMofMaxText, setFilterMofMaxText] = useState('');
  const [filterRsMinText, setFilterRsMinText] = useState('');
  const [filterRsMaxText, setFilterRsMaxText] = useState('');
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

  const sectionMatcher = useMemo(() => buildMatcher(sectionQuery, sectionUseRegex), [sectionQuery, sectionUseRegex]);
  const projectMatcher = useMemo(() => buildMatcher(projectQuery, projectUseRegex), [projectQuery, projectUseRegex]);

  const filteredData = useMemo(() => {
    if (!data) return null;
    const mofMin = parseAmountToYen(filterMofMinText);
    const mofMax = parseAmountToYen(filterMofMaxText);
    const rsMin = parseAmountToYen(filterRsMinText);
    const rsMax = parseAmountToYen(filterRsMaxText);
    const sections = data.sections.filter(s =>
      (accounts.length === 0 || accounts.includes(s.accountType)) &&
      (ministries.length === 0 || ministries.includes(s.ministry)) &&
      (mofMin === null || s.amount >= mofMin) &&
      (mofMax === null || s.amount <= mofMax));
    const projects = data.projects.filter(p =>
      (rsMin === null || p.initialBudget >= rsMin) &&
      (rsMax === null || p.initialBudget <= rsMax));
    const ids = new Set(sections.map(s => s.id));
    const edges = data.edges.filter(e => ids.has(e.source) && (!itemQuery || e.itemName.includes(itemQuery)));
    return { ...data, sections, projects, edges };
  }, [data, accounts, ministries, itemQuery, filterMofMinText, filterMofMaxText, filterRsMinText, filterRsMaxText]);
  useEffect(() => { setSectionOffset(0); setProjectOffset(0); },
    [accounts, ministries, itemQuery, filterMofMinText, filterMofMaxText, filterRsMinText, filterRsMaxText]);
  const view = useMemo(
    () => (filteredData ? buildView(
      filteredData,
      { topN: topSection, offset: sectionOffset }, { topN: topProject, offset: projectOffset },
      sectionMatcher.match, projectMatcher.match,
    ) : null),
    [filteredData, topSection, sectionOffset, topProject, projectOffset, sectionMatcher, projectMatcher],
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
  const prevSectionQuery = useRef(sectionQuery);
  useEffect(() => { if (prevSectionQuery.current !== sectionQuery) { prevSectionQuery.current = sectionQuery; setSectionOffset(0); } }, [sectionQuery]);
  const prevProjectQuery = useRef(projectQuery);
  useEffect(() => { if (prevProjectQuery.current !== projectQuery) { prevProjectQuery.current = projectQuery; setProjectOffset(0); } }, [projectQuery]);

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

        {/* 検索・フィルタ: /sankey-svg と同じく画面左上に置く。MOF項・RS事業それぞれ独立した
            検索ボックスを常時表示し、会計区分・所管はチェックボックス付きコンボボックス
            （/sankey-svg の会計・省庁フィルタと同じ部品）にする。開閉式の詳細フィルタに
            金額レンジ・目名を収める */}
        <div className="absolute left-3 top-3 z-30 flex items-start gap-1">
          <div className="flex flex-col" style={{ width: 340 }}>
            <div className="overflow-hidden rounded-lg rounded-br-none border border-black/10 bg-white/95 shadow-md backdrop-blur">
              <div className="flex flex-col gap-1.5 p-2">
                <SearchInput
                  testId="search-input-section" label="MOFの項" placeholder="項名・所管で検索"
                  value={sectionQuery} onChange={v => { setSectionQuery(v); setSelected(null); }}
                  useRegex={sectionUseRegex} onToggleRegex={() => setSectionUseRegex(v => !v)}
                  error={sectionMatcher.error}
                />
                <SearchInput
                  testId="search-input-project" label="RSの事業" placeholder="事業名・PIDで検索"
                  value={projectQuery} onChange={v => { setProjectQuery(v); setSelected(null); }}
                  useRegex={projectUseRegex} onToggleRegex={() => setProjectUseRegex(v => !v)}
                  error={projectMatcher.error}
                />
              </div>
              {filtersOpen && (
                <div className="flex flex-col gap-2.5 border-t border-black/5 px-3 py-2.5 text-xs">
                  <CheckboxCombobox
                    label="会計" selected={accounts} onChange={setAccounts}
                    options={[{ value: 'general', label: '一般会計' }, { value: 'special', label: '特別会計' }]}
                  />
                  <CheckboxCombobox
                    label="所管" selected={ministries} onChange={setMinistries}
                    options={[...new Set(data.sections.map(s => s.ministry))].sort().map(m => ({ value: m, label: m }))}
                  />
                  <FilterRow label="目名">
                    <input aria-label="目名" value={itemQuery} onChange={e => setItemQuery(e.target.value)}
                      placeholder="部分一致" className="w-full rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5" />
                  </FilterRow>
                  {/* MOF項の総額・RS事業の当初予算は独立したレンジとして持つ。同じ入力欄を共用しない */}
                  <AmountRangeRow label="MOF金額" minText={filterMofMinText} maxText={filterMofMaxText}
                    setMin={setFilterMofMinText} setMax={setFilterMofMaxText} />
                  <AmountRangeRow label="RS予算" minText={filterRsMinText} maxText={filterRsMaxText}
                    setMin={setFilterRsMinText} setMax={setFilterRsMaxText} />
                </div>
              )}
            </div>
            <button
              type="button"
              aria-pressed={filtersOpen}
              aria-label="フィルタの表示切替"
              title={filtersOpen ? 'フィルタを隠す' : 'フィルタを表示'}
              onClick={() => setFiltersOpen(v => !v)}
              className="self-end rounded-b border border-t-0 border-black/10 bg-white/95 px-2 py-0.5 text-[10px] text-neutral-400 shadow-sm hover:text-neutral-600"
            >{filtersOpen ? '▴' : '▾'}</button>
          </div>
          <button
            type="button"
            aria-label="フィルタを解除"
            onClick={() => {
              setSectionQuery(''); setSectionUseRegex(false);
              setProjectQuery(''); setProjectUseRegex(false);
              setAccounts([]); setMinistries([]); setItemQuery('');
              setFilterMofMinText(''); setFilterMofMaxText(''); setFilterRsMinText(''); setFilterRsMaxText('');
            }}
            className="h-9 rounded-lg border border-black/10 bg-white/90 px-2 text-xs shadow-md backdrop-blur hover:bg-white"
          >解除</button>
        </div>

        {/* 右上クラスタ: ［表示範囲 - ページ切替］。/sankey-svg のrangeCard位置と同じ。
            右パネル展開時は rightControlsOffset ぶん左へ退避する。ページ切替メニューは
            ドロップダウンが右端基準で開くため、必ずクラスタの右端に置く */}
        <div
          style={{
            position: 'absolute', top: 12, right: 12 + rightControlsOffset, zIndex: 200,
            display: 'flex', gap: 8, alignItems: 'flex-start', transition: 'right 0.2s ease',
          }}
        >
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
