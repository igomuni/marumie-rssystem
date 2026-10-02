/**
 * DocumentHierarchy PoC: 概算要求PDFの「文書階層」（組織→項→要求→…）の見出し行と、その親子関係の候補を観測する。
 * 入力は SourceToken / TableGeometry / LogicalRow（Engine Selection Research で KEEP と判断された下位3層）だけ。
 * SpatialRegion / RegionRelation / SemanticRecordCandidate / RecordAnchor / PageTemplate（PAUSE/FREEZE）は読まない・importしない。
 *
 * ## 原則
 * - 評価用のGround Truth（目次由来）を読まない・importしない。このモジュールは評価側（evaluate-budget-request-document-hierarchy.ts）を知らない。
 * - コード値（070・010・186 等）や語（組織・項）を条件にしない。使うのは「形」（先頭が3桁／要求番号+NN-NN）・xインデントの階段・文書順だけ。
 *   「code 010 だから項」のような意味の確定はしない。levelは「その文書のxインデント階段の順位」であり、organization/item/request ではない。
 * - 金額は解釈しない（△/▲/-の推定・blank→0・差額計算なし）。行末の4桁トークンを「頁数列の候補」として観測するだけ（総表の印字された page reference）。
 * - 親が確定できなければ unresolved / level_gap（ambiguous）にする。confidenceの最大値を採用する設計にしない。祖先候補（stack全体）も保持する。
 * - 全nodeは SourceToken.index / PhysicalRowCandidate.rowIndex / LogicalRowCandidate.logicalRowIndex / page に戻れる。
 *
 * ## 方法（v1）
 * 1. 見出し候補行: 形A=先頭の非空白tokenが /^\d{3}$/ で後続あり、形B=先頭が /^\d{1,3}$/ で2番目が /^\d{2}-\d{2}$/。形Bを先に判定。
 *    key token は A=先頭、B=2番目（コード）。
 * 2. view（summary / detail は呼び出し側が与える入力。自動判別はしない）ごとに key token の xMin を単一連結クラスタリング
 *    （隣接差 <= gapFactor × 基準フォントサイズ。基準=各ページの基準サイズの中央値）。支持が minSupport 行未満のクラスタは unplaced。
 *    placed クラスタを xMin 昇順に並べた順位が level（1始まり）。
 * 3. 文書順（ページ昇順→行順）にstackで処理: level 以上のtopをpopし、残ったtopを親候補とする。
 *    level が連続（親=子-1）なら resolved_by_indent_sequence、飛ぶなら level_gap、親無しなら unresolved。
 * ページをまたぐ親（見出しが再掲されないページ）も同じstackで辿る。stackに載るのは見出し候補行だけなので、
 * 見出し形状を持たない行（過年度表など）は親にならない。
 */
import type { LogicalRowResult } from './budget-request-logical-row';
import type { PageMeta, SourceToken } from './budget-request-source-token';
import type { TableGeometryResult } from './budget-request-table-geometry';

export const DOCUMENT_HIERARCHY_SCHEMA = 'budget-request-document-hierarchy-poc/v1';

export type HierarchyView = 'summary' | 'detail';
export type RowShape = 'code3_then_text' | 'request_no_then_code';
export type EdgeStatus = 'resolved_by_indent_sequence' | 'level_gap' | 'unresolved';

export interface HierarchyOptions {
  /** xクラスタの隣接差の上限 = gapFactor × 基準フォントサイズ（ページ基準サイズの中央値） */
  indentClusterGapFactor: number;
  /** placed とみなす最小の見出し候補行数（繰り返し現れるインデント段のみを階段として扱う） */
  minClusterSupport: number;
}

export const DEFAULT_HIERARCHY_OPTIONS: HierarchyOptions = { indentClusterGapFactor: 0.25, minClusterSupport: 2 };

export interface HierarchyPageInput {
  meta: PageMeta;
  tokens: SourceToken[];
  geometry: TableGeometryResult;
  logical: LogicalRowResult;
}

export interface DocumentHierarchyNodeObservation {
  id: string;
  view: HierarchyView;
  sourcePage: number;
  rowShape: RowShape;
  sourceRowRefs: { logicalRowIndex: number; physicalRowIndexes: number[] };
  /** 全て当該ページのSourceToken.index */
  sourceTokenRefs: { keyTokenIndex: number; rowTokenIndexes: number[] };
  /** 印字されたままのtoken文字列（正規化・補正なし） */
  observedCodeParts: { requestNo?: string; code: string };
  /** コード以降の非空白tokenのrawText（visual順。結合・分類しない） */
  observedTextParts: string[];
  xIndentEvidence: { keyTokenXMin: number; clusterIndex: number | null; level: number | null; placed: boolean };
  structureEvidence: {
    /** 行内でxMaxが最大の /^\d{4}$/ だけのtokenの文字列。総表の頁数列の候補（観測のみ。無ければnull） */
    printedPageRefCandidate: string | null;
    rowTokenCount: number;
  };
}

