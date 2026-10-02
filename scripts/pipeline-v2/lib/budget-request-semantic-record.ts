/**
 * SemanticRecordCandidate PoC: 前段までの geometry / observation 層（SourceToken・TableGeometry・LogicalRowResolver・
 * SpatialRegionDetector・RegionRelationResolver）の上に、初めて semantic interpretation の「候補」層を載せる。
 * 最終的な LogicalDetailRecord ではない。unknown > guess / ambiguous > forced assignment / observed text > reconstructed text。
 *
 * ## 方針
 * - observation と interpretation を分離する: 各観測は `evidence`（見たtoken index・rawText）と `interpretation`（解釈の種別）を別に持つ。
 *   SourceToken.rawText は変更しない。この層では rawText の内容を候補判定に使う（前段と違い、文字を変えれば結果が変わるのは正常）が、
 *   geometry層の結果は変更しない。
 * - 起点は LogicalRowCandidate。主要明細行候補（detail_record_candidate）の anchor は、「コードらしい文字列」だけでは確定せず、
 *   text pattern + geometry evidence（行の左端の位置・同一segment内で後続する文字・左端の繰り返し配置）を組み合わせる。
 * - canonical value を作らない: 金額は `234,` `599,` `916` のようなtoken列（rawTokenIndexes=content stream順 / visualTokenIndexes=x順）を保持し、
 *   数値へparseしない。`previewText` は表示確認用の non-authoritative な値で、source truth ではない。
 * - 符号は独立した視覚証拠: 金額groupの直前に実際の `△` `▲` `-` のSourceTokenがある場合のみ signObservation、無ければ null。
 *   空欄を0にしない・差額を計算しない・値の大小から符号を推測しない・見えていない文字を補わない。
 * - 金額groupが3つ見えた行だけ previous/request/difference の「候補」を順序で付ける（interpretationに根拠 `by_column_order` を明記）。
 *   3つでない行は groups を保持したまま ambiguity（`amount_group_count_not_3`）にし、無理に割り当てない。
 * - relatedStructures は RegionRelation の関連候補への参照。membership（rowのtokenがregionに属する）と proximity（近接のみ）を
 *   別のevidenceとして保持し、stable/unstable relation のrefも別々に残す。**stable relationだけを使わない**（unstableでも捨てない。
 *   statusは ambiguous にする）。semantic type（request_summary 等）は付けない。nearest winner も作らない。
 * - 文字内容を、弱い空間関係を強制的に確定する救済に使わない（「備考」だから attach 等はしない）。
 * - 取りこぼしは捨てず `unassignedSemanticObservations` に残す（金額らしいtoken群・regexだけ一致したコード等）。
 */
import type { LogicalRowCandidate, LogicalRowResult } from './budget-request-logical-row';
import type { RegionRelationCandidate, RegionRelationResult } from './budget-request-region-relation';
import type { SourceToken, SourceTokenBBox } from './budget-request-source-token';
import type { SpatialRegionResult } from './budget-request-spatial-region';
import type { TableGeometryResult } from './budget-request-table-geometry';

export const SEMANTIC_RECORD_SCHEMA = 'budget-request-semantic-record-poc/v1';

export interface SemanticRecordOptions {
  /** 金額chunkを同じgroupにまとめる最大のx-gap = factor × fontSize中央値 */
  amountChunkGapFactor: number;
  /** 左端の繰り返し配置とみなす幅 = factor × fontSize中央値 */
  alignmentToleranceFactor: number;
}

export const DEFAULT_SEMANTIC_RECORD_OPTIONS: SemanticRecordOptions = { amountChunkGapFactor: 1.5, alignmentToleranceFactor: 0.25 };

/** text patternの定義（rawTextの内容を見る。意味の確定ではなく候補判定の材料） */
export const CODE_PATTERN = /^\d{2,5}(?:-\d{1,5})*$/;
export const AMOUNT_CHUNK_PATTERN = /^\d[\d,]*$/;
export const SIGN_TOKENS = ['△', '▲', '-'];
const CJK_PATTERN = /[぀-ヿ㐀-鿿]/;

