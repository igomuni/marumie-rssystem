import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024');
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as T;
const inv = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-budget-xml-inventory', '2024', '202411001-source-inventory.json'), 'utf8')) as { files: { filename: string; sha256: string }[] };
const set = read<{ xmlFiles: number; targetTableFiles: number; nonTargetFiles: number; expected: Record<string, number>; targets: { file: string; sha256: string; itemStartRows: number; requestRows: number }[]; nonTargets: { file: string; sha256: string; titleForList: string }[] }>('202411001-source-set.json');
type Rec = { file: string; row: string; page: number; organization: string; itemCode: string; itemName: string; requestName: string; col4Raw: string; amountsRaw: Record<string, string>; amountsThousandYen: Record<string, number>; requestQtCount: number; requestGaiji: unknown[]; itemStartsInThisRow: boolean };
const proj = read<{ sourceSetSha256: string; recordCount: number; records: Rec[] }>('202411001-reference-projection.json');
const hand = read<{ rowCount: number; rows: { file: string; row: string; reasons: string[]; rawClmFragments: string[]; expected: Rec }[] }>('202411001-hand-checked-fixture.json');
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex');

// 実装前に凍結した oracle の整合性（artifact のみ。raw XML は git 管理外。再生成の一致は generator の --check で確認する）
describe('MOF budget XML parser v0 frozen fixtures', () => {
  it('source set: 328 = 94 対象 + 234 対象外。hash が inventory と一致し、期待件数が固定されている', () => {
    expect(set.xmlFiles).toBe(328);
    expect(set.targets).toHaveLength(94);
    expect(set.nonTargets).toHaveLength(234);
    const invHash = new Map(inv.files.map(f => [f.filename, f.sha256]));
    for (const t of [...set.targets, ...set.nonTargets]) expect(invHash.get(t.file)).toBe(t.sha256);
    expect(new Set([...set.targets, ...set.nonTargets].map(t => t.file)).size).toBe(328);
    expect(set.nonTargets.every(n => n.titleForList !== '〔組織別事項別内訳〕')).toBe(true);
    expect(set.expected).toMatchObject({ itemStartRows: 784, requestRows: 1256 });
  });
  it('reference projection: 1,256 件・重複なし・孤児なし・source set と一致', () => {
    expect(proj.recordCount).toBe(1256);
    expect(proj.records).toHaveLength(1256);
    expect(proj.sourceSetSha256).toBe(sha('202411001-source-set.json'));
    expect(new Set(proj.records.map(r => `${r.file}#${r.row}`)).size).toBe(1256);
    expect(proj.records.every(r => r.itemCode !== '' && r.organization !== '')).toBe(true);
    for (const t of set.targets) {
      const rs = proj.records.filter(r => r.file === t.file);
      expect(rs).toHaveLength(t.requestRows);
      expect(rs.filter(r => r.itemStartsInThisRow)).toHaveLength(t.itemStartRows);
      expect(rs[0].itemStartsInThisRow).toBe(true);
    }
  });
  it('reference projection: コード・金額が事前登録の文法に従う（blank→0・符号補完なし）', () => {
    for (const r of proj.records) {
      expect(r.itemCode).toMatch(/^\d{3}$/);
      expect(r.col4Raw).toMatch(/^\d{2}$/);
      expect(r.amountsRaw.col6).toMatch(/^(0|[1-9]\d{0,2}(,\d{3})*)$/);
      expect(r.amountsRaw.col8).toMatch(/^(0|[1-9]\d{0,2}(,\d{3})*)$/);
      expect(r.amountsRaw.col10).toMatch(/^(0|(△ )?[1-9]\d{0,2}(,\d{3})*)$/);
      expect(r.amountsThousandYen.col10).toBe(Number(r.amountsRaw.col10.replace(/[△ ,]/g, '')) * (r.amountsRaw.col10.startsWith('△') ? -1 : 1));
    }
  });
  it('gaiji 2 件・qt 11 件が projection に記録されている', () => {
    expect(proj.records.filter(r => r.requestGaiji.length > 0)).toHaveLength(2);
    expect(proj.records.filter(r => r.requestQtCount > 0)).toHaveLength(11);
  });
  it('hand-checked fixture: 規則どおりの行が projection と一致し、gaiji・qt は全件含まれる', () => {
    expect(hand.rowCount).toBe(hand.rows.length);
    const byKey = new Map(proj.records.map(r => [`${r.file}#${r.row}`, r]));
    for (const h of hand.rows) { expect(byKey.get(`${h.file}#${h.row}`)).toEqual(h.expected); expect(h.rawClmFragments.length).toBeGreaterThan(0); }
    const have = new Set(hand.rows.map(h => `${h.file}#${h.row}`));
    for (const r of proj.records.filter(x => x.requestGaiji.length > 0 || x.requestQtCount > 0)) expect(have.has(`${r.file}#${r.row}`)).toBe(true);
  });
});
