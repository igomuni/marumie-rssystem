/**
 * 概算要求PDFの Raw Text 層（physical PDF → PageRawText[]）。page 単位の文字観測だけを扱い、意味付け（page type・項・金額・MOF 照合等）はしない。
 *
 * contract:
 *   - page は physical page の 1-based 番号（印刷ページ番号とは別概念）。pdfinfo の Pages と PageRawText の件数は一致しなければならない（不一致は throw）。
 *   - `text` は抽出器が返した page 文字列をそのまま保持する（正規化・再整形・行結合・Unicode 置換をしない）。
 *   - `nonEmptyLines` は text から決定的に導出する派生値。行区切りは "\n"（"\r" は除去せず行内に残す）、行は trim せず元の文字列のまま、
 *     空白判定は JS の /\S/（Unicode White_Space を含む）で「non-whitespace を 1 文字以上含む行」を non-empty とする。
 *   - page status: EXTRACTED = non-whitespace を 1 文字以上取得 / EMPTY = 取得できなかった。EMPTY は「source PDF に文字がない」ではなく
 *     「configured text extraction method で text を取得できなかった」という観測であり、理由（representation-blocked 等）は分類しない。
 *   - document status: EXTRACTED（いずれかの page が EXTRACTED）/ EMPTY（全 page が EMPTY でも page record は pageCount 件作る）/ FAILED（抽出器が PDF を処理できない。page record は作らない）。
 */
import * as crypto from 'crypto';

export type RawTextStatus = 'EXTRACTED' | 'EMPTY';
export type RawTextDocumentStatus = RawTextStatus | 'FAILED';

export interface PageRawText {
  /** physical page, 1-based */
  page: number;
  text: string;
  textSha256: string;
  charCount: number;
  nonWhitespaceCharCount: number;
  status: RawTextStatus;
  nonEmptyLines: { lineIndex: number; text: string }[];
}

export const sha256Hex = (data: Buffer | string): string => crypto.createHash('sha256').update(data).digest('hex');

export function isNonEmptyLine(line: string): boolean {
  return /\S/.test(line);
}

/** lineIndex は text.split("\n") 上の 0-based index */
export function nonEmptyLinesOf(text: string): { lineIndex: number; text: string }[] {
  const out: { lineIndex: number; text: string }[] = [];
  text.split('\n').forEach((line, lineIndex) => { if (isNonEmptyLine(line)) out.push({ lineIndex, text: line }); });
  return out;
}

/**
 * `pdftotext` の標準出力（page 末尾に form feed を置く）を physical page ごとに分割する。
 * 出力は各 page の末尾に form feed を持つ前提で、末尾の form feed が作る空要素だけを取り除く。件数が pageCount と合わなければ page boundary を保持できないとして throw する。
 */
export function splitPdftotextPages(raw: string, pageCount: number): string[] {
  if (!raw.endsWith('\f')) throw new Error('page boundary mismatch: pdftotext output does not end with a form feed');
  const parts = raw.split('\f');
  parts.pop();
  if (parts.length !== pageCount) {
    throw new Error(`page boundary mismatch: pdftotext returned ${parts.length} page chunks, expected ${pageCount}`);
  }
  return parts;
}

export function buildPageRawText(page: number, text: string): PageRawText {
  const nonWhitespaceCharCount = text.replace(/\s/g, '').length;
  return {
    page,
    text,
    textSha256: sha256Hex(text),
    charCount: text.length,
    nonWhitespaceCharCount,
    status: nonWhitespaceCharCount > 0 ? 'EXTRACTED' : 'EMPTY',
    nonEmptyLines: nonEmptyLinesOf(text),
  };
}

export function buildDocumentPages(raw: string, pageCount: number): PageRawText[] {
  return splitPdftotextPages(raw, pageCount).map((t, i) => buildPageRawText(i + 1, t));
}

export function documentStatusOf(pages: PageRawText[]): RawTextStatus {
  return pages.some(p => p.status === 'EXTRACTED') ? 'EXTRACTED' : 'EMPTY';
}
