/**
 * 入力内容から決定論的に安定IDを作る。配列の入力順（連番）をpublic IDに使わないための基盤
 * （仕様: 20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md 5節）。
 *
 * Python参照実装には2つのID方式が混在しており、両方を移植する。
 * - `stableId`: pipeline_v2/common.py の stable_id/normalize_text と同じ。各パーツを
 *   NFKC正規化＋空白除去してからUS（0x1F）区切りで連結しSHA-256の先頭20桁を使う。
 *   normalized/derived層のrecordId・eventId・relationId・linkIdに使う
 * - `publicStableId`: pipeline_v2/publish.py の `_stable_hex` と同じ。パーツをJSON配列に
 *   直列化（NFKC正規化はしない。値をそのまま比較するため）してSHA-256の先頭20桁を使う。
 *   public/data/v2のsection ID・item IDに使う（実際に生成されたmanifestの値と一致することを
 *   確認済み: general/外務省/在外公館/.../027/経済協力費 → "0067ec27906deaa07022"）
 */
import { createHash } from 'crypto';

/** NFKC正規化して空白を除去する（全角/半角ゆれ・空白ゆれを同一視するための正規化） */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value.normalize('NFKC').replace(/\s+/g, '');
}

/** 複数パーツから安定IDを作る（normalized/derived層用）。同じパーツ列は常に同じIDになる */
export function stableId(parts: (string | number | null | undefined)[], prefix = ''): string {
  const payload = parts.map(p => normalizeText(String(p ?? ''))).join('\x1f');
  const digest = createHash('sha256').update(payload, 'utf-8').digest('hex').slice(0, 20);
  return `${prefix}${digest}`;
}

/**
 * public層のsection/item ID。JSON配列直列化のためNFKC正規化はしない
 * （Pythonの`json.dumps(parts, ensure_ascii=False, separators=(',', ':'), sort_keys=False)`と
 * 同じ区切り記号・キー順を使う必要がある。値は文字列・数値のみを渡すこと）
 */
export function publicStableId(parts: (string | number)[]): string {
  const payload = JSON.stringify(parts);
  return createHash('sha256').update(payload, 'utf-8').digest('hex').slice(0, 20);
}

/** stable IDの先頭2桁（16進）をshard名として使う。256shard構成の基準 */
export function shardOf(id: string): string {
  return id.slice(0, 2);
}
