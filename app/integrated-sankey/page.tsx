'use client';

/**
 * /integrated-sankey — MOF項とRS事業を2列のノード一覧として並べる。
 *
 * 仕様の正: docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md
 * 恒久ガイド: docs/integrated-sankey-graph-model.md
 *
 * 帯（エッジ）は持たない。項と事業をつなぐ線は描かない。対応関係は選択したノードの
 * 詳細パネル（目一覧・RS事業一覧・予算執行一覧）でのみ見せる。
 *
 * `/sankey-svg` の「図そのもの以外」のコントロール一式（検索・フィルタ・ズーム・
 * サイドパネルの枠・年度切替・ページ切替）はそのまま引き継ぐ。検索（ジャンプ機能）と
 * フィルタ（絞り込み）は別物という設計も踏襲する。検索は1本のボックスで項名・事業名を
 * 横断する（/sankey-svg の検索が事業名・支出先名を1本で横断するのと同じ考え方）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel, SIDE_PANEL_WIDTH_MIN, SIDE_PANEL_WIDTH_MAX } from '@/client/hooks/useSidePanel';
import { RangeWindowRow } from '@/client/components/SankeySvg/RangeWindowRows';
import { parseAmountToYen } from '@/app/lib/format/yen';
import { getAccountBadgeStyle } from '@/app/lib/account-badge';
import { BudgetTypeBadge, Badge as MofBadge } from '@/client/components/mof-kou/Badge';
import { classifyAccountCategory } from '@/app/lib/account-badge';
import { revisedBudgetType, type MOFBudgetType, type MOFRevisionNumber } from '@/types/mof-jikou';
import type {
  IntegratedGraph,
  IntegratedItemEdge,
  IntegratedProjectNode,
  IntegratedSectionNode,
} from '@/app/lib/integrated-sankey';

// ── 寸法 ──
// viewBox はコンテナの実測ピクセルサイズに合わせる（SVG単位=CSSピクセル）。/sankey-svg も
// 同じ考え方で、固定サイズをpreserveAspectRatioで引き伸ばす方式は使わない。固定サイズだと
// ウィンドウが小さいときにラベルの文字まで縮小され読めなくなるため
const DEFAULT_DIMS = { w: 1400, h: 900 };
interface Dims { w: number; h: number }
const NODE_W = 18; // /sankey-svg の NODE_W と揃える
const NODE_W2 = NODE_W * 2; // RS事業（予算＋支出の統合ノード）の幅。/sankey-svg と同じく単位幅の2倍
const NODE_GAP = 3;
const NODE_MIN_SLOT = 18;
// 列(バー)は左のノードは左側に・右のノードは右側にラベルを伸ばす（帯を持たないため、
// バー自体は中央で寄せ合わせ、ラベルは左右の外側へ広く使える幅を確保する構図）。
// RS事業ノードが予算(左半分・緑)＋支出(右半分・橙)の統合ノードになったため、
// 中央の隙間には予算額ラベル（統合ノードの左側）も入る。MID_GAPはそのぶんの余白を含めて広げた
const MARGIN_X = 24;
const MID_GAP = 240;
function colGeometry(dims: Dims) {
  const midX = dims.w / 2;
  const leftX = Math.max(MARGIN_X, midX - MID_GAP / 2 - NODE_W);
  const rightX = midX + MID_GAP / 2;
  return { leftX, rightX };
}
const colH = (dims: Dims) => Math.max(200, dims.h - PAD_TOP - PAD_BOTTOM);
const PAD_TOP = 110;
const PAD_BOTTOM = 28;
const NAME_MAX_CHARS = 26; // /sankey-svg のノードラベル(40文字)相当を、狭いガター幅に合わせて縮小

const ZOOM_MIN_MULTIPLIER = 0.25;
const ZOOM_MAX_MULTIPLIER = 30;

const NODE_COLORS = { general: '#2d7d46', special: '#8ec9a8', project: '#4db870', aggregate: '#9aa0a6' } as const;

// マイナス額は符号を保ったまま億/兆判定する（絶対値で閾値比較しないと万円表示に
// 落ちてしまう）。1万円未満は0万円に丸めて消えるのを避け、素の円で表示する
// （client/components/mof-jikou/format.ts の formatYen と同じ考え方）
const money = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
  if (abs >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}万円`;
  return `${v.toLocaleString()}円`;
};
// /sankey-svg の `name.length > 40 ? slice(0,40)+'…' : name` と同じ考え方
const trim = (s: string, n = NAME_MAX_CHARS) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** RS側の予算種別表記（「第N次補正予算」）をMOF側表記（「補正予算（第N号）」）へ変換する。
 * `BudgetTypeBadge`（mof-kou-moku等と共有）がMOF表記前提のため（対応関係は
 * scripts/generate-mof-rs-kou-moku-linkage.ts の resolveMofBudgetType と同じ） */
function toMofBudgetType(rsBudgetType: string): MOFBudgetType {
  const m = /^第(\d+)次補正予算$/.exec(rsBudgetType);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 4) return revisedBudgetType(n as MOFRevisionNumber); }
  if (rsBudgetType === '当初予算' || rsBudgetType === '暫定予算' || rsBudgetType === '決算') return rsBudgetType;
  return '当初予算';
}

const SUPPORTED_YEARS = [2025, 2024] as const;
type SupportedYear = (typeof SUPPORTED_YEARS)[number];

interface LinkageQuality {
  counts: { kouMokuTotal: number; kouMokuLinked: number; projectTotal: number; projectLinked: number };
  coverage: { rsAmountTotal: number; rsAmountLinked: number };
}
interface ApiResponse extends IntegratedGraph { linkageQuality: LinkageQuality | null }

type NodeKind = 'section' | 'project' | 'other-sections' | 'other-projects';
type DisplayNode = {
  id: string; name: string; value: number; side: 'left' | 'right'; kind: NodeKind;
  section?: IntegratedSectionNode; project?: IntegratedProjectNode;
  /** RS事業（project/other-projects）のみ: 支出額。/sankey-svg の予算(緑)・支出(橙)の
   * 統合ノードと同じ構図でRS事業ノードを描くために使う */
  spendValue?: number;
};
/** h = 予算高さ・支出高さのうち大きい方（スロット確保・縦位置決めに使う）。
 * RS事業ノードは budgetH/spendH を別々に持ち、統合ノードの形状描画に使う */
