/**
 * MOF 未一致項の source 検索（research-only 純関数）。新しい抽出 rule ではなく、page の token 連結 text に対する名称検索とヒット位置の記述だけを行う。
 * 規則は docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md。MOF 名になるよう別行・別セル・別 page を連結しない（token の連結は pdf.js の抽出順の隣接のみ）。
 */
export interface TokenLite { index: number; rawText: string; bbox: { xMin: number; xMax: number; yMin: number; yMax: number }; fontSize: number }
export type HitKind = 'SINGLE_TOKEN_EXACT' | 'EMBEDDED_IN_LARGER_TOKEN' | 'MULTI_TOKEN_NAME_CELL_CONTINUATION' | 'MULTI_TOKEN_OTHER';
export interface Hit { kind: HitKind; tokens: TokenLite[]; startsAtTokenStart: boolean; endsAtTokenEnd: boolean }

export const normalizeText = (s: string): string => s.normalize('NFKC').replace(/\s+/g, '');

/** page の token（抽出順）を正規化して連結し、name の全出現位置を token 範囲へ対応づける */
export function findNameHits(tokens: TokenLite[], name: string): Hit[] {
  const segs = tokens.map(t => normalizeText(t.rawText));
  const offs: number[] = []; let acc = 0;
  for (const s of segs) { offs.push(acc); acc += s.length; }
  const joined = segs.join('');
  const hits: Hit[] = [];
  if (name === '') return hits;
  for (let from = joined.indexOf(name); from >= 0; from = joined.indexOf(name, from + 1)) {
    const to = from + name.length;
    const idx: number[] = [];
    for (let i = 0; i < tokens.length; i++) if (segs[i].length > 0 && offs[i] < to && offs[i] + segs[i].length > from) idx.push(i);
    if (idx.length === 0) continue;
    const toks = idx.map(i => tokens[i]);
    const startsAtTokenStart = offs[idx[0]] === from, endsAtTokenEnd = offs[idx[idx.length - 1]] + segs[idx[idx.length - 1]].length === to;
    let kind: HitKind;
    if (idx.length === 1) kind = startsAtTokenStart && endsAtTokenEnd ? 'SINGLE_TOKEN_EXACT' : 'EMBEDDED_IN_LARGER_TOKEN';
    else kind = startsAtTokenStart && endsAtTokenEnd && isNameCellContinuation(toks) ? 'MULTI_TOKEN_NAME_CELL_CONTINUATION' : 'MULTI_TOKEN_OTHER';
    hits.push({ kind, tokens: toks, startsAtTokenStart, endsAtTokenEnd });
  }
  return hits;
}

/** 複数 token が名称セル内の折り返しか: 各 token の xMin が先頭 token と 0.25 × フォントサイズ以内で揃い、y が 0.75〜1.5 × フォントサイズ刻みで下がる（既存 guard の係数の転記） */
export function isNameCellContinuation(toks: TokenLite[]): boolean {
  const fs = toks[0].fontSize;
  for (let j = 1; j < toks.length; j++) {
    const dy = toks[j].bbox.yMin - toks[j - 1].bbox.yMin;
    if (Math.abs(toks[j].bbox.xMin - toks[0].bbox.xMin) > 0.25 * fs + 1e-9) return false;
    if (dy < 0.75 * fs - 1e-9 || dy > 1.5 * fs + 1e-9) return false;
  }
  return true;
}

export type LeftCode = { text: string; shape: 'plain3' | 'request_code' | 'other'; xMin: number } | null;
/** ヒットの先頭 token と同じ行（縦中心が 0.5 × フォントサイズ以内）で、直前（左）の token */
export function leftCodeOf(tokens: TokenLite[], first: TokenLite): LeftCode {
  const cy = (t: TokenLite) => (t.bbox.yMin + t.bbox.yMax) / 2;
  const cand = tokens.filter(t => t.index !== first.index && t.rawText.trim() !== '' && Math.abs(cy(t) - cy(first)) <= 0.5 * first.fontSize && t.bbox.xMax <= first.bbox.xMin + 0.1).sort((a, b) => b.bbox.xMax - a.bbox.xMax)[0];
  if (!cand) return null;
  const text = cand.rawText.trim();
  return { text, shape: /^\d{3}$/.test(text) ? 'plain3' : /^\d{2}-\d{2,5}$/.test(text) ? 'request_code' : 'other', xMin: cand.bbox.xMin };
}

export type PdfRepresentation = 'TEXT_GEOMETRY_AVAILABLE' | 'TEXT_PRESENT_UNICODE_UNRESOLVED' | 'DRAWING_PATH_TEXT' | 'RASTER_IMAGE_ONLY' | 'OTHER' | 'UNKNOWN';
export function classifyRepresentation(s: { tokens: number; asciiDigitTokens: number; sampledImages: number; sampledPaths: number; sampledPages: number }): PdfRepresentation {
  if (s.tokens > 0) return s.asciiDigitTokens > 0 ? 'TEXT_GEOMETRY_AVAILABLE' : 'TEXT_PRESENT_UNICODE_UNRESOLVED';
  if (s.sampledPages === 0) return 'UNKNOWN';
  if (s.sampledImages > 0 && s.sampledImages >= s.sampledPaths / 100) return 'RASTER_IMAGE_ONLY';
  if (s.sampledPaths > 0) return 'DRAWING_PATH_TEXT';
  return 'OTHER';
}