export interface HierarchyEdgeEvidence {
  kind: 'indent_level' | 'document_order' | 'page_transition';
  detail: Record<string, number | boolean | string | null>;
}

export interface DocumentHierarchyEdgeCandidate {
  parentNodeId: string | null;
  childNodeId: string;
  status: EdgeStatus;
  evidence: HierarchyEdgeEvidence[];
  /** 親候補より上位（level が小さい）の stack 上のnode。近い順 */
  ancestorCandidateNodeIds: string[];
}

export interface IndentClusterObservation {
  clusterIndex: number;
  xMin: number;
  xMax: number;
  memberCount: number;
  level: number | null;
}

export interface DocumentHierarchyResult {
  schema: typeof DOCUMENT_HIERARCHY_SCHEMA;
  view: HierarchyView;
  parameters: HierarchyOptions & {
    referenceFontSize: number;
    referenceFontSizeBasis: 'median of per-page TableGeometry referenceFontSize';
    clusterGap: number;
    levelDefinition: 'rank of placed x-indent clusters (ascending xMin), 1-based; NOT a semantic type';
    inputLayers: ['SourceToken', 'TableGeometry', 'LogicalRow'];
  };
  pages: number[];
  nodes: DocumentHierarchyNodeObservation[];
  edges: DocumentHierarchyEdgeCandidate[];
  indentClusters: IndentClusterObservation[];
  diagnostics: {
    logicalRowCount: number;
    headingCandidateCount: number;
    placedCount: number;
    unplacedCount: number;
    edgeStatusCounts: Record<EdgeStatus, number>;
    nodeCountByLevel: Record<string, number>;
  };
}

const REQUEST_CODE = /^\d{2}[-‐-―−]\d{2}$/;
const CODE3 = /^\d{3}$/;
const REQUEST_NO = /^\d{1,3}$/;
const PAGE_REF = /^\d{4}$/;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface HeadingCandidate {
  pageIndex: number;
  rowOrdinal: number; // 入力全体での論理行の通し番号（文書順）
  node: DocumentHierarchyNodeObservation;
}

/** 論理行の先頭tokenの形から見出し候補かを判定する（形のみ。値は見ない） */
function headingShapeOf(texts: string[]): { shape: RowShape; keyPos: number } | null {
  if (texts.length >= 2 && REQUEST_NO.test(texts[0]) && REQUEST_CODE.test(texts[1])) return { shape: 'request_no_then_code', keyPos: 1 };
  if (texts.length >= 2 && CODE3.test(texts[0])) return { shape: 'code3_then_text', keyPos: 0 };
  return null;
}

