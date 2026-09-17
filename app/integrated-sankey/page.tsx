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

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel, SIDE_PANEL_WIDTH_MIN, SIDE_PANEL_WIDTH_MAX } from '@/client/hooks/useSidePanel';
import { RangeWindowRow } from '@/client/components/SankeySvg/RangeWindowRows';
import { parseAmountToYen } from '@/app/lib/format/yen';
import { getAccountBadgeStyle, rsOnlyBudgetTypeBadge } from '@/app/lib/account-badge';
import { BudgetTypeBadge, Badge as MofBadge, OutlineBadge } from '@/client/components/mof-kou/Badge';
import { classifyAccountCategory } from '@/app/lib/account-badge';
import { revisedBudgetType, type MOFBudgetType, type MOFRevisionNumber } from '@/types/mof-jikou';
import { TagChip } from '@/client/components/TagChip';
import { flowOriginLabel, flowOriginToTagKind, originKindLabel, originKindToTagKind } from '@/client/components/subcontract/origin-kind';
import { buildFlowRows, buildRecipientRows } from '@/app/lib/integrated-sankey-blocks';
import type { SubcontractGraph } from '@/types/subcontract';
import {
  buildMatcher,
  buildSectionDetailView,
  buildView,
  compareProjects,
  EMPTY_FILTERS,
  OTHER_PROJECTS,
  OTHER_SECTIONS,
  type DisplayNode,
  type Filters,
  type IntegratedGraph,
  type IntegratedItemEdge,
  type IntegratedProjectNode,
  type IntegratedSectionNode,
  type ViewModel,
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

/** h = 予算高さ・支出高さのうち大きい方（スロット確保・縦位置決めに使う）。
 * RS事業ノードは budgetH/spendH を別々に持ち、統合ノードの形状描画に使う */
type PlacedNode = DisplayNode & { x: number; y: number; h: number; budgetH?: number; spendH?: number };

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
  // 「すべて選択/解除」は個別チェックボックスの状態と完全に連動する通常のselect-all
  // トグルに戻した（2026-09-15再指摘：個別を隠す挙動は違和感があるとのこと）。
  // すべて選択（allChecked）のときは個別もすべてチェック済みで表示し、「すべて解除」は
  // 個別がすべてチェック済みのとき（allChecked）だけ発動する——部分選択の状態で
  // マスターを押すと「すべて選択」になる（allChecked以外は常に選択側へ倒す）
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
  const router = useRouter();
  const searchParams = useSearchParams();
  // URLのyearクエリパラメータを初期状態に反映し、YearSelectの変更をURLへ書き戻す。
  // 未指定・不正値（対応年度以外）は既定の2025へフォールバックする
  const initialYear = (() => {
    const n = Number(searchParams.get('year'));
    return (SUPPORTED_YEARS as readonly number[]).includes(n) ? (n as SupportedYear) : 2025;
  })();
  const [year, setYearState] = useState<SupportedYear>(initialYear);
  const setYear = (y: SupportedYear) => {
    setYearState(y);
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', String(y));
    router.replace(`?${params.toString()}`, { scroll: false });
  };
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
    // 年度を短時間で連続切替すると複数の fetch が走る。古いリクエストが後から
    // 完了すると選択年度と異なるデータで data/error を上書きしてしまうため、
    // effect のクリーンアップで中止する（CodeRabbit指摘）
    const controller = new AbortController();
    setData(null); setError(''); setSelected(null);
    fetch(`/api/integrated-sankey?year=${year}`, { signal: controller.signal })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then(setData)
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
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

  // ジャンプ選択: 対象ノードが現在の表示ウィンドウの外なら、窓を動かして中に入れる。
  // 検索は絞り込みを無視して全件から探す設計（グラフを絞り込まない）なので、
  // 選択対象がアクティブなフィルタで除外されている場合は先にフィルタを解除する。
  // 解除しないと buildView の母集合に対象が存在せず、オフセットを動かしても
  // layout.byId に無いノードを選んだことになり詳細パネルが空になる不具合になる
  const jumpTo = (hit: SearchHit) => {
    if (!data || !view) return;
    const isFilteredOut = hit.kind === 'section'
      ? !view.rankedSections.some(s => s.id === hit.id)
      : !view.rankedProjects.some(p => p.id === hit.id);
    if (isFilteredOut) setFilters(EMPTY_FILTERS);

    if (hit.kind === 'section') {
      const ranked = [...data.sections].sort((a, b) => b.amount - a.amount);
      const idx = ranked.findIndex(s => s.id === hit.id);
      if (idx >= 0) setSectionOffset(Math.max(0, idx - Math.floor(topSection / 2)));
    } else {
      const ranked = [...data.projects].sort(compareProjects);
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
  const allProjectMinistries = [...new Set(data.projects.flatMap(p => p.ministry.split(/及び|・|、/).map(x => x.trim()).filter(Boolean)))].sort();

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#f7f8f5] text-neutral-800">
      {/* サイドパネル表示時もサンキー図自体はPanしない。/sankey-svg と同じく、
          パネルはこのコンテナの上にオーバーレイするだけで、図の幅・位置は変えない
          （leftControlsOffsetは検索ボックス等のフローティングUIの位置調整にのみ使う） */}
      <div ref={containerRef} className="absolute inset-0">
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
            {/* 列見出しはノード中心の真上に中央揃えで置く（/sankey-svg と同じ、
                screenX = ノードX0 + 幅/2 に text-align:center を合わせる考え方） */}
            <text x={layout.leftX + NODE_W / 2} y={PAD_TOP - 40} fontSize="13" fontWeight="700" fill="#555" textAnchor="middle">MOF項</text>
            <text x={layout.leftX + NODE_W / 2} y={PAD_TOP - 22} fontSize="12" fill="#999" textAnchor="middle">{money(view.sectionColumnTotal)}</text>
            <text x={layout.rightX + NODE_W2 / 2} y={PAD_TOP - 40} fontSize="13" fontWeight="700" fill="#555" textAnchor="middle">RS事業</text>
            {/* 予算/支出の合計を/区切りで併記する（/sankey-svg の事業列見出しと同じ書式） */}
            <text x={layout.rightX + NODE_W2 / 2} y={PAD_TOP - 22} fontSize="12" fill="#999" textAnchor="middle">
              {money(view.projectColumnTotal)} / {money(view.projectSpendColumnTotal)}
            </text>
            <g>
              {layout.left.map(n => {
                const active = nodeActive(n);
                return (
                  <g key={n.id} data-testid="sankey-node" data-kind={n.kind} className="cursor-pointer" opacity={active ? 1 : 0.25}
                    onClick={() => setSelected(selected === n.id ? null : n.id)}
                  >
                    {/* 選択時のボーダーは付けない。NODE_W=18の細いバーだと枠線がFillを
                        潰してしまうため（選択状態はopacity/相手列の強調のみで示す） */}
                    <rect x={n.x} y={n.y} width={NODE_W} height={Math.max(0.6, n.h)} rx="2" fill={nodeColor(n)} />
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
                        上辺は直線、下辺は予算下端↔支出下端をベジェ曲線で結ぶ。
                        選択時のボーダーは付けない（細い形状だとFillを潰すため） */}
                    <path d={mergedProjectPath(n.x, n.y, budgetH, spendH)} fill={projectNodeFill(n)} />
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
                <CheckboxCombobox label="府省庁" selected={filters.projectMinistries} onChange={v => setFilter('projectMinistries', v)}
                  options={allProjectMinistries.map(m => ({ value: m, label: m }))} />
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
            <ProjectDetail project={selectedNode.project} itemEdges={selectedItemEdges} sections={data.sections} year={year} onClose={() => setSelected(null)} />
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

/** サイドパネルの一覧行の共通レイアウト。1行目＝バッジ＋名前（CSSのellipsisで
 * 省略）＋金額の右寄せ併記、2行目以降＝補足情報を左寄せで表示する。詳細パネルの
 * 全タブの一覧でこの構造に統一する。
 *
 * 名前は`trim()`（文字数固定の事前カット）ではなくCSSの`text-overflow:ellipsis`
 * のみで省略する。サイドパネルはユーザーがドラッグで幅を変えられるため、事前に
 * 固定文字数で切ると幅を広げても続きが表示されない不具合になる（「電気・ガス
 * 価格激変緩和対策等事業のデロイトトーマツファイナンシャルアドバイザリー合同
 * 会社ほかがサイドパネルを広げても最後まで表示されない」との指摘、2026-09-17）。
 * `trim()`はSVGのノードラベル（幅固定でCSS ellipsisが使えない）専用として残す */
function ListRow({ badges, name, amount, meta }: { badges?: React.ReactNode; name: string; amount: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div style={listButtonStyle} data-testid="list-row">
      <span style={{ ...listNameStyle, flex: '1 1 0%', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {badges}
        <span data-testid="list-row-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      </span>
      <span style={{ ...listValueStyle, flex: '0 0 auto', marginLeft: 8 }}>{amount}</span>
      {meta && <div data-testid="list-row-meta" style={{ flex: '0 0 100%', fontSize: 11, color: '#999', textAlign: 'left' }}>{meta}</div>}
    </div>
  );
}

/** 「N件」を示すバッジ（RS×N、当初×N等）の内訳ポップアップの状態。クリックした
 * バッジ自身の`getBoundingClientRect()`を`anchor`として持ち、`BadgePopup`側で
 * 実際のポップアップサイズを測ってから画面内に収まる位置を計算する（バッジの
 * すぐ下に決め打ちすると、一覧の下の方のバッジをクリックしたときにポップアップが
 * ビューポート下端からはみ出して見切れる不具合になる、2026-09-15指摘） */
/** idはどのバッジが開いたポップアップかを識別する。同じバッジを再クリックした
 * ときは閉じ、別のバッジをクリックしたときは切り替える（トグル）ために使う
 * （「同じバッジを再クリックしたときに閉じたい、他バッジは切り替える既存の挙動は
 * 維持」との指摘、2026-09-15） */
interface BadgePopupState { id: string; title: string; rows: { name: string; amount: number }[]; anchor: DOMRect }

/** ×N付きバッジをクリックすると内訳（名前・金額の一覧）をポップアップで見せる
 * （「×付きのバッジをクリックしたらポップアップで内訳」との指摘、2026-09-15）。
 * `button`でキーボード操作（Tab移動・Enter/Space）にも対応する（`span`は
 * フォーカス不可でキーボードから開けなかった、PRレビュー指摘） */
function ClickableBadge({ onClick, children }: { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  // data-badge-trigger: BadgePopupの外側クリック検知（mousedown）から除外するための
  // 目印。無いと、同じバッジを再クリックしたときにmousedownの外側クリック判定が
  // 先に発火してポップアップをonClose()で閉じてしまい、直後のonClick（トグル処理）が
  // 「閉じている状態からの再オープン」と誤認して即座に開き直してしまう
  // （トグルで閉じたいのに閉じられない不具合になる、2026-09-15指摘）
  return (
    <button type="button" data-badge-trigger="true" onClick={onClick}
      style={{ cursor: 'pointer', padding: 0, border: 0, background: 'transparent' }}>
      {children}
    </button>
  );
}

function BadgePopup({ state, onClose }: { state: BadgePopupState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // 初回描画はanchorのすぐ下（見えない状態）に置いて実サイズを測り、ビューポート内に
  // 収まるようclampした位置を確定してから表示する。下端をはみ出す場合はバッジの
  // 上側に表示を反転する
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let top = state.anchor.bottom + 4;
    if (top + rect.height > window.innerHeight - margin) {
      const above = state.anchor.top - rect.height - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - rect.height - margin);
    }
    let left = state.anchor.left;
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    left = Math.max(margin, left);
    setPos({ left, top });
  }, [state]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // バッジ自身のクリックは除外し、バッジ側のonClick（トグル処理）に任せる
      if (!ref.current?.contains(target) && !target.closest?.('[data-badge-trigger]')) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div ref={ref}
      style={{ position: 'fixed', left: pos?.left ?? state.anchor.left, top: pos?.top ?? state.anchor.bottom + 4,
        visibility: pos ? 'visible' : 'hidden', zIndex: 60, background: '#fff', border: '1px solid #ddd',
        borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: 320, overflowY: 'auto', minWidth: 220, maxWidth: 360 }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #f0f0f0', fontSize: 11, fontWeight: 700, color: '#555',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, position: 'sticky', top: 0, background: '#fff' }}>
        <span>{state.title}</span>
        <button type="button" onClick={onClose} aria-label="閉じる"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ padding: '4px 0' }}>
        {state.rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 10px', fontSize: 11 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span style={{ flexShrink: 0, color: '#666' }}>{money(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionDetail({ section, itemEdges, projects, onClose }: {
  section: IntegratedSectionNode; itemEdges: IntegratedItemEdge[]; projects: IntegratedProjectNode[]; onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [popup, setPopup] = useState<BadgePopupState | null>(null);
  const projectById = new Map(projects.map(p => [p.id, p]));
  const { projectTotals, projectBudgetTypeEdges, itemRows, summary, difference, changeRate } = buildSectionDetailView(section, itemEdges);
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
            <b style={{ color: difference < 0 ? '#e11d48' : '#2d7d46' }}>
              {difference >= 0 ? '+' : ''}{money(difference)}
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
      <DetailTabs tabs={[
        { label: 'サマリー' },
        { label: '目', count: itemRows.length },
        { label: 'RS事業', count: projectTotals.size },
      ]} active={tab} onChange={setTab} />
      <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
        {tab === 0 ? (
          <div style={{ marginBottom: 10 }}>
            <Row label="RS接続額" v={summary.connectedAmount} strong />
            <Row label="未接続額" v={summary.unconnectedAmount} />
            <Row label="超過額（要確認）" v={summary.excessAmount} />
            <Row label="当初予算額" v={summary.initialAmount} />
            <Row label="補正予算による増減" v={summary.revisedAmount} />
            <StatRow label="目数" value={`${summary.itemCount}件（当初${summary.initialItemCount}・補正${summary.revisedItemCount}）`} />
            <StatRow label="接続RS事業数" value={`${summary.projectCount}件`} />
          </div>
        ) : tab === 1 ? (
          itemRows.map(g => (
            <ListRow key={g.itemKey} name={g.itemName} amount={money(g.mofAmount)}
              // 未接続（status: 'unconnected'）はラベル無し。「RS未接続」は事実の割に
              // 目立ちすぎる／誤解を招くとの指摘を受け、良い代替案が出るまで何も出さない
              // （2026-09-14）。バッジ類（予算種別・RS接続件数・超過）は1行目ではなく
              // すべて2行目（meta）に統一する（2026-09-15指摘：バッジは2行目の方が
              // 良さそう、予算種別・会計区分を他タブ・RS事業サイドパネルでも統一）
              meta={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BudgetTypeBadge budgetType={g.budgetType} />
                  {g.connectedEdges.length > 0 && (
                    <ClickableBadge onClick={e => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const id = `item:${g.itemKey}`;
                      setPopup(prev => prev?.id === id ? null : {
                        id, title: `${g.itemName}の接続先（${g.connectedEdges.length}件）`,
                        rows: g.connectedEdges.map(ed => ({ name: projectById.get(ed.target)?.name ?? ed.target, amount: ed.value })),
                        anchor: rect,
                      });
                    }}>
                      <OutlineBadge label={`RS×${g.connectedEdges.length}`} color="#78909c" />
                    </ClickableBadge>
                  )}
                  {g.hasExcess && <span>超過・要確認</span>}
                </div>
              } />
          ))
        ) : (
          projectTotals.size === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>接続しているRS事業がありません</p> : (
            [...projectTotals.entries()].sort((a, b) => b[1] - a[1]).map(([pid, value]) => (
              <ListRow key={pid} name={projectById.get(pid)?.name ?? pid} amount={money(value)}
                meta={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {[...(projectBudgetTypeEdges.get(pid)?.entries() ?? [])]
                    .sort((a, b) => (a[0] === '当初予算' ? -1 : b[0] === '当初予算' ? 1 : 0))
                    .map(([bt, edges]) => (
                      <ClickableBadge key={bt} onClick={e => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const id = `project:${pid}|${bt}`;
                        setPopup(prev => prev?.id === id ? null : {
                          id, title: `${bt}の内訳（${edges.length}件）`,
                          rows: edges.map(ed => ({ name: ed.itemName, amount: ed.value })),
                          anchor: rect,
                        });
                      }}>
                        <BudgetTypeBadge budgetType={bt} count={edges.length} />
                      </ClickableBadge>
                    ))}
                </div>} />
            ))
          )
        )}
      </div>
      {popup && <BadgePopup state={popup} onClose={() => setPopup(null)} />}
    </PanelShell>
  );
}

/** 再委託構造（`SubcontractGraph`）の取得状態。5-1・5-2 CSV由来の既存データ
 * （`/api/subcontracts/[projectId]`。scripts/generate-subcontracts.ts が生成）を
 * 事業選択時に都度取得する。件数が事業ごとに大きく異なり、全事業分を
 * `/api/integrated-sankey` に同梱すると無駄が大きいため遅延取得にしている */
type SubGraphState =
  | { status: 'loading' }
  | { status: 'ready'; graph: SubcontractGraph }
  | { status: 'empty' }
  | { status: 'error' };

function useSubcontractGraph(projectId: number, year: number): SubGraphState {
  const key = `${projectId}-${year}`;
  const keyRef = useRef(key);
  const [state, setState] = useState<SubGraphState>({ status: 'loading' });
  // 事業・年度が切り替わったら、useEffect実行前（このレンダー内）で古いready
  // データを捨てる。ProjectDetail自体はkeyでremountしない（remountすると
  // タブ選択（tab state）もリセットされてしまい、「選択タブが予算サマリに
  // 戻ってしまう」不具合になる、2026-09-18指摘）。Reactの「レンダー中に前回の
  // propsとの差分でstateを調整する」パターンで、タブ選択を保ったまま
  // 古いグラフが一瞬表示される問題も避ける
  const stale = keyRef.current !== key;
  if (stale) keyRef.current = key;
  const effectiveState: SubGraphState = stale ? { status: 'loading' } : state;
  if (stale) setState(effectiveState);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/subcontracts/${projectId}?year=${year}`)
      .then(res => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SubcontractGraph>;
      })
      .then(graph => { if (!cancelled) setState(graph ? { status: 'ready', graph } : { status: 'empty' }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [projectId, year]);
  return effectiveState;
}

/** 再委託構造タブ（支出先・ブロック・ブロックのつながり）共通の空/読込/エラー表示 */
function SubGraphStatusMessage({ state, emptyText }: { state: SubGraphState; emptyText: string }) {
  if (state.status === 'loading') return <p style={{ fontSize: 12, color: '#aaa' }}>読み込み中…</p>;
  if (state.status === 'error') return <p style={{ fontSize: 12, color: '#aaa' }}>再委託構造データの取得に失敗しました</p>;
  return <p style={{ fontSize: 12, color: '#aaa' }}>{emptyText}</p>;
}

/** ブロック番号（5-2 CSVの「支出先ブロック番号」等）を小さなバッジで示す。
 * 既存の`OutlineBadge`を中立色（識別子であって意味分類ではないため）で流用する
 * （「ブロック番号はバッジにできそう」との指摘、2026-09-17） */
function BlockIdBadge({ id }: { id: string }) {
  return <OutlineBadge label={id} color="#9aa0a6" />;
}

function ProjectDetail({ project, itemEdges, sections, year, onClose }: {
  project: IntegratedProjectNode; itemEdges: IntegratedItemEdge[]; sections: IntegratedSectionNode[]; year: number; onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const sectionById = new Map(sections.map(s => [s.id, s]));
  // 部課局は代表値（目内訳の先頭行）。事業内で複数組織にまたがる場合は近似
  const rep = project.budgetItems[0];
  // 'unknown'（予算執行データもMOF紐づけも無く判定材料が無い事業）はバッジを出さない
  const accountBadge = getAccountBadgeStyle(
    project.accountType === 'mixed' ? 'both' : project.accountType === 'unknown' ? null : project.accountType,
  );
  const bySection = new Map<string, number>();
  for (const e of itemEdges) bySection.set(e.source, (bySection.get(e.source) ?? 0) + e.value);
  // 支出先・ブロックの2タブは再委託構造（既存データ。新規CSVパース無し）から作る。
  // 「ブロック」タブは当初ブロック単体の一覧と、ブロック同士の親子関係一覧を別タブに
  // 分けていたが、「ブロックタブ消して、ブロックのつながりタブをブロックタブにして」
  // との指摘を受け、親子関係一覧（flows）の方を「ブロック」タブとして残した
  // （2026-09-17。ブロック単体の情報はブロックのつながり側で対象ブロックの
  // 合計金額として表示済みのため、単体一覧は独立タブとしては不要と判断）
  const subGraphState = useSubcontractGraph(project.projectId, year);
  const recipientRows = subGraphState.status === 'ready' ? buildRecipientRows(subGraphState.graph) : [];
  const flowRows = subGraphState.status === 'ready' ? buildFlowRows(subGraphState.graph) : [];
  return (
    <PanelShell>
      <PanelHeader
        name={project.name}
        onClose={onClose}
        amountBlock={
          <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 5 }}>
            <AmountCell label="予算額" value={project.budgetAmount} />
            <AmountCell label="支出額" value={project.spendingAmount} />
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
        { label: '予算サマリ' },
        { label: '予算執行', count: project.budgetBreakdown.length },
        { label: 'MOF項', count: bySection.size },
        { label: '支出先', count: subGraphState.status === 'ready' ? recipientRows.length : undefined },
        { label: 'ブロック', count: subGraphState.status === 'ready' ? flowRows.length : undefined },
      ]} active={tab} onChange={setTab} />
      <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
        {tab === 0 ? (
          project.budgetSummary ? (
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
          ) : <p style={{ fontSize: 12, color: '#aaa' }}>予算執行データがありません</p>
        ) : tab === 1 ? (
          // 「2-2_予算・執行_予算種別・歳出予算項目」CSV由来のレコードをそのまま一覧にする
          // （集計値ではなく生のレコード。集計サマリは別タブ）
          project.budgetBreakdown.length === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>予算執行レコードがありません</p> : (
            project.budgetBreakdown.map((i, n) => {
              const category = classifyAccountCategory(i.accountCategory);
              const accBadge = getAccountBadgeStyle(category);
              // 会計区分が一般のときは「会計」列が常に「一般会計」で自明なので表示しない
              const accountText = category === 'general' ? null : i.account;
              // 前年度から繰越し・予備費等Nは所管・項・目が空のことが多い
              // （MOF側と突合できない行のため）。名前が取れない場合は予算種別を代わりに出す
              const rsOnlyBadge = rsOnlyBudgetTypeBadge(i.budgetType);
              return (
                <ListRow key={`${i.fiscalYear}-${i.budgetType}-${i.accountCategory}-${i.item}-${i.subItem}-${n}`}
                  name={i.subItem || i.item || i.note || i.budgetType || '（内訳なし）'} amount={money(i.amount)}
                  // バッジ（会計区分・予算種別）は1行目ではなく2行目（meta）に統一する
                  // （「バッジは2行目の方が良さそう」との指摘、2026-09-15）
                  meta={<>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      {accBadge && <MofBadge label={accBadge.label} background={accBadge.background} />}
                      {rsOnlyBadge
                        ? <OutlineBadge label={rsOnlyBadge.label} color={rsOnlyBadge.color} />
                        : <BudgetTypeBadge budgetType={toMofBudgetType(i.budgetType)} />}
                    </div>
                    <div>{[accountText, i.item].filter(Boolean).join(' / ')}</div>
                    {i.note.trim() && (i.subItem || i.item) && <div>補足: {i.note}</div>}
                  </>}
                />
              );
            })
          )
        ) : tab === 2 ? (
          // MOF項一覧: 目一覧（RS自身の予算内訳、接続済み/未接続の二値のみ）より、
          // 実際に紐づいたMOF項の名前と金額をそのまま見せる方がつながりを表現しやすい
          // という指摘を受け、独立タブへ格上げした（目タブ自体は不要と判断し廃止。
          // 2026-09-14）
          bySection.size === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>接続しているMOF項がありません</p> : (
            [...bySection.entries()].sort((a, b) => b[1] - a[1]).map(([sid, value]) => (
              <ListRow key={sid} name={sectionById.get(sid)?.name ?? sid} amount={money(value)} />
            ))
          )
        ) : tab === 3 ? (
          // 支出先: 直接支出先ブロックだけでなく再委託・別財源ブロックの支出先も横断で見せる
          // （「支出先、ブロック、ブロックのつながりでタブを分けたい」「支出先には直接支出先
          // ブロックなのか再委託ブロックなのか、再委託であればどのブロックの再委託なのかを」
          // との指摘、2026-09-17）。データは5-2 CSVの直接/間接判定を1階層目のみに限る
          // /sankey-svgの直接支出先合計より広く、再委託構造データ（既存）をそのまま使う
          subGraphState.status !== 'ready'
            ? <SubGraphStatusMessage state={subGraphState} emptyText="再委託構造データがありません" />
            : recipientRows.length === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>支出先がありません</p> : (
              // ブロックバッジの並びはブロックタブと揃える: 再委託・別財源は
              // 親バッジ（名前は出さない）→ 対象ブロックバッジ→ブロック名。
              // 直接は対象ブロックバッジ→ブロック名のみ（「支出先タブのブロック
              // バッジの再委託はブロックと合わせて、親の名前不要でブロックバッジ→
              // 子ブロックバッジ」との指摘、2026-09-17）
              recipientRows.map((r, i) => (
                <ListRow key={`${r.blockId}-${r.name}-${i}`} name={r.name} amount={money(r.amount)}
                  meta={
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                      <TagChip kind={originKindToTagKind(r.originKind)}>{originKindLabel(r.originKind)}</TagChip>
                      {r.parentBlocks.map(p => <BlockIdBadge key={p.blockId} id={p.blockId} />)}
                      {r.parentBlocks.length > 0 && <span>→</span>}
                      <BlockIdBadge id={r.blockId} />
                      <span>{r.blockName}</span>
                    </div>
                  }
                />
              ))
            )
        ) : (
          // ブロック: ブロック同士の親子関係（5-2 CSVの「支出元の支出先ブロック」→
          // 「支出先の支出先ブロック」）を一覧化する（「ブロックのつながりでは、
          // ブロック同士の親子関係が一覧化されていてほしい」との指摘）。
          // 当初はブロック単体の一覧を別タブ（旧「ブロック」タブ）にしていたが、
          // 「ブロックタブ消して、ブロックのつながりタブをブロックタブにして」との
          // 指摘を受けて1本化した（2026-09-17。対象ブロックの合計金額はこの
          // 一覧の`amount`列にそのまま出ているため単体一覧は重複だった）
          subGraphState.status !== 'ready'
            ? <SubGraphStatusMessage state={subGraphState} emptyText="再委託構造データがありません" />
            : flowRows.length === 0 ? <p style={{ fontSize: 12, color: '#aaa' }}>ブロックのつながりがありません</p> : (
              // ブロック番号バッジは各ブロック名の直左に置く（ListRowの`name`は文字列
              // 専用でバッジを名前に隣接できないため、ここだけ独自のレイアウトにする。
              // 「ブロックバッジの位置はブロック名の左に」との指摘、2026-09-17）
              flowRows.map((f, i) => (
                <div key={`${f.sourceBlockId ?? 'root'}-${f.targetBlockId}-${i}`} style={listButtonStyle} data-testid="list-row">
                  <span style={{ ...listNameStyle, flex: '1 1 0%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                    {f.sourceBlockId && <>
                      <BlockIdBadge id={f.sourceBlockId} />
                      <span>→</span>
                    </>}
                    <BlockIdBadge id={f.targetBlockId} />
                    <span data-testid="list-row-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.targetBlockName}</span>
                  </span>
                  <span style={{ ...listValueStyle, flex: '0 0 auto', marginLeft: 8 }}>{money(f.targetAmount)}</span>
                  {/* 補足（note）は起点種別バッジと同じ行に置く（別行だと切り替わりの
                      文脈がつかみにくいという指摘、2026-09-17） */}
                  <div data-testid="list-row-meta" style={{ flex: '0 0 100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 11, color: '#999', textAlign: 'left' }}>
                    <TagChip kind={flowOriginToTagKind(f.origin)}>{flowOriginLabel(f.origin)}</TagChip>
                    {f.targetIncomingBlockCount > 1 && <span>対象ブロックへの合流{f.targetIncomingBlockCount}件</span>}
                    {f.note && <span>補足: {f.note}{f.isReference ? '（参考情報）' : ''}</span>}
                  </div>
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

/** Rowと同じ見た目で、金額ではなく件数等の任意テキストを右側に出す */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f5f5f5', padding: '4px 0' }}>
      <span style={{ color: '#999', fontSize: 12 }}>{label}</span><span style={{ fontSize: 12 }}>{value}</span>
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
          <ListRow key={i} name={it.name} amount={money(it.value)} />
        ))}
      </div>
    </PanelShell>
  );
}

export default function IntegratedSankeyPage() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}
