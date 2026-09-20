import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/**
 * 1行1レコードのJSON Lines形式で書き出す。行数を返す。
 *
 * ファイル記述子への逐次writeSyncで書く（配列全体を文字列化してから
 * 1回のwriteFileSyncで書くと、文字列化後の全行連結分もメモリに載る。
 * MOF約2万行では問題にならないが、RS 15CSVはNormalized合計が
 * 数百万行・GB級になりうるため、大規模投入前にstreaming化しておく）。
 */
export function writeJsonl(outPath: string, rows: Iterable<unknown>): number {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, 'w');
  let count = 0;
  try {
    for (const row of rows) {
      fs.writeSync(fd, JSON.stringify(row) + '\n');
      count++;
    }
  } finally {
    fs.closeSync(fd);
  }
  return count;
}

export function writeJson(outPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
}

/** 全件を配列で読む。小さいファイル専用（大きいファイルは readJsonlStream を使う） */
export function readJsonl<T>(inPath: string): T[] {
  if (!fs.existsSync(inPath)) return [];
  return fs.readFileSync(inPath, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as T);
}

/** 1行ずつ読む非同期ジェネレータ。ファイル全体をメモリに載せない */
export async function* readJsonlStream<T>(inPath: string): AsyncGenerator<T> {
  if (!fs.existsSync(inPath)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(inPath, 'utf-8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line) as T;
  }
}
