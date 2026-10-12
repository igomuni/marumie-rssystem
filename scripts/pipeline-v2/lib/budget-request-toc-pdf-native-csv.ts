/**
 * 概算要求PDFの目次(TOC)ページ → CSV（PDF-native v0）。pdf.js の SourceToken と TableGeometry の行クラスタリングだけを根拠に、
 * 「要求番号,区分,ページ」を保守的に取り出す。Raw Text（pdftotext）は一切使わない。
 *
 * ## 方針（取り出せるものだけ出す）
 * - 列分離を先に行う: ヘッダの「要求」2個と「ページ」の x 位置から左右列の境界を決め、列ごとに token を分けてから物理行をクラスタリングする
 *   （TableGeometry は y だけで行を作るため、左右の同じ高さの token が 1 行に混ざる。幾何行は意味上の項目ではない）。
 *   ヘッダが見つからない/曖昧なページは列の根拠がないので、本文 token を全部 unresolved（NO_COLUMN_EVIDENCE）にする。
 * - pdf.js の返却順は読み順ではない。行内の並びは bbox.xMin 昇順（同値は index 昇順）。index は項目IDとしてそのまま保持する。
 * - ヘッダ帯より上（表題・ノンブル・所管名）は HEADER_ZONE として棄却し、タイトルとページを近接だけで対応付けない。
 * - 「ページ」は 右端揃えの列帯にある token だけ。接頭辞（エ/電/原/国/国(国)）は原本の綴りのまま連結する。
 * - 折り返しタイトルの続き（要求番号・コード・ページを持たない行）は、前の行の続きだと独立に裏付ける根拠がないので結合しない。
 *   ページ付きの行の次が断片行なら、その行は main に出さず HOLD_INCOMPLETE_TITLE として候補つきで audit に残す。
 * - 所管・組織などの階層は解決しない。5分類の意味付けもしない。
 */
import type { PageMeta, SourceToken } from './budget-request-source-token';
import { baselineTopOf, clusterPhysicalRows, referenceFontSizeOf, type PhysicalRowCandidate } from './budget-request-table-geometry';

export const TOC_PDF_NATIVE_SCHEMA = 'budget-request-toc-pdf-native-csv/v0';
/**
 * 抽出オプションID（pdfjs 版は含めない）。extractPageTokens の getDocument/getTextContent 設定を表す。
 * P6（Source Token First）の occurrence tuple の optionsId と同じ綴りになるよう `pdfjs-<version>-` を前置して使う
 * （P6 の 17 ページ・6,655 item で text/transform が一致することを確認済み。docs 参照）。
 */
export const EXTRACTION_OPTIONS_SUFFIX = 'disableNormalization-true-cmaps-standardfonts-verbosity0-v1';
export const extractionOptionsId = (pdfjsVersion: string): string => `pdfjs-${pdfjsVersion}-${EXTRACTION_OPTIONS_SUFFIX}`;

export interface TocParams {
  /** 行クラスタリングの許容差 = factor × 列の fontSize 中央値（TableGeometry の既定と同じ） */
  rowToleranceFactor: number;
  /** ヘッダ帯の検出: 「要求」のベースラインから +factor×fontSize までを同じヘッダ帯とみなす */
  headerBandFactor: number;
  /** ヘッダ帯と本文の境界の許容差 = factor × fontSize */
  headerBottomToleranceFactor: number;
  /** 「ページ」token の右端からの許容差 = factor × fontSize（ページ番号は右端揃い） */
  pageRefRightEdgeFactor: number;
  /** ページ列帯の左端 = 「ページ」xMin − factor × fontSize（接頭辞を含めるための余白） */
  pageRefZoneLeftFactor: number;
  /** 要求番号の中心と「要求」見出しの中心の許容差 = factor × 「要求」token の幅 */
  requestNumberCenterFactor: number;
  /** 接頭辞と数字の間の最大 gap = factor × fontSize */
  prefixGapFactor: number;
}

export const DEFAULT_TOC_PARAMS: TocParams = {
  rowToleranceFactor: 0.25,
  headerBandFactor: 4,
  headerBottomToleranceFactor: 0.5,
  pageRefRightEdgeFactor: 1,
  pageRefZoneLeftFactor: 2,
  requestNumberCenterFactor: 0.75,
  prefixGapFactor: 1.5,
};

