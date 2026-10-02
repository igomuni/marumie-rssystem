/**
 * DocumentHierarchy v2-experimental: v1（budget-request-document-hierarchy.ts。変更しない）に、独立した2つの実験オプションを足した比較用の実装。
 *  A) headerCollisionHandling = 'observational-filter': ページ上下端に反復して現れる page-header/footer 型の行を hierarchy placement から除外する（行は消さず、理由を残す）。
 *  B) singletonRootPlacement = 'lattice-supported': 支持が少ない根のクラスタを、document-local なインデント階段（lattice）の連続を根拠にだけ placed にする。
 * off/off は v1 と同値（テストで確認）。A と B は別の仮説で、variant を独立に比較する（実験計画: docs/data-pipeline-v2.md の DocumentHierarchy 節）。
 *
 * ## 原則（v1と同じ + 追加）
 * - 入力は SourceToken / TableGeometry / LogicalRow のみ。評価GT・コード値・省庁名・固定pt値・凍結層は使わない。
 * - 「見出し候補」でなくなった行も node として残す（hierarchyEligibility: 'excluded' + exclusionEvidence）。silent drop しない。
 * - 親が確定できなければ unresolved / level_gap。false parent を作らない > 正しい level > unresolved を減らす。
 *
 * ## A: header collision の GT-free evidence（単独では決めない。2種以上で除外）
 * - page_edge_row: その論理行が当該ページで最も上、または下端が最も下の行（割合の閾値は使わない）。
 * - vertical_repetition: 全ページの論理行のyMinを単一連結クラスタリング（許容差=TableGeometryの行クラスタリング許容差。新しい閾値は作らない）し、
 *   その行のクラスタが過半数のページに行を持つ（ページ数が3未満なら評価不能=証拠なし）。
 * - page_number_sequence: 各ページの最上/最下行の「数字だけのtoken」について（値−物理ページ番号）を数え、過半数のページで共通する差（頁番号のオフセット）が
 *   あるとき、その行が「値=物理ページ+オフセット」のtokenを持つ。ここで数値化するのは最上/最下行の数字だけのtokenで、金額は解釈しない。
 * 「過半数」は多数決という定義上の値で、特定文書に合わせた調整値ではない。
 *
 * ## B: lattice-supported placement
 * 支持が minClusterSupport 未満のクラスタ C を、次の全てを満たすときだけ placed にする: ① C のxが全ての placed クラスタより左（根側）、
 * ② 右隣の placed クラスタ R0 から始まる、隣接差が互いに許容差（v1の clusterGap）以内の placed クラスタの run が3つ以上、
 * ③ C と R0 の差が run の隣接差の中央値と許容差以内（階段の1段分）。満たさなければ v1 と同じく unplaced。minClusterSupport を下げることはしない。
 */
import type {
  DocumentHierarchyEdgeCandidate,
  DocumentHierarchyNodeObservation,
  EdgeStatus,
  HierarchyOptions,
  HierarchyPageInput,
  HierarchyView,
  IndentClusterObservation,
  RowShape,
} from './budget-request-document-hierarchy';
import { DEFAULT_HIERARCHY_OPTIONS } from './budget-request-document-hierarchy';

export const DOCUMENT_HIERARCHY_V2_SCHEMA = 'budget-request-document-hierarchy-poc/v2-experimental';

export interface HierarchyV2ExperimentalOptions {
  headerCollisionHandling: 'off' | 'observational-filter';
  singletonRootPlacement: 'off' | 'lattice-supported';
}

export type HeaderEvidenceKind = 'page_edge_row' | 'vertical_repetition' | 'page_number_sequence';

export interface ExclusionEvidence {
  kind: HeaderEvidenceKind;
  detail: Record<string, number | boolean | string | null>;
}

export interface DocumentHierarchyNodeV2 extends DocumentHierarchyNodeObservation {
  hierarchyEligibility: 'candidate' | 'excluded';
  /** excluded のとき、除外に使った evidence（2種以上）。candidate のときは空 */
  exclusionEvidence: ExclusionEvidence[];
  /** 観測した header evidence（候補行ごとに全て記録。optionがoffのときは空） */
  headerEvidenceObserved: ExclusionEvidence[];
}

