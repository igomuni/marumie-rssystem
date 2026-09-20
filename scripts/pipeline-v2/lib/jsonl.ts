import * as fs from 'fs';
import * as path from 'path';

/** 1行1レコードのJSON Lines形式で書き出す。行数を返す */
export function writeJsonl(outPath: string, rows: unknown[]): number {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = rows.map(r => JSON.stringify(r));
  fs.writeFileSync(outPath, lines.length > 0 ? lines.join('\n') + '\n' : '');
  return rows.length;
}

export function writeJson(outPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
}

export function readJsonl<T>(inPath: string): T[] {
  if (!fs.existsSync(inPath)) return [];
  return fs.readFileSync(inPath, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as T);
}
