/**
 * FY2024 概算要求 TOC A 層 row assembly parser（preregistered rule の実装。正本: tests/fixtures/budget-request-toc-row-assembly/2024/preregistration.json）。
 *
 * 入力は Raw Text の page record（nonEmptyLines）のみ。意味（階層・section carry）・正規化・丸囲み/PUA 復元・page ref の補完は一切しない。
 * 判断できない箇所は preregistered な abstention reason で abstain する（推測しない）。rule・tolerance を変更する経路を持たない。
 * Library for primitives, RS for semantics: 本 module は物理 row の raw 表現と provenance だけを返す。
 */
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';

// ---- preregistered config（preregistration.json の rules と一致することを test で検証する）----
export const PAGEREF_SOURCE = '(?:[ぁ-んァ-ヶ一-龥]{1}(?:[（(][^）)]{1,2}[）)])?\\s?)?\\d{1,4}';
export const REQUEST_TOKEN_SOURCE = '\\d{1,3}\\s+\\d{2}[\\u2010\\u2011-]\\d{2}';
export const MARKER_TOKEN_SOURCE = '[（(][^）)\\s]+[）)]';
export const OTHER_CODE_SOURCE = '^\\s+(0\\d{2})\\s+(?!\\d{2}[\\u2010\\u2011-]\\d{2})(\\S.*?\\S)\\s+(PAGEREF)\\s*$';
export const BAND_TOLERANCE_CHARS = 2;
export const BAND_MIN_EVIDENCE = 2;

const REQUEST_TOKEN = new RegExp(REQUEST_TOKEN_SOURCE, 'u');
const MARKER_TOKEN = new RegExp(MARKER_TOKEN_SOURCE, 'u');
const OTHER_CODE = new RegExp(OTHER_CODE_SOURCE.replace('PAGEREF', PAGEREF_SOURCE), 'u');
const TRAILING_PAGEREF = new RegExp(`\\s+(${PAGEREF_SOURCE})\\s*$`, 'u');
const RIGHT_BAND_EVIDENCE = new RegExp(`\\d{1,4}(\\s+)(${REQUEST_TOKEN_SOURCE})`, 'gu');
const MARKER_RIGHT_CANDIDATE = new RegExp(`\\d{1,4}(\\s+)(${MARKER_TOKEN_SOURCE})`, 'gu');
const ANY_REQUEST_TOKEN = new RegExp(REQUEST_TOKEN_SOURCE, 'gu');
const STARTS_REQUEST = new RegExp(`^(${REQUEST_TOKEN_SOURCE})`, 'u');
const STARTS_MARKER = new RegExp(`^(${MARKER_TOKEN_SOURCE})`, 'u');
const STARTS_THREE_DIGIT_CODE = /^\d{3}\s+\S/u;
const STARTS_DIGIT = /^\d/u;

export const ABSTENTION_REASONS = [
  'FROZEN_INPUT_MISMATCH', 'RIGHT_EVIDENCE_INSUFFICIENT', 'MARKER_ONLY_RIGHT_BOUNDARY', 'MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS',
  'BOUNDARY_CONFLICT_LINE', 'BOUNDARY_CROSSING', 'UNKNOWN_ROW_START', 'FRAGMENT_WITH_PAGE_REF', 'FRAGMENT_OWNER_NOT_UNIQUE',
  'FRAGMENT_NO_SAFE_OWNER', 'SIMULTANEOUS_LR_FRAGMENT', 'SOURCE_ORDER_CONFLICT', 'REQUIRES_HIERARCHY_SEMANTICS',
  'OTHER_CODE_UNSUPPORTED_FORM', 'PROVENANCE_UNAVAILABLE',
] as const;
export type AbstentionReason = (typeof ABSTENTION_REASONS)[number];
export type RowKind = 'REQUEST_NUMBER_ROW' | 'MARKER_ROW' | 'TITLE_OR_HEADING' | 'OTHER_CODE' | 'WRAPPED_FRAGMENT' | 'UNKNOWN_ABSTAINED';
export type Column = 'LEFT' | 'RIGHT' | 'UNSPLIT';
export type PageState = 'ASSEMBLED_SPLIT' | 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE' | 'PAGE_ABSTAINED';