export function observeDocumentHierarchy(
  view: HierarchyView,
  pages: HierarchyPageInput[],
  options: HierarchyOptions = DEFAULT_HIERARCHY_OPTIONS,
): DocumentHierarchyResult {
  const ordered = [...pages].sort((a, b) => a.meta.number - b.meta.number);
  const referenceFontSize = median(ordered.map(p => p.geometry.parameters.rowClustering.referenceFontSize));
  const clusterGap = round3(options.indentClusterGapFactor * referenceFontSize);

  const candidates: HeadingCandidate[] = [];
  let ordinal = 0;
  let logicalRowCount = 0;
  ordered.forEach((p, pageIndex) => {
    for (const row of p.logical.logicalRowCandidates) {
      const toks = row.visualTokenIndexes.map(i => p.tokens[i]).filter(t => t.rawText.trim() !== '');
      const texts = toks.map(t => t.rawText.trim());
      const found = headingShapeOf(texts);
      if (found) {
        const key = toks[found.keyPos];
        // 頁数列の候補: 行内でxMaxが最大の「4桁だけのtoken」（金額はカンマ区切りのため4桁数字だけのtokenにならない。名称が折り返す行でも取れる）
        const refToken = toks.filter(t => PAGE_REF.test(t.rawText.trim())).sort((a, b) => b.bbox.xMax - a.bbox.xMax)[0];
        candidates.push({
          pageIndex,
          rowOrdinal: ordinal,
          node: {
            id: `${view}-p${p.meta.number}-r${row.logicalRowIndex}`,
            view,
            sourcePage: p.meta.number,
            rowShape: found.shape,
            sourceRowRefs: { logicalRowIndex: row.logicalRowIndex, physicalRowIndexes: [...row.physicalRowIndexes] },
            sourceTokenRefs: { keyTokenIndex: key.index, rowTokenIndexes: toks.map(t => t.index) },
            observedCodeParts: found.shape === 'request_no_then_code' ? { requestNo: toks[0].rawText, code: toks[1].rawText } : { code: toks[0].rawText },
            observedTextParts: toks.slice(found.keyPos + 1).map(t => t.rawText),
            xIndentEvidence: { keyTokenXMin: key.bbox.xMin, clusterIndex: null, level: null, placed: false },
            structureEvidence: { printedPageRefCandidate: refToken ? refToken.rawText.trim() : null, rowTokenCount: toks.length },
          },
        });
      }
      ordinal++;
      logicalRowCount++;
    }
  });

  // xインデントの階段: key tokenのxMinを単一連結クラスタリング
  const xs = candidates.map(c => c.node.xIndentEvidence.keyTokenXMin).sort((a, b) => a - b);
  const groups: { xs: number[] }[] = [];
  for (const x of xs) {
    const g = groups[groups.length - 1];
    if (g && x - g.xs[g.xs.length - 1] <= clusterGap) g.xs.push(x);
    else groups.push({ xs: [x] });
  }
  const placedSorted = groups.filter(g => g.xs.length >= options.minClusterSupport);
  const indentClusters: IndentClusterObservation[] = groups.map((g, clusterIndex) => ({
    clusterIndex,
    xMin: round3(g.xs[0]),
    xMax: round3(g.xs[g.xs.length - 1]),
    memberCount: g.xs.length,
    level: g.xs.length >= options.minClusterSupport ? placedSorted.indexOf(g) + 1 : null,
  }));
  for (const c of candidates) {
    const x = c.node.xIndentEvidence.keyTokenXMin;
    const cl = indentClusters.find(k => x >= k.xMin && x <= k.xMax);
    if (cl) c.node.xIndentEvidence = { keyTokenXMin: x, clusterIndex: cl.clusterIndex, level: cl.level, placed: cl.level !== null };
  }

  // 文書順のstack。placedなnodeだけが参加する
  const edges: DocumentHierarchyEdgeCandidate[] = [];
  const stack: HeadingCandidate[] = [];
  const level = (c: HeadingCandidate): number => c.node.xIndentEvidence.level as number;
  for (const c of candidates) {
    if (!c.node.xIndentEvidence.placed) continue;
    while (stack.length > 0 && level(stack[stack.length - 1]) >= level(c)) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) {
      edges.push({ parentNodeId: null, childNodeId: c.node.id, status: 'unresolved', evidence: [{ kind: 'document_order', detail: { reason: 'no_preceding_shallower_heading' } }], ancestorCandidateNodeIds: [] });
    } else {
      const adjacent = level(parent) === level(c) - 1;
      edges.push({
        parentNodeId: parent.node.id,
        childNodeId: c.node.id,
        status: adjacent ? 'resolved_by_indent_sequence' : 'level_gap',
        evidence: [
          { kind: 'indent_level', detail: { parentLevel: level(parent), childLevel: level(c), adjacent } },
          { kind: 'document_order', detail: { logicalRowsBetween: c.rowOrdinal - parent.rowOrdinal - 1 } },
          { kind: 'page_transition', detail: { parentPage: parent.node.sourcePage, childPage: c.node.sourcePage, parentOnSamePage: parent.pageIndex === c.pageIndex, pagesBetween: c.pageIndex - parent.pageIndex } },
        ],
        ancestorCandidateNodeIds: stack.slice(0, -1).reverse().map(s => s.node.id),
      });
    }
    stack.push(c);
  }

  const statusCounts: Record<EdgeStatus, number> = { resolved_by_indent_sequence: 0, level_gap: 0, unresolved: 0 };
  for (const e of edges) statusCounts[e.status]++;
  const byLevel: Record<string, number> = {};
  for (const c of candidates) {
    const k = c.node.xIndentEvidence.level === null ? 'unplaced' : String(c.node.xIndentEvidence.level);
    byLevel[k] = (byLevel[k] ?? 0) + 1;
  }
  return {
    schema: DOCUMENT_HIERARCHY_SCHEMA,
    view,
    parameters: {
      ...options,
      referenceFontSize: round3(referenceFontSize),
      referenceFontSizeBasis: 'median of per-page TableGeometry referenceFontSize',
      clusterGap,
      levelDefinition: 'rank of placed x-indent clusters (ascending xMin), 1-based; NOT a semantic type',
      inputLayers: ['SourceToken', 'TableGeometry', 'LogicalRow'],
    },
    pages: ordered.map(p => p.meta.number),
    nodes: candidates.map(c => c.node),
    edges,
    indentClusters,
    diagnostics: {
      logicalRowCount,
      headingCandidateCount: candidates.length,
      placedCount: candidates.filter(c => c.node.xIndentEvidence.placed).length,
      unplacedCount: candidates.filter(c => !c.node.xIndentEvidence.placed).length,
      edgeStatusCounts: statusCounts,
      nodeCountByLevel: byLevel,
    },
  };
}