type PlacedNode = DisplayNode & { x: number; y: number; h: number; budgetH?: number; spendH?: number };

const OTHER_SECTIONS = 'other-sections';
const OTHER_PROJECTS = 'other-projects';

function nodeColor(n: DisplayNode) {
  if (n.kind === 'section') return n.section?.accountType === 'general' ? NODE_COLORS.general : NODE_COLORS.special;
  if (n.kind === 'project') return NODE_COLORS.project;
  return NODE_COLORS.aggregate;
}

/** RS事業（project/other-projects）の統合ノード塗り。/sankey-svg の proj-node-grad /
 * proj-agg-grad と同じ、予算(緑)→支出(橙)のグラデーション（集約ノードはグレー階調） */
const projectNodeFill = (n: DisplayNode) => (n.kind === 'other-projects' ? 'url(#proj-agg-grad)' : 'url(#proj-node-grad)');

/** RS事業の統合ノード（予算＋支出）のパス。/sankey-svg の mergedProjectPath と同じ構図:
 * 上辺は直線、下辺は予算下端↔支出下端をベジェ曲線で結ぶ。左半分=予算(緑)、右半分=支出(橙) */
function mergedProjectPath(x0: number, y0: number, budgetH: number, spendH: number): string {
  const xEnd = x0 + NODE_W2;
  const mx = x0 + NODE_W;
  const yBudgetBottom = y0 + Math.max(0.6, budgetH);
  const ySpendBottom = y0 + Math.max(0.6, spendH);
  return `M${x0},${y0} L${xEnd},${y0} L${xEnd},${ySpendBottom} C${mx},${ySpendBottom} ${mx},${yBudgetBottom} ${x0},${yBudgetBottom} Z`;
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
  // 集約対象は窓より後ろ（値が小さい側）の tail のみ。窓より前（オフセットで
  // 飛ばした値が大きい側）は単純に非表示にする（集約しない）。/sankey-svg の
  // tailRecipients = sortedRecips.slice(offset + topN) と同じ設計。ここを
  // 「窓に含まれない全件」にすると、オフセットを進めるたびに元々見えていた
  // 大きい値の項目まで集約ノードに巻き込まれ、値が跳ね上がって見える不具合になる
  return {
    shown: ranked.slice(offset, offset + w.topN),
    tail: ranked.slice(offset + w.topN),
    offset, maxOffset, total: ranked.length,
  };
}

interface Filters {
  // null = 未選択（絞り込みなし＝すべて含む）。一度でも操作すると配列になり、
  // 空配列は「すべて解除（0件）」を明示的に表す。/sankey-svg の acGeneral/acSpecial/...
  // のような「個々の値が独立してon/offできる」挙動を、空配列=フィルタなしに
  // 圧縮してしまわないための表現
  accounts: string[] | null; ministries: string[] | null;
  sectionNameQuery: string; sectionNameRegex: boolean;
  projectNameQuery: string; projectNameRegex: boolean;
  mofMinText: string; mofMaxText: string; rsMinText: string; rsMaxText: string;
}
const EMPTY_FILTERS: Filters = {
  accounts: null, ministries: null, sectionNameQuery: '', sectionNameRegex: false,
  projectNameQuery: '', projectNameRegex: false,
  mofMinText: '', mofMaxText: '', rsMinText: '', rsMaxText: '',
};

function buildView(data: IntegratedGraph, filters: Filters, sectionWindow: RangeWindow, projectWindow: RangeWindow) {
  const mofMin = parseAmountToYen(filters.mofMinText);
  const mofMax = parseAmountToYen(filters.mofMaxText);
  const rsMin = parseAmountToYen(filters.rsMinText);
  const rsMax = parseAmountToYen(filters.rsMaxText);
  const sectionNameMatch = buildMatcher(filters.sectionNameQuery, filters.sectionNameRegex).match;
  const projectNameMatch = buildMatcher(filters.projectNameQuery, filters.projectNameRegex).match;
  // 共管（所管が「A及びB」のような複合表記）を分解して複数値として扱う
  const ministriesOf = (m: string) => m.split(/及び|・|、/).map(s => s.trim()).filter(Boolean);

  const keptSections = data.sections.filter(s =>
    (filters.accounts === null || filters.accounts.includes(s.accountType)) &&
    (filters.ministries === null || ministriesOf(s.ministry).some(m => filters.ministries!.includes(m))) &&
    sectionNameMatch(s.name) &&
    (mofMin === null || s.amount >= mofMin) &&
    (mofMax === null || s.amount <= mofMax));
  const rankedSections = [...keptSections].sort((a, b) => b.amount - a.amount);
  const sectionRange = windowSlice(rankedSections, sectionWindow);
  const sectionsTotal = rankedSections.reduce((a, s) => a + s.amount, 0);
  const sectionTailTotal = sectionRange.tail.reduce((a, s) => a + s.amount, 0);

  const keptProjects = data.projects.filter(p =>
    projectNameMatch(p.name) &&
    (rsMin === null || p.budgetAmount >= rsMin) &&
    (rsMax === null || p.budgetAmount <= rsMax));
  const rankedProjects = [...keptProjects].sort((a, b) => b.budgetAmount - a.budgetAmount);
  const projectRange = windowSlice(rankedProjects, projectWindow);
  const projectsTotal = rankedProjects.reduce((a, p) => a + p.budgetAmount, 0);
  const projectTailTotal = projectRange.tail.reduce((a, p) => a + p.budgetAmount, 0);
  const spendOf = (p: IntegratedProjectNode) => p.budgetSummary?.executedAmount ?? 0;
  const projectTailSpendTotal = projectRange.tail.reduce((a, p) => a + spendOf(p), 0);

  const left: DisplayNode[] = sectionRange.shown
    .map((s): DisplayNode => ({ id: s.id, name: s.name, value: s.amount, side: 'left', kind: 'section', section: s }));
  if (sectionRange.tail.length > 0) {
    left.push({ id: OTHER_SECTIONS, name: `その他の項（${sectionRange.tail.length}件）`, value: sectionTailTotal, side: 'left', kind: 'other-sections' });
  }
  const right: DisplayNode[] = projectRange.shown
    .map((p): DisplayNode => ({ id: p.id, name: p.name, value: p.budgetAmount, spendValue: spendOf(p), side: 'right', kind: 'project', project: p }));
  if (projectRange.tail.length > 0) {
    right.push({ id: OTHER_PROJECTS, name: `その他のRS事業（${projectRange.tail.length}件）`, value: projectTailTotal, spendValue: projectTailSpendTotal, side: 'right', kind: 'other-projects' });
  }

  // 「その他」集約ノードの詳細パネル用: 窓より後ろ（tail）に出た項・事業そのもの。
  // 窓より前（オフセットで飛ばした側）は集約に含めない（windowSlice参照）
  const hiddenSections = sectionRange.tail.map(s => ({ name: s.name, value: s.amount }));
  const hiddenProjects = projectRange.tail.map(p => ({ name: p.name, value: p.budgetAmount }));

  return {
    left, right, hiddenSections, hiddenProjects,
    sectionColumnTotal: sectionsTotal, projectColumnTotal: projectsTotal,
    sectionUniverse: sectionRange.total, sectionMaxOffset: sectionRange.maxOffset, sectionOffset: sectionRange.offset,
    projectUniverse: projectRange.total, projectMaxOffset: projectRange.maxOffset, projectOffset: projectRange.offset,
  };
}

