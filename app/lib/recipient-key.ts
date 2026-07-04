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
  // 「その他」集約行は個社として扱わない。中文表記「其他」も念のため除外（現データには未出現）。
  return n === '' || n === 'その他' || n === '其他';
}

/**
 * 有効な法人番号か。13桁の数字であっても、以下は無効として扱う:
 * - 全桁が同一のもの（9999999999999=個人・非公表、8888888888888 等のダミー）
 * - チェックディジット（先頭1桁の検査数字）が基礎番号12桁と整合しないもの（誤記載）
 * これらを正規番号とみなすと、個人・職員・自治体など無関係な支出先が
 * 1つのエントリに誤って合算されてしまう。
 */
export function isValidCorporateNumber(corporateNumber: string): boolean {
  const cn = corporateNumber.trim();
  if (!/^\d{13}$/.test(cn)) return false;
  if (/^(\d)\1{12}$/.test(cn)) return false; // 全桁同一のダミー
  return hasValidCheckDigit(cn);
}

/**
 * 法人番号のチェックディジット検証。13桁の先頭1桁が検査用数字、残り12桁が基礎番号。
 * 検査用数字 = 9 −（Σ[n=1..12] Pn×Qn を 9 で割った余り）
 *   Pn = 基礎番号の下 n 桁目、Qn = n が奇数なら1・偶数なら2。
 * 前提: cn は13桁の数字であること（呼び出し側で担保）。
 */
function hasValidCheckDigit(cn: string): boolean {
  const base = cn.slice(1); // 基礎番号12桁
  let sum = 0;
  for (let n = 1; n <= 12; n++) {
    const Pn = Number(base[12 - n]); // 下 n 桁目
    const Qn = n % 2 === 1 ? 1 : 2;
    sum += Pn * Qn;
  }
  return 9 - (sum % 9) === Number(cn[0]);
}

export function buildRecipientKey(name: string, corporateNumber: string): string {
  if (isValidCorporateNumber(corporateNumber)) return corporateNumber.trim();
  return `name:${normalizeRecipientName(name)}`;
}
