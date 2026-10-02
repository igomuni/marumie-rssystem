/**
 * FieldResolver v0 PoC（概算要求PDF）。「この field は、この source evidence に基づいて安全に確定してよいか」を判定する。
 * 値を埋めることではなく、根拠（provenance）を保ったまま、確定できないものを確定しないことが目的。
 *
 * ## 入力（この module が読んでよいもの）
 * SourceToken / TableGeometry / LogicalRowCandidate / DocumentHierarchy v2-B（凍結済みの観測結果。hierarchy 依存 field だけが読む）。
 * Golden・hierarchy GT・human-observations・SpatialRegion 以降の凍結層は読まない（静的テストで強制）。
 *
 * ## 判断の原則
 * - row-local の値は LogicalRowCandidate（anchor）と、そのページの列見出しtokenから観測した列の幾何だけで決める。
 * - 符号は実在する △/▲/- token が行と列の幾何で関連付けられるときだけ。値の大小・算術・備考の △ からは作らない。
 * - 空欄（blank）と明示的な "0" は厳密に分ける。blank を 0 にしない。差額は計算しない。単位換算しない。
 * - 列の右側（備考領域）・列の間にあるtokenは金額・符号の根拠にしない（auxiliary として参照だけ残す）。
 * - hierarchy 依存の field は Contract §9 の方針（Safe の edge だけ。risky / unresolved / level_gap は親を断定しない）。
 */
import type { PageMeta, SourceToken, SourceTokenBBox } from './budget-request-source-token';
import type { PhysicalRowCandidate, TableGeometryResult } from './budget-request-table-geometry';
import type { LogicalRowCandidate, LogicalRowResult } from './budget-request-logical-row';
import type { DocumentHierarchyNodeV2, DocumentHierarchyV2Result } from './budget-request-document-hierarchy-v2';

export const FIELD_RESOLVER_SCHEMA = 'budget-request-field-resolver-poc/v0';

export type FieldStatus = 'resolved' | 'blank' | 'unresolved' | 'ambiguous' | 'not_observed' | 'not_applicable';
export type AssociationClass = 'same_row' | 'continuation' | 'auxiliary' | 'unrelated';
export type AuxiliaryClass = 'remark_text' | 'breakdown_table' | 'history_table' | 'ruled_table' | 'inline_label_number';
export type SignRaw = '△' | '▲' | '-';

export interface FieldEvidence {
  page: number;
  sourceTokenRefs: number[];
  sourceRowRefs: { logicalRowIndex: number; physicalRowIndexes: number[] }[];
  rawText: string;
  associationClass: AssociationClass;
  bboxUnion: SourceTokenBBox;
  /** 金額セル・blank の根拠となった列帯（見出しtokenから観測したx範囲）。blank の再現に使う */
  cellBand?: { column: 'previousBudget' | 'requestedBudget' | 'difference'; xLeft: number; xRight: number; basis: string };
  /** 1つのtokenを文字位置の比例で分けた場合の注記 */
  geometryNote?: string;
}

export interface FieldResult<V> {
  status: FieldStatus;
  value: V | null;
  reasonCode: string | null;
  evidence: FieldEvidence | null;
  candidates?: FieldEvidence[];
}

export interface AmountValue {
  magnitudeRaw: string;
  magnitudeNumeric: number;
  explicitZero: boolean;
}

export type RecordKind = 'organization' | 'item' | 'request' | 'detail_line' | 'unclassified';

export interface RecordFieldResolution {
  anchor: { page: number; logicalRowIndex: number };
  /** anchor（LogicalRowCandidate）のbbox。レコードの位置の参照用（評価・可視化。値の根拠ではない） */
  anchorBBox: SourceTokenBBox;
  recordKind: RecordKind;
  recordKindBasis: string;
  rowLocal: {
    code: FieldResult<{ raw: string }>;
    name: FieldResult<{ raw: string; normalized: string }>;
    previousBudget: FieldResult<AmountValue>;
    requestedBudget: FieldResult<AmountValue>;
    difference: FieldResult<AmountValue>;
    previousBudgetSign: FieldResult<{ raw: SignRaw }>;
    requestedBudgetSign: FieldResult<{ raw: SignRaw }>;
    differenceSign: FieldResult<{ raw: SignRaw }>;
  };
  hierarchyDependent: {
    parentItemAssociation: FieldResult<{ parentNodeRef: string }>;
    parentOrganizationAssociation: FieldResult<{ parentNodeRef: string }>;
  };
  auxiliaryEvidenceRefs: { class: AuxiliaryClass; sourceTokenRefs: number[]; page: number }[];
  pageUnitLabel: FieldResult<{ raw: string }>;
}