export type Side = 'left' | 'right';
export type Disposition = 'BLANK' | 'HEADER_ZONE' | 'ENTRY' | 'UNRESOLVED';

export type AuditKind =
  | 'NO_COLUMN_EVIDENCE'
  | 'COLUMN_STRADDLE'
  | 'PAGE_REF_AMBIGUOUS'
  | 'PAGE_REF_WITHOUT_TITLE'
  | 'REQUEST_NUMBER_WITHOUT_TITLE'
  | 'NO_PAGE_REF'
  | 'NO_TITLE_TEXT'
  | 'UNOWNED_FRAGMENT'
  | 'HOLD_INCOMPLETE_TITLE'
  | 'HOLD_POSSIBLE_CONTINUATION_TAIL';

export type EntryShape = 'NUMBERED' | 'MARKER' | 'CODE' | 'TITLE_PAGE';

export interface TocEntry {
  entryId: string;
  rowId: string;
  side: Side;
  /** y 昇順（列内）の通し番号。0 始まり */
  rowOrdinal: number;
  requestNumber: string;
  label: string;
  pageRef: string;
  shape: EntryShape;
  requestNumberTokenIndexes: number[];
  labelTokenIndexes: number[];
  pageRefTokenIndexes: number[];
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
}

export interface AuditRecord {
  auditId: string;
  kind: AuditKind;
  side: Side | null;
  rowId: string | null;
  /** 行を構成した token の index（x 昇順。空白 token を除く） */
  tokenIndexes: number[];
  /** tokenIndexes に対応する rawText（原文のまま） */
  rawTexts: string[];
  /** 候補にすぎない所有者 entry/row（所有関係の判断ではない） */
  candidateOwnerRowId: string | null;
  candidateOwnerEntryId: string | null;
  detail: string;
}

export interface LedgerRow {
  tokenIndex: number;
  rawText: string;
  disposition: Disposition;
  reason: string;
  /** ENTRY は entryId、UNRESOLVED は auditId、他は空 */
  ref: string;
  side: Side | null;
}

export interface PageResult {
  pdfSha256: string;
  physicalPage: number;
  tokenCount: number;
  columnEvidence: ColumnEvidence;
  entries: TocEntry[];
  audits: AuditRecord[];
  ledger: LedgerRow[];
  /** 列ごとの物理行数（意味上の項目数ではない） */
  geometricRows: { left: number; right: number };
}

export type ColumnEvidence =
  | { available: true; boundaryX: number; headerBottomBaseline: number; requestHeaderCenters: [number, number]; pageHeaderRightEdges: [number, number]; pageHeaderLeftEdges: [number, number]; requestHeaderWidths: [number, number]; headerTokenIndexes: number[] }
  | { available: false; reason: string; headerTokenIndexes: number[] };

const HEADER_WORDS = new Set(['要求', '番号', '区', '分', 'ページ']);
const MARKER = /^（(?:項|組織|所管|会計|勘定)）$/u;
const CODE = /^(?:\d{3}|\d{2}[‐‑-]\d{2})$/u;
const DIGITS = /^\d{1,4}$/u;
const REQUEST_NUMBER = /^\d{1,3}$/u;
const PREFIXES = new Set(['エ', '電', '原', '国', '国(国)']);
const PAGE_REF_ONE_TOKEN = /^(?:エ|電|原|国\(国\)|国)[ \t]?\d{1,4}$|^\d{1,4}$/u;

const isBlank = (t: SourceToken): boolean => t.rawText.trim() === '';
const sha8 = (pdfSha256: string): string => pdfSha256.slice(0, 8);

export interface PageInput {
  pdfSha256: string;
  physicalPage: number;
  meta: PageMeta;
  tokens: SourceToken[];
}

/** token を (xMin, index) 昇順に並べる。pdf.js の返却順は読み順ではない */
const byVisualX = (a: SourceToken, b: SourceToken): number => a.bbox.xMin - b.bbox.xMin || a.index - b.index;