type ViewModel = ReturnType<typeof buildView>;

function fitZoom(view: ViewModel, dims: Dims) {
  let low = 0.1, high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (buildLayout(view, mid, dims).contentH <= dims.h - 30) low = mid; else high = mid;
  }
  return low;
}

function buildLayout(view: ViewModel, zoom: number, dims: Dims) {
  const { leftX, rightX } = colGeometry(dims);
  const availH = colH(dims);
  // 金額→高さの縮尺（ky）は項・事業の両列で共有する。列ごとに別のkyを使うと、
  // 同じ高さのバーが列によって違う金額を表すことになり、見た目で比較できなくなる
  const leftTotal = view.left.reduce((a, n) => a + n.value, 0) || 1;
  const rightTotal = view.right.reduce((a, n) => a + n.value, 0) || 1;
  const availLeft = availH - Math.max(0, view.left.length - 1) * NODE_GAP;
  const availRight = availH - Math.max(0, view.right.length - 1) * NODE_GAP;
  const ky = Math.min(availLeft / leftTotal, availRight / rightTotal);

  const place = (nodes: DisplayNode[], x: number): PlacedNode[] => {
    let y = PAD_TOP;
    return nodes.map(n => {
      const budgetH = n.value * ky * zoom;
      // RS事業（予算＋支出の統合ノード）は/sankey-svgと同じく高い方に合わせてスロットを確保する
      const spendH = n.spendValue !== undefined ? n.spendValue * ky * zoom : undefined;
      const h = spendH !== undefined ? Math.max(budgetH, spendH) : budgetH;
      const slot = Math.max(NODE_MIN_SLOT, h);
      y += (slot - h) / 2;
      const placed: PlacedNode = { ...n, x, y, h, budgetH: spendH !== undefined ? budgetH : undefined, spendH };
      y += h + (slot - h) / 2 + NODE_GAP;
      return placed;
    });
  };
  const left = place(view.left, leftX);
  const right = place(view.right, rightX);
  const byId = new Map<string, PlacedNode>([...left, ...right].map(n => [n.id, n]));
  const bottom = (nodes: PlacedNode[]) => (nodes.length ? nodes[nodes.length - 1].y + nodes[nodes.length - 1].h : PAD_TOP);
  const contentH = Math.max(bottom(left), bottom(right)) + PAD_BOTTOM;
  return { left, right, byId, contentH, leftX, rightX };
}

// ────────────────────────────────────────────────────────────
// UI部品（/sankey-svg の実装からスタイル値・構造を移植）
// ────────────────────────────────────────────────────────────