export interface ColumnLayout {
  page: number;
  /** 見出しtokenを観測したページ（自ページか、引き継ぎ元） */
  headerPage: number;
  basis: 'page_header' | 'carried_forward_header_corroborated_by_page_column_bands';
  tolerance: number;
  previousBudget: [number, number];
  requestedBudget: [number, number];
  difference: [number, number];
  /** 各領域のx範囲（token中心がこの範囲にあるものをその領域に属するとみなす） */
  regions: { name: [number, number]; previousBudget: [number, number]; requestedBudget: [number, number]; gap: [number, number]; difference: [number, number]; right: [number, number] };
  headerTokenRefs: number[];
}

export interface FieldResolverPageInput {
  meta: PageMeta;
  tokens: SourceToken[];
  geometry: TableGeometryResult;
  logical: LogicalRowResult;
}

export interface FieldResolverInput {
  pages: FieldResolverPageInput[];
  /** DocumentHierarchy v2-B（凍結済み）の観測結果。無ければ hierarchy 依存 field は not_observed */
  hierarchy: DocumentHierarchyV2Result | null;
}

export interface FieldResolverResult {
  schema: typeof FIELD_RESOLVER_SCHEMA;
  parameters: {
    columnEvidence: string;
    toleranceDefinition: string;
    hierarchyPolicy: string;
    inputLayers: ['SourceToken', 'TableGeometry', 'LogicalRow', 'DocumentHierarchy v2-B (consumed, never re-inferred)'];
  };
  pageDiagnostics: { page: number; columnLayout: ColumnLayout | null; columnLayoutReason: string | null; recordCount: number }[];
  records: RecordFieldResolution[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const isBlank = (t: SourceToken): boolean => t.rawText.trim() === '';
const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function unionBBox(boxes: SourceTokenBBox[]): SourceTokenBBox {
  return {
    xMin: round3(Math.min(...boxes.map(b => b.xMin))),
    yMin: round3(Math.min(...boxes.map(b => b.yMin))),
    xMax: round3(Math.max(...boxes.map(b => b.xMax))),
    yMax: round3(Math.max(...boxes.map(b => b.yMax))),
  };
}

function absent<V>(status: FieldStatus, reasonCode: string, candidates?: FieldEvidence[]): FieldResult<V> {
  const r: FieldResult<V> = { status, value: null, reasonCode, evidence: null };
  if (candidates && candidates.length > 0) r.candidates = candidates;
  return r;
}

// ---------------------------------------------------------------------------------------------
// 列の観測（ページの見出しtokenから。x範囲は PDF の幾何であり、他ページ・Golden から借りない）
// ---------------------------------------------------------------------------------------------

const HEAD_PREV_CHARS = new Set([...'前年度予算額']);
const HEAD_DIFF_CHARS = new Set([...'対前年度比較増△減']);

/**
 * 列見出しtokenから列のx範囲を観測する。見出しは文字ごとのSourceToken（「前」「年」「度」…）と「概 算 要 求 額」の1tokenで出る。
 * 見出しはテーブルの先頭ページにしか印字されないことがあるので、見出しの無いページは {@link layoutForPage} で前方のページから引き継ぐ。
 */
export function observeColumnLayout(page: number, tokens: SourceToken[]): ColumnLayout | null {
  const anchors = tokens.filter(t => t.rawText.replace(/\s+/g, '') === '概算要求額');
  if (anchors.length !== 1) return null;
  const A = anchors[0];
  const fs = A.fontSize;
  const band = tokens.filter(t => !isBlank(t) && t.bbox.yMin >= A.bbox.yMin - 2.5 * fs && t.bbox.yMax <= A.bbox.yMax + fs);
  const glyph = (t: SourceToken, set: Set<string>): boolean => [...t.rawText.trim()].length === 1 && set.has(t.rawText.trim());
  const prev = band.filter(t => glyph(t, HEAD_PREV_CHARS) && t.bbox.xMax <= A.bbox.xMin + 1e-6);
  const diff = band.filter(t => glyph(t, HEAD_DIFF_CHARS) && t.bbox.xMin >= A.bbox.xMax - 1e-6);
  // 文字が3つ未満なら見出しとして観測できたとはみなさない
  if (new Set(prev.map(t => t.rawText.trim())).size < 3 || new Set(diff.map(t => t.rawText.trim())).size < 3) return null;
  const range = (g: SourceToken[]): [number, number] => [Math.min(...g.map(t => t.bbox.xMin)), Math.max(...g.map(t => t.bbox.xMax))];
  const pr = range(prev);
  const rr: [number, number] = [A.bbox.xMin, A.bbox.xMax];
  const dr = range(diff);
  if (!(pr[1] <= rr[0] + 1e-6 && rr[1] <= dr[0] + 1e-6)) return null;
  const heads = [...prev, A, ...diff];
  const tolerance = round3(median(heads.map(t => t.fontSize)) * 0.5);
  const nameRight = round3(pr[0] - tolerance);
  const boundary = round3(rr[0]);
  const reqRight = round3(rr[1] + tolerance);
  const diffLeft = round3(dr[0] - tolerance);
  const diffRight = round3(dr[1] + tolerance);
  return {
    page,
    headerPage: page,
    basis: 'page_header',
    tolerance,
    previousBudget: [round3(pr[0]), round3(pr[1])],
    requestedBudget: [round3(rr[0]), round3(rr[1])],
    difference: [round3(dr[0]), round3(dr[1])],
    regions: {
      name: [-Infinity, nameRight],
      previousBudget: [nameRight, boundary],
      requestedBudget: [boundary, reqRight],
      gap: [reqRight, diffLeft],
      difference: [diffLeft, diffRight],
      right: [diffRight, Infinity],
    },
    headerTokenRefs: heads.map(t => t.index).sort((a, b) => a - b),
  };
}

/**
 * ページの列配置。自ページの見出しがあればそれ、無ければ文書内で前方（run内）の最も近い見出しページから引き継ぐ。
 * 引き継いだ配置は、このページのTableGeometry（右端揃いの帯）が3列それぞれのセル領域に存在するときだけ採用する（無ければ観測なし）。
 */
export function layoutForPage(page: number, own: ColumnLayout | null, carried: ColumnLayout | null, geometry: TableGeometryResult): { layout: ColumnLayout | null; reason: string | null } {
  if (own) return { layout: own, reason: null };
  if (!carried) return { layout: null, reason: 'column_layout_unobserved' };
  const corroborated = (['previousBudget', 'requestedBudget', 'difference'] as const).every(c => {
    const [l, r] = carried.regions[c];
    return geometry.columnBands.some(b => b.edge === 'xMax' && b.edgeRange[1] >= l && b.edgeRange[1] < r);
  });
  if (!corroborated) return { layout: null, reason: 'column_layout_not_corroborated_on_page' };
  return { layout: { ...carried, page, basis: 'carried_forward_header_corroborated_by_page_column_bands' }, reason: null };
}

type RegionName = keyof ColumnLayout['regions'];
function regionOf(layout: ColumnLayout, centerX: number): RegionName {
  const names: RegionName[] = ['name', 'previousBudget', 'requestedBudget', 'gap', 'difference', 'right'];
  for (const n of names) {
    const [l, r] = layout.regions[n];
    if (centerX >= l && centerX < r) return n;
  }
  return 'right';
}

// ---------------------------------------------------------------------------------------------
// token を piece に分ける（△/▲ を含む token は文字位置の比例で数字部と符号部に分ける）
// ---------------------------------------------------------------------------------------------

interface Piece {
  tokenIndex: number;
  text: string;
  xMin: number;
  xMax: number;
  kind: 'digits' | 'sign' | 'other';
  split: boolean;
  physicalRowIndex: number;
  bbox: SourceTokenBBox;
}

const SIGN_CHARS = /[△▲]/;
const STANDALONE_SIGN = /^[-－−]$/;

function piecesOf(t: SourceToken, physicalRowIndex: number): Piece[] {
  const text = t.rawText;
  const base = { tokenIndex: t.index, physicalRowIndex, bbox: t.bbox };
  const kindOf = (s: string): Piece['kind'] => (/^[0-9,]+$/.test(s) ? 'digits' : /^[△▲]$/.test(s) || STANDALONE_SIGN.test(s) ? 'sign' : 'other');
  if (!SIGN_CHARS.test(text) || text.trim().length === 1) {
    const s = text.trim();
    return [{ ...base, text: s, xMin: t.bbox.xMin, xMax: t.bbox.xMax, kind: kindOf(s), split: false }];
  }
  const len = text.length;
  const out: Piece[] = [];
  const re = /[△▲]|[^\s△▲]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const a = t.bbox.xMin + (t.width * m.index) / len;
    const b = t.bbox.xMin + (t.width * (m.index + m[0].length)) / len;
    out.push({ ...base, text: m[0], xMin: a, xMax: b, kind: kindOf(m[0]), split: true });
  }
  return out;
}

const center = (p: { xMin: number; xMax: number }): number => (p.xMin + p.xMax) / 2;

// ---------------------------------------------------------------------------------------------
// code / name / 金額
// ---------------------------------------------------------------------------------------------

const RE_CODE = /^\d{2,5}(-\d{2,5})*$/;
const RE_REQ_NO = /^\d{1,3}$/;

function rowTokens(page: FieldResolverPageInput, row: LogicalRowCandidate): { token: SourceToken; physicalRowIndex: number }[] {
  const physByToken = new Map<number, number>();
  for (const pr of row.physicalRowIndexes) {
    const phys: PhysicalRowCandidate | undefined = page.geometry.physicalRows[pr];
    for (const i of phys?.rawTokenIndexes ?? []) physByToken.set(i, pr);
  }
  return row.visualTokenIndexes
    .map(i => ({ token: page.tokens[i], physicalRowIndex: physByToken.get(i) ?? row.physicalRowIndexes[0] }))
    .filter(x => !isBlank(x.token));
}

const sourceRows = (row: LogicalRowCandidate): FieldEvidence['sourceRowRefs'] => [{ logicalRowIndex: row.logicalRowIndex, physicalRowIndexes: [...row.physicalRowIndexes] }];

function assocClass(row: LogicalRowCandidate, physRows: number[]): AssociationClass {
  return physRows.every(p => p !== row.physicalRowIndexes[0]) && physRows.length > 0 ? 'continuation' : 'same_row';
}

interface CodeObservation {
  code: { raw: string; tokenIndex: number } | null;
  requestNo: { raw: string; tokenIndex: number } | null;
}

function observeCode(toks: { token: SourceToken; physicalRowIndex: number }[]): CodeObservation {
  const first = toks[0]?.token;
  if (!first) return { code: null, requestNo: null };
  const f = first.rawText.trim();
  const second = toks[1]?.token;
  const s = second?.rawText.trim();
  if (RE_REQ_NO.test(f) && s !== undefined && /^\d{2}-\d{2,5}$/.test(s)) {
    return { requestNo: { raw: f, tokenIndex: first.index }, code: { raw: s, tokenIndex: second!.index } };
  }
  if (RE_CODE.test(f) && (f.length >= 3 || f.includes('-'))) return { requestNo: null, code: { raw: f, tokenIndex: first.index } };
  return { code: null, requestNo: null };
}

function amountField(
  column: 'previousBudget' | 'requestedBudget' | 'difference',
  layout: ColumnLayout,
  page: number,
  row: LogicalRowCandidate,
  pieces: Piece[],
  rowOk: boolean,
  possibleContinuation: Piece[],
): { amount: FieldResult<AmountValue>; sign: FieldResult<{ raw: SignRaw }> } {
  const [xl, xr] = layout.regions[column];
  const inCell = pieces.filter(p => regionOf(layout, center(p)) === column);
  const digits = inCell.filter(p => p.kind === 'digits');
  const signs = inCell.filter(p => p.kind === 'sign');
  const others = inCell.filter(p => p.kind === 'other');
  const basis = 'column x-range from this page\'s header tokens; token center inside the cell region';
  const cellBand = { column, xLeft: round3(Math.max(xl, layout.regions.name[1])), xRight: round3(xr), basis };
  const noSign = (reason: string): FieldResult<{ raw: SignRaw }> => absent('not_observed', reason);

  if (inCell.length === 0) {
    // 継続の可能性がある行（LogicalRow が ambiguous とした行。merge していない）のtokenがこのセルにあるなら、空欄とは言えない
    if (possibleContinuation.some(p => regionOf(layout, center(p)) === column)) {
      return { amount: absent('unresolved', 'possible_continuation_row_has_token_in_cell'), sign: absent('unresolved', 'possible_continuation_row_has_token_in_cell') };
    }
    if (!rowOk) return { amount: absent('unresolved', 'row_not_established_for_blank'), sign: absent('unresolved', 'row_not_established_for_blank') };
    const evidence: FieldEvidence = {
      page,
      sourceTokenRefs: [],
      sourceRowRefs: sourceRows(row),
      rawText: '',
      associationClass: 'same_row',
      ...(possibleContinuation.length > 0 ? { geometryNote: 'the geometrically possible continuation row (LogicalRow: ambiguous, not merged) was also checked: no token in this cell' } : {}),
      bboxUnion: { xMin: cellBand.xLeft, yMin: row.bbox.yMin, xMax: cellBand.xRight, yMax: row.bbox.yMax },
      cellBand,
    };
    return { amount: { status: 'blank', value: null, reasonCode: 'no_token_in_cell_band', evidence }, sign: absent('not_applicable', 'amount_blank') };
  }
  if (others.length > 0) {
    return { amount: absent('unresolved', 'non_numeric_token_in_cell'), sign: digits.length === 0 && signs.length === 0 ? noSign('no_sign_token') : absent('unresolved', 'amount_unresolved') };
  }
  if (digits.length === 0) {
    return { amount: absent('unresolved', 'sign_without_amount'), sign: absent('unresolved', 'sign_without_amount') };
  }
  const physRows = [...new Set(digits.map(d => d.physicalRowIndex))];
  const ordered = [...digits].sort((a, b) => a.xMin - b.xMin || a.tokenIndex - b.tokenIndex);
  const mkEvidence = (ds: Piece[]): FieldEvidence => ({
    page,
    sourceTokenRefs: [...new Set(ds.map(d => d.tokenIndex))].sort((a, b) => a - b),
    sourceRowRefs: sourceRows(row),
    rawText: [...ds].sort((a, b) => a.xMin - b.xMin).map(d => d.text).join(''),
    associationClass: assocClass(row, [...new Set(ds.map(d => d.physicalRowIndex))]),
    bboxUnion: unionBBox(ds.map(d => d.bbox)),
    cellBand,
    ...(ds.some(d => d.split) ? { geometryNote: 'token split by character-position proportion (digits and sign share one SourceToken)' } : {}),
  });
  if (physRows.length > 1) {
    const cands = physRows.map(pr => mkEvidence(digits.filter(d => d.physicalRowIndex === pr)));
    return { amount: absent('ambiguous', 'multiple_physical_rows_in_cell', cands), sign: absent('unresolved', 'amount_ambiguous') };
  }
  const magnitudeRaw = ordered.map(d => d.text).join('');
  if (!/^(0|[1-9]\d{0,2}(,\d{3})*)$/.test(magnitudeRaw)) {
    return { amount: absent('unresolved', 'amount_format_unexpected'), sign: absent('unresolved', 'amount_unresolved') };
  }
  const evidence = mkEvidence(ordered);
  const amount: FieldResult<AmountValue> = {
    status: 'resolved',
    value: { magnitudeRaw, magnitudeNumeric: Number(magnitudeRaw.replace(/,/g, '')), explicitZero: magnitudeRaw === '0' },
    reasonCode: null,
    evidence,
  };
  if (signs.length === 0) return { amount, sign: noSign('no_sign_token') };
  const leftmostDigit = Math.min(...digits.map(d => d.xMin));
  const sameRowSigns = signs.filter(s => s.physicalRowIndex === physRows[0] && s.xMax <= leftmostDigit + layout.tolerance);
  if (sameRowSigns.length !== signs.length) return { amount, sign: absent('unresolved', 'sign_not_at_left_of_amount_in_same_row') };
  if (signs.length > 1) {
    return { amount, sign: absent('ambiguous', 'multiple_sign_tokens_in_cell', signs.map(s => signEvidence(page, row, s, cellBand))) };
  }
  const s = signs[0];
  const raw = (STANDALONE_SIGN.test(s.text) ? '-' : s.text) as SignRaw;
  return { amount, sign: { status: 'resolved', value: { raw }, reasonCode: null, evidence: signEvidence(page, row, s, cellBand) } };
}

function signEvidence(page: number, row: LogicalRowCandidate, s: Piece, cellBand: FieldEvidence['cellBand']): FieldEvidence {
  return {
    page,
    sourceTokenRefs: [s.tokenIndex],
    sourceRowRefs: sourceRows(row),
    rawText: s.text,
    associationClass: assocClass(row, [s.physicalRowIndex]),
    bboxUnion: { ...s.bbox },
    cellBand,
    ...(s.split ? { geometryNote: 'token split by character-position proportion (digits and sign share one SourceToken)' } : {}),
  };
}

const RE_SPACES = /[\s　]+/g;

function nameField(
  page: FieldResolverPageInput,
  row: LogicalRowCandidate,
  layout: ColumnLayout | null,
  layoutReason: string | null,
  toks: { token: SourceToken; physicalRowIndex: number }[],
  codeIdx: Set<number>,
  possibleContinuation: Piece[],
): FieldResult<{ raw: string; normalized: string }> {
  if (!layout) return absent('unresolved', layoutReason ?? 'column_layout_unobserved');
  const nameToks = toks.filter(x => !codeIdx.has(x.token.index) && regionOf(layout, center(x.token.bbox)) === 'name');
  if (nameToks.length === 0) return absent('unresolved', 'no_name_token');
  if (possibleContinuation.some(p => regionOf(layout, center(p)) === 'name')) {
    return absent('ambiguous', 'continuation_ambiguous');
  }
  const byRow = new Map<number, SourceToken[]>();
  for (const x of nameToks) byRow.set(x.physicalRowIndex, [...(byRow.get(x.physicalRowIndex) ?? []), x.token]);
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const lines = rows.map(r => byRow.get(r)!.sort((a, b) => a.bbox.xMin - b.bbox.xMin || a.index - b.index).map(t => t.rawText).join(''));
  const normalized = lines.join('').replace(RE_SPACES, '');
  if (normalized === '') return absent('unresolved', 'no_name_token');
  const used = nameToks.map(x => x.token);
  return {
    status: 'resolved',
    value: { raw: lines.join('\n'), normalized },
    reasonCode: null,
    evidence: {
      page: page.meta.number,
      sourceTokenRefs: used.map(t => t.index).sort((a, b) => a - b),
      sourceRowRefs: sourceRows(row),
      rawText: lines.join('\n'),
      associationClass: assocClass(row, [...byRow.keys()]),
      bboxUnion: unionBBox(used.map(t => t.bbox)),
    },
  };
}

const RE_UNIT = /^[（(]\s*単位\s*[:：]?\s*[^）)]+[）)]$/;

