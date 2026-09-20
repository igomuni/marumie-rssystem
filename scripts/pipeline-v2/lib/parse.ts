/**
 * blank（未記載）と明示的な0円を区別して扱うためのパーサ群。
 * Python参照実装（pipeline_v2/common.py）の parse_int/parse_number/yen_from_thousand/
 * canonical_project_id と同じ挙動に揃えている。
 *
 * 「空欄=0円」と決め打つと、本来は「値が無い（該当行が存在しない）」ことと
 * 「0円と明記されている」ことの違いが失われる（仕様書「4. blankと明示的zeroを区別する」）。
 */

const BLANK_TOKENS = new Set(['-', '--', '―', 'ー']);

function cleanNumericText(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).normalize('NFKC').replace(/,/g, '').trim();
}

/** 整数として読む。blankや非数値は既定で0（noneIfBlank指定時はnull） */
export function parseIntValue(raw: string | null | undefined, options: { noneIfBlank?: boolean } = {}): number | null {
  const fallback = options.noneIfBlank ? null : 0;
  const s = cleanNumericText(raw);
  if (!s || BLANK_TOKENS.has(s)) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/** 原本の数値セルをblankをnullのまま読む（0に潰さない）。整数ならinteger、小数ならfloatを返す */
export function parseNumber(raw: string | null | undefined): number | null {
  const s = cleanNumericText(raw);
  if (!s || BLANK_TOKENS.has(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 千円単位の金額セルを円に変換する（BigIntによる固定小数点演算。浮動小数点誤差を避ける）。
 * 例: "11200.834"（千円）→ 11200834（円）。小数点以下4桁目以降は切り捨てる。
 */
export function yenFromThousand(raw: string | null | undefined, options: { noneIfBlank?: boolean } = {}): number | null {
  const fallback = options.noneIfBlank ? null : 0;
  const s = cleanNumericText(raw);
  if (!s || BLANK_TOKENS.has(s)) return fallback;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return fallback;
  const [, sign, intPart, fracPart = ''] = m;
  const scaledFrac = (fracPart + '000').slice(0, 3);
  const yen = BigInt(intPart + scaledFrac) * BigInt(sign === '-' ? -1 : 1);
  return Number(yen);
}

/**
 * RS事業IDの正規化。数値のみで構成される場合は先頭の0を除去する（"000004" → "4"）。
 * 数値でないIDはNFKC正規化した文字列のまま保持する（数値化して情報を失わないため）。
 */
export function canonicalProjectId(raw: string | null | undefined): string {
  const s = (raw ?? '').toString().normalize('NFC').trim();
  if (!s) return '';
  const n = s.normalize('NFKC');
  if (/^[0-9]+$/.test(n)) return n.replace(/^0+/, '') || '0';
  return n;
}

const TRUE_TOKENS = new Set(['TRUE', '1', 'YES', 'Y', '○', '有', 'あり']);
const FALSE_TOKENS = new Set(['FALSE', '0', 'NO', 'N', '×', '無', 'なし']);

/** TRUE/FALSE系フラグ列を読む。Python参照実装のparse_boolと同じトークン集合 */
export function parseBool(raw: string | null | undefined): boolean | null {
  const s = (raw ?? '').toString().normalize('NFKC').trim().toUpperCase();
  if (!s) return null;
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return null;
}

/** TRUE/FALSEとして読めればboolean、読めなければ原本の文字列（空欄はnull）を返す。
 *  1-2の実施方法列のように「1固定 or 空欄」だが将来別表記が来ても値を失わないため */
export function boolOrRaw(raw: string | null | undefined): boolean | string | null {
  const b = parseBool(raw);
  if (b !== null) return b;
  const s = (raw ?? '').toString().trim();
  return s || null;
}
