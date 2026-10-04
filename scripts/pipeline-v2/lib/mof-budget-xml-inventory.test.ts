import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'mof-budget-xml-inventory', '2024');
const inv = JSON.parse(fs.readFileSync(path.join(DIR, '202411001-source-inventory.json'), 'utf8')) as {
  xml: { localFiles: number; totalBytes: number; menuMissingLocally: string[]; localNotInMenu: string[]; duplicatesInMenuList: number };
  provenance: { present: boolean; files?: number; hashOrBytesMismatch?: number };
  menu: { enumeratedXmlFiles: number };
  files: { filename: string; bytes: number; sha256: string; encoding: string; root: string }[];
};
const sum = JSON.parse(fs.readFileSync(path.join(DIR, '202411001-structure-summary.json'), 'utf8')) as {
  structure: { fingerprintCount: number; clmIdFormMismatch: { clm: number } };
  jikouTables: { files: number; rowClasses: { class: string; rows: number }[]; counts: Record<string, number>; assignment: Record<string, number>; docOrderChecks: { notAscending: number }; exceptions: string[] };
};

// research artifact（FY2024 一般会計 当初予算 202411001）の整合性。raw XML は git 管理外なので committed artifact だけを検証する
describe('MOF budget XML inventory artifact（snapshot の整合性）', () => {
  it('328 XML・目次の列挙集合と一致・重複なし・provenance と hash/bytes が一致', () => {
    expect(inv.files).toHaveLength(328);
    expect(new Set(inv.files.map(f => f.filename)).size).toBe(328);
    expect(inv.files.reduce((n, f) => n + f.bytes, 0)).toBe(inv.xml.totalBytes);
    expect(inv.xml).toMatchObject({ localFiles: 328, menuMissingLocally: [], localNotInMenu: [], duplicatesInMenuList: 0 });
    expect(inv.menu.enumeratedXmlFiles).toBe(328);
    expect(inv.provenance).toMatchObject({ present: true, files: 328, hashOrBytesMismatch: 0 });
    for (const f of inv.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('全ファイルが同一の宣言・root（Shift_JIS・budget）で、clm の id 形式外が 0', () => {
    expect(new Set(inv.files.map(f => `${f.encoding}/${f.root}`))).toEqual(new Set(['Shift_JIS/budget']));
    expect(sum.structure.clmIdFormMismatch.clm).toBe(0);
  });
  it('事項表 94 ファイルの行分類が過不足なく（未分類・例外 0）、件数が行分類と整合する', () => {
    const j = sum.jikouTables;
    expect(j.files).toBe(94);
    expect(j.exceptions).toEqual([]);
    expect(j.rowClasses.some(r => r.class.startsWith('unclassified'))).toBe(false);
    const by = Object.fromEntries(j.rowClasses.map(r => [r.class, r.rows]));
    expect(j.counts.jikouRows).toBe((by['jikou-row'] ?? 0) + (by['kou+jikou-row'] ?? 0) + (by['org+kou+jikou-row'] ?? 0));
    expect(j.counts.kouStartRows).toBe((by['kou+jikou-row'] ?? 0) + (by['org+kou+jikou-row'] ?? 0));
    expect(j.assignment.jikouWithoutPrecedingKou).toBe(0);
    expect(j.docOrderChecks.notAscending).toBe(0);
  });
});