function detectColumnEvidence(tokens: SourceToken[], meta: PageMeta, params: TocParams): ColumnEvidence {
  const fs = referenceFontSizeOf(tokens);
  const requests = tokens.filter(t => t.rawText.trim() === '要求').sort(byVisualX);
  if (requests.length !== 2) return { available: false, reason: `要求 見出しが${requests.length}個（2個必要）`, headerTokenIndexes: [] };
  const base = (t: SourceToken) => baselineTopOf(t, meta);
  const sameBand = requests.every(r => Math.abs(base(r) - base(requests[0])) <= params.rowToleranceFactor * fs);
  if (!sameBand) return { available: false, reason: '要求 見出し2個のベースラインが揃わない', headerTokenIndexes: [] };
  const bandTop = base(requests[0]) - params.headerBottomToleranceFactor * fs;
  const bandBottom = base(requests[0]) + params.headerBandFactor * fs;
  const header = tokens.filter(t => HEADER_WORDS.has(t.rawText.trim()) && base(t) >= bandTop && base(t) <= bandBottom);
  const pages = header.filter(t => t.rawText.trim() === 'ページ').sort(byVisualX);
  if (pages.length !== 2) return { available: false, reason: `ページ 見出しが${pages.length}個（2個必要）`, headerTokenIndexes: header.map(t => t.index) };
  if (!(pages[0].bbox.xMax < requests[1].bbox.xMin && requests[0].bbox.xMax < pages[0].bbox.xMin && requests[1].bbox.xMax < pages[1].bbox.xMin)) {
    return { available: false, reason: '見出しの左右の並びが 要求,ページ,要求,ページ にならない', headerTokenIndexes: header.map(t => t.index) };
  }
  const headerBottomBaseline = Math.max(...header.map(base));
  return {
    available: true,
    boundaryX: (pages[0].bbox.xMax + requests[1].bbox.xMin) / 2,
    headerBottomBaseline,
    requestHeaderCenters: [(requests[0].bbox.xMin + requests[0].bbox.xMax) / 2, (requests[1].bbox.xMin + requests[1].bbox.xMax) / 2],
    requestHeaderWidths: [requests[0].bbox.xMax - requests[0].bbox.xMin, requests[1].bbox.xMax - requests[1].bbox.xMin],
    pageHeaderRightEdges: [pages[0].bbox.xMax, pages[1].bbox.xMax],
    pageHeaderLeftEdges: [pages[0].bbox.xMin, pages[1].bbox.xMin],
    headerTokenIndexes: header.map(t => t.index),
  };
}

type RowKind = 'ENTRY_CANDIDATE' | 'FRAGMENT' | 'UNRESOLVED';

interface ParsedRow {
  row: PhysicalRowCandidate;
  rowId: string;
  rowOrdinal: number;
  side: Side;
  tokens: SourceToken[]; // 非空白, visual-x 順
  kind: RowKind;
  auditKind?: AuditKind;
  detail?: string;
  requestNumber?: SourceToken;
  pageRefTokens: SourceToken[];
  pageRef?: string;
  labelTokens: SourceToken[];
  shape?: EntryShape;
}

