'use client';

/**
 * /integrated-sankey — MOF項とRS事業を直接結ぶ2列サンキー。
 *
 * 仕様の正: docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md
 * 恒久ガイド: docs/integrated-sankey-graph-model.md
 *
 * MOF項・RS事業の2ノード型は /sankey-svg の4列（総計/省庁/事業/支出先）レイアウト
 * エンジン（app/lib/sankey-svg-filter.ts の filterTopN/computeLayout）が前提とする
 * ノード型と根本的に異なるため、データ・レイアウトのロジックはここで新規に持つ
 * （/sankey-svg は変更しない）。一方、ズーム・検索・フィルタのUI構造・スタイル値は
 * /sankey-svg の実装からそのまま移植する（近似で書き直さない）。
 *
 * 検索（ジャンプ機能）とフィルタ（絞り込み）は別物。/sankey-svg と同じ分離を守る。
 * 検索はグラフを絞り込まず、一致ノードへパン/ズームして選択するだけ。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
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
const CANVAS_H = 1100; // viewBoxは固定。Zoomは中身の縦寸法だけを変える
const NODE_W = 18; // /sankey-svg の NODE_W と揃える
const NODE_GAP = 3;
const NODE_MIN_SLOT = 18;
const LABEL_GUTTER = 300;
const COL_LEFT_X = LABEL_GUTTER + 20;
const COL_RIGHT_X = CANVAS_W - LABEL_GUTTER - 20 - NODE_W;
const COL_H = 860;
const PAD_TOP = 110;
const PAD_BOTTOM = 28;

// /sankey-svg のズーム定数（ZOOM_MIN_ABS 等）と同じ考え方。基準倍率(fit)からの比率で動く
const ZOOM_MIN_MULTIPLIER = 0.25;
const ZOOM_MAX_MULTIPLIER = 30;

const NODE_COLORS = {
  general: '#2d7d46', special: '#8ec9a8', project: '#4db870', aggregate: '#9aa0a6', excess: '#e53935',
} as const;
const EDGE_COLORS = { connected: '#4db870', unconnected: '#b3b8b3', excess: '#e53935' } as const;

const money = (v: number) =>
  v >= 1e12 ? `${(v / 1e12).toFixed(2)}兆円`
    : v >= 1e8 ? `${(v / 1e8).toFixed(1)}億円`
      : `${Math.round(v / 1e4).toLocaleString()}万円`;
const trim = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n)}…` : s);

const SUPPORTED_YEARS = [2025, 2024] as const;
type SupportedYear = (typeof SUPPORTED_YEARS)[number];

interface LinkageQuality {
  counts: { kouMokuTotal: number; kouMokuLinked: number; projectTotal: number; projectLinked: number };
  coverage: { rsAmountTotal: number; rsAmountLinked: number };
}
interface ApiResponse extends IntegratedGraph { linkageQuality: LinkageQuality | null }

type NodeKind = 'section' | 'project' | 'other-sections' | 'other-projects' | 'unconnected' | 'excess';
type DisplayNode = {
  id: string; name: string; value: number; side: 'left' | 'right'; kind: NodeKind;
  section?: IntegratedSectionNode; project?: IntegratedProjectNode;
};
type PlacedNode = DisplayNode & { x: number; y: number; h: number };
/** 項×事業のペアに束ねた表示用の帯。目単位の内訳は持たない（目一覧は詳細パネル側で別途引く） */
type DisplayEdge = { id: string; source: string; target: string; value: number; status: IntegratedItemEdge['status'] };

const OTHER_SECTIONS = 'other-sections';
const OTHER_PROJECTS = 'other-projects';

function nodeColor(n: DisplayNode) {
  if (n.kind === 'section') return n.section?.accountType === 'general' ? NODE_COLORS.general : NODE_COLORS.special;
  if (n.kind === 'project') return NODE_COLORS.project;
  if (n.kind === 'excess') return NODE_COLORS.excess;
  return NODE_COLORS.aggregate;
}

/** 部分一致・正規表現の切り替えを1箇所に集約する。不正な正規表現は例外を投げず
 * 「該当なし」として扱う（/sankey-svg の searchRegexError と同じ考え方） */
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

export interface RangeWindow { topN: number; offset: number }
function windowSlice<T>(ranked: T[], w: RangeWindow) {
  const maxOffset = Math.max(0, ranked.length - w.topN);
  const offset = Math.max(0, Math.min(w.offset, maxOffset));
  return { shown: ranked.slice(offset, offset + w.topN), offset, maxOffset, total: ranked.length };
}

interface Filters {
  accounts: string[]; ministries: string[];
  sectionNameQuery: string; projectNameQuery: string;
  mofMinText: string; mofMaxText: string; rsMinText: string; rsMaxText: string;
}
const EMPTY_FILTERS: Filters = {
  accounts: [], ministries: [], sectionNameQuery: '', projectNameQuery: '',
  mofMinText: '', mofMaxText: '', rsMinText: '', rsMaxText: '',
};