export interface FieldObservation {
  /** content stream順（index昇順） */
  tokenIndexes: number[];
  /** 同じtokenのvisual-x order */
  visualTokenIndexes: number[];
  /** tokenIndexes順のrawText（改変しない） */
  rawTexts: string[];
  bbox: SourceTokenBBox;
  interpretation: string;
  /** 表示確認用。non-authoritative（source truthではない・parseしない） */
  previewText?: string;
  physicalRowIndexes?: number[];
  logicalRowIndexes?: number[];
}

export interface SignObservation {
  tokenIndex: number;
  rawText: string;
  /** sign tokenの右端から金額groupの左端までのx距離（signは別列に置かれることがあり、距離が大きいことがある） */
  gapToGroup: number;
}

export interface AmountGroupObservation extends FieldObservation {
  /** 直前に実際のsign tokenが見えたときだけ。見えなければnull（推測しない） */
  signObservation: SignObservation | null;
}

export type SemanticEvidence =
  | { kind: 'code_pattern'; tokenIndexes: number[]; rawTexts: string[]; codeShape: string }
  | { kind: 'row_position'; value: 'first_token_of_row' | 'first_token_of_second_segment_after_single_numeric_leading_token' }
  | { kind: 'matter_text_follows_in_segment'; tokenIndexes: number[] }
  | { kind: 'code_left_edge_alignment'; alignedCandidateCount: number; toleranceFactor: number }
  | { kind: 'amount_groups'; groupCount: number; gapFactor: number };

export interface SemanticAmbiguity {
  kind: 'amount_group_count_not_3' | 'sign_attachment_distance_large' | 'matter_boundary_possible_continuation' | 'related_structure_relation_unstable' | 'amount_like_tokens_beyond_text_boundary' | 'logical_row_ambiguous';
  detail: Record<string, unknown>;
}

export interface RelatedStructureCandidate {
  regionIndex: number;
  relationIndexes: number[];
  /** membership: logical rowのtokenがregionに属する / proximity: 近接のみ / mixed: 両方 */
  evidenceKind: 'membership' | 'proximity' | 'mixed';
  /** このregionがfield observationのtokenを含む（記録自身の位置） */
  containsFieldObservations: boolean;
  stableRelationIndexes: number[];
  unstableRelationIndexes: number[];
  status: 'candidate' | 'ambiguous';
  reasons: string[];
}

export interface SemanticRecordCandidate {
  candidateIndex: number;
  /** 起点のLogicalRowCandidate.logicalRowIndex */
  anchorLogicalRowIndexes: number[];
  observations: {
    code: FieldObservation;
    matter: FieldObservation;
    previousBudget?: AmountGroupObservation;
    requestBudget?: AmountGroupObservation;
    difference?: AmountGroupObservation;
  };
  /** 金額groupの観測（件数が3でなくても保持する）。content stream順でなくvisual-x順（左から） */
  amountGroups: AmountGroupObservation[];
  relatedStructures: RelatedStructureCandidate[];
  status: 'candidate' | 'ambiguous';
  evidence: SemanticEvidence[];
  ambiguities: SemanticAmbiguity[];
}

export interface UnassignedSemanticObservation {
  kind: 'amount_group_candidate' | 'code_pattern_candidate' | 'sign_token';
  tokenIndexes: number[];
  rawTexts: string[];
  physicalRowIndex: number;
  logicalRowIndex: number;
  reason: string;
}