function parseRow(
  row: PhysicalRowCandidate,
  tokenByIndex: Map<number, SourceToken>,
  side: Side,
  rowId: string,
  rowOrdinal: number,
  ev: Extract<ColumnEvidence, { available: true }>,
  fs: number,
  params: TocParams,
): ParsedRow {
  const sideIdx = side === 'left' ? 0 : 1;
  const tokens = row.rawTokenIndexes.map(i => tokenByIndex.get(i)!).sort(byVisualX);
  const base: ParsedRow = { row, rowId, rowOrdinal, side, tokens, kind: 'UNRESOLVED', pageRefTokens: [], labelTokens: [] };
  const fail = (auditKind: AuditKind, detail: string): ParsedRow => ({ ...base, kind: 'UNRESOLVED', auditKind, detail });

  // ページ列帯: 右端揃い。zone 内の token は ページ参照として全体が解釈できなければ曖昧
  const zoneLeft = ev.pageHeaderLeftEdges[sideIdx] - params.pageRefZoneLeftFactor * fs;
  const zone = tokens.filter(t => (t.bbox.xMin + t.bbox.xMax) / 2 >= zoneLeft);
  const rest = tokens.filter(t => !zone.includes(t));
  let pageRef: string | undefined;
  let pageRefTokens: SourceToken[] = [];
  if (zone.length > 0) {
    const rightEdge = ev.pageHeaderRightEdges[sideIdx];
    const last = zone[zone.length - 1];
    const rightAligned = Math.abs(last.bbox.xMax - rightEdge) <= params.pageRefRightEdgeFactor * fs;
    const lastText = last.rawText.trim();
    if (zone.length === 1 && rightAligned && PAGE_REF_ONE_TOKEN.test(last.rawText)) {
      pageRef = last.rawText;
      pageRefTokens = [last];
    } else if (
      zone.length === 2 &&
      rightAligned &&
      DIGITS.test(lastText) &&
      PREFIXES.has(zone[0].rawText.trim()) &&
      zone[0].bbox.xMax <= last.bbox.xMin + 1e-6 &&
      last.bbox.xMin - zone[0].bbox.xMax <= params.prefixGapFactor * fs
    ) {
      pageRef = `${zone[0].rawText}${last.rawText}`;
      pageRefTokens = zone;
    } else {
      return fail('PAGE_REF_AMBIGUOUS', `ページ列帯の token を ページ参照として解釈できない: ${zone.map(t => JSON.stringify(t.rawText)).join(' ')}`);
    }
  }

  // 要求番号: 先頭の数字のみ token で、中心が「要求」見出しの中心付近にあるもの
  let requestNumber: SourceToken | undefined;
  const first = rest[0];
  if (first && REQUEST_NUMBER.test(first.rawText.trim())) {
    const center = (first.bbox.xMin + first.bbox.xMax) / 2;
    if (Math.abs(center - ev.requestHeaderCenters[sideIdx]) <= params.requestNumberCenterFactor * ev.requestHeaderWidths[sideIdx]) requestNumber = first;
  }
  const labelTokens = rest.filter(t => t !== requestNumber);
  const common = { ...base, requestNumber, pageRefTokens, pageRef, labelTokens };

  if (labelTokens.length === 0) {
    if (pageRef !== undefined) return { ...common, kind: 'UNRESOLVED', auditKind: 'PAGE_REF_WITHOUT_TITLE', detail: 'ページ参照のみの行（近接するタイトルとは対応付けない）' };
    if (requestNumber) return { ...common, kind: 'UNRESOLVED', auditKind: 'REQUEST_NUMBER_WITHOUT_TITLE', detail: '要求番号のみの行' };
    return { ...common, kind: 'UNRESOLVED', auditKind: 'UNOWNED_FRAGMENT', detail: '空の行' };
  }

  const firstText = labelTokens[0].rawText.trim();
  const isMarker = MARKER.test(firstText);
  const isCode = CODE.test(firstText);
  const structured = requestNumber !== undefined || isMarker || isCode;
  const hasTitleText = labelRoles(labelTokens).includes('TITLE');
  if (!structured && pageRef === undefined) return { ...common, kind: 'FRAGMENT', auditKind: 'UNOWNED_FRAGMENT', detail: '要求番号・コード・ページ参照のいずれも持たない行（折り返しの続きかは不明）' };
  if (!hasTitleText) return { ...common, kind: 'UNRESOLVED', auditKind: 'NO_TITLE_TEXT', detail: '区分のタイトル文字列がない（コード/見出しのみ）' };
  if (pageRef === undefined) return { ...common, kind: 'UNRESOLVED', auditKind: 'NO_PAGE_REF', detail: 'ページ列帯に参照がない（折り返しの2行目にあるかは不明）' };
  const shape: EntryShape = requestNumber ? 'NUMBERED' : isMarker ? 'MARKER' : isCode ? 'CODE' : 'TITLE_PAGE';
  return { ...common, kind: 'ENTRY_CANDIDATE', shape };
}

/** 区分内の token の役割。見出し（項）等の直後の数字のみ token は、その見出しのコードとして扱う */
export function labelRoles(tokens: SourceToken[]): ('MARKER' | 'CODE' | 'TITLE')[] {
  return tokens.map((t, i) => {
    const text = t.rawText.trim();
    if (MARKER.test(text)) return 'MARKER';
    if (CODE.test(text) || (i > 0 && MARKER.test(tokens[i - 1].rawText.trim()) && DIGITS.test(text))) return 'CODE';
    return 'TITLE';
  });
}