function CheckboxCombobox({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[];
  /** null = 未操作（すべて含む）。一度でも触ると配列になり、空配列＝すべて解除を表せる */
  selected: string[] | null; onChange: (next: string[] | null) => void;
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
  const effective = selected ?? options.map(o => o.value);
  const allChecked = effective.length === options.length;
  const noneChecked = effective.length === 0;
  const summary = selected === null ? 'すべて'
    : allChecked ? 'すべて'
      : noneChecked ? 'なし（0件）'
        : effective.length === 1 ? (options.find(o => o.value === effective[0])?.label ?? effective[0])
          : `選択中 (${effective.length}/${options.length})`;
  const isChecked = (v: string) => effective.includes(v);
  const toggle = (v: string) => {
    const next = effective.includes(v) ? effective.filter(x => x !== v) : [...effective, v];
    onChange(next);
  };
  // /sankey-svg の「すべて選択/解除」チェックボックスと同じ: 全選択済みなら全解除、
  // それ以外（一部・ゼロ）なら全選択、の単純トグル。空配列=フィルタなしに圧縮しない
  const toggleAll = () => onChange(allChecked ? [] : options.map(o => o.value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#555', width: '3.5em', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div ref={rootRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(v => !v)}
          style={{ width: '100%', fontSize: 11, border: '1px solid #ddd', borderRadius: 4, padding: '3px 20px 3px 5px', background: '#fafafa', color: (selected === null || allChecked) ? '#aaa' : '#333', outline: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{summary}</button>
        <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
          <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="#aaa"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M480-360 280-560h400L480-360Z" />
          </svg>
        </span>
        {open && (
          <div role="listbox" aria-label={label}
            style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 50, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 'min(320px, 60vh)', overflowY: 'auto', minWidth: '100%', width: 'max-content' }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ width: 12, height: 12 }} />
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

/** フィルタパネル内の項名・事業名テキスト絞り込み。検索ボックスと同じく正規表現トグルを持つ
 * （/sankey-svg の filterProjectNameRegex/filterRecipientNameRegex と同じ、フィルタ側にも
 * 独立した正規表現切り替えがある） */
function TextFilterRow({ label, ariaLabel, value, onChange, useRegex, onToggleRegex }: {
  label: string; ariaLabel: string; value: string; onChange: (v: string) => void;
  useRegex: boolean; onToggleRegex: () => void;
}) {
  const { error } = buildMatcher(value, useRegex);
  return (
    <FilterRow label={label}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <input aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)}
          placeholder="部分一致"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, border: `1px solid ${error ? '#e53935' : '#ddd'}`, borderRadius: 4, padding: '3px 22px 3px 5px', background: '#fafafa' }} />
        <button type="button" aria-label={useRegex ? `${label}の正規表現検索をオフ` : `${label}を正規表現で検索`} aria-pressed={useRegex}
          title={useRegex ? '正規表現検索をオフ' : '正規表現で検索'} onClick={onToggleRegex}
          style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', background: useRegex ? '#1a73e8' : 'transparent', border: 'none', borderRadius: 3, cursor: 'pointer', color: useRegex ? '#fff' : '#888', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1, padding: '2px 3px' }}
        >.*</button>
      </div>
    </FilterRow>
  );
}

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

interface SearchHit { id: string; name: string; sub: string; value: number; kind: 'section' | 'project' }

/** /sankey-svg と同じ「検索＝ジャンプ機能」。グラフは絞り込まず、一致ノードを列挙して
 * クリックで選択・ウィンドウ移動するだけ。対象は項名・事業名のみ（1本のボックスで横断する。
 * /sankey-svg が事業名・支出先名を1本で横断するのと同じ考え方） */
function SearchJumpBox({ results, query, setQuery, useRegex, setUseRegex, onSelect }: {
  results: SearchHit[]; query: string; setQuery: (v: string) => void;
  useRegex: boolean; setUseRegex: (v: boolean) => void; onSelect: (hit: SearchHit) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { error } = buildMatcher(query, useRegex);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <span aria-hidden="true" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
        <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
      </span>
      <input
        data-testid="search-input"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setOpen(false); } }}
        placeholder="項名・事業名で検索（2文字以上）"
        style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: query ? 56 : 32, paddingTop: 7, paddingBottom: 7, fontSize: 13, border: `1px solid ${error ? '#e53935' : '#e0e0e0'}`, borderRadius: 6, background: '#fff', outline: 'none', color: '#333' }}
      />
      <button type="button" aria-label={useRegex ? '正規表現検索をオフ' : '正規表現で検索'} aria-pressed={useRegex}
        title={useRegex ? '正規表現検索をオフ' : '正規表現で検索'} onClick={() => setUseRegex(!useRegex)}
        style={{ position: 'absolute', right: query ? 26 : 6, top: '50%', transform: 'translateY(-50%)', background: useRegex ? '#1a73e8' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', color: useRegex ? '#fff' : '#888', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1, padding: '2px 4px' }}
      >.*</button>
      {query && (
        <button type="button" aria-label="検索語をクリア" onClick={() => { setQuery(''); setOpen(false); }}
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
        >✕</button>
      )}
      {open && query.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50, maxHeight: 320, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#999' }}>該当なし</div>
          ) : results.slice(0, 60).map(r => (
            <button key={r.id} type="button" data-testid="search-input-result" onClick={() => { onSelect(r); setOpen(false); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: r.kind === 'section' ? NODE_COLORS.general : NODE_COLORS.project }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, color: '#333' }}>{r.name}</span>
              <span style={{ flexShrink: 0, fontSize: 11, color: '#999' }}>{r.sub} ・ {money(r.value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ZoomControls({ scale, baseZoom, onZoomBy, onZoomTo, onReset, right }: {
  scale: number; baseZoom: number; onZoomBy: (factor: number) => void; onZoomTo: (percent: number) => void; onReset: () => void; right: number;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const percent = Math.round(scale / baseZoom * 100);
  const min = Math.log10(Math.max(0.02, baseZoom * ZOOM_MIN_MULTIPLIER));
  const max = Math.log10(Math.min(60, baseZoom * ZOOM_MAX_MULTIPLIER));
  return (
    <div style={{ position: 'absolute', bottom: 12, right, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4, transition: 'right 0.2s ease' }}>
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
  const [scale, setScale] = useState(1);
  const [baseZoom, setBaseZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(f => ({ ...f, [k]: v }));
  const hasActiveFilters = Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k as keyof Filters]);

  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);

  // サイドパネルは /sankey-svg のノード詳細と同じ左側（AIチャット等の右パネルは今回無い）
  const detailPanel = useSidePanel({ side: 'left' });

  // viewBoxをコンテナの実測ピクセルサイズに合わせる（/sankey-svg と同じ考え方）。
  // ウィンドウが縮んでもラベルの文字サイズが一緒に縮まないようにするため。
  // データ読込中はcontainer未マウントのため、useRefではなくcallback refで
  // 実際にマウントされたタイミングでobserverを張り直す
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => { setContainer(el); }, []);
  const [dims, setDims] = useState<Dims>(DEFAULT_DIMS);
  const measuredOnce = useRef(false);
  useEffect(() => {
    const el = container;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) { measuredOnce.current = true; setDims({ w: Math.round(width), h: Math.round(height) }); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [container]);

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
  const layout = useMemo(() => (view ? buildLayout(view, scale, dims) : null), [view, scale, dims]);
  const initiallyFitted = useRef(false);
  useEffect(() => {
    if (view && measuredOnce.current && !initiallyFitted.current) {
      initiallyFitted.current = true;
      const k = fitZoom(view, dims); setBaseZoom(k); setScale(k);
    }
  }, [view, dims]);

  const prevTopSection = useRef(topSection);
  useEffect(() => { if (prevTopSection.current !== topSection) { prevTopSection.current = topSection; setSectionOffset(0); } }, [topSection]);
  const prevTopProject = useRef(topProject);
  useEffect(() => { if (prevTopProject.current !== topProject) { prevTopProject.current = topProject; setProjectOffset(0); } }, [topProject]);
  const prevFilters = useRef(filters);
  useEffect(() => { if (prevFilters.current !== filters) { prevFilters.current = filters; setSectionOffset(0); setProjectOffset(0); } }, [filters]);

  // 検索（ジャンプ）: 項名・事業名を1本のボックスで横断する
  const searchResults: SearchHit[] = useMemo(() => {
    if (!data || query.trim().length < 2) return [];
    const { match } = buildMatcher(query, useRegex);
    const sectionHits = data.sections.filter(s => match(s.name))
      .map((s): SearchHit => ({ id: s.id, name: s.name, sub: s.ministry, value: s.amount, kind: 'section' }));
    const projectHits = data.projects.filter(p => match(p.name))
      .map((p): SearchHit => ({ id: p.id, name: p.name, sub: `PID:${p.projectId}`, value: p.budgetAmount, kind: 'project' }));
    return [...sectionHits, ...projectHits].sort((a, b) => b.value - a.value);
  }, [data, query, useRegex]);

  // ジャンプ選択: 対象ノードが現在の表示ウィンドウの外なら、窓を動かして中に入れる
  const jumpTo = (hit: SearchHit) => {
    if (!data) return;
    if (hit.kind === 'section') {
      const kept = data.sections.filter(s => filters.accounts === null || filters.accounts.includes(s.accountType));
      const ranked = [...kept].sort((a, b) => b.amount - a.amount);
      const idx = ranked.findIndex(s => s.id === hit.id);
      if (idx >= 0) setSectionOffset(Math.max(0, idx - Math.floor(topSection / 2)));
    } else {
      const ranked = [...data.projects].sort((a, b) => b.budgetAmount - a.budgetAmount);
      const idx = ranked.findIndex(p => p.id === hit.id);
      if (idx >= 0) setProjectOffset(Math.max(0, idx - Math.floor(topProject / 2)));
    }
    setSelected(hit.id);
    setPan({ x: 0, y: 0 });
  };

  const selectedNode = layout?.byId.get(selected ?? '') ?? null;
  // 選択ノードの対応関係は、帯を描かずに詳細パネルの一覧（目一覧・RS事業一覧・
  // 予算執行一覧）でのみ見せる。この算出には元の目単位データ（IntegratedItemEdge）を使う
  const selectedItemEdges = useMemo(
    () => (data && selected ? data.edges.filter(e => e.source === selected || e.target === selected) : []),
    [data, selected],
  );
  // 対応するノードを相手列で淡く強調する（帯は引かない。opacityのみ）
  const relatedIds = useMemo(() => {
    if (!selected) return null;
    const ids = new Set<string>();
    for (const e of selectedItemEdges) { ids.add(e.source); if (e.target.startsWith('project:')) ids.add(e.target); }
    return ids;
  }, [selected, selectedItemEdges]);

  if (error) return <div className="flex h-screen items-center justify-center text-red-600">{error}</div>;
  if (!data || !view || !layout) return <div className="flex h-screen items-center justify-center text-neutral-500">読み込み中…</div>;

  const nodeActive = (n: PlacedNode) => !selected || n.id === selected || (relatedIds?.has(n.id) ?? false);
  const zoomAt = (next: number, anchor: number) => {
    const z = Math.max(0.02, Math.min(60, next));
    setPan(p => ({ ...p, y: anchor - (anchor - p.y) * buildLayout(view, z, dims).contentH / layout.contentH }));
    setScale(z);
  };
  const reset = () => { setScale(baseZoom); setPan({ x: 0, y: 0 }); };
  const leftControlsOffset = selected && !detailPanel.collapsed ? detailPanel.effectiveWidth : 0;

  const allMinistries = [...new Set(data.sections.flatMap(s => s.ministry.split(/及び|・|、/).map(x => x.trim()).filter(Boolean)))].sort();

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#f7f8f5] text-neutral-800">
      <div ref={containerRef} className="absolute inset-y-0 right-0" style={{ left: leftControlsOffset, transition: 'left 0.2s ease' }}>
        <svg
          data-testid="integrated-canvas"
          className="h-full w-full cursor-grab"
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          onWheel={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            zoomAt(scale * (e.deltaY > 0 ? 0.9 : 1.1), e.clientY - rect.top);
          }}
          onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
          onMouseMove={e => {
            if (drag.current) {
              setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
            }
          }}
          onMouseUp={() => { drag.current = null; }}
          onMouseLeave={() => { drag.current = null; }}
        >
          <defs>
            {/* RS事業の統合ノード（予算=緑・支出=橙）のグラデーション。/sankey-svg の
                proj-node-grad/proj-agg-grad と同じ配色 */}
            <linearGradient id="proj-node-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4db870" />
              <stop offset="44%" stopColor="#4db870" />
              <stop offset="56%" stopColor="#e07040" />
              <stop offset="100%" stopColor="#e07040" />
            </linearGradient>
            <linearGradient id="proj-agg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#999" />
              <stop offset="44%" stopColor="#999" />
              <stop offset="56%" stopColor="#777" />
              <stop offset="100%" stopColor="#777" />
            </linearGradient>
          </defs>
          <g transform={`translate(${pan.x} ${pan.y})`}>
            <text x={layout.leftX} y={PAD_TOP - 40} fontSize="13" fontWeight="700" fill="#555" textAnchor="end">MOF項</text>
            <text x={layout.leftX} y={PAD_TOP - 22} fontSize="12" fill="#999" textAnchor="end">{money(view.sectionColumnTotal)}</text>
            <text x={layout.rightX + NODE_W2} y={PAD_TOP - 40} fontSize="13" fontWeight="700" fill="#555">RS事業（予算・支出）</text>
            <text x={layout.rightX + NODE_W2} y={PAD_TOP - 22} fontSize="12" fill="#999">{money(view.projectColumnTotal)}</text>
            <g>
              {layout.left.map(n => {
                const active = nodeActive(n);
                return (
                  <g key={n.id} data-testid="sankey-node" data-kind={n.kind} className="cursor-pointer" opacity={active ? 1 : 0.25}
                    onClick={() => setSelected(selected === n.id ? null : n.id)}
                  >
                    <rect x={n.x} y={n.y} width={NODE_W} height={Math.max(0.6, n.h)} rx="2" fill={nodeColor(n)}
                      stroke={selected === n.id ? '#111' : 'none'} strokeWidth={selected === n.id ? 2 : 0} />
                    {/* ラベルは列の外側（左）へ向けて伸ばす。NODE_MIN_SLOTで各ノードに最低限の
                        枠を確保しているため、高さでの非表示判定はしない
                        （/sankey-svgが間隔を空けて表示する方式と同じ考え方） */}
                    <text x={n.x - 8} y={n.y + n.h / 2 + 4} textAnchor="end" fontSize="12" fill="#333">
                      {trim(n.name)} <tspan fill="#8a8f8a">（{money(n.value)}）</tspan>
                    </text>
                    <title>{n.name}｜{money(n.value)}</title>
                  </g>
                );
              })}
              {layout.right.map(n => {
                const active = nodeActive(n);
                const budgetH = n.budgetH ?? n.h;
                const spendH = n.spendH ?? n.h;
                const spendValue = n.spendValue ?? 0;
                return (
                  <g key={n.id} data-testid="sankey-node" data-kind={n.kind} className="cursor-pointer" opacity={active ? 1 : 0.25}
                    onClick={() => setSelected(selected === n.id ? null : n.id)}
                  >
                    {/* /sankey-svg と同じ予算(緑・左半分)＋支出(橙・右半分)の統合ノード。
                        上辺は直線、下辺は予算下端↔支出下端をベジェ曲線で結ぶ */}
                    <path d={mergedProjectPath(n.x, n.y, budgetH, spendH)} fill={projectNodeFill(n)}
                      stroke={selected === n.id ? '#111' : 'none'} strokeWidth={selected === n.id ? 2 : 0} />
                    {/* 予算額ラベルは統合ノードの左側（列の内側）、名前＋支出額ラベルは
                        右側（列の外側）。/sankey-svg の統合ノードと同じ配置 */}
                    <text x={n.x - 8} y={n.y + Math.max(budgetH, spendH) / 2 + 4} textAnchor="end" fontSize="12" fill="#333">
                      {money(n.value)}
                    </text>
                    <text x={n.x + NODE_W2 + 8} y={n.y + Math.max(budgetH, spendH) / 2 + 4} textAnchor="start" fontSize="12" fill="#333">
                      {trim(n.name)} <tspan fill="#8a8f8a">（{money(spendValue)}）</tspan>
                    </text>
                    <title>{n.name}｜予算 {money(n.value)}｜支出 {money(spendValue)}</title>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </div>

      {/* 左上：検索（ジャンプ）・フィルタ（絞り込み）。左パネル展開時は右へ退避する */}
      <div style={{ position: 'absolute', left: 12 + leftControlsOffset, top: 12, zIndex: 30, display: 'flex', alignItems: 'flex-start', gap: 4, transition: 'left 0.2s ease' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 300 }}>
          {/* overflow:hidden にしない。検索結果・コンボボックスのドロップダウンが
              親のこの角丸カードで見切れてしまうため（角丸は子要素に個別に持たせてある） */}
          <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e0e0e0', borderRadius: '6px 6px 0 6px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: 8 }}>
              <SearchJumpBox results={searchResults} query={query} setQuery={setQuery} useRegex={useRegex} setUseRegex={setUseRegex}
                onSelect={jumpTo} />
            </div>
            {filtersOpen && (
              <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #f0f0f0' }}>
                <CheckboxCombobox label="会計" selected={filters.accounts} onChange={v => setFilter('accounts', v)}
                  options={[{ value: 'general', label: '一般会計' }, { value: 'special', label: '特別会計' }]} />
                <CheckboxCombobox label="所管" selected={filters.ministries} onChange={v => setFilter('ministries', v)}
                  options={allMinistries.map(m => ({ value: m, label: m }))} />
                <TextFilterRow label="項" ariaLabel="項名で絞り込み" value={filters.sectionNameQuery}
                  onChange={v => setFilter('sectionNameQuery', v)} useRegex={filters.sectionNameRegex}
                  onToggleRegex={() => setFilter('sectionNameRegex', !filters.sectionNameRegex)} />
                <TextFilterRow label="事業" ariaLabel="事業名で絞り込み" value={filters.projectNameQuery}
                  onChange={v => setFilter('projectNameQuery', v)} useRegex={filters.projectNameRegex}
                  onToggleRegex={() => setFilter('projectNameRegex', !filters.projectNameRegex)} />
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
        {/* /sankey-svg のフィルタ解除ボタンと同じ（Material Icons: filter_list_off）。
            常に同じ幅を占有し、絞り込み未設定時は非表示にする */}
        <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}
          title="フィルタを解除" aria-label="フィルタを解除" aria-hidden={!hasActiveFilters} tabIndex={hasActiveFilters ? 0 : -1}
          style={{
            flexShrink: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.95)', border: '1px solid #e0e0e0', borderRadius: 6,
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer', color: '#666', padding: 0,
            visibility: hasActiveFilters ? 'visible' : 'hidden', pointerEvents: hasActiveFilters ? 'auto' : 'none',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M791-55 55-791l57-57 736 736-57 57ZM633-440l-80-80h167v80h-87ZM433-640l-80-80h487v80H433Zm-33 400v-80h160v80H400ZM240-440v-80h166v80H240ZM120-640v-80h86v80h-86Z" />
          </svg>
        </button>
      </div>

      {/* 右上：表示範囲（項・事業）・年度切替・ページ切替 */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 200, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', width: 300, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <RangeWindowRow label="MOF項" total={view.sectionUniverse} topN={topSection} setTopN={setTopSection}
            offset={view.sectionOffset} maxOffset={view.sectionMaxOffset} onOffsetChange={setSectionOffset} markReplace={() => {}} metaFontPx={11} />
          <RangeWindowRow label="RS事業" total={view.projectUniverse} topN={topProject} setTopN={setTopProject}
            offset={view.projectOffset} maxOffset={view.projectMaxOffset} onOffsetChange={setProjectOffset} markReplace={() => {}} metaFontPx={11} />
        </div>
        <YearSelect value={String(year)} onChange={v => setYear(Number(v) as SupportedYear)} years={SUPPORTED_YEARS} theme="light" fontPx={12} testId="year-select" />
        <PageNavMenu current="/integrated-sankey" theme="light" />
      </div>

      {/* 紐づけ率。年度によって大きく異なるため隠さず出す（誇張の注記は付けない） */}
      {data.linkageQuality && (
        <div style={{ position: 'absolute', top: 100, right: 12, zIndex: 20, pointerEvents: 'none', background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#777', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          紐づけ率：事業 {(data.linkageQuality.counts.projectLinked / data.linkageQuality.counts.projectTotal * 100).toFixed(1)}%
          ／金額 {(data.linkageQuality.coverage.rsAmountLinked / data.linkageQuality.coverage.rsAmountTotal * 100).toFixed(1)}%
        </div>
      )}

      <ZoomControls scale={scale} baseZoom={baseZoom} onZoomBy={f => zoomAt(scale * f, 550)} onZoomTo={pct => zoomAt(pct / 100 * baseZoom, 550)}
        onReset={reset} right={16} />

      {selected && (
        <SidePanelChrome side="left" open={!detailPanel.collapsed} onToggle={detailPanel.toggleCollapsed}
          width={detailPanel.effectiveWidth} minWidth={SIDE_PANEL_WIDTH_MIN} maxWidth={SIDE_PANEL_WIDTH_MAX}
          onResizeStart={detailPanel.onResizeStart} isResizing={detailPanel.isResizing} onResetWidth={detailPanel.resetWidth}
          testId="integrated-detail"
        >
          {selectedNode?.section ? (
            <SectionDetail section={selectedNode.section} itemEdges={selectedItemEdges} projects={data.projects} onClose={() => setSelected(null)} />
          ) : selectedNode?.project ? (
            <ProjectDetail project={selectedNode.project} itemEdges={selectedItemEdges} sections={data.sections} onClose={() => setSelected(null)} />
          ) : (
            <AggregateDetail
              name={selectedNode?.name ?? ''}
              items={selected === OTHER_SECTIONS ? view.hiddenSections : selected === OTHER_PROJECTS ? view.hiddenProjects : []}
              onClose={() => setSelected(null)}
            />
          )}
        </SidePanelChrome>
      )}
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// 詳細パネル（/sankey-svg の左ノード詳細と同じ構造: ヘッダー固定・一覧のみスクロール）
// ────────────────────────────────────────────────────────────

function PanelShell({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>;
}

function PanelHeader({ name, onClose, amountBlock, badges }: {
  name: string; onClose: () => void; amountBlock: React.ReactNode; badges: React.ReactNode;
}) {
  return (
    <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>{name}</div>
          {amountBlock}
        </div>
        <button onClick={onClose} title="閉じる（選択解除）" aria-label="閉じる（選択解除）"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 16, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
        >✕</button>
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>{badges}</div>
    </div>
  );
}

function Badge({ background, children }: { background: string; children: React.ReactNode }) {
  return <span style={{ background, color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{children}</span>;
}

function AmountCell({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: '1 1 112px', minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 11, color: '#aaa', fontWeight: 400, marginBottom: 1 }}>{label}</span>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#222', whiteSpace: 'nowrap' }}>{money(value)}</span>
      <span style={{ display: 'block', fontSize: 11, color: '#999', marginTop: 1, whiteSpace: 'nowrap' }}>{Math.round(value).toLocaleString()}円</span>
    </div>
  );
}

/** タブに件数を添える。/sankey-svg の省庁/事業/支出先タブと同じ「ラベル(件数)」表示
 * （リストではなく集計値だけのタブは count を省略する） */
function DetailTabs({ tabs, active, onChange }: { tabs: { label: string; count?: number }[]; active: number; onChange: (i: number) => void }) {
  const tabBtnBase: React.CSSProperties = { flex: 1, padding: '6px 4px', fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', color: '#999' };
  const tabBtnActive: React.CSSProperties = { ...tabBtnBase, color: '#333', borderBottom: '2px solid #4a90d9' };
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fff' }}>
      {tabs.map((t, i) => (
        <button key={t.label} type="button" style={i === active ? tabBtnActive : tabBtnBase} onClick={() => onChange(i)}>
          {t.label}{t.count !== undefined && <span style={{ fontWeight: 400, fontSize: 11 }}>（{t.count.toLocaleString()}）</span>}
        </button>
      ))}
    </div>
  );
}

const listButtonStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f5f5f5', width: '100%', background: 'transparent', border: 'none', cursor: 'default', columnGap: 6, rowGap: 2, textAlign: 'left' };
const listNameStyle: React.CSSProperties = { flex: '1 1 150px', minWidth: 0, fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const listValueStyle: React.CSSProperties = { flex: '0 0 100%', minWidth: 0, fontSize: 12, color: '#777', textAlign: 'right' };

function SectionDetail({ section, itemEdges, projects, onClose }: {
  section: IntegratedSectionNode; itemEdges: IntegratedItemEdge[]; projects: IntegratedProjectNode[]; onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const projectById = new Map(projects.map(p => [p.id, p]));
  const projectTotals = new Map<string, number>();
  for (const e of itemEdges) if (e.target.startsWith('project:')) projectTotals.set(e.target, (projectTotals.get(e.target) ?? 0) + e.value);
  const changeRate = section.previousAmount > 0 ? (section.difference / section.previousAmount * 100) : null;
  const accountBadge = getAccountBadgeStyle(section.accountType);
  return (
    <PanelShell>
      <PanelHeader
        name={section.name}
        onClose={onClose}
        amountBlock={<>
          <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 5 }}>
            <AmountCell label="本年度額" value={section.amount} />
            <AmountCell label="前年度額" value={section.previousAmount} />
          </div>
          <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#aaa', marginRight: 4 }}>増減</span>
            <b style={{ color: section.difference < 0 ? '#e11d48' : '#2d7d46' }}>
              {section.difference >= 0 ? '+' : ''}{money(section.difference)}
            </b>
            {changeRate !== null && <span style={{ color: '#999', marginLeft: 4 }}>（{changeRate >= 0 ? '+' : ''}{changeRate.toFixed(1)}%）</span>}
          </div>
        </>}
        badges={<>
          <Badge background={section.accountType === 'general' ? '#2d7d46' : '#8ec9a8'}>項</Badge>
          {accountBadge && <MofBadge label={accountBadge.label} background={accountBadge.background} />}
          <span style={{ fontSize: 11, color: '#666' }}>{section.ministry}{section.organization ? ` / ${section.organization}` : ''}{section.subAccount ? ` / ${section.subAccount}` : ''}</span>
        </>}
      />
      <DetailTabs tabs={[{ label: '目', count: itemEdges.length }, { label: 'RS事業', count: projectTotals.size }]} active={tab} onChange={setTab} />
      <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
        {tab === 0 ? (
          [...itemEdges].sort((a, b) => b.value - a.value).slice(0, 200).map(e => (
            <div key={e.id} style={listButtonStyle}>
              <span style={listNameStyle}>{e.itemName}</span>
              <span style={listValueStyle}>
                {money(e.value)}・{e.status === 'connected' ? `RS接続済み${e.target.startsWith('project:') ? `（${projectById.get(e.target)?.name ?? ''}）` : ''}` : e.status === 'excess' ? '超過・要確認' : 'RS未接続'}
              </span>
            </div>
          ))
        ) : (
          projectTotals.size === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>接続しているRS事業がありません</p> : (
            [...projectTotals.entries()].sort((a, b) => b[1] - a[1]).map(([pid, value]) => (
              <div key={pid} style={listButtonStyle}>
                <span style={listNameStyle}>{projectById.get(pid)?.name ?? pid}</span>
                <span style={listValueStyle}>{money(value)}</span>
              </div>
            ))
          )
        )}
      </div>
    </PanelShell>
  );
}

function ProjectDetail({ project, itemEdges, sections, onClose }: {
  project: IntegratedProjectNode; itemEdges: IntegratedItemEdge[]; sections: IntegratedSectionNode[]; onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const sectionById = new Map(sections.map(s => [s.id, s]));
  // 部課局は代表値（目内訳の先頭行）。事業内で複数組織にまたがる場合は近似
  const rep = project.budgetItems[0];
  const accountBadge = getAccountBadgeStyle(project.accountType === 'mixed' ? 'both' : project.accountType);
  const bySection = new Map<string, number>();
  for (const e of itemEdges) bySection.set(e.source, (bySection.get(e.source) ?? 0) + e.value);
  return (
    <PanelShell>
      <PanelHeader
        name={project.name}
        onClose={onClose}
        amountBlock={
          <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 5 }}>
            <AmountCell label="予算額" value={project.budgetAmount} />
            <AmountCell label="支出額" value={project.budgetSummary?.executedAmount ?? 0} />
          </div>
        }
        badges={<>
          <Badge background="#4db870">事業</Badge>
          {accountBadge && <MofBadge label={accountBadge.label} background={accountBadge.background} />}
          <span style={{ fontSize: 11, color: '#aaa' }}>PID:{project.projectId}</span>
          <span style={{ fontSize: 11, color: '#666' }}>{project.ministry}{rep ? ` / ${rep.organizationAccount}` : ''}</span>
        </>}
      />
      <DetailTabs tabs={[
        { label: '予算執行', count: project.budgetBreakdown.length },
        { label: '予算サマリ' },
        { label: '目', count: project.budgetItems.length },
      ]} active={tab} onChange={setTab} />
      <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
        {tab === 0 ? (
          // 「2-2_予算・執行_予算種別・歳出予算項目」CSV由来のレコードをそのまま一覧にする
          // （集計値ではなく生のレコード。集計サマリは別タブ）
          project.budgetBreakdown.length === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>予算執行レコードがありません</p> : (
            project.budgetBreakdown.map((i, n) => {
              const accBadge = getAccountBadgeStyle(classifyAccountCategory(i.accountCategory));
              return (
                <div key={`${i.fiscalYear}-${i.budgetType}-${i.accountCategory}-${i.item}-${i.subItem}-${n}`} style={listButtonStyle}>
                  <span style={{ ...listNameStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <BudgetTypeBadge budgetType={toMofBudgetType(i.budgetType)} />
                    {accBadge && <MofBadge label={accBadge.label} background={accBadge.background} />}
                    {i.subItem || i.item}
                  </span>
                  <span style={listValueStyle}>{i.account} / {i.item} / {money(i.amount)}</span>
                  {i.note.trim() && (
                    <span style={{ flex: '0 0 100%', fontSize: 11, color: '#999' }}>補足: {i.note}</span>
                  )}
                </div>
              );
            })
          )
        ) : tab === 1 ? (
          <>
            {project.budgetSummary ? (
              <div style={{ marginBottom: 10 }}>
                <Row label="当初予算" v={project.budgetSummary.initialBudget} />
                <Row label="補正予算" v={project.budgetSummary.supplementaryBudget} />
                <Row label="繰越予算" v={project.budgetSummary.carryoverBudget} />
                <Row label="予備費使用等" v={project.budgetSummary.reserveFund} />
                <Row label="予算現額" v={project.budgetSummary.totalBudget} strong />
                <Row label="執行額" v={project.budgetSummary.executedAmount} />
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f5f5f5', padding: '4px 0' }}>
                  <span style={{ color: '#999', fontSize: 12 }}>執行率</span><b style={{ fontSize: 12 }}>{project.budgetSummary.executionRate?.toFixed(1) ?? '—'}%</b>
                </div>
                <Row label="翌年度繰越額" v={project.budgetSummary.carryoverToNext} />
                <Row label="翌年度要求額" v={project.budgetSummary.nextYearRequest} />
              </div>
            ) : <p style={{ fontSize: 12, color: '#aaa' }}>予算執行データがありません</p>}
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '10px 0 4px' }}>MOF項からの接続</h3>
            {bySection.size === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>接続しているMOF項がありません</p> : (
              [...bySection.entries()].sort((a, b) => b[1] - a[1]).map(([sid, value]) => (
                <div key={sid} style={listButtonStyle}>
                  <span style={listNameStyle}>{sectionById.get(sid)?.name ?? sid}</span>
                  <span style={listValueStyle}>{money(value)}</span>
                </div>
              ))
            )}
          </>
        ) : (
          project.budgetItems.length === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>目内訳がありません</p> : (
            project.budgetItems.map((i, n) => (
              <div key={`${i.item}-${i.subItem}-${n}`} style={listButtonStyle}>
                <span style={{ ...listNameStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ background: i.connected ? '#d1fae5' : '#e5e5e5', color: i.connected ? '#065f46' : '#555', padding: '1px 5px', borderRadius: 8, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                    {i.connected ? 'MOF接続済み' : 'MOF未接続'}
                  </span>
                  {i.subItem || i.item}
                </span>
                <span style={listValueStyle}>{i.accountCategory} / {i.item} / {money(i.amount)}</span>
              </div>
            ))
          )
        )}
      </div>
    </PanelShell>
  );
}

function Row({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f5f5f5', padding: '4px 0', fontWeight: strong ? 700 : 400 }}>
      <span style={{ color: '#999', fontSize: 12 }}>{label}</span><span style={{ fontSize: 12 }}>{money(v)}</span>
    </div>
  );
}

/** 「その他の項」「その他のRS事業」集約ノードの詳細。構成する項・事業そのものを一覧する */
function AggregateDetail({ name, items, onClose }: { name: string; items: { name: string; value: number }[]; onClose: () => void }) {
  return (
    <PanelShell>
      <PanelHeader name={name} onClose={onClose}
        amountBlock={<div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>表示件数の外に出た項目の集約です</div>}
        badges={<Badge background="#9aa0a6">集約</Badge>}
      />
      <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
        {items.length === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>内訳はありません</p> : items.map((it, i) => (
          <div key={i} style={listButtonStyle}>
            <span style={listNameStyle}>{it.name}</span>
            <span style={listValueStyle}>{money(it.value)}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

export default function IntegratedSankeyPage() {
  return <App />;
}