export interface TocPageInput {
  localPdfPath: string;
  pdfSha256: string;
  physicalPage: number;
  textSha256: string;
  classifierSource: 'DIRECT' | 'INHERITED';
  /** frozen な page text（hash 検証に使う） */
  text: string;
  nonEmptyLines: { lineIndex: number; text: string }[];
}
export interface Provenance {
  localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string;
  lineIndex: number; charStart: number; charEnd: number; sourceRawSlice: string;
}
export interface FragmentOut { textRaw: string; provenance: Provenance }
export interface RowOut {
  column: Column;
  sourceOrder: number;
  rowKind: RowKind;
  rowStartTokenRaw: string | null;
  codeRaw: string | null;
  titleRaw: string | null;
  pageRefRaw: string | null;
  fragments: FragmentOut[];
  provenance: Provenance;
  state: 'RESOLVED' | 'ABSTAINED';
  abstentionReason: AbstentionReason | null;
}
export interface PageOut {
  localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string;
  pageState: PageState;
  pageAbstentionReason: AbstentionReason | null;
  rightBandEdge: number | null;
  rows: RowOut[];
}

const cp = (s: string) => Array.from(s);
/** UTF-16 index → code point index */
const cpIndex = (s: string, utf16: number) => Array.from(s.slice(0, utf16)).length;
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);

/** raw line 内の先頭 non-whitespace の code point index */
const firstNonWs = (chars: string[]) => chars.findIndex(c => !isWs(c));

function rowStartsLine(text: string): boolean {
  const t = text.replace(/^\s+/u, '');
  return STARTS_REQUEST.test(t) || STARTS_MARKER.test(t) || OTHER_CODE.test(text);
}

/** 右 column evidence の開始 index（行内で先頭 token ではない request token）と、marker 右候補の有無 */
function bandEvidenceOf(text: string): { requestStarts: number[]; markerCandidates: number } {
  const chars = cp(text);
  const first = firstNonWs(chars);
  const requestStarts: number[] = [];
  for (const m of text.matchAll(RIGHT_BAND_EVIDENCE)) {
    const tokenUtf16 = (m.index as number) + m[0].length - m[2].length;
    const start = cpIndex(text, tokenUtf16);
    if (start > first) requestStarts.push(start);
  }
  let markerCandidates = 0;
  for (const m of text.matchAll(MARKER_RIGHT_CANDIDATE)) {
    const tokenUtf16 = (m.index as number) + m[0].length - m[2].length;
    if (cpIndex(text, tokenUtf16) > first) markerCandidates++;
  }
  return { requestStarts, markerCandidates };
}

interface Seg { column: Column; lineIndex: number; lineChars: string[]; start: number; end: number; text: string }

function sliceProv(page: TocPageInput, seg: { lineIndex: number; lineChars: string[] }, start: number, end: number): Provenance | null {
  const sourceRawSlice = seg.lineChars.slice(start, end).join('');
  const line = page.nonEmptyLines.find(l => l.lineIndex === seg.lineIndex);
  if (!line || cp(line.text).slice(start, end).join('') !== sourceRawSlice) return null;
  return { localPdfPath: page.localPdfPath, pdfSha256: page.pdfSha256, physicalPage: page.physicalPage, textSha256: page.textSha256, lineIndex: seg.lineIndex, charStart: start, charEnd: end, sourceRawSlice };
}

function pageAbstain(page: TocPageInput, reason: AbstentionReason, edge: number | null = null): PageOut {
  return { localPdfPath: page.localPdfPath, pdfSha256: page.pdfSha256, physicalPage: page.physicalPage, textSha256: page.textSha256, classifierSource: page.classifierSource, pageState: 'PAGE_ABSTAINED', pageAbstentionReason: reason, rightBandEdge: edge, rows: [] };
}