/**
 * ページの単位表記。台帳の見出し領域（最初のレコード行より上）にある単位tokenだけを台帳の単位とする。
 * 本体の途中（レコード行より下）にある単位tokenは右側の補助表などのもので、台帳の金額の単位の根拠にしない。
 * 単位tokenが無い・本体内だけのページは not_observed（他ページから推測しない）。
 */
export function observePageUnitLabel(page: number, tokens: SourceToken[], firstRecordYMin: number): FieldResult<{ raw: string }> {
  const all = tokens.filter(t => RE_UNIT.test(t.rawText.trim()));
  if (all.length === 0) return absent('not_observed', 'no_unit_token_on_page');
  const hits = all.filter(t => t.bbox.yMax <= firstRecordYMin);
  if (hits.length === 0) return absent('not_observed', 'unit_token_only_inside_table_body_treated_as_auxiliary');
  const raws = [...new Set(hits.map(t => t.rawText.trim()))];
  const ev = (t: SourceToken): FieldEvidence => ({
    page,
    sourceTokenRefs: [t.index],
    sourceRowRefs: [],
    rawText: t.rawText,
    associationClass: 'unrelated',
    bboxUnion: { ...t.bbox },
    geometryNote: 'page-level unit label in the ledger header zone (above the first record row)',
  });
  if (raws.length > 1) return absent('ambiguous', 'multiple_distinct_unit_tokens', hits.map(ev));
  return { status: 'resolved', value: { raw: raws[0] }, reasonCode: null, evidence: ev(hits[0]) };
}