function buildView(data: IntegratedGraph, filters: Filters, sectionWindow: RangeWindow, projectWindow: RangeWindow) {
  const mofMin = parseAmountToYen(filters.mofMinText);
  const mofMax = parseAmountToYen(filters.mofMaxText);
  const rsMin = parseAmountToYen(filters.rsMinText);
  const rsMax = parseAmountToYen(filters.rsMaxText);
  const sectionNameMatch = buildMatcher(filters.sectionNameQuery, false).match;
  const projectNameMatch = buildMatcher(filters.projectNameQuery, false).match;
  // 共管（所管が「A及びB」のような複合表記）を分解して複数値として扱う
  const ministriesOf = (m: string) => m.split(/及び|・|、/).map(s => s.trim()).filter(Boolean);

  const kept = data.sections.filter(s =>
    (filters.accounts.length === 0 || filters.accounts.includes(s.accountType)) &&
    (filters.ministries.length === 0 || ministriesOf(s.ministry).some(m => filters.ministries.includes(m))) &&
    sectionNameMatch(s.name) &&
    (mofMin === null || s.amount >= mofMin) &&
    (mofMax === null || s.amount <= mofMax));
  const keptIds = new Set(kept.map(s => s.id));

  const sectionDrawn = new Map<string, number>();
  for (const e of data.edges) if (keptIds.has(e.source)) sectionDrawn.set(e.source, (sectionDrawn.get(e.source) ?? 0) + e.value);
  const rankedSections = [...kept].sort((a, b) => (sectionDrawn.get(b.id) ?? 0) - (sectionDrawn.get(a.id) ?? 0));
  const sectionRange = windowSlice(rankedSections, sectionWindow);
  const shownIds = new Set(sectionRange.shown.map(s => s.id));
  const hasOtherSections = sectionRange.total > sectionRange.shown.length;
  const sourceOf = (e: IntegratedItemEdge) => shownIds.has(e.source) ? e.source : keptIds.has(e.source) ? OTHER_SECTIONS : null;

  const inflowAll = new Map<string, number>();
  for (const e of data.edges) {
    if (!keptIds.has(e.source) || !e.target.startsWith('project:')) continue;
    inflowAll.set(e.target, (inflowAll.get(e.target) ?? 0) + e.value);
  }
  const projectPool = data.projects.filter(p =>
    inflowAll.has(p.id) && projectNameMatch(p.name) &&
    (rsMin === null || p.initialBudget >= rsMin) &&
    (rsMax === null || p.initialBudget <= rsMax));
  const rankedProjects = [...projectPool].sort((a, b) => (inflowAll.get(b.id) ?? 0) - (inflowAll.get(a.id) ?? 0));
  const projectRange = windowSlice(rankedProjects, projectWindow);
  const shownProjectIds = new Set(projectRange.shown.map(p => p.id));
  const hasOtherProjects = projectRange.total > projectRange.shown.length;
  const targetOf = (e: IntegratedItemEdge) =>
    !e.target.startsWith('project:') ? e.target : shownProjectIds.has(e.target) ? e.target : OTHER_PROJECTS;

  // 項×事業のペアへ集約する（目エッジは持たない）
  const bundles = new Map<string, DisplayEdge>();
  for (const e of data.edges) {
    const source = sourceOf(e);
    if (!source) continue;
    const target = targetOf(e);
    const id = `${source}|${target}`;
    const found = bundles.get(id);
    if (found) { found.value += e.value; if (e.status !== 'connected') found.status = e.status; }
    else bundles.set(id, { id, source, target, value: e.value, status: e.status });
  }
  const edges = [...bundles.values()];

  const outTotals = new Map<string, number>(); const inTotals = new Map<string, number>();
  for (const e of edges) {
    outTotals.set(e.source, (outTotals.get(e.source) ?? 0) + e.value);
    inTotals.set(e.target, (inTotals.get(e.target) ?? 0) + e.value);
  }

  const left: DisplayNode[] = sectionRange.shown
    .map((s): DisplayNode => ({ id: s.id, name: s.name, value: outTotals.get(s.id) ?? 0, side: 'left', kind: 'section', section: s }))
    .filter(n => n.value > 0).sort((a, b) => b.value - a.value);
  if (hasOtherSections && (outTotals.get(OTHER_SECTIONS) ?? 0) > 0) {
    left.push({ id: OTHER_SECTIONS, name: `その他の項（${sectionRange.total - sectionRange.shown.length}件）`, value: outTotals.get(OTHER_SECTIONS)!, side: 'left', kind: 'other-sections' });
  }
  const right: DisplayNode[] = projectRange.shown
    .map((p): DisplayNode => ({ id: p.id, name: p.name, value: inTotals.get(p.id) ?? 0, side: 'right', kind: 'project', project: p }))
    .filter(n => n.value > 0);
  const special: [string, string, NodeKind][] = [['rs-unconnected', 'RS未接続', 'unconnected'], ['rs-excess', '超過・要確認', 'excess']];
  for (const [id, name, kind] of special) { const v = inTotals.get(id) ?? 0; if (v > 0) right.push({ id, name, value: v, side: 'right', kind }); }
  right.sort((a, b) => b.value - a.value);
  if (hasOtherProjects && (inTotals.get(OTHER_PROJECTS) ?? 0) > 0) {
    right.push({ id: OTHER_PROJECTS, name: `その他のRS事業（${projectRange.total - projectRange.shown.length}件）`, value: inTotals.get(OTHER_PROJECTS)!, side: 'right', kind: 'other-projects' });
  }

  const sumOf = (status: IntegratedItemEdge['status']) => edges.filter(e => e.status === status).reduce((a, e) => a + e.value, 0);
  const totals = { all: edges.reduce((a, e) => a + e.value, 0), connected: sumOf('connected'), unconnected: sumOf('unconnected'), excess: sumOf('excess') };
  return {
    left, right, edges, totals,
    sectionUniverse: sectionRange.total, sectionMaxOffset: sectionRange.maxOffset, sectionOffset: sectionRange.offset,
    projectUniverse: projectRange.total, projectMaxOffset: projectRange.maxOffset, projectOffset: projectRange.offset,
  };
}

type ViewModel = ReturnType<typeof buildView>;

function fitZoom(view: ViewModel) {
  let low = 0.1, high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (buildLayout(view, mid).contentH <= CANVAS_H - 30) low = mid; else high = mid;
  }
  return low;
}