export function assembleTocPage(page: TocPageInput): PageOut {
  // frozen input 検証: text hash と nonEmptyLines の再現
  if (sha256Hex(page.text) !== page.textSha256 || JSON.stringify(nonEmptyLinesOf(page.text)) !== JSON.stringify(page.nonEmptyLines)) return pageAbstain(page, 'FROZEN_INPUT_MISMATCH');
  const lines = page.nonEmptyLines;
  for (let i = 1; i < lines.length; i++) if (lines[i].lineIndex <= lines[i - 1].lineIndex) return pageAbstain(page, 'SOURCE_ORDER_CONFLICT');

  // ---- page-local column segmentation ----
  const starts: number[] = [];
  let markerCandidates = 0;
  for (const l of lines) { const e = bandEvidenceOf(l.text); starts.push(...e.requestStarts); markerCandidates += e.markerCandidates; }
  let edge: number | null = null;
  if (starts.length >= BAND_MIN_EVIDENCE) {
    const min = Math.min(...starts);
    if (Math.max(...starts) > min + BAND_TOLERANCE_CHARS) return pageAbstain(page, 'MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS');
    edge = min;
  } else if (starts.length === 1) return pageAbstain(page, 'RIGHT_EVIDENCE_INSUFFICIENT');
  else if (markerCandidates > 0) return pageAbstain(page, 'MARKER_ONLY_RIGHT_BOUNDARY');
  const split = edge !== null;

  // ---- header zone: 最初の row-start 行の直前まで ----
  const firstRow = lines.findIndex(l => rowStartsLine(l.text));
  const headerEnd = firstRow < 0 ? lines.length : firstRow;

  const rows: (RowOut & { _line: number })[] = [];
  const owner: Record<Column, RowOut | null> = { LEFT: null, RIGHT: null, UNSPLIT: null };
  const clearAll = () => { owner.LEFT = owner.RIGHT = owner.UNSPLIT = null; };
  const orderIn: Record<Column, number> = { LEFT: 0, RIGHT: 0, UNSPLIT: 0 };
  const push = (r: Omit<RowOut, 'sourceOrder'>, line: number) => { rows.push({ ...r, sourceOrder: orderIn[r.column]++, _line: line }); return rows[rows.length - 1]; };

  const wholeLineAbstain = (l: { lineIndex: number; text: string }, chars: string[], reason: AbstentionReason) => {
    const s = firstNonWs(chars); const e = chars.length - [...chars].reverse().findIndex(c => !isWs(c));
    const prov = sliceProv(page, { lineIndex: l.lineIndex, lineChars: chars }, s, e);
    push({ column: 'UNSPLIT', rowKind: 'UNKNOWN_ABSTAINED', rowStartTokenRaw: null, codeRaw: null, titleRaw: null, pageRefRaw: null, fragments: [], provenance: prov ?? ({} as Provenance), state: 'ABSTAINED', abstentionReason: prov ? reason : 'PROVENANCE_UNAVAILABLE' }, l.lineIndex);
    clearAll();
  };

  type Classified = { kind: 'ROW'; row: Omit<RowOut, 'sourceOrder'> } | { kind: 'FRAGMENT'; textRaw: string; provenance: Provenance } | { kind: 'ABSTAIN'; row: Omit<RowOut, 'sourceOrder'> };
  const classify = (page_: TocPageInput, seg: Seg): Classified => {
    const full = seg.text; // 空白のみでない raw segment（先頭空白を含む）
    const lead = cp(full).findIndex(c => !isWs(c));
    const trimmed = full.replace(/^\s+/u, '').replace(/\s+$/u, '');
    const trailEnd = seg.start + cp(full.replace(/\s+$/u, '')).length;
    const tStart = seg.start + lead;
    const prov = sliceProv(page_, seg, tStart, trailEnd);
    const abst = (reason: AbstentionReason): Classified => ({ kind: 'ABSTAIN', row: { column: seg.column, rowKind: 'UNKNOWN_ABSTAINED', rowStartTokenRaw: null, codeRaw: null, titleRaw: null, pageRefRaw: null, fragments: [], provenance: prov ?? ({} as Provenance), state: 'ABSTAINED', abstentionReason: prov ? reason : 'PROVENANCE_UNAVAILABLE' } });
    if (!prov) return abst('PROVENANCE_UNAVAILABLE');
    const ref = TRAILING_PAGEREF.exec(trimmed);
    const body = (s: string) => (ref ? s.slice(0, s.length - ref[0].length) : s).trim();
    const mk = (rowKind: RowKind, tok: string, code: string | null, title: string): Classified => ({ kind: 'ROW', row: { column: seg.column, rowKind, rowStartTokenRaw: tok, codeRaw: code, titleRaw: title, pageRefRaw: ref ? ref[1].trim() : null, fragments: [], provenance: prov, state: 'RESOLVED', abstentionReason: null } });
    const req = STARTS_REQUEST.exec(trimmed);
    if (req) {
      const code = /\d{2}[‐‑-]\d{2}$/u.exec(req[1])![0];
      return mk('REQUEST_NUMBER_ROW', req[1], code, body(trimmed.slice(req[1].length)));
    }
    const mkr = STARTS_MARKER.exec(trimmed);
    if (mkr) {
      const rest = trimmed.slice(mkr[1].length);
      const c = /^\s*(\d{1,3})\s+(?=\S)/u.exec(rest);
      return mk('MARKER_ROW', mkr[1], c ? c[1] : null, body(c ? rest.slice(c[0].length) : rest));
    }
    const oc = OTHER_CODE.exec(full.replace(/\s+$/u, ''));
    if (oc) return { kind: 'ROW', row: { column: seg.column, rowKind: 'OTHER_CODE', rowStartTokenRaw: oc[1], codeRaw: oc[1], titleRaw: oc[2], pageRefRaw: oc[3].trim(), fragments: [], provenance: prov, state: 'RESOLVED', abstentionReason: null } };
    if (STARTS_THREE_DIGIT_CODE.test(trimmed)) return abst('OTHER_CODE_UNSUPPORTED_FORM');
    if (STARTS_DIGIT.test(trimmed)) return abst('UNKNOWN_ROW_START');
    if (ref) return abst('FRAGMENT_WITH_PAGE_REF');
    return { kind: 'FRAGMENT', textRaw: trimmed, provenance: prov };
  };

  const attach = (col: Column, f: Extract<Classified, { kind: 'FRAGMENT' }>, line: number) => {
    const o = owner[col];
    if (!o) {
      push({ column: col, rowKind: 'UNKNOWN_ABSTAINED', rowStartTokenRaw: null, codeRaw: null, titleRaw: f.textRaw, pageRefRaw: null, fragments: [], provenance: f.provenance, state: 'ABSTAINED', abstentionReason: 'FRAGMENT_NO_SAFE_OWNER' }, line);
      return;
    }
    o.fragments.push({ textRaw: f.textRaw, provenance: f.provenance });
  };
  const take = (col: Column, c: Classified, line: number) => {
    if (c.kind === 'FRAGMENT') { attach(col, c, line); return; }
    const r = push(c.row, line);
    if (c.kind === 'ROW') owner[col] = r; else owner[col] = null; // ABSTAINED は当該 column の barrier
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; const chars = cp(l.text);
    if (i < headerEnd) {
      const s = firstNonWs(chars); const e = chars.length - [...chars].reverse().findIndex(c => !isWs(c));
      const prov = sliceProv(page, { lineIndex: l.lineIndex, lineChars: chars }, s, e);
      push({ column: 'UNSPLIT', rowKind: 'TITLE_OR_HEADING', rowStartTokenRaw: null, codeRaw: null, titleRaw: l.text.trim(), pageRefRaw: null, fragments: [], provenance: prov ?? ({} as Provenance), state: prov ? 'RESOLVED' : 'ABSTAINED', abstentionReason: prov ? null : 'PROVENANCE_UNAVAILABLE' }, l.lineIndex);
      clearAll(); // TITLE は barrier
      continue;
    }
    if (!split) {
      const seg: Seg = { column: 'UNSPLIT', lineIndex: l.lineIndex, lineChars: chars, start: 0, end: chars.length, text: l.text };
      take('UNSPLIT', classify(page, seg), l.lineIndex);
      continue;
    }
    const E = edge as number;
    // 行内で先頭 token ではない request token が [E-2, E-1] または E+3 以上にあれば BOUNDARY_CONFLICT_LINE
    const first = firstNonWs(chars);
    const toks = [...l.text.matchAll(ANY_REQUEST_TOKEN)].map(m => cpIndex(l.text, m.index as number)).filter(ix => ix > first);
    if (toks.some(ix => (ix >= E - BAND_TOLERANCE_CHARS && ix <= E - 1) || ix >= E + BAND_TOLERANCE_CHARS + 1)) { wholeLineAbstain(l, chars, 'BOUNDARY_CONFLICT_LINE'); continue; }
    if (chars.length > E && !isWs(chars[E - 1]) && !isWs(chars[E])) { wholeLineAbstain(l, chars, 'BOUNDARY_CROSSING'); continue; }
    const leftChars = chars.slice(0, E); const rightChars = chars.slice(E);
    const segs: Seg[] = [];
    if (leftChars.some(c => !isWs(c))) segs.push({ column: 'LEFT', lineIndex: l.lineIndex, lineChars: chars, start: 0, end: Math.min(E, chars.length), text: leftChars.join('') });
    if (rightChars.some(c => !isWs(c))) segs.push({ column: 'RIGHT', lineIndex: l.lineIndex, lineChars: chars, start: E, end: chars.length, text: rightChars.join('') });
    const cls = segs.map(s => ({ s, c: classify(page, s) }));
    if (cls.length === 2 && cls.every(x => x.c.kind === 'FRAGMENT')) {
      for (const x of cls) {
        const f = x.c as Extract<Classified, { kind: 'FRAGMENT' }>;
        push({ column: x.s.column, rowKind: 'UNKNOWN_ABSTAINED', rowStartTokenRaw: null, codeRaw: null, titleRaw: f.textRaw, pageRefRaw: null, fragments: [], provenance: f.provenance, state: 'ABSTAINED', abstentionReason: 'SIMULTANEOUS_LR_FRAGMENT' }, l.lineIndex);
      }
      clearAll();
      continue;
    }
    for (const x of cls) take(x.s.column, x.c, l.lineIndex);
  }

  const rank: Record<Column, number> = { LEFT: 0, RIGHT: 1, UNSPLIT: 2 };
  // 出力順 = (column, lineIndex)。sourceOrder は column 内の raw 順（lineIndex 昇順）を push 順のまま保持
  const out = rows.map(({ _line, ...r }) => ({ ...r, _line })).sort((a, b) => rank[a.column] - rank[b.column] || a._line - b._line || a.sourceOrder - b.sourceOrder);
  return {
    localPdfPath: page.localPdfPath, pdfSha256: page.pdfSha256, physicalPage: page.physicalPage, textSha256: page.textSha256, classifierSource: page.classifierSource,
    pageState: split ? 'ASSEMBLED_SPLIT' : 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', pageAbstentionReason: null, rightBandEdge: edge,
    rows: out.map(({ _line, ...r }) => r),
  };
}

/** 実装 rule/config の hash（freeze 用） */
export function ruleConfigSha256(): string {
  return sha256Hex(JSON.stringify({ PAGEREF_SOURCE, REQUEST_TOKEN_SOURCE, MARKER_TOKEN_SOURCE, OTHER_CODE_SOURCE, BAND_TOLERANCE_CHARS, BAND_MIN_EVIDENCE, ABSTENTION_REASONS }));
}