export interface SemanticRecordResult {
  parameters: SemanticRecordOptions & {
    codePattern: string;
    amountChunkPattern: string;
    signTokens: string[];
    anchorRule: 'code-like token (text pattern) that is the first token of the first segment of the first physical row (or of the second segment when the first segment is a single numeric token) AND is followed by a CJK-containing matter token in the same segment';
    amountRegionRule: 'amount-like/sign tokens right of the matter in the anchor physical row, up to the first token that is neither (anything else ends the region); amount-like tokens beyond are kept as unassigned';
    columnOrderRule: 'only when exactly 3 amount groups are observed: previous/request/difference candidates by left-to-right order';
    previewTextIsAuthoritative: false;
  };
  semanticRecordCandidates: SemanticRecordCandidate[];
  unassignedSemanticObservations: UnassignedSemanticObservation[];
  diagnostics: {
    counts: {
      candidates: number;
      ambiguousCandidates: number;
      codeObservations: number;
      matterObservations: number;
      amountGroupObservations: number;
      signObservations: number;
      unassignedSemanticObservations: number;
      membershipEvidence: number;
      proximityEvidence: number;
      stableRelationRefs: number;
      unstableRelationRefs: number;
    };
    codeShapes: Record<string, number>;
    ambiguityKinds: Record<string, number>;
    amountGroupCountDistribution: Record<string, number>;
    /** コードらしい文字列のうち anchor にならなかったもの（regexだけでは確定しないことの観測） */
    regexOnlyCodeMatches: { tokenIndex: number; rawText: string; reason: string }[];
    /** 同じ順序番号の金額groupのxMax（右端）がどれだけ繰り返すか（省庁・行を横断した再利用の目安） */
    amountColumnReuse: { ordinal: number; groupCount: number; distinctRightEdges: number }[];
    ambiguousLogicalRowsAffectingCandidates: number;
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const isBlank = (t: SourceToken): boolean => t.rawText.trim() === '';
const isAmountLike = (t: SourceToken): boolean => AMOUNT_CHUNK_PATTERN.test(t.rawText);
const isSign = (t: SourceToken): boolean => SIGN_TOKENS.includes(t.rawText);
const hasCjk = (t: SourceToken): boolean => CJK_PATTERN.test(t.rawText);
export const codeShapeOf = (text: string): string => text.replace(/\d/g, 'D');

function unionBBox(tokens: SourceToken[], idx: number[]): SourceTokenBBox {
  const b = idx.map(i => tokens[i].bbox);
  return {
    xMin: round3(Math.min(...b.map(x => x.xMin))),
    yMin: round3(Math.min(...b.map(x => x.yMin))),
    xMax: round3(Math.max(...b.map(x => x.xMax))),
    yMax: round3(Math.max(...b.map(x => x.yMax))),
  };
}

function observation(
  tokens: SourceToken[],
  visualOrder: number[],
  interpretation: string,
  extra: { physicalRowIndexes?: number[]; logicalRowIndexes?: number[]; preview?: boolean } = {},
): FieldObservation {
  const raw = [...visualOrder].sort((a, b) => a - b);
  return {
    tokenIndexes: raw,
    visualTokenIndexes: visualOrder,
    rawTexts: raw.map(i => tokens[i].rawText),
    bbox: unionBBox(tokens, raw),
    interpretation,
    ...(extra.preview ? { previewText: visualOrder.map(i => tokens[i].rawText).join('') } : {}),
    ...(extra.physicalRowIndexes ? { physicalRowIndexes: extra.physicalRowIndexes } : {}),
    ...(extra.logicalRowIndexes ? { logicalRowIndexes: extra.logicalRowIndexes } : {}),
  };
}

/** 金額群の検出（同一physical row内、matterの右）。sign tokenは直前に見えたときだけgroupのsignObservationにする */
export function detectAmountGroups(
  tokens: SourceToken[],
  rowVisualTokens: number[],
  afterX: number,
  gapLimit: number,
): { groups: AmountGroupObservation[]; orphanSigns: number[]; beyondBoundary: number[] } {
  const rightOf = rowVisualTokens.filter(i => !isBlank(tokens[i]) && tokens[i].bbox.xMin >= afterX - 1e-6);
  const region: number[] = [];
  let boundaryAt = rightOf.length;
  for (let k = 0; k < rightOf.length; k++) {
    const t = tokens[rightOf[k]];
    if (isAmountLike(t) || isSign(t)) region.push(rightOf[k]);
    else {
      boundaryAt = k;
      break;
    }
  }
  const beyondBoundary = rightOf.slice(boundaryAt).filter(i => isAmountLike(tokens[i]) || isSign(tokens[i]));

  const groups: AmountGroupObservation[] = [];
  const orphanSigns: number[] = [];
  let cur: number[] = [];
  let curSign: SignObservation | null = null;
  let pending: { index: number; xMax: number } | null = null;
  let prevXMax = -Infinity;
  const flush = () => {
    if (cur.length > 0) groups.push({ ...observation(tokens, cur, 'amount_group_candidate', { preview: true }), signObservation: curSign });
    cur = [];
    curSign = null;
  };
  for (const i of region) {
    const t = tokens[i];
    if (isSign(t)) {
      flush();
      if (pending) orphanSigns.push(pending.index); // 直後に金額chunkが来なかったsign
      pending = { index: i, xMax: t.bbox.xMax };
      continue;
    }
    if (cur.length > 0 && t.bbox.xMin - prevXMax > gapLimit) flush();
    if (cur.length === 0 && pending) {
      // sign tokenは、金額領域の中で直後の金額chunkとの間に他のtokenが無い場合に、そのgroupのsignObservationになる
      // （signは別列に置かれることがあるため距離は問わず、距離を gapToGroup として残す。推測はしない）
      curSign = { tokenIndex: pending.index, rawText: tokens[pending.index].rawText, gapToGroup: round3(t.bbox.xMin - pending.xMax) };
      pending = null;
    }
    cur.push(i);
    prevXMax = Math.max(prevXMax, t.bbox.xMax);
  }
  flush();
  if (pending) orphanSigns.push((pending as { index: number }).index);
  return { groups, orphanSigns, beyondBoundary };
}

export function detectSemanticRecords(
  tokens: SourceToken[],
  geometry: TableGeometryResult,
  logical: LogicalRowResult,
  spatial: SpatialRegionResult,
  relations: RegionRelationResult,
  options: SemanticRecordOptions = DEFAULT_SEMANTIC_RECORD_OPTIONS,
): SemanticRecordResult {
  const ref = geometry.parameters.rowClustering.referenceFontSize;
  const gapLimit = options.amountChunkGapFactor * ref;
  const alignTol = options.alignmentToleranceFactor * ref;
  const physicalRows = new Map(geometry.physicalRows.map(r => [r.rowIndex, r]));
  const rows = logical.logicalRowCandidates;

  interface Draft {
    row: LogicalRowCandidate;
    codeIdx: number;
    matterVisual: number[];
    matterRows: number[];
    evidence: SemanticEvidence[];
    ambiguities: SemanticAmbiguity[];
    position: 'first_token_of_row' | 'first_token_of_second_segment_after_single_numeric_leading_token';
    segmentTokens: number[];
  }
  const drafts: Draft[] = [];
  const regexOnly: SemanticRecordResult['diagnostics']['regexOnlyCodeMatches'] = [];
  const anchorTokenSet = new Set<number>();

  for (const row of rows) {
    const firstPhys = row.physicalRowIndexes[0];
    const segs = row.segments.filter(s => s.physicalRowIndex === firstPhys);
    const nonBlank = (seg: (typeof segs)[number] | undefined) => seg?.visualTokenIndexes.filter(i => !isBlank(tokens[i])) ?? [];
    /** segmentの先頭tokenがコードらしく、同じsegmentで後続するtokenにCJKを含むmatterがあるとき anchor */
    const tryAnchor = (seg: (typeof segs)[number] | undefined): { first: number; matterTokens: number[] } | { first?: number; reason: string } => {
      const visual = nonBlank(seg);
      const first = visual[0];
      if (first === undefined || !CODE_PATTERN.test(tokens[first].rawText)) return { reason: 'segment does not start with a code-like token' };
      const matterTokens: number[] = [];
      for (const i of visual.slice(1)) {
        if (isAmountLike(tokens[i]) || isSign(tokens[i])) break;
        matterTokens.push(i);
      }
      if (!matterTokens.some(i => hasCjk(tokens[i]))) return { first, reason: 'code pattern at segment start but no matter text follows in the segment' };
      return { first, matterTokens };
    };
    let position: Draft['position'] = 'first_token_of_row';
    let anchor = tryAnchor(segs[0]);
    let seg = segs[0];
    if (!('matterTokens' in anchor) && segs.length > 1) {
      const lead = nonBlank(segs[0]);
      if (lead.length === 1 && /^\d{1,5}$/.test(tokens[lead[0]].rawText)) {
        const second = tryAnchor(segs[1]);
        if ('matterTokens' in second) {
          anchor = second;
          seg = segs[1];
          position = 'first_token_of_second_segment_after_single_numeric_leading_token';
        }
      }
    }
    if (!('matterTokens' in anchor)) {
      if (anchor.first !== undefined) regexOnly.push({ tokenIndex: anchor.first, rawText: tokens[anchor.first].rawText, reason: anchor.reason });
      continue;
    }
    const { first, matterTokens } = anchor;
    const visual = nonBlank(seg);
    anchorTokenSet.add(first);
    // 継続行: 開始位置がmatterの開始位置と揃うsegmentのtokenをmatterへ（LogicalRowResolverのcontinuationが前提）
    const matterStartX = tokens[matterTokens[0]].bbox.xMin;
    const matterVisual = [...matterTokens];
    const matterRows = [firstPhys];
    for (const p of row.physicalRowIndexes.slice(1)) {
      for (const s of row.segments.filter(x => x.physicalRowIndex === p)) {
        if (Math.abs(s.bbox.xMin - matterStartX) <= alignTol) {
          matterVisual.push(...s.visualTokenIndexes.filter(i => !isBlank(tokens[i])));
          if (!matterRows.includes(p)) matterRows.push(p);
        }
      }
    }
    drafts.push({
      row,
      codeIdx: first,
      matterVisual,
      matterRows,
      evidence: [
        { kind: 'code_pattern', tokenIndexes: [first], rawTexts: [tokens[first].rawText], codeShape: codeShapeOf(tokens[first].rawText) },
        { kind: 'row_position', value: position },
        { kind: 'matter_text_follows_in_segment', tokenIndexes: matterTokens },
      ],
      ambiguities: [],
      position,
      segmentTokens: visual,
    });
  }

  // 左端の繰り返し配置（anchor同士。ColumnBandは使わない）
  const codeX = drafts.map(d => tokens[d.codeIdx].bbox.xMin);
  const candidates: SemanticRecordCandidate[] = drafts.map((d, candidateIndex) => {
    const x = tokens[d.codeIdx].bbox.xMin;
    const aligned = codeX.filter((o, i) => i !== candidateIndex && Math.abs(o - x) <= alignTol).length;
    d.evidence.push({ kind: 'code_left_edge_alignment', alignedCandidateCount: aligned, toleranceFactor: options.alignmentToleranceFactor });

    const firstPhys = d.row.physicalRowIndexes[0];
    const rowVisual = physicalRows.get(firstPhys)!.visualTokenIndexes;
    const matterLastX = Math.max(...d.matterVisual.filter(i => physicalRows.get(firstPhys)!.rawTokenIndexes.includes(i)).map(i => tokens[i].bbox.xMax));
    const { groups, beyondBoundary } = detectAmountGroups(tokens, rowVisual, matterLastX, gapLimit);
    d.evidence.push({ kind: 'amount_groups', groupCount: groups.length, gapFactor: options.amountChunkGapFactor });
    for (const g of groups) {
      if (g.signObservation && g.signObservation.gapToGroup > gapLimit) {
        d.ambiguities.push({ kind: 'sign_attachment_distance_large', detail: { signTokenIndex: g.signObservation.tokenIndex, groupTokenIndexes: g.tokenIndexes, gapToGroup: g.signObservation.gapToGroup, gapLimit: round3(gapLimit) } });
      }
    }
    if (groups.length !== 3) d.ambiguities.push({ kind: 'amount_group_count_not_3', detail: { groupCount: groups.length, groupTokenIndexes: groups.map(g => g.tokenIndexes) } });
    if (beyondBoundary.length > 0) d.ambiguities.push({ kind: 'amount_like_tokens_beyond_text_boundary', detail: { tokenIndexes: beyondBoundary } });
    if (d.row.resolution.kind === 'ambiguous') d.ambiguities.push({ kind: 'logical_row_ambiguous', detail: { logicalRowIndex: d.row.logicalRowIndex, reason: d.row.resolution.evidence.reason } });
    const nextRow = rows.find(r => r.logicalRowIndex === d.row.logicalRowIndex + 1);
    if (nextRow && nextRow.resolution.kind === 'ambiguous' && nextRow.resolution.evidence.possibleContinuationOfLogicalRow === d.row.logicalRowIndex) {
      d.ambiguities.push({ kind: 'matter_boundary_possible_continuation', detail: { alternativeLogicalRowIndex: nextRow.logicalRowIndex, physicalRowIndexes: nextRow.physicalRowIndexes } });
    }

    const fieldTokens = new Set<number>([d.codeIdx, ...d.matterVisual, ...groups.flatMap(g => g.tokenIndexes), ...groups.flatMap(g => (g.signObservation ? [g.signObservation.tokenIndex] : []))]);

    // 関連構造: logical row → region のrelation。membership/proximityを分け、stable/unstableのrefも別々に保持する
    const rels = relations.relations.filter(r => r.source.kind === 'logical_row' && r.source.logicalRowIndex === d.row.logicalRowIndex && r.target.kind === 'spatial_region');
    const byRegion = new Map<number, RegionRelationCandidate[]>();
    for (const r of rels) byRegion.set((r.target as { regionIndex: number }).regionIndex, [...(byRegion.get((r.target as { regionIndex: number }).regionIndex) ?? []), r]);
    const relatedStructures: RelatedStructureCandidate[] = [...byRegion.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([regionIndex, rs]) => {
        const membership = rs.some(r => r.evidence.some(e => e.kind === 'row_tokens_in_region'));
        const proximity = rs.some(r => !r.evidence.some(e => e.kind === 'row_tokens_in_region'));
        const region = spatial.regions.find(x => x.regionIndex === regionIndex)!;
        const reasons = [...new Set(rs.flatMap(r => r.stability.reasons))];
        return {
          regionIndex,
          relationIndexes: rs.map(r => r.relationIndex),
          evidenceKind: membership && proximity ? 'mixed' : membership ? 'membership' : 'proximity',
          containsFieldObservations: region.tokenIndexes.some(i => fieldTokens.has(i)),
          stableRelationIndexes: rs.filter(r => r.stability.stable).map(r => r.relationIndex),
          unstableRelationIndexes: rs.filter(r => !r.stability.stable).map(r => r.relationIndex),
          status: reasons.length === 0 ? 'candidate' : 'ambiguous',
          reasons,
        } as RelatedStructureCandidate;
      });
    if (relatedStructures.some(r => r.unstableRelationIndexes.length > 0)) {
      d.ambiguities.push({ kind: 'related_structure_relation_unstable', detail: { regionIndexes: relatedStructures.filter(r => r.unstableRelationIndexes.length > 0).map(r => r.regionIndex) } });
    }

    const labels = ['previousBudget', 'requestBudget', 'difference'] as const;
    const interp = ['previous_budget_candidate_by_column_order', 'request_budget_candidate_by_column_order', 'difference_candidate_by_column_order'];
    const named: Partial<Record<(typeof labels)[number], AmountGroupObservation>> = {};
    if (groups.length === 3) groups.forEach((g, i) => (named[labels[i]] = { ...g, interpretation: interp[i] }));

    return {
      candidateIndex,
      anchorLogicalRowIndexes: [d.row.logicalRowIndex],
      observations: {
        code: observation(tokens, [d.codeIdx], 'detail_code_candidate'),
        matter: observation(tokens, d.matterVisual, 'matter_candidate', { preview: true, physicalRowIndexes: d.matterRows, logicalRowIndexes: [d.row.logicalRowIndex] }),
        ...named,
      },
      amountGroups: groups,
      relatedStructures,
      status: d.ambiguities.length > 0 ? 'ambiguous' : 'candidate',
      evidence: d.evidence,
      ambiguities: d.ambiguities,
    };
  });

  // 取りこぼし（捨てない）: anchorにならなかった金額らしいtoken群・regexだけ一致したコード・sign
  const assigned = new Set<number>();
  for (const c of candidates) {
    for (const o of [c.observations.code, c.observations.matter]) o.tokenIndexes.forEach(i => assigned.add(i));
    for (const g of c.amountGroups) {
      g.tokenIndexes.forEach(i => assigned.add(i));
      if (g.signObservation) assigned.add(g.signObservation.tokenIndex);
    }
  }
  const unassigned: UnassignedSemanticObservation[] = [];
  for (const row of rows) {
    for (const p of row.physicalRowIndexes) {
      const pr = physicalRows.get(p)!;
      const cand = pr.visualTokenIndexes.filter(i => !assigned.has(i) && !isBlank(tokens[i]));
      // 連続するamount-like/signをgroupにする
      let cur: number[] = [];
      let prevX = -Infinity;
      const flush = (reason: string) => {
        if (cur.length > 0) {
          const o = observation(tokens, cur, 'amount_group_candidate', { preview: true });
          unassigned.push({ kind: 'amount_group_candidate', tokenIndexes: o.tokenIndexes, rawTexts: o.rawTexts, physicalRowIndex: p, logicalRowIndex: row.logicalRowIndex, reason });
          cur = [];
        }
      };
      for (const i of cand) {
        const t = tokens[i];
        if (isSign(t)) {
          flush('amount-like tokens without a detail-code anchor in this row (not assigned to any candidate)');
          unassigned.push({ kind: 'sign_token', tokenIndexes: [i], rawTexts: [t.rawText], physicalRowIndex: p, logicalRowIndex: row.logicalRowIndex, reason: 'sign token not attached to a candidate amount group' });
          prevX = -Infinity;
        } else if (isAmountLike(t)) {
          if (cur.length > 0 && t.bbox.xMin - prevX > gapLimit) flush('amount-like tokens without a detail-code anchor in this row (not assigned to any candidate)');
          cur.push(i);
          prevX = Math.max(prevX, t.bbox.xMax);
        } else flush('amount-like tokens without a detail-code anchor in this row (not assigned to any candidate)');
      }
      flush('amount-like tokens without a detail-code anchor in this row (not assigned to any candidate)');
    }
  }
  for (const pr of geometry.physicalRows) {
    for (const i of pr.rawTokenIndexes) {
      if (CODE_PATTERN.test(tokens[i].rawText) && !anchorTokenSet.has(i) && !regexOnly.some(r => r.tokenIndex === i)) {
        regexOnly.push({ tokenIndex: i, rawText: tokens[i].rawText, reason: 'code pattern matched but the token is not the row-start token of an anchor (no geometry evidence)' });
      }
    }
  }

  const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const allRel = candidates.flatMap(c => c.relatedStructures);
  const ordinalRights = [0, 1, 2].map(o => candidates.filter(c => c.amountGroups.length === 3).map(c => c.amountGroups[o].bbox.xMax));
  const distinctWithin = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.filter((x, i) => i === 0 || x - s[i - 1] > alignTol).length;
  };
  return {
    parameters: {
      ...options,
      codePattern: CODE_PATTERN.source,
      amountChunkPattern: AMOUNT_CHUNK_PATTERN.source,
      signTokens: SIGN_TOKENS,
      anchorRule: 'code-like token (text pattern) that is the first token of the first segment of the first physical row (or of the second segment when the first segment is a single numeric token) AND is followed by a CJK-containing matter token in the same segment',
      amountRegionRule: 'amount-like/sign tokens right of the matter in the anchor physical row, up to the first token that is neither (anything else ends the region); amount-like tokens beyond are kept as unassigned',
      columnOrderRule: 'only when exactly 3 amount groups are observed: previous/request/difference candidates by left-to-right order',
      previewTextIsAuthoritative: false,
    },
    semanticRecordCandidates: candidates,
    unassignedSemanticObservations: unassigned,
    diagnostics: {
      counts: {
        candidates: candidates.length,
        ambiguousCandidates: candidates.filter(c => c.status === 'ambiguous').length,
        codeObservations: candidates.length,
        matterObservations: candidates.length,
        amountGroupObservations: candidates.reduce((n, c) => n + c.amountGroups.length, 0),
        signObservations: candidates.reduce((n, c) => n + c.amountGroups.filter(g => g.signObservation).length, 0),
        unassignedSemanticObservations: unassigned.length,
        membershipEvidence: allRel.filter(r => r.evidenceKind !== 'proximity').length,
        proximityEvidence: allRel.filter(r => r.evidenceKind !== 'membership').length,
        stableRelationRefs: allRel.reduce((n, r) => n + r.stableRelationIndexes.length, 0),
        unstableRelationRefs: allRel.reduce((n, r) => n + r.unstableRelationIndexes.length, 0),
      },
      codeShapes: count(candidates.map(c => codeShapeOf(c.observations.code.rawTexts[0]))),
      ambiguityKinds: count(candidates.flatMap(c => c.ambiguities.map(a => a.kind))),
      amountGroupCountDistribution: count(candidates.map(c => String(c.amountGroups.length))),
      regexOnlyCodeMatches: regexOnly.sort((a, b) => a.tokenIndex - b.tokenIndex),
      amountColumnReuse: ordinalRights.map((xs, ordinal) => ({ ordinal, groupCount: xs.length, distinctRightEdges: xs.length === 0 ? 0 : distinctWithin(xs) })),
      ambiguousLogicalRowsAffectingCandidates: candidates.filter(c => c.ambiguities.some(a => a.kind === 'logical_row_ambiguous' || a.kind === 'matter_boundary_possible_continuation')).length,
    },
  };
}