export interface IndentClusterV2 extends IndentClusterObservation {
  placementBasis: 'support' | 'lattice_supported' | 'unplaced';
  latticeEvidence?: { step: number; gapToRun: number; runClusterIndexes: number[]; tolerance: number };
}

export interface DocumentHierarchyV2Result {
  schema: typeof DOCUMENT_HIERARCHY_V2_SCHEMA;
  view: HierarchyView;
  options: HierarchyV2ExperimentalOptions;
  parameters: HierarchyOptions & {
    referenceFontSize: number;
    clusterGap: number;
    headerRowTolerance: number;
    pageNumberOffset: number | null;
    levelDefinition: 'rank of placed x-indent clusters (ascending xMin), 1-based; NOT a semantic type';
    inputLayers: ['SourceToken', 'TableGeometry', 'LogicalRow'];
  };
  pages: number[];
  nodes: DocumentHierarchyNodeV2[];
  edges: DocumentHierarchyEdgeCandidate[];
  indentClusters: IndentClusterV2[];
  diagnostics: {
    logicalRowCount: number;
    headingCandidateCount: number;
    eligibleCount: number;
    excludedCount: number;
    placedCount: number;
    unplacedCount: number;
    latticePlacedClusterCount: number;
    edgeStatusCounts: Record<EdgeStatus, number>;
    nodeCountByLevel: Record<string, number>;
  };
}

export const V1_EQUIVALENT_OPTIONS: HierarchyV2ExperimentalOptions = { headerCollisionHandling: 'off', singletonRootPlacement: 'off' };

const REQUEST_CODE = /^\d{2}[-‐-―−]\d{2}$/;
const CODE3 = /^\d{3}$/;
const REQUEST_NO = /^\d{1,3}$/;
const PAGE_REF = /^\d{4}$/;
const DIGITS_ONLY = /^\d+$/;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function headingShapeOf(texts: string[]): { shape: RowShape; keyPos: number } | null {
  if (texts.length >= 2 && REQUEST_NO.test(texts[0]) && REQUEST_CODE.test(texts[1])) return { shape: 'request_no_then_code', keyPos: 1 };
  if (texts.length >= 2 && CODE3.test(texts[0])) return { shape: 'code3_then_text', keyPos: 0 };
  return null;
}

interface Candidate {
  pageIndex: number;
  rowOrdinal: number;
  rowIndex: number;
  node: DocumentHierarchyNodeV2;
}

