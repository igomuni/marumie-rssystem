/**
 * 支出先キーの正規化（Pure関数）。
 * 生成スクリプトとAPI・UIで同一ロジックを共有し、キーの不一致を防ぐ。
 *
 * キー規約:
 * - 法人番号あり → "1234567890123"（13桁そのまま）
 * - 法人番号なし → "name:" + 正規化名
 */

/** 法人格の略記を正式表記へ統一 */
const CORPORATE_ABBREVIATIONS: ReadonlyArray<[RegExp, string]> = [
  [/[(（]株[)）]|㈱/g, '株式会社'],
  [/[(（]有[)）]|㈲/g, '有限会社'],
  [/[(（]合[)）]/g, '合同会社'],
  [/[(（]財[)）]/g, '財団法人'],
  [/[(（]社[)）]/g, '社団法人'],
  [/[(（]独[)）]/g, '独立行政法人'],
];

/** 支出先名の正規化: NFKC + 空白除去 + 小文字化 + 法人格略記の統一 */
export function normalizeRecipientName(name: string): string {
  let s = name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  for (const [pattern, replacement] of CORPORATE_ABBREVIATIONS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

/** インデックス対象外の支出先名（集約行のため個社として扱えない） */
export function isExcludedRecipientName(name: string): boolean {
  const n = name.normalize('NFKC').trim();
  return n === '' || n === 'その他';
}

export function buildRecipientKey(name: string, corporateNumber: string): string {
  const cn = corporateNumber.trim();
  if (/^\d{13}$/.test(cn)) return cn;
  return `name:${normalizeRecipientName(name)}`;
}