// ---------------------------------------------------------------------------------------------
// hierarchy 依存 field（Contract §9。DocumentHierarchy は消費するだけで、親を推論しない）
// ---------------------------------------------------------------------------------------------

const isStrongHeaderEvidence = (n: DocumentHierarchyNodeV2): boolean => {
  const kinds = n.hierarchyResolutionContext.observedEvidenceKinds;
  return kinds.length >= 2 && kinds.includes('page_edge_row');
};

interface HierarchyIndex {
  byRow: Map<string, DocumentHierarchyNodeV2>;
  byId: Map<string, DocumentHierarchyNodeV2>;
  edgeByChild: Map<string, DocumentHierarchyV2Result['edges'][number]>;
}

function indexHierarchy(h: DocumentHierarchyV2Result): HierarchyIndex {
  const byRow = new Map<string, DocumentHierarchyNodeV2>();
  const byId = new Map<string, DocumentHierarchyNodeV2>();
  for (const n of h.nodes) {
    byRow.set(`${n.sourcePage}:${n.sourceRowRefs.logicalRowIndex}`, n);
    byId.set(n.id, n);
  }
  return { byRow, byId, edgeByChild: new Map(h.edges.map(e => [e.childNodeId, e])) };
}

type Hop = { ok: true; parent: DocumentHierarchyNodeV2 } | { ok: false; status: FieldStatus; reasonCode: string };

