/**
 * page header / first title line の label の source-only projection と segmentation（research-only 純関数）。
 * 規則は docs/tasks/20261005_0930_Budget_Request_Page_Header_Label_Segment_Protocol.md（全件走査前に固定）。label の意味は解釈しない。blank / unavailable は補完・bridge しない。
 */
export type RowClass = 'request' | 'plain3' | 'plain3_only' | 'hyphen' | 'other';
const REQ_CODE = /^\d{2}[-‐-―−]\d{2}/;
export function classifyRow(texts: string[]): RowClass {
  if (texts.length >= 2 && /^\d{1,3}$/.test(texts[0]) && REQ_CODE.test(texts[1])) return 'request';
  if (/^\d{3}$/.test(texts[0] ?? '')) return texts.length >= 2 ? 'plain3' : 'plain3_only';
  if (/^\d{2,3}[-‐-―−]\d/.test(texts[0] ?? '')) return 'hyphen';
  return 'other';
}

export type TitleStatus = 'observed_nonblank' | 'observed_blank' | 'unavailable_upstream' | 'unavailable_rotate90' | 'other_unavailable';
export type BlankReason = 'no_title_row' | 'empty_row' | 'digits_only';

export interface LogicalRowText { logicalRowIndex: number; physicalRowIndexes: number[]; tokenIndexes: number[]; texts: string[] }
export interface PageTitle { status: TitleStatus; blankReason: BlankReason | null; firstTitleRaw: string | null; firstTitleNormalized: string | null; shape: LabelShape | null; sourceRefs: { logicalRowIndex: number; physicalRowIndexes: number[]; tokenIndexes: number[] } | null }
export interface LabelShape { length: number; parenthesized: boolean; prefixLength: number | null; innerLength: number | null }

/** NFKC → 全ての空白と数字（\d）を除去。意味変換はしない */
export const normalizeLabel = (raw: string): string => raw.normalize('NFKC').replace(/[\s　]+/g, '').replace(/\d/g, '');

export function shapeOf(normalized: string): LabelShape {
  const m = /^([^()]+)\(([^()]+)\)$/.exec(normalized);
  return { length: normalized.length, parenthesized: !!m, prefixLength: m ? m[1].length : null, innerLength: m ? m[2].length : null };
}

/** page の logical row（上から順）から first title line を取り出す。title 行 = 最初の code 行より前の row */
export function titleOfPage(rows: LogicalRowText[]): PageTitle {
  const firstCode = rows.findIndex(r => classifyRow(r.texts) !== 'other');
  const titleRows = rows.slice(0, firstCode < 0 ? rows.length : firstCode);
  if (titleRows.length === 0) return { status: 'observed_blank', blankReason: 'no_title_row', firstTitleRaw: null, firstTitleNormalized: null, shape: null, sourceRefs: null };
  const t = titleRows[0];
  const raw = t.texts.join(' ');
  const refs = { logicalRowIndex: t.logicalRowIndex, physicalRowIndexes: t.physicalRowIndexes, tokenIndexes: t.tokenIndexes };
  if (raw.trim() === '') return { status: 'observed_blank', blankReason: 'empty_row', firstTitleRaw: raw, firstTitleNormalized: '', shape: null, sourceRefs: refs };
  const normalized = normalizeLabel(raw);
  if (normalized === '') return { status: 'observed_blank', blankReason: 'digits_only', firstTitleRaw: raw, firstTitleNormalized: '', shape: null, sourceRefs: refs };
  return { status: 'observed_nonblank', blankReason: null, firstTitleRaw: raw, firstTitleNormalized: normalized, shape: shapeOf(normalized), sourceRefs: refs };
}

export interface PageProjection { page: number; title: PageTitle }
export interface Segment { id: number; kind: 'label' | 'blank' | 'unavailable'; state: string; from: number; to: number; pages: number }

/** 連続 page の同 label（observed_nonblank・normalized が完全一致）を 1 segment。blank / unavailable は同 status が連続する間だけ 1 つの state run。page 番号が飛べば別 segment */
export function segmentize(pages: PageProjection[]): Segment[] {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const out: Segment[] = [];
  for (const p of sorted) {
    const t = p.title;
    const kind: Segment['kind'] = t.status === 'observed_nonblank' ? 'label' : t.status === 'observed_blank' ? 'blank' : 'unavailable';
    const state = t.status === 'observed_nonblank' ? (t.firstTitleNormalized as string) : t.status;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.state === state && last.to === p.page - 1) { last.to = p.page; last.pages++; }
    else out.push({ id: out.length + 1, kind, state, from: p.page, to: p.page, pages: 1 });
  }
  return out;
}