/** 区分文字列: 見出し/コードは前後に ASCII 空白1個。タイトル token 同士は原文のまま連結（空白 token は使わない） */
export function joinLabel(tokens: SourceToken[]): string {
  const roles = labelRoles(tokens);
  let out = '';
  tokens.forEach((t, i) => {
    const special = roles[i] !== 'TITLE';
    const piece = special ? t.rawText.trim() : t.rawText;
    if (out !== '' && (special || roles[i - 1] !== 'TITLE')) out += ' ';
    out += piece;
  });
  return out;
}

export function convertTocPage(input: PageInput, params: TocParams = DEFAULT_TOC_PARAMS): PageResult {
  const { pdfSha256, physicalPage, meta, tokens } = input;
  const idBase = `${sha8(pdfSha256)}-p${physicalPage}`;
  const ledger = new Map<number, LedgerRow>();
  const audits: AuditRecord[] = [];
  const entries: TocEntry[] = [];
  const tokenByIndex = new Map(tokens.map(t => [t.index, t]));
  if (tokenByIndex.size !== tokens.length) throw new Error(`重複した token index: ${idBase}`);
  const setLedger = (t: SourceToken, disposition: Disposition, reason: string, ref: string, side: Side | null) =>
    ledger.set(t.index, { tokenIndex: t.index, rawText: t.rawText, disposition, reason, ref, side });
  const newAudit = (kind: AuditKind, side: Side | null, rowId: string | null, ts: SourceToken[], detail: string, owner?: { rowId: string; entryId: string | null }): AuditRecord => {
    const a: AuditRecord = {
      auditId: `A-${idBase}-${String(audits.length).padStart(3, '0')}`,
      kind,
      side,
      rowId,
      tokenIndexes: ts.map(t => t.index),
      rawTexts: ts.map(t => t.rawText),
      candidateOwnerRowId: owner?.rowId ?? null,
      candidateOwnerEntryId: owner?.entryId ?? null,
      detail,
    };
    audits.push(a);
    for (const t of ts) setLedger(t, 'UNRESOLVED', kind, a.auditId, side);
    return a;
  };

  for (const t of tokens) if (isBlank(t)) setLedger(t, 'BLANK', 'BLANK_TOKEN', '', null);
  const nonBlank = tokens.filter(t => !isBlank(t));
  const evidence = detectColumnEvidence(nonBlank, meta, params);
  const geometricRows = { left: 0, right: 0 };

  if (!evidence.available) {
    // 列の根拠がない: 左右を分けられないので、物理行だけ作って全部 unresolved（意味上の項目ではない）
    const { rows } = clusterPhysicalRows(nonBlank, meta, { yReference: 'baseline', toleranceFactor: params.rowToleranceFactor });
    for (const row of rows) {
      const ts = row.rawTokenIndexes.map(i => tokenByIndex.get(i)!).sort(byVisualX);
      newAudit('NO_COLUMN_EVIDENCE', null, `R-${idBase}-nocol${row.rowIndex}`, ts, evidence.reason);
    }
    return finish();
  }

  const fs = referenceFontSizeOf(nonBlank);
  const headerBottom = evidence.headerBottomBaseline + params.headerBottomToleranceFactor * fs;
  const body: SourceToken[] = [];
  for (const t of nonBlank) {
    if (baselineTopOf(t, meta) <= headerBottom) setLedger(t, 'HEADER_ZONE', evidence.headerTokenIndexes.includes(t.index) ? 'COLUMN_HEADER' : 'ABOVE_COLUMN_HEADER', '', null);
    else body.push(t);
  }

  const leftTokens: SourceToken[] = [];
  const rightTokens: SourceToken[] = [];
  for (const t of body) {
    if (t.bbox.xMax <= evidence.boundaryX) leftTokens.push(t);
    else if (t.bbox.xMin >= evidence.boundaryX) rightTokens.push(t);
    else newAudit('COLUMN_STRADDLE', null, null, [t], `token が列境界 x=${evidence.boundaryX.toFixed(2)} をまたぐ`);
  }

  for (const [side, colTokens] of [['left', leftTokens], ['right', rightTokens]] as const) {
    if (colTokens.length === 0) continue;
    const colFs = referenceFontSizeOf(colTokens);
    const { rows } = clusterPhysicalRows(colTokens, meta, { yReference: 'baseline', toleranceFactor: params.rowToleranceFactor });
    // rows は y 昇順（gapGroups が昇順にソート）
    geometricRows[side] = rows.length;
    const colMap = new Map(colTokens.map(t => [t.index, t]));
    const parsed = rows.map((row, ord) => parseRow(row, colMap, side, `R-${idBase}-${side[0]}${ord}`, ord, evidence, colFs, params));
    const entryIdOf = (p: ParsedRow) => `E-${idBase}-${side[0]}${p.rowOrdinal}`;

    parsed.forEach((p, i) => {
      const prev = parsed[i - 1];
      const next = parsed[i + 1];
      if (p.kind === 'UNRESOLVED') {
        newAudit(p.auditKind!, side, p.rowId, p.tokens, p.detail ?? '');
        return;
      }
      if (p.kind === 'FRAGMENT') {
        // 直前のページ付き行は必ず HOLD_INCOMPLETE_TITLE になるので entry は存在しない。行IDだけを候補として残す
        const owner = prev && prev.kind === 'ENTRY_CANDIDATE' ? { rowId: prev.rowId, entryId: null } : undefined;
        newAudit('UNOWNED_FRAGMENT', side, p.rowId, p.tokens, p.detail ?? '', owner);
        return;
      }
      // ENTRY_CANDIDATE
      if (next && next.kind === 'FRAGMENT') {
        newAudit('HOLD_INCOMPLETE_TITLE', side, p.rowId, p.tokens, 'ページ付きの行の直後に所有者不明の断片行がある。タイトルが完結しているか独立の根拠がない', { rowId: next.rowId, entryId: null });
        return;
      }
      if (p.shape === 'TITLE_PAGE' && prev && prev.kind === 'FRAGMENT') {
        newAudit('HOLD_POSSIBLE_CONTINUATION_TAIL', side, p.rowId, p.tokens, '番号・コードを持たない行の直前に断片行がある。折り返しの末尾の可能性があり単独の項目と断定できない', { rowId: prev.rowId, entryId: null });
        return;
      }
      const entry: TocEntry = {
        entryId: entryIdOf(p),
        rowId: p.rowId,
        side,
        rowOrdinal: p.rowOrdinal,
        requestNumber: p.requestNumber ? p.requestNumber.rawText.trim() : '',
        label: joinLabel(p.labelTokens),
        pageRef: p.pageRef!,
        shape: p.shape!,
        requestNumberTokenIndexes: p.requestNumber ? [p.requestNumber.index] : [],
        labelTokenIndexes: p.labelTokens.map(t => t.index),
        pageRefTokenIndexes: p.pageRefTokens.map(t => t.index),
        bbox: p.row.bbox,
      };
      entries.push(entry);
      for (const t of p.tokens) {
        const role = t === p.requestNumber ? 'REQUEST_NUMBER' : p.pageRefTokens.includes(t) ? 'PAGE_REF' : 'LABEL';
        setLedger(t, 'ENTRY', role, entry.entryId, side);
      }
    });
  }
  return finish();

  function finish(): PageResult {
    const missing = tokens.filter(t => !ledger.has(t.index));
    if (missing.length > 0) throw new Error(`ledger に載らない token: ${idBase} ${missing.map(t => t.index).join(',')}`);
    return {
      pdfSha256,
      physicalPage,
      tokenCount: tokens.length,
      columnEvidence: evidence,
      entries,
      audits,
      ledger: [...ledger.values()].sort((a, b) => a.tokenIndex - b.tokenIndex),
      geometricRows,
    };
  }
}

/** RFC 4180 風: `,` `"` CR LF を含む値だけ二重引用符で囲む。改行は LF、末尾に LF */
export function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
export function renderCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n') + '\n';
}

export const MAIN_CSV_HEADERS = ['要求番号', '区分', 'ページ'];
export function renderMainCsv(entries: TocEntry[]): string {
  return renderCsv(MAIN_CSV_HEADERS, entries.map(e => [e.requestNumber, e.label, e.pageRef]));
}