function buildLayout(view: ViewModel, zoom: number) {
  const total = view.left.reduce((a, n) => a + n.value, 0) || 1;
  const availLeft = COL_H - Math.max(0, view.left.length - 1) * NODE_GAP;
  const availRight = COL_H - Math.max(0, view.right.length - 1) * NODE_GAP;
  const ky = Math.max(0, Math.min(availLeft, availRight)) / total;
  const place = (nodes: DisplayNode[], x: number): PlacedNode[] => {
    let y = PAD_TOP;
    return nodes.map(n => {
      const h = n.value * ky * zoom;
      const slot = Math.max(NODE_MIN_SLOT, h);
      y += (slot - h) / 2;
      const placed: PlacedNode = { ...n, x, y, h };
      y += h + (slot - h) / 2 + NODE_GAP;
      return placed;
    });
  };
  const left = place(view.left, COL_LEFT_X);
  const right = place(view.right, COL_RIGHT_X);
  const byId = new Map<string, PlacedNode>([...left, ...right].map(n => [n.id, n]));
  const outAcc = new Map<string, number>(); const inAcc = new Map<string, number>();
  const bands = view.edges
    .filter(e => byId.has(e.source) && byId.has(e.target))
    .sort((a, b) => (byId.get(a.source)!.y - byId.get(b.source)!.y) || (byId.get(a.target)!.y - byId.get(b.target)!.y))
    .map(e => {
      const s = byId.get(e.source)!; const t = byId.get(e.target)!;
      const w = Math.max(0.4, e.value * ky * zoom);
      const sy = s.y + (outAcc.get(s.id) ?? 0); const ty = t.y + (inAcc.get(t.id) ?? 0);
      outAcc.set(s.id, (outAcc.get(s.id) ?? 0) + w); inAcc.set(t.id, (inAcc.get(t.id) ?? 0) + w);
      return { edge: e, sy, ty, w };
    });
  const bottom = (nodes: PlacedNode[]) => (nodes.length ? nodes[nodes.length - 1].y + nodes[nodes.length - 1].h : PAD_TOP);
  const contentH = Math.max(bottom(left), bottom(right)) + PAD_BOTTOM;
  return { left, right, byId, bands, contentH };
}

/** 帯は塗りで描く。線幅で描くと両端の位置合わせができない */
function ribbonPath(x0: number, sy: number, x1: number, ty: number, w: number) {
  const c1 = x0 + (x1 - x0) * 0.45, c2 = x1 - (x1 - x0) * 0.45;
  return `M${x0},${sy} C${c1},${sy} ${c2},${ty} ${x1},${ty} L${x1},${ty + w} C${c2},${ty + w} ${c1},${sy + w} ${x0},${sy + w} Z`;
}

// ────────────────────────────────────────────────────────────
// UI部品（/sankey-svg の実装からスタイル値・構造を移植）
// ────────────────────────────────────────────────────────────

