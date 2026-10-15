import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { readMenuAncestorChains } from './mof-budget-xml-items-general';
import { MofXmlParseError } from './mof-budget-xml-items-general';
import { parseMofSpecialXmlFile, specialScopeFromChain, type MofSpecialParserSpec } from './mof-budget-xml-special-items';

const CSV_DIR = path.join('tests', 'fixtures', 'mof-archive-csv');
const SET_DIR = path.join('tests', 'fixtures', 'mof-xml-parser-special');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const VERSIONS = ['2024', '2025', '2025_teishutsu'] as const;
const EXPECTED = { '2024': { targets: 32, nonTargets: 249, records: 360, items: 250 }, '2025': { targets: 34, nonTargets: 265, records: 365, items: 254 }, '2025_teishutsu': { targets: 34, nonTargets: 265, records: 365, items: 254 } };

describe('special-account jikou: final CSV and source sets', () => {
  it('mof-archive-csv の manifest の SHA-256 が全 CSV と一致する', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(CSV_DIR, 'manifest.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(manifest)).toHaveLength(6 * fs.readdirSync(CSV_DIR).filter(d => fs.statSync(path.join(CSV_DIR, d)).isDirectory()).length);
    for (const [f, h] of Object.entries(manifest)) expect(sha(fs.readFileSync(path.join(CSV_DIR, f)))).toBe(h);
  });
  for (const v of VERSIONS) {
    it(`${v}: source set の件数、事項の行数、項の数（公式 CSV の項と同数）、前年度の空欄は新勘定の 5 行だけ`, () => {
      const set = JSON.parse(fs.readFileSync(path.join(SET_DIR, v, 'source-set.json'), 'utf8')) as { targets: unknown[]; nonTargets: unknown[] };
      expect(set.targets).toHaveLength(EXPECTED[v].targets);
      expect(set.nonTargets).toHaveLength(EXPECTED[v].nonTargets);
      const lines = fs.readFileSync(path.join(CSV_DIR, v, 'jikou-special.csv'), 'utf8').trimEnd().split('\n');
      expect(lines).toHaveLength(EXPECTED[v].records + 1);
      const kou = fs.readFileSync(path.join(CSV_DIR, v, 'kou-special.csv'), 'utf8').trimEnd().split('\n');
      expect(kou).toHaveLength(EXPECTED[v].items + 1);
      const blank = lines.slice(1).filter(l => /\d,,,\d+a\.xml,/.test(l)); // 予定額,（前年度）,（差額）,source_file
      expect(blank).toHaveLength(v === '2024' ? 0 : 5);
      expect(blank.every(l => l.includes('202512001000170a.xml'))).toBe(true);
    });
  }
});

describe('specialScopeFromChain', () => {
  const base = ['令和6年度特別会計予算参照書', '令和6年度特別会計歳入歳出予定計算書等', '農林水産省所管', '食料安定供給', '甲号歳入歳出予定計算書'];
  it('勘定あり／なし', () => {
    expect(specialScopeFromChain([...base, '食糧管理勘定', '歳出 事項別内訳'], 'f')).toEqual({ ministry: '農林水産省', specialAccount: '食料安定供給', subAccount: '食糧管理勘定' });
    expect(specialScopeFromChain([...base, '歳出 事項別内訳'], 'f').subAccount).toBe('');
  });
  it('末尾・marker・所管が想定外なら例外', () => {
    expect(() => specialScopeFromChain([...base, '歳入 事項別内訳'], 'f')).toThrow(MofXmlParseError);
    expect(() => specialScopeFromChain(['a', 'b', '歳出 事項別内訳'], 'f')).toThrow(MofXmlParseError);
    expect(() => specialScopeFromChain([...base.slice(0, 2), '農林水産省', '食料安定供給', '甲号歳入歳出予定計算書', '歳出 事項別内訳'], 'f')).toThrow(MofXmlParseError);
  });
});

// raw XML（git 管理外）がある環境だけ、例外の 3 ファイルを実際に通す
const ARCHIVE = path.join('data', 'download', 'mof.go.jp', 'archive');
const have = fs.existsSync(path.join(ARCHIVE, '2025', '2025', 'xml', '202512001000337a.xml'));
describe.skipIf(!have)('special-account jikou: exception files (needs data/)', () => {
  const spec: MofSpecialParserSpec = { documentId: '202512001', doctype: 'DOCTYPE budget SYSTEM "../dtd/202501.dtd"', yearLabel: '令和7年度' };
  const set = JSON.parse(fs.readFileSync(path.join(SET_DIR, '2025', 'source-set.json'), 'utf8')) as { targets: { file: string; sha256: string }[]; nonTargets: { file: string; sha256: string }[] };
  const sourceSet = new Map([...set.targets, ...set.nonTargets].map(t => [t.file, t.sha256]));
  const chains = readMenuAncestorChains(new TextDecoder('euc-jp').decode(fs.readFileSync(path.join(ARCHIVE, '2025', '2025', 'html', '202512001menu.html'))));
  const run = (f: string) => parseMofSpecialXmlFile({ filename: f, bytes: fs.readFileSync(path.join(ARCHIVE, '2025', '2025', 'xml', f)), menuChain: chains.get(f), sourceSet, spec });
  it('食糧管理勘定: 入れ子の表を無視して後ろの項（02,03,04,05,09）まで読む', () => {
    const o = run('202512001000337a.xml');
    if (o.status !== 'recognized') throw new Error('not recognized');
    expect(o.records.map(r => r.itemCode).filter((c, i, a) => a.indexOf(c) === i)).toEqual(['01', '02', '03', '04', '05', '09']);
    expect(o.counts.nestedTableCells).toBeGreaterThan(0);
  });
  it('新勘定（前年度の列なし）: 前年度・比較増△減額は null（0 にしない）', () => {
    const o = run('202512001000170a.xml');
    if (o.status !== 'recognized') throw new Error('not recognized');
    expect(o.layout).toBe('noprev');
    expect(o.records.every(r => r.amountsThousandYen.prev === null && r.amountsThousandYen.diff === null)).toBe(true);
  });
  it('復興庁: org 型で、組織が埋まる', () => {
    const o = run('202512001000473a.xml');
    if (o.status !== 'recognized') throw new Error('not recognized');
    expect(o.layout).toBe('org');
    expect(new Set(o.records.map(r => r.organization))).toEqual(new Set(['復興庁', '総務本省', '財務本省']));
  });
  it('一般の勘定は組織が空欄、対象外のファイルは not_target', () => {
    const o = run('202512001000080a.xml');
    if (o.status !== 'recognized') throw new Error('not recognized');
    expect(o.records.every(r => r.organization === '')).toBe(true);
    expect(run('202512001000001a.xml').status).toBe('not_target');
  });
  it('SHA が source set と違えば unsupported', () => {
    const f = '202512001000080a.xml';
    const bad = new Map(sourceSet); bad.set(f, '0'.repeat(64));
    const o = parseMofSpecialXmlFile({ filename: f, bytes: fs.readFileSync(path.join(ARCHIVE, '2025', '2025', 'xml', f)), menuChain: chains.get(f), sourceSet: bad, spec });
    expect(o).toMatchObject({ status: 'unsupported', reason: 'source_hash_mismatch' });
  });
});
