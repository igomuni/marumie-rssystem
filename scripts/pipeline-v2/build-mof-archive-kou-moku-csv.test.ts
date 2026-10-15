import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './build-mof-archive-kou-moku-csv';

describe('parseCsv', () => {
  it('引用符・引用符内のカンマと改行・"" のエスケープ・空欄を読む', () => {
    expect(parseCsv('a,b\n"x,1","y""z"\n,"l1\nl2"\n')).toEqual([['a', 'b'], ['x,1', 'y"z'], ['', 'l1\nl2']]);
  });
  it('末尾に改行がなくても最後の行を読む', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

// archive（git 管理外）がある環境だけ、正の CSV を再生成して一致を確認する
const ARCHIVE = path.join('data', 'download', 'mof.go.jp', 'archive', '2025', '2025', 'csv', 'DL202511001.zip');
describe.skipIf(!fs.existsSync(ARCHIVE))('build-mof-archive-kou-moku-csv (needs data/)', () => {
  it('2025 の項・目の CSV が tests/fixtures/mof-archive-csv/2025 とバイト単位で一致する', async () => {
    const { execFileSync } = await import('child_process');
    const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kou-moku-'));
    execFileSync('npx', ['tsx', 'scripts/pipeline-v2/build-mof-archive-kou-moku-csv.ts', '2025', out], { stdio: 'ignore' });
    for (const f of ['kou-general', 'kou-special', 'moku-general', 'moku-special']) {
      expect(fs.readFileSync(path.join(out, `${f}.csv`))).toEqual(fs.readFileSync(path.join('tests', 'fixtures', 'mof-archive-csv', '2025', `${f}.csv`)));
    }
  }, 60_000);
});