/** /sankey-svg の会計区分・省庁フィルタと同じ「チェックボックス付きコンボボックス」 */
function CheckboxCombobox({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // /sankey-svg と同じく、全画面の透明レイヤーではなく外側クリック検知で閉じる。
  // 全画面レイヤーだとトリガーボタン自身もレイヤーの下敷きになり、再クリックで
  // 閉じようとした操作が奪われる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#555', width: '3.5em', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div ref={rootRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(v => !v)}
          style={{ width: '100%', fontSize: 11, border: '1px solid #ddd', borderRadius: 4, padding: '3px 20px 3px 5px', background: '#fafafa', color: allSelected ? '#aaa' : '#333', outline: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{summary}</button>
        <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
          <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="#aaa"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M480-360 280-560h400L480-360Z" />
          </svg>
        </span>
        {open && (
          <div role="listbox" aria-label={label}
            style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 50, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto', minWidth: '100%', width: 'max-content' }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
              <input type="checkbox" checked={allSelected} onChange={() => onChange([])} style={{ width: 12, height: 12 }} />
              <span style={{ fontSize: 11, color: '#333' }}>すべて選択/解除</span>
            </label>
            {options.map(o => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={isChecked(o.value)} onChange={() => toggle(o.value)} style={{ width: 12, height: 12 }} />
                <span style={{ fontSize: 11, color: '#333' }}>{o.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#555', width: '3.5em', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

/** /sankey-svg の予算/支出テキスト入力と同じ検証表示（不正な非空文字は赤枠） */
function AmountRangeRow({ label, minText, maxText, setMin, setMax }: {
  label: string; minText: string; maxText: string; setMin: (v: string) => void; setMax: (v: string) => void;
}) {
  const invalid = (t: string) => t !== '' && parseAmountToYen(t) === null;
  return (
    <FilterRow label={label}>
      <input value={minText} onChange={e => setMin(e.target.value)} placeholder="例: 100億、50万"
        style={{ flex: 1, minWidth: 0, fontSize: 11, border: `1px solid ${invalid(minText) ? '#e53935' : '#ddd'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }} />
      <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>~</span>
      <input value={maxText} onChange={e => setMax(e.target.value)} placeholder="例: 1兆、500億"
        style={{ flex: 1, minWidth: 0, fontSize: 11, border: `1px solid ${invalid(maxText) ? '#e53935' : '#ddd'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }} />
      {(minText || maxText) && (
        <button type="button" onClick={() => { setMin(''); setMax(''); }} style={{ fontSize: 11, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
      )}
    </FilterRow>
  );
}

interface SearchHit { id: string; name: string; sub: string; value: number }

/** /sankey-svg と同じ「検索＝ジャンプ機能」。グラフは絞り込まず、一致ノードを列挙して
 * クリックで選択・パン/ズームするだけ。項用・事業用をそれぞれ独立に持つ */
function SearchJumpBox({ label, placeholder, testId, query, setQuery, useRegex, setUseRegex, results, onSelect }: {
  label: string; placeholder: string; testId: string;
  query: string; setQuery: (v: string) => void; useRegex: boolean; setUseRegex: (v: boolean) => void;
  results: SearchHit[]; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { error } = buildMatcher(query, useRegex);
  // /sankey-svg と同じく、全画面の透明レイヤーではなく外側クリック検知で閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <span aria-hidden="true" style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
        <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
      </span>
      <input
        data-testid={testId}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setOpen(false); } }}
        placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 28, paddingRight: useRegex ? 56 : 32, paddingTop: 6, paddingBottom: 6, fontSize: 13, border: `1px solid ${error ? '#e53935' : '#e0e0e0'}`, borderRadius: 6, background: '#fff', outline: 'none', color: '#333' }}
      />
      <button type="button" aria-label={useRegex ? `${label}の正規表現検索をオフ` : `${label}を正規表現で検索`} aria-pressed={useRegex}
        title={useRegex ? '正規表現検索をオフ' : '正規表現で検索'} onClick={() => setUseRegex(!useRegex)}
        style={{ position: 'absolute', right: query ? 26 : 6, top: '50%', transform: 'translateY(-50%)', background: useRegex ? '#1a73e8' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', color: useRegex ? '#fff' : '#888', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1, padding: '2px 4px' }}
      >.*</button>
      {query && (
        <button type="button" aria-label={`${label}の検索語をクリア`} onClick={() => { setQuery(''); setOpen(false); }}
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
        >✕</button>
      )}
      {open && query.trim() && (
        <div
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50, maxHeight: 260, overflowY: 'auto' }}
        >
          {results.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#999' }}>該当なし</div>
          ) : results.slice(0, 50).map(r => (
            <button key={r.id} type="button" data-testid={`${testId}-result`} onClick={() => { onSelect(r.id); setOpen(false); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, color: '#333' }}>{r.name}</span>
              <span style={{ flexShrink: 0, fontSize: 11, color: '#999' }}>{r.sub} ・ {money(r.value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** /sankey-svg のズームコントロール（右下・縦積みカード）と同じ構造・アイコン */
function ZoomControls({ scale, baseZoom, onZoomBy, onZoomTo, onReset, scrollMode, onToggleScrollMode, right }: {
  scale: number; baseZoom: number; onZoomBy: (factor: number) => void; onZoomTo: (percent: number) => void; onReset: () => void;
  scrollMode: 'zoom' | 'pan'; onToggleScrollMode: () => void; right: number;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const percent = Math.round(scale / baseZoom * 100);
  const min = Math.log10(Math.max(0.02, baseZoom * ZOOM_MIN_MULTIPLIER));
  const max = Math.log10(Math.min(60, baseZoom * ZOOM_MAX_MULTIPLIER));
  return (
    <div style={{ position: 'absolute', bottom: 12, right, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4, transition: 'right 0.2s ease' }}>
      <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
        <button aria-label={scrollMode === 'pan' ? 'スクロール移動モード（クリックでズームモードへ）' : 'スクロール移動モードに切替'}
          aria-pressed={scrollMode === 'pan'}
          title={scrollMode === 'pan' ? 'スクロール: 移動モード\nクリックでズームモードへ' : 'スクロール: ズームモード\nクリックで移動モードへ'}
          onClick={onToggleScrollMode}
          style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: scrollMode === 'pan' ? '#e8f0fe' : 'transparent', cursor: 'pointer' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill={scrollMode === 'pan' ? '#1a73e8' : '#bbb'}><path d="M480-80 310-250l57-57 73 73v-166H274l73 74-57 57L120-440l170-170 57 57-74 73h166v-166l-73 73-57-57 170-170 170 170-57 57-73-73v166h166l-74-73 57-57 170 170-170 170-57-57 74-74H520v166l73-73 57 57L480-80Z" /></svg>
        </button>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button data-testid="zoom-in" aria-label="ズームイン" onClick={() => onZoomBy(1.5)} title="ズームイン"
          style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}>
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
        </button>
        <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
          <input type="range" aria-label="ズーム倍率" min={min} max={max} step={0.01}
            value={Math.log10(Math.max(1e-6, scale))}
            onChange={e => onZoomTo(Math.pow(10, parseFloat(e.target.value)) / baseZoom * 100)}
            style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16, height: 80 }}
            title={`Zoom: ${percent}%`} />
        </div>
        <button data-testid="zoom-out" aria-label="ズームアウト" onClick={() => onZoomBy(1 / 1.5)} title="ズームアウト"
          style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13H5v-2h14v2z" /></svg>
        </button>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
        {editing ? (
          <input type="number" autoFocus min={1} max={6000} step={1} value={inputValue}
            onChange={e => { setInputValue(e.target.value); const v = Number(e.target.value); if (!isNaN(v) && v > 0) onZoomTo(v); }}
            onBlur={() => setEditing(false)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false); }}
            style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '3px 0', border: 'none', outline: 'none', background: 'transparent', color: '#555', boxSizing: 'border-box' }} />
        ) : (
          <button onClick={() => { setInputValue(String(percent)); setEditing(true); }} title="クリックしてZoom率を入力"
            style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '4px 0', border: 'none', background: 'transparent', color: '#888', cursor: 'text' }}
          >{percent}%</button>
        )}
      </div>
      <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
        <button data-testid="reset-viewport" aria-label="全体表示" onClick={onReset} title="全体表示"
          style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path d="M792-576v-120H672v-72h120q30 0 51 21.15T864-696v120h-72Zm-696 0v-120q0-30 21.15-51T168-768h120v72H168v120H96Zm576 384v-72h120v-120h72v120q0 30-21.15 51T792-192H672Zm-504 0q-30 0-51-21.15T96-264v-120h72v120h120v72H168Zm72-144v-288h480v288H240Zm72-72h336v-144H312v144Zm0 0v-144 144Z" /></svg>
        </button>
      </div>
    </div>
  );
}

function App() {
  const [year, setYear] = useState<SupportedYear>(2025);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState('');

  const [topSection, setTopSection] = useState(35);
  const [sectionOffset, setSectionOffset] = useState(0);
  const [topProject, setTopProject] = useState(35);
  const [projectOffset, setProjectOffset] = useState(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<DisplayEdge | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [baseZoom, setBaseZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scrollMode, setScrollMode] = useState<'zoom' | 'pan'>('zoom');
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(f => ({ ...f, [k]: v }));

  const [sectionSearch, setSectionSearch] = useState('');
  const [sectionSearchRegex, setSectionSearchRegex] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectSearchRegex, setProjectSearchRegex] = useState(false);

  const detailPanel = useSidePanel({ side: 'right' });

  useEffect(() => {
    setData(null); setError(''); setSelected(null);
    fetch(`/api/integrated-sankey?year=${year}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then(setData)
      .catch(e => setError(e.message));
  }, [year]);

  const view = useMemo(
    () => (data ? buildView(data, filters, { topN: topSection, offset: sectionOffset }, { topN: topProject, offset: projectOffset }) : null),
    [data, filters, topSection, sectionOffset, topProject, projectOffset],
  );
  const layout = useMemo(() => (view ? buildLayout(view, scale) : null), [view, scale]);
  const initiallyFitted = useRef(false);
  useEffect(() => {
    if (view && !initiallyFitted.current) { initiallyFitted.current = true; const k = fitZoom(view); setBaseZoom(k); setScale(k); }
  }, [view]);

  const prevTopSection = useRef(topSection);
  useEffect(() => { if (prevTopSection.current !== topSection) { prevTopSection.current = topSection; setSectionOffset(0); } }, [topSection]);
  const prevTopProject = useRef(topProject);
  useEffect(() => { if (prevTopProject.current !== topProject) { prevTopProject.current = topProject; setProjectOffset(0); } }, [topProject]);
  const prevFilters = useRef(filters);
  useEffect(() => { if (prevFilters.current !== filters) { prevFilters.current = filters; setSectionOffset(0); setProjectOffset(0); } }, [filters]);

  const sectionSearchResults: SearchHit[] = useMemo(() => {
    if (!data || !sectionSearch.trim()) return [];
    const { match } = buildMatcher(sectionSearch, sectionSearchRegex);
    return data.sections.filter(s => match(`${s.name} ${s.ministry} ${s.organization}`))
      .sort((a, b) => b.amount - a.amount)
      .map(s => ({ id: s.id, name: s.name, sub: s.ministry, value: s.amount }));
  }, [data, sectionSearch, sectionSearchRegex]);
  const projectSearchResults: SearchHit[] = useMemo(() => {
    if (!data || !projectSearch.trim()) return [];
    const { match } = buildMatcher(projectSearch, projectSearchRegex);
    return data.projects.filter(p => match(`${p.name} ${p.ministry} ${p.projectId}`))
      .sort((a, b) => b.initialBudget - a.initialBudget)
      .map(p => ({ id: p.id, name: p.name, sub: `PID:${p.projectId}`, value: p.initialBudget }));
  }, [data, projectSearch, projectSearchRegex]);

  // ジャンプ選択: 対象ノードが現在の表示ウィンドウの外なら、窓を動かして中に入れる
  const jumpTo = (id: string, kind: 'section' | 'project') => {
    if (!data) return;
    if (kind === 'section') {
      const kept = data.sections.filter(s => filters.accounts.length === 0 || filters.accounts.includes(s.accountType));
      const drawn = new Map<string, number>();
      for (const e of data.edges) if (kept.some(s => s.id === e.source)) drawn.set(e.source, (drawn.get(e.source) ?? 0) + e.value);
      const ranked = [...kept].sort((a, b) => (drawn.get(b.id) ?? 0) - (drawn.get(a.id) ?? 0));
      const idx = ranked.findIndex(s => s.id === id);
      if (idx >= 0) setSectionOffset(Math.max(0, idx - Math.floor(topSection / 2)));
    } else {
      const idx = data.projects.findIndex(p => p.id === id);
      if (idx >= 0) setProjectOffset(Math.max(0, idx - Math.floor(topProject / 2)));
    }
    setSelected(id);
    setPan({ x: 0, y: 0 });
  };

  const selectedNode = layout?.byId.get(selected ?? '') ?? null;
  const selectedItemEdges = useMemo(
    () => (data && selected ? data.edges.filter(e => e.source === selected || e.target === selected) : []),
    [data, selected],
  );

  if (error) return <div className="flex h-screen items-center justify-center text-red-600">{error}</div>;
  if (!data || !view || !layout) return <div className="flex h-screen items-center justify-center text-neutral-500">読み込み中…</div>;

  const isRelated = (e: DisplayEdge) => !selected || e.source === selected || e.target === selected;
  const nodeActive = (n: PlacedNode) => !selected || n.id === selected || view.edges.some(e => isRelated(e) && (e.source === n.id || e.target === n.id));
  const zoomAt = (next: number, anchor: number) => {
    const z = Math.max(0.02, Math.min(60, next));
    setPan(p => ({ ...p, y: anchor - (anchor - p.y) * buildLayout(view, z).contentH / layout.contentH }));
    setScale(z); setHover(null);
  };
  const reset = () => { setScale(baseZoom); setPan({ x: 0, y: 0 }); };
  const rightControlsOffset = selected && !detailPanel.collapsed ? detailPanel.effectiveWidth : 0;
  const allMinistries = [...new Set(data.sections.flatMap(s => s.ministry.split(/及び|・|、/).map(x => x.trim()).filter(Boolean)))].sort();

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#f7f8f5] text-neutral-800">
      <div className="absolute inset-y-0 left-0" style={{ right: rightControlsOffset, transition: 'right 0.2s ease' }}>
        <svg
          data-testid="integrated-canvas"
          className="h-full w-full cursor-grab"
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="xMidYMid meet"
          onWheel={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const unit = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H);
            if (scrollMode === 'pan' && !e.ctrlKey && !e.metaKey) setPan(p => ({ x: p.x - e.deltaX * 1.2 / unit, y: p.y - e.deltaY * 1.2 / unit }));
            else zoomAt(scale * (e.deltaY > 0 ? 0.9 : 1.1), (e.clientY - rect.top - (rect.height - CANVAS_H * unit) / 2) / unit);
          }}
          onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
          onMouseMove={e => {
            setCursor({ x: e.clientX, y: e.clientY });
            if (drag.current) {
              const rect = e.currentTarget.getBoundingClientRect();
              const unit = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H);
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
                  <path key={edge.id} data-testid="integrated-edge" data-status={edge.status}
                    d={ribbonPath(COL_LEFT_X + NODE_W, sy, COL_RIGHT_X, ty, w)}
                    fill={EDGE_COLORS[edge.status]} fillOpacity={active ? (hover?.id === edge.id ? 0.85 : 0.45) : 0.06}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover(edge)} onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(edge.target)}
                  >
                    <title>{money(edge.value)}</title>
                  </path>
                );
              })}
            </g>
            <g>
              {[...layout.left, ...layout.right].map(n => {
                const active = nodeActive(n); const isLeft = n.side === 'left';
                return (
                  <g key={n.id} data-testid="sankey-node" data-kind={n.kind} className="cursor-pointer" opacity={active ? 1 : 0.2}
                    onClick={() => setSelected(selected === n.id ? null : n.id)}
                  >
                    <rect x={n.x} y={n.y} width={NODE_W} height={Math.max(0.3, n.h)} rx="2" fill={nodeColor(n)}
                      stroke={selected === n.id ? '#111' : 'none'} strokeWidth={selected === n.id ? 2 : 0} />
                    <text x={isLeft ? n.x - 8 : n.x + NODE_W + 8} y={n.y + n.h / 2 + 4} textAnchor={isLeft ? 'end' : 'start'} fontSize="12" fill="#333">
                      {trim(n.name)}
                      {n.h >= 15 && <tspan fill="#8a8f8a">　{money(n.value)}</tspan>}
                    </text>
                    <title>{n.name}｜{money(n.value)}</title>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {hover && (
          <div data-testid="integrated-hover" className="pointer-events-none fixed z-40 max-w-sm rounded-lg border border-black/10 bg-white/97 p-2.5 text-xs shadow-xl"
            style={{ left: Math.min(cursor.x + 14, window.innerWidth - 340), top: cursor.y + 16 }}
          >
            <div>この帯 {money(hover.value)}</div>
            <div className="mt-1 text-neutral-500">
              {hover.status === 'connected' ? 'MOF接続済み' : hover.status === 'excess' ? '超過・要確認' : 'RS未接続・差額'}
            </div>
          </div>
        )}
      </div>

      {/* 左上：検索（ジャンプ）・フィルタ（絞り込み） */}
      <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 30, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 320 }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e0e0e0', borderRadius: '6px 6px 0 6px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
              <SearchJumpBox label="MOFの項" placeholder="項名・所管で検索し選択" testId="search-input-section"
                query={sectionSearch} setQuery={setSectionSearch} useRegex={sectionSearchRegex} setUseRegex={setSectionSearchRegex}
                results={sectionSearchResults} onSelect={id => jumpTo(id, 'section')} />
              <SearchJumpBox label="RSの事業" placeholder="事業名・PIDで検索し選択" testId="search-input-project"
                query={projectSearch} setQuery={setProjectSearch} useRegex={projectSearchRegex} setUseRegex={setProjectSearchRegex}
                results={projectSearchResults} onSelect={id => jumpTo(id, 'project')} />
            </div>
            {filtersOpen && (
              <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #f0f0f0' }}>
                <CheckboxCombobox label="会計" selected={filters.accounts} onChange={v => setFilter('accounts', v)}
                  options={[{ value: 'general', label: '一般会計' }, { value: 'special', label: '特別会計' }]} />
                <CheckboxCombobox label="所管" selected={filters.ministries} onChange={v => setFilter('ministries', v)}
                  options={allMinistries.map(m => ({ value: m, label: m }))} />
                <FilterRow label="項">
                  <input aria-label="項名で絞り込み" value={filters.sectionNameQuery} onChange={e => setFilter('sectionNameQuery', e.target.value)}
                    placeholder="部分一致" style={{ flex: 1, minWidth: 0, fontSize: 11, border: '1px solid #ddd', borderRadius: 4, padding: '3px 5px', background: '#fafafa' }} />
                </FilterRow>
                <FilterRow label="事業">
                  <input aria-label="事業名で絞り込み" value={filters.projectNameQuery} onChange={e => setFilter('projectNameQuery', e.target.value)}
                    placeholder="部分一致" style={{ flex: 1, minWidth: 0, fontSize: 11, border: '1px solid #ddd', borderRadius: 4, padding: '3px 5px', background: '#fafafa' }} />
                </FilterRow>
                <AmountRangeRow label="項予算" minText={filters.mofMinText} maxText={filters.mofMaxText}
                  setMin={v => setFilter('mofMinText', v)} setMax={v => setFilter('mofMaxText', v)} />
                <AmountRangeRow label="事業予算" minText={filters.rsMinText} maxText={filters.rsMaxText}
                  setMin={v => setFilter('rsMinText', v)} setMax={v => setFilter('rsMaxText', v)} />
              </div>
            )}
          </div>
          <button type="button" aria-pressed={filtersOpen} aria-label="フィルタの表示切替"
            title={filtersOpen ? 'フィルタ を隠す' : 'フィルタ を表示'} onClick={() => setFiltersOpen(v => !v)}
            style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.92)', borderTop: 'none', borderLeft: '1px solid #e0e0e0', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', borderRadius: '0 0 4px 4px', cursor: 'pointer', padding: '0 2px', marginTop: -1 }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
              <path d={filtersOpen ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'} />
            </svg>
          </button>
        </div>
        <button type="button" aria-label="フィルタを解除" onClick={() => setFilters(EMPTY_FILTERS)}
          style={{ height: 34, borderRadius: 6, border: '1px solid #e0e0e0', background: 'rgba(255,255,255,0.92)', padding: '0 10px', fontSize: 12, color: '#666', cursor: 'pointer' }}
        >解除</button>
      </div>

      {/* 右上：表示範囲（項・事業）・年度切替・ページ切替 */}
      <div style={{ position: 'absolute', top: 12, right: 12 + rightControlsOffset, zIndex: 200, display: 'flex', gap: 8, alignItems: 'flex-start', transition: 'right 0.2s ease' }}>
        <div style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', width: 300, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <RangeWindowRow label="MOF項" total={view.sectionUniverse} topN={topSection} setTopN={setTopSection}
            offset={view.sectionOffset} maxOffset={view.sectionMaxOffset} onOffsetChange={setSectionOffset} markReplace={() => {}} metaFontPx={11} />
          <RangeWindowRow label="RS事業" total={view.projectUniverse} topN={topProject} setTopN={setTopProject}
            offset={view.projectOffset} maxOffset={view.projectMaxOffset} onOffsetChange={setProjectOffset} markReplace={() => {}} metaFontPx={11} />
        </div>
        <YearSelect value={String(year)} onChange={v => setYear(Number(v) as SupportedYear)} years={SUPPORTED_YEARS} theme="light" fontPx={12} testId="year-select" />
        <PageNavMenu current="/integrated-sankey" theme="light" />
      </div>

      {/* 紐づけ品質。年度によって著しく異なるため隠さず出す */}
      {data.linkageQuality && (
        <div style={{ position: 'absolute', top: 100, right: 12 + rightControlsOffset, zIndex: 20, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#777', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          紐づけ率：事業 {(data.linkageQuality.counts.projectLinked / data.linkageQuality.counts.projectTotal * 100).toFixed(1)}%
          ／金額 {(data.linkageQuality.coverage.rsAmountLinked / data.linkageQuality.coverage.rsAmountTotal * 100).toFixed(1)}%
          {data.linkageQuality.counts.projectLinked / data.linkageQuality.counts.projectTotal < 0.5 &&
            <span style={{ marginLeft: 4, color: '#e11d48' }}>（この年度は紐づけ精度が低い）</span>}
        </div>
      )}

      {/* 左下：列の合計（設定コーナー相当） */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 30, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.95)', border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 12px', fontSize: 11, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
        <span style={{ color: '#999' }}>MOF {money(data.metadata.mofAmount)}</span>
        <span style={{ color: '#2d7d46' }}>接続 {money(data.metadata.connectedAmount)}</span>
        <span style={{ color: '#888' }}>未接続 {money(data.metadata.unconnectedAmount)}</span>
        {data.metadata.excessAmount > 0 && <span style={{ color: '#e53935' }}>超過 {money(data.metadata.excessAmount)}</span>}
      </div>

      <ZoomControls scale={scale} baseZoom={baseZoom} onZoomBy={f => zoomAt(scale * f, 550)} onZoomTo={pct => zoomAt(pct / 100 * baseZoom, 550)}
        onReset={reset} scrollMode={scrollMode} onToggleScrollMode={() => setScrollMode(m => m === 'zoom' ? 'pan' : 'zoom')}
        right={16 + rightControlsOffset} />

      {selected && (
        <SidePanelChrome side="right" open={!detailPanel.collapsed} onToggle={detailPanel.toggleCollapsed}
          width={detailPanel.effectiveWidth} minWidth={SIDE_PANEL_WIDTH_MIN} maxWidth={SIDE_PANEL_WIDTH_MAX}
          onResizeStart={detailPanel.onResizeStart} isResizing={detailPanel.isResizing} onResetWidth={detailPanel.resetWidth}
          testId="integrated-detail"
        >
          <div className="overflow-auto p-5">
            <button onClick={() => setSelected(null)} className="float-right rounded border px-2 py-1 text-xs">選択解除</button>
            {selectedNode?.section ? (
              <SectionDetail section={selectedNode.section} itemEdges={selectedItemEdges} projects={data.projects} />
            ) : selectedNode?.project ? (
              <ProjectDetail project={selectedNode.project} itemEdges={selectedItemEdges} sections={data.sections} />
            ) : (
              <SpecialDetail id={selected} name={selectedNode?.name ?? ''} edges={view.edges.filter(e => e.source === selected || e.target === selected)} />
            )}
          </div>
        </SidePanelChrome>
      )}
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// 詳細パネル
// ────────────────────────────────────────────────────────────

function DetailTabs({ tabs, active, onChange }: { tabs: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div className="mt-3 flex gap-1 border-b border-neutral-200 text-sm">
      {tabs.map((t, i) => (
        <button key={t} onClick={() => onChange(i)}
          className={`border-b-2 px-2 py-1.5 ${i === active ? 'border-emerald-600 font-semibold text-neutral-900' : 'border-transparent text-neutral-500'}`}
        >{t}</button>
      ))}
    </div>
  );
}

function SectionDetail({ section, itemEdges, projects }: {
  section: IntegratedSectionNode; itemEdges: IntegratedItemEdge[]; projects: IntegratedProjectNode[];
}) {
  const [tab, setTab] = useState(0);
  const projectById = new Map(projects.map(p => [p.id, p]));
  const projectTotals = new Map<string, number>();
  for (const e of itemEdges) if (e.target.startsWith('project:')) projectTotals.set(e.target, (projectTotals.get(e.target) ?? 0) + e.value);
  const changeRate = section.previousAmount > 0 ? (section.difference / section.previousAmount * 100) : null;
  return (
    <div className="text-sm">
      <p className="text-xs font-semibold text-neutral-500">MOF項</p>
      <h2 className="mt-1 pr-10 text-lg font-bold">{section.name}</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-neutral-100 p-3 text-xs">
        <div className="col-span-2">{section.accountType === 'general' ? '一般会計' : '特別会計'} ／ {section.ministry}</div>
        <div className="col-span-2">{section.organization}{section.subAccount ? ` / ${section.subAccount}` : ''}</div>
        <div>本年度額 <b>{money(section.amount)}</b></div>
        <div>前年度額 <b>{money(section.previousAmount)}</b></div>
        <div className="col-span-2">
          増減 <b className={section.difference < 0 ? 'text-rose-600' : 'text-emerald-700'}>{money(Math.abs(section.difference))}</b>
          {changeRate !== null && <span className="text-neutral-500">（{changeRate >= 0 ? '+' : ''}{changeRate.toFixed(1)}%）</span>}
        </div>
      </div>
      <DetailTabs tabs={['目一覧', 'RS事業一覧']} active={tab} onChange={setTab} />
      {tab === 0 ? (
        <div className="mt-3">
          {[...itemEdges].sort((a, b) => b.value - a.value).slice(0, 100).map(e => (
            <div key={e.id} className="border-t py-2">
              <div className="font-medium">{e.itemName}</div>
              <div className="text-xs text-neutral-500">
                {money(e.value)}・{e.status === 'connected' ? `RS接続済み${e.target.startsWith('project:') ? `（${projectById.get(e.target)?.name ?? ''}）` : ''}` : e.status === 'excess' ? '超過・要確認' : 'RS未接続'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          {projectTotals.size === 0 ? <p className="text-neutral-500">接続しているRS事業がありません</p> : (
            [...projectTotals.entries()].sort((a, b) => b[1] - a[1]).map(([pid, value]) => (
              <div key={pid} className="border-t py-2">
                <div className="font-medium">{projectById.get(pid)?.name ?? pid}</div>
                <div className="text-xs text-neutral-500">{money(value)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ProjectDetail({ project, itemEdges, sections }: {
  project: IntegratedProjectNode; itemEdges: IntegratedItemEdge[]; sections: IntegratedSectionNode[];
}) {
  const [tab, setTab] = useState(0);
  const sectionById = new Map(sections.map(s => [s.id, s]));
  // 部課局は代表値（目内訳の先頭行）。事業内で複数組織にまたがる場合は近似
  const rep = project.budgetItems[0];
  const accountLabel = project.accountType === 'mixed' ? '一般・特別' : project.accountType === 'general' ? '一般会計' : '特別会計';
  const bySection = new Map<string, number>();
  for (const e of itemEdges) bySection.set(e.source, (bySection.get(e.source) ?? 0) + e.value);
  return (
    <div className="text-sm">
      <p className="text-xs font-semibold text-neutral-500">RS予算事業</p>
      <h2 className="mt-1 pr-10 text-lg font-bold">{project.name}</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-emerald-50 p-3 text-xs">
        <div className="col-span-2">{accountLabel} ／ {project.ministry}{rep ? ` / ${rep.organizationAccount}` : ''}</div>
        <div className="col-span-2 text-neutral-500">PID {project.projectId}</div>
        <div>予算額 <b>{money(project.initialBudget)}</b></div>
        <div>支出額 <b>{project.budgetSummary ? money(project.budgetSummary.executedAmount) : '—'}</b></div>
      </div>
      <DetailTabs tabs={['予算執行一覧', '目一覧']} active={tab} onChange={setTab} />
      {tab === 0 ? (
        <div className="mt-3 space-y-1">
          {project.budgetSummary ? (
            <>
              <Row label="当初予算" v={project.budgetSummary.initialBudget} />
              <Row label="補正予算" v={project.budgetSummary.supplementaryBudget} />
              <Row label="繰越予算" v={project.budgetSummary.carryoverBudget} />
              <Row label="予備費使用等" v={project.budgetSummary.reserveFund} />
              <Row label="予算現額" v={project.budgetSummary.totalBudget} strong />
              <Row label="執行額" v={project.budgetSummary.executedAmount} />
              <div className="flex justify-between border-t py-1"><span className="text-neutral-500">執行率</span><b>{project.budgetSummary.executionRate?.toFixed(1) ?? '—'}%</b></div>
              <Row label="翌年度繰越額" v={project.budgetSummary.carryoverToNext} />
              <Row label="翌年度要求額" v={project.budgetSummary.nextYearRequest} />
            </>
          ) : <p className="text-neutral-500">予算執行データがありません</p>}
          <h3 className="mb-1 mt-4 font-bold">MOF項からの接続</h3>
          {bySection.size === 0 ? <p className="text-neutral-500">接続しているMOF項がありません</p> : (
            [...bySection.entries()].sort((a, b) => b[1] - a[1]).map(([sid, value]) => (
              <div key={sid} className="flex justify-between border-t py-1.5">
                <span>{sectionById.get(sid)?.name ?? sid}</span><span className="text-neutral-500">{money(value)}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="mt-3">
          {project.budgetItems.length === 0 ? <p className="text-neutral-500">目内訳がありません</p> : (
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
      )}
    </div>
  );
}

function Row({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between border-t py-1 ${strong ? 'font-bold' : ''}`}>
      <span className="text-neutral-500">{label}</span><span>{money(v)}</span>
    </div>
  );
}

function SpecialDetail({ id, name, edges }: { id: string; name: string; edges: DisplayEdge[] }) {
  const note =
    id === 'rs-unconnected' ? 'MOFの目金額のうち、RS事業への接続で説明されない部分です。制度上の対象外とは断定していません。'
      : id === 'rs-excess' ? 'RS計上額がMOF目金額を上回る分です。0へ丸めず、原因を調べるために表に出しています。'
        : id === OTHER_SECTIONS ? '表示件数の外に出たMOF項の集約です。'
          : '表示件数の外に出たRS事業の集約です。';
  return (
    <div className="mt-4 text-sm">
      <h2 className="text-lg font-bold">{name || id}</h2>
      <p className="mt-2 text-neutral-600">{note}</p>
      {[...edges].sort((a, b) => b.value - a.value).slice(0, 100).map(e => (
        <div key={e.id} className="border-t py-2"><div className="text-xs text-neutral-500">{money(e.value)}</div></div>
      ))}
    </div>
  );
}

export default function IntegratedSankeyPage() {
  return <App />;
}
