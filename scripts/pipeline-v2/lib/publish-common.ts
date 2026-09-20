/**
 * Publish層（public/data/v2）共通ユーティリティ。
 * 参照実装: Python版 pipeline_v2/publish.py の _pick/_meaningful/_write_gzip_json/_rs_shard。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

export const PUBLISH_SCHEMA_VERSION = 1;
export const SHARD_COUNT = 256;

/** 意味のある値かどうか（null/undefined/空文字/空配列/空オブジェクトは「無い」として扱う。0とfalseは残す） */
export function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

/** 指定キーのみ、値が意味を持つ場合だけ残す（0/falseは既定で残す） */
export function pick<T extends Record<string, unknown>>(row: T, keys: readonly (keyof T & string)[], options: { keepZero?: boolean } = {}): Record<string, unknown> {
  const keepZero = options.keepZero ?? true;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = row[key];
    if (!meaningful(value)) continue;
    if (!keepZero && value === 0) continue;
    out[key] = value;
  }
  return out;
}

/** RS共通のRsBaseFields相当の列（projectId等）を落として、データセット固有の列だけ残す */
export function stripRsCommon(row: Record<string, unknown>, extraDrop: Set<string> = new Set()): Record<string, unknown> {
  const drop = new Set([
    'schemaVersion', 'recordType', 'sourceSystem', 'sourceYear', 'reviewYear', 'projectId', 'projectIdRaw', 'projectName',
    'ministry', 'policyMinistry', 'ministryOrderRaw', 'bureau', 'department', 'division', 'office', 'team', 'unit',
    'sheetType', 'extraFields', 'source', 'sources', 'sourceRowId', 'evidenceRowIds',
    ...extraDrop,
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (drop.has(k)) continue;
    if (meaningful(v)) out[k] = v;
  }
  return out;
}

/** rs-project:{projectId}のSHA-256先頭2桁（00-ff）。256 shard分割に使う */
export function rsShard(projectId: string): string {
  return crypto.createHash('sha256').update(`rs-project:${projectId}`).digest('hex').slice(0, 2);
}

export function writeJson(filePath: string, value: unknown): number {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = Buffer.from(JSON.stringify(value), 'utf-8');
  fs.writeFileSync(filePath, data);
  return data.length;
}

/** gzip -9、mtime固定でビルドの再現性を確保する */
export function writeGzipJson(filePath: string, value: unknown): number {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = Buffer.from(JSON.stringify(value), 'utf-8');
  const compressed = zlib.gzipSync(data, { level: 9 });
  fs.writeFileSync(filePath, compressed);
  return compressed.length;
}