function hop(idx: HierarchyIndex, child: DocumentHierarchyNodeV2): Hop {
  const e = idx.edgeByChild.get(child.id);
  if (!e) return { ok: false, status: 'unresolved', reasonCode: 'no_edge_for_node' };
  if (e.status === 'unresolved') return { ok: false, status: 'unresolved', reasonCode: 'edge_unresolved' };
  if (e.status === 'level_gap') return { ok: false, status: 'unresolved', reasonCode: 'edge_level_gap' };
  const parent = e.parentNodeId ? idx.byId.get(e.parentNodeId) : undefined;
  if (!parent) return { ok: false, status: 'unresolved', reasonCode: 'parent_node_missing' };
  if (isStrongHeaderEvidence(child)) return { ok: false, status: 'unresolved', reasonCode: 'header_collision_strong_on_child' };
  if (isStrongHeaderEvidence(parent)) return { ok: false, status: 'unresolved', reasonCode: 'header_collision_strong_on_parent' };
  return { ok: true, parent };
}

function parentEvidence(pages: Map<number, FieldResolverPageInput>, parent: DocumentHierarchyNodeV2, associationVia: string): FieldEvidence {
  const p = pages.get(parent.sourcePage);
  const refs = [parent.sourceTokenRefs.keyTokenIndex];
  const tok = p?.tokens[parent.sourceTokenRefs.keyTokenIndex];
  return {
    page: parent.sourcePage,
    sourceTokenRefs: refs,
    sourceRowRefs: [{ logicalRowIndex: parent.sourceRowRefs.logicalRowIndex, physicalRowIndexes: [...parent.sourceRowRefs.physicalRowIndexes] }],
    rawText: tok?.rawText ?? parent.observedCodeParts.code,
    associationClass: 'unrelated',
    bboxUnion: tok ? { ...tok.bbox } : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    geometryNote: associationVia,
  };
}