export function observeDocumentHierarchyV2(
  view: HierarchyView,
  pages: HierarchyPageInput[],
  options: HierarchyV2ExperimentalOptions,
  v1Options: HierarchyOptions = DEFAULT_HIERARCHY_OPTIONS,
): DocumentHierarchyV2Result {
  const ordered = [...pages].sort((a, b) => a.meta.number - b.meta.number);
  const referenceFontSize = median(ordered.map(p => p.geometry.parameters.rowClustering.referenceFontSize));
  const clusterGap = round3(v1Options.indentClusterGapFactor * referenceFontSize);
  const headerRowTolerance = round3(median(ordered.map(p => p.geometry.parameters.rowClustering.tolerance)));

  // 見出し候補（v1と同じ形）
  const candidates: Candidate[] = [];
  let ordinal = 0;
  let logicalRowCount = 0;
  ordered.forEach((p, pageIndex) => {
    for (const row of p.logical.logicalRowCandidates) {
      const toks = row.visualTokenIndexes.map(i => p.tokens[i]).filter(t => t.rawText.trim() !== '');
      const texts = toks.map(t => t.rawText.trim());
      const found = headingShapeOf(texts);
      if (found) {
        const key = toks[found.keyPos];
        const refToken = toks.filter(t => PAGE_REF.test(t.rawText.trim())).sort((a, b) => b.bbox.xMax - a.bbox.xMax)[0];
        candidates.push({
          pageIndex,
          rowOrdinal: ordinal,
          rowIndex: row.logicalRowIndex,
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
            hierarchyEligibility: 'candidate',
            exclusionEvidence: [],
            headerEvidenceObserved: [],
          },
        });
      }
      ordinal++;
      logicalRowCount++;
    }
  });

  // A: header collision evidence
  let pageNumberOffset: number | null = null;
  if (options.headerCollisionHandling === 'observational-filter') {
    const nPages = ordered.length;
    const enough = nPages >= 3;
    // 各ページの最上/最下の論理行
    const edge = ordered.map(p => {
      const rows = p.logical.logicalRowCandidates;
      let top = -1;
      let bottom = -1;
      rows.forEach((r, i) => {
        if (top < 0 || r.bbox.yMin < rows[top].bbox.yMin) top = i;
        if (bottom < 0 || r.bbox.yMax > rows[bottom].bbox.yMax) bottom = i;
      });
      return { top, bottom };
    });
    // 全ページの論理行のyMinの単一連結クラスタ → クラスタごとの「行を持つページ数」
    const ys: { y: number; pageIndex: number; rowIndex: number }[] = [];
    ordered.forEach((p, pageIndex) => p.logical.logicalRowCandidates.forEach((r, rowIndex) => ys.push({ y: r.bbox.yMin, pageIndex, rowIndex })));
    ys.sort((a, b) => a.y - b.y);
    const clusterOf = new Map<string, number>();
    const clusterPages: Set<number>[] = [];
    let last = Number.NEGATIVE_INFINITY;
    for (const e of ys) {
      if (clusterPages.length === 0 || e.y - last > headerRowTolerance) clusterPages.push(new Set());
      clusterPages[clusterPages.length - 1].add(e.pageIndex);
      clusterOf.set(`${e.pageIndex}:${e.rowIndex}`, clusterPages.length - 1);
      last = e.y;
    }
    // 頁番号のオフセット: 最上/最下行の数字だけのtokenの（値−物理ページ）の多数決
    const offsetPages = new Map<number, number>();
    ordered.forEach((p, pageIndex) => {
      const seen = new Set<number>();
      for (const ri of [edge[pageIndex].top, edge[pageIndex].bottom]) {
        if (ri < 0) continue;
        for (const ti of p.logical.logicalRowCandidates[ri].rawTokenIndexes) {
          const t = p.tokens[ti].rawText.trim();
          if (DIGITS_ONLY.test(t)) seen.add(Number(t) - p.meta.number);
        }
      }
      for (const o of seen) offsetPages.set(o, (offsetPages.get(o) ?? 0) + 1);
    });
    if (enough) {
      const best = [...offsetPages.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best && best[1] > nPages / 2) pageNumberOffset = best[0];
    }
    for (const c of candidates) {
      const p = ordered[c.pageIndex];
      const row = p.logical.logicalRowCandidates[c.rowIndex];
      const observed: ExclusionEvidence[] = [];
      if (edge[c.pageIndex].top === c.rowIndex) observed.push({ kind: 'page_edge_row', detail: { edge: 'top' } });
      else if (edge[c.pageIndex].bottom === c.rowIndex) observed.push({ kind: 'page_edge_row', detail: { edge: 'bottom' } });
      if (enough) {
        const pagesInBand = clusterPages[clusterOf.get(`${c.pageIndex}:${c.rowIndex}`) as number].size;
        if (pagesInBand > nPages / 2) observed.push({ kind: 'vertical_repetition', detail: { pagesWithRowInBand: pagesInBand, pages: nPages } });
      }
      if (pageNumberOffset !== null) {
        const hit = row.rawTokenIndexes.map(ti => p.tokens[ti].rawText.trim()).find(t => DIGITS_ONLY.test(t) && Number(t) - p.meta.number === pageNumberOffset);
        if (hit !== undefined) observed.push({ kind: 'page_number_sequence', detail: { offset: pageNumberOffset, token: hit } });
      }
      c.node.headerEvidenceObserved = observed;
      if (observed.length >= 2) {
        c.node.hierarchyEligibility = 'excluded';
        c.node.exclusionEvidence = observed;
      }
    }
  }

  const eligible = candidates.filter(c => c.node.hierarchyEligibility === 'candidate');

  // xインデントの階段（eligibleだけでクラスタリング）
  const xs = eligible.map(c => c.node.xIndentEvidence.keyTokenXMin).sort((a, b) => a - b);
  const groups: { xs: number[] }[] = [];
  for (const x of xs) {
    const g = groups[groups.length - 1];
    if (g && x - g.xs[g.xs.length - 1] <= clusterGap) g.xs.push(x);
    else groups.push({ xs: [x] });
  }
  const placedBySupport = new Set<number>(groups.map((g, i) => (g.xs.length >= v1Options.minClusterSupport ? i : -1)).filter(i => i >= 0));
  const lattice = new Map<number, NonNullable<IndentClusterV2['latticeEvidence']>>();
  if (options.singletonRootPlacement === 'lattice-supported') {
    for (;;) {
      const placed = [...placedBySupport, ...lattice.keys()].sort((a, b) => a - b);
      if (placed.length === 0) break;
      const leftmost = placed[0];
      // 根側: 全てのplacedクラスタより左にある、最も近い未placedクラスタ
      const c = [...groups.keys()].filter(i => i < leftmost && !placed.includes(i)).pop();
      if (c === undefined) break;
      // 右隣から始まる規則的なplacedクラスタのrun（隣接差が許容差以内で揃う）
      const gaps: number[] = [];
      const run = [leftmost];
      for (let k = 1; k < placed.length; k++) {
        const gap = groups[placed[k]].xs[0] - groups[placed[k - 1]].xs[0];
        if (gaps.length > 0 && Math.abs(gap - median(gaps)) > clusterGap) break;
        gaps.push(gap);
        run.push(placed[k]);
      }
      if (run.length < 3) break;
      const step = median(gaps);
      const gapToRun = groups[leftmost].xs[0] - groups[c].xs[0];
      if (Math.abs(gapToRun - step) > clusterGap) break;
      lattice.set(c, { step: round3(step), gapToRun: round3(gapToRun), runClusterIndexes: run, tolerance: clusterGap });
    }
  }
  const placedAll = new Set<number>([...placedBySupport, ...lattice.keys()]);
  const placedSorted = [...placedAll].sort((a, b) => a - b);
  const indentClusters: IndentClusterV2[] = groups.map((g, clusterIndex) => ({
    clusterIndex,
    xMin: round3(g.xs[0]),
    xMax: round3(g.xs[g.xs.length - 1]),
    memberCount: g.xs.length,
    level: placedAll.has(clusterIndex) ? placedSorted.indexOf(clusterIndex) + 1 : null,
    placementBasis: placedBySupport.has(clusterIndex) ? 'support' : lattice.has(clusterIndex) ? 'lattice_supported' : 'unplaced',
    ...(lattice.has(clusterIndex) ? { latticeEvidence: lattice.get(clusterIndex) } : {}),
  }));
  for (const c of eligible) {
    const x = c.node.xIndentEvidence.keyTokenXMin;
    const cl = indentClusters.find(k => x >= k.xMin && x <= k.xMax);
    if (cl) c.node.xIndentEvidence = { keyTokenXMin: x, clusterIndex: cl.clusterIndex, level: cl.level, placed: cl.level !== null };
  }

  // 文書順のstack（placedな eligible nodeだけ）
  const edges: DocumentHierarchyEdgeCandidate[] = [];
  const stack: Candidate[] = [];
  const level = (c: Candidate): number => c.node.xIndentEvidence.level as number;
  for (const c of eligible) {
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
  for (const c of eligible) {
    const k = c.node.xIndentEvidence.level === null ? 'unplaced' : String(c.node.xIndentEvidence.level);
    byLevel[k] = (byLevel[k] ?? 0) + 1;
  }
  return {
    schema: DOCUMENT_HIERARCHY_V2_SCHEMA,
    view,
    options,
    parameters: {
      ...v1Options,
      referenceFontSize: round3(referenceFontSize),
      clusterGap,
      headerRowTolerance,
      pageNumberOffset,
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
      eligibleCount: eligible.length,
      excludedCount: candidates.length - eligible.length,
      placedCount: eligible.filter(c => c.node.xIndentEvidence.placed).length,
      unplacedCount: eligible.filter(c => !c.node.xIndentEvidence.placed).length,
      latticePlacedClusterCount: lattice.size,
      edgeStatusCounts: statusCounts,
      nodeCountByLevel: byLevel,
    },
  };
}