/**
 * 3桁コードだけの行の種別を、観測済みの hierarchy（node の形と edge）から決める。row-local の形だけでは organization / item / 明細行を区別できないため。
 * hierarchy を再推論しない: root（親候補なしの unresolved）→ organization、親が organization → item、親が request か item → 明細行、それ以外（level_gap 等）→ unclassified。
 */
function kindFromHierarchy(idx: HierarchyIndex, node: DocumentHierarchyNodeV2, depth = 0): { kind: RecordKind; basis: string } {
  if (isStrongHeaderEvidence(node)) return { kind: 'unclassified', basis: 'strong header-collision evidence on this node' };
  if (node.rowShape === 'request_no_then_code') return { kind: 'request', basis: 'hierarchy node shape: request number then code' };
  const e = idx.edgeByChild.get(node.id);
  if (!e) return { kind: 'unclassified', basis: 'no edge for the node' };
  if (e.status === 'unresolved' && !e.parentNodeId) return { kind: 'organization', basis: 'hierarchy root: no parent candidate (edge unresolved)' };
  if (e.status !== 'resolved_by_indent_sequence' || !e.parentNodeId || depth > 8) return { kind: 'unclassified', basis: `hierarchy edge ${e.status}: kind not determined` };
  const parent = idx.byId.get(e.parentNodeId);
  if (!parent) return { kind: 'unclassified', basis: 'parent node missing' };
  if (parent.rowShape === 'request_no_then_code') return { kind: 'detail_line', basis: 'code-only row nested under a request in the observed hierarchy' };
  const pk = kindFromHierarchy(idx, parent, depth + 1).kind;
  if (pk === 'organization') return { kind: 'item', basis: 'child of a hierarchy root (organization)' };
  if (pk === 'unclassified') return { kind: 'unclassified', basis: 'parent kind not determined' };
  return { kind: 'detail_line', basis: `code-only row nested under a ${pk} in the observed hierarchy` };
}

function hierarchyFields(
  kind: RecordKind,
  node: DocumentHierarchyNodeV2 | undefined,
  idx: HierarchyIndex | null,
  pages: Map<number, FieldResolverPageInput>,
): RecordFieldResolution['hierarchyDependent'] {
  const na = <V>(r: string): FieldResult<V> => absent<V>('not_applicable', r);
  if (kind === 'organization') return { parentItemAssociation: na('organization_is_root'), parentOrganizationAssociation: na('organization_is_root') };
  if (kind === 'detail_line') return { parentItemAssociation: na('detail_line_not_in_hierarchy_scope'), parentOrganizationAssociation: na('detail_line_not_in_hierarchy_scope') };
  if (!idx) {
    return { parentItemAssociation: absent('not_observed', 'hierarchy_artifact_not_available'), parentOrganizationAssociation: absent('not_observed', 'hierarchy_artifact_not_available') };
  }
  if (kind === 'unclassified') return { parentItemAssociation: absent('unresolved', 'record_kind_undetermined'), parentOrganizationAssociation: absent('unresolved', 'record_kind_undetermined') };
  if (!node) {
    return { parentItemAssociation: absent('not_observed', 'row_is_not_a_hierarchy_node'), parentOrganizationAssociation: absent('not_observed', 'row_is_not_a_hierarchy_node') };
  }
  const first = hop(idx, node);
  const mk = (h: Hop, via: string): FieldResult<{ parentNodeRef: string }> =>
    h.ok ? { status: 'resolved', value: { parentNodeRef: h.parent.id }, reasonCode: null, evidence: parentEvidence(pages, h.parent, via) } : absent(h.status, h.reasonCode);
  if (kind === 'item') return { parentItemAssociation: na('item_parent_is_organization'), parentOrganizationAssociation: mk(first, 'hierarchy edge (resolved_by_indent_sequence, no strong header-collision evidence)') };
  // request: 2-hop。両方の hop が Safe のときだけ organization まで確定する
  const parentItem = mk(first, 'hierarchy edge (resolved_by_indent_sequence, no strong header-collision evidence)');
  if (!first.ok) return { parentItemAssociation: parentItem, parentOrganizationAssociation: absent(first.status, `hop1_${first.reasonCode}`) };
  const second = hop(idx, first.parent);
  return {
    parentItemAssociation: parentItem,
    parentOrganizationAssociation: second.ok ? mk(second, '2-hop hierarchy edge (both hops Safe)') : absent(second.status, `hop2_${second.reasonCode}`),
  };
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------

export function resolveFields(input: FieldResolverInput): FieldResolverResult {
  const pages = new Map(input.pages.map(p => [p.meta.number, p]));
  const idx = input.hierarchy ? indexHierarchy(input.hierarchy) : null;
  const records: RecordFieldResolution[] = [];
  const pageDiagnostics: FieldResolverResult['pageDiagnostics'] = [];
  let lastHeaderLayout: ColumnLayout | null = null;

  for (const page of [...input.pages].sort((a, b) => a.meta.number - b.meta.number)) {
    const pageNo = page.meta.number;
    const own = observeColumnLayout(pageNo, page.tokens);
    if (own) lastHeaderLayout = own;
    const { layout, reason: layoutReason } = layoutForPage(pageNo, own, lastHeaderLayout, page.geometry);
    const rows = page.logical.logicalRowCandidates;
    const firstRecordY = Math.min(...rows.filter(r => observeCode(rowTokens(page, r)).code).map(r => r.bbox.yMin), Infinity);
    const unit = observePageUnitLabel(pageNo, page.tokens, firstRecordY);
    let count = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const toks = rowTokens(page, row);
      const obs = observeCode(toks);
      if (!obs.code) continue;
      count++;
      const node = idx?.byRow.get(`${pageNo}:${row.logicalRowIndex}`);
      let kind: RecordKind;
      let basis: string;
      if (obs.requestNo) { kind = 'request'; basis = 'row-leading request number followed by a code'; }
      else if (obs.code.raw.includes('-')) { kind = 'detail_line'; basis = 'hyphenated code without a request number'; }
      else if (node && idx) { ({ kind, basis } = kindFromHierarchy(idx, node)); }
      else { kind = 'unclassified'; basis = 'plain code and no hierarchy node for this row'; }

      const codeIdx = new Set<number>([obs.code.tokenIndex, ...(obs.requestNo ? [obs.requestNo.tokenIndex] : [])]);
      const codeTok = page.tokens[obs.code.tokenIndex];
      const codeField: FieldResult<{ raw: string }> = {
        status: 'resolved',
        value: { raw: obs.code.raw },
        reasonCode: null,
        evidence: {
          page: pageNo,
          sourceTokenRefs: [codeTok.index],
          sourceRowRefs: sourceRows(row),
          rawText: codeTok.rawText,
          associationClass: 'same_row',
          bboxUnion: { ...codeTok.bbox },
        },
      };
      const next = rows[ri + 1];
      const possibleContinuation: Piece[] =
        next?.resolution.kind === 'ambiguous' && next.resolution.evidence.possibleContinuationOfLogicalRow === row.logicalRowIndex
          ? rowTokens(page, next).flatMap(x => piecesOf(x.token, x.physicalRowIndex))
          : [];
      const name = nameField(page, row, layout, layoutReason, toks, codeIdx, possibleContinuation);

      const pieces = toks.flatMap(x => piecesOf(x.token, x.physicalRowIndex));
      const rowOk = name.status === 'resolved' && row.resolution.kind !== 'ambiguous';
      const cols = (['previousBudget', 'requestedBudget', 'difference'] as const).map(c =>
        layout
          ? amountField(c, layout, pageNo, row, pieces, rowOk, possibleContinuation)
          : { amount: absent<AmountValue>('unresolved', layoutReason ?? 'column_layout_unobserved'), sign: absent<{ raw: SignRaw }>('unresolved', layoutReason ?? 'column_layout_unobserved') },
      );

      const aux: RecordFieldResolution['auxiliaryEvidenceRefs'] = [];
      if (layout) {
        const auxTokens = new Map<AuxiliaryClass, Set<number>>();
        for (const p of pieces) {
          const r = regionOf(layout, center(p));
          if (r !== 'right' && r !== 'gap') continue;
          const cls: AuxiliaryClass = /^[0-9,△▲]+$/.test(p.text) ? 'inline_label_number' : 'remark_text';
          auxTokens.set(cls, (auxTokens.get(cls) ?? new Set()).add(p.tokenIndex));
        }
        for (const cls of [...auxTokens.keys()].sort()) aux.push({ class: cls, sourceTokenRefs: [...auxTokens.get(cls)!].sort((a, b) => a - b), page: pageNo });
      }

      records.push({
        anchor: { page: pageNo, logicalRowIndex: row.logicalRowIndex },
        anchorBBox: { ...row.bbox },
        recordKind: kind,
        recordKindBasis: basis,
        rowLocal: {
          code: codeField,
          name,
          previousBudget: cols[0].amount,
          requestedBudget: cols[1].amount,
          difference: cols[2].amount,
          previousBudgetSign: cols[0].sign,
          requestedBudgetSign: cols[1].sign,
          differenceSign: cols[2].sign,
        },
        hierarchyDependent: hierarchyFields(kind, node, idx, pages),
        auxiliaryEvidenceRefs: aux,
        pageUnitLabel: unit,
      });
    }
    pageDiagnostics.push({ page: pageNo, columnLayout: layout, columnLayoutReason: layoutReason, recordCount: count });
  }

  return {
    schema: FIELD_RESOLVER_SCHEMA,
    parameters: {
      columnEvidence: 'x-ranges of the three amount columns observed from this page\'s header tokens (前年度/予算額, 概算要求額/年度, 比較増△減/対前年度); token center decides the cell',
      toleranceDefinition: 'half of the median header-token fontSize on the page',
      hierarchyPolicy: 'Safe = edge resolved_by_indent_sequence and neither child nor parent has strong header-collision evidence (>=2 kinds including page_edge_row); otherwise abstain. request->organization needs both hops Safe',
      inputLayers: ['SourceToken', 'TableGeometry', 'LogicalRow', 'DocumentHierarchy v2-B (consumed, never re-inferred)'],
    },
    pageDiagnostics,
    records,
  };
}

/** 決定的なシリアライズ（Infinity は JSON にできないので null にする。キー順は構築順で固定） */
export function serializeFieldResolverResult(r: FieldResolverResult): string {
  return `${JSON.stringify(r, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2)}\n`;
}
