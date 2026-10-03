import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join(__dirname, '../../../tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0');
const load = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
interface Unit { selectedAs: string; stratum: string; source: string; group: string; documentKey: string; page: number; logicalRowIndex: number; baselineName: string; allBlankAmounts: boolean }

describe('incomplete-name guard 評価標本（事前登録）', () => {
  const sample = load<{ sample: Unit[] }>('sample.json').sample;
  it('43 unit・8 省庁・既知 failure 3 件を含み、unit は一意', () => {
    expect(sample).toHaveLength(43);
    expect(new Set(sample.map(u => u.group)).size).toBe(8);
    expect(new Set(sample.map(u => `${u.documentKey}:${u.page}:${u.logicalRowIndex}`)).size).toBe(43);
    expect(sample.filter(u => u.selectedAs === 'known-failure').map(u => u.baselineName)).toEqual(['ネイチャーポジティブ（', '自然環境保全地域等保全', '世界自然遺産等保全対策']);
    expect(sample.filter(u => u.allBlankAmounts).length).toBeGreaterThanOrEqual(6);
  });
  it('出所（development / held-out v0 / additional）が区別されている', () => {
    expect(new Set(sample.map(u => u.source))).toEqual(new Set(['development', 'heldout-v0-pages', 'additional']));
  });
  it('GT 作業リストは層・出所・baseline の名称・predicate を含まず、標本と同じ unit を指す', () => {
    const wl = load<{ units: Record<string, unknown>[] }>('gt-worklist.json').units;
    expect(wl).toHaveLength(43);
    for (const u of wl) expect(Object.keys(u).sort()).toEqual(['anchorYPt', 'canonicalUrl', 'code', 'physicalPage', 'unitId']);
    expect(new Set(wl.map(u => u.unitId))).toEqual(new Set(sample.map(u => `${u.documentKey}:${u.page}:${u.logicalRowIndex}`)));
  });
  it('baseline artifact の sha1 が凍結されている（21 件）', () => {
    const a = load<{ artifacts: Record<string, string> }>('baseline-artifacts.json').artifacts;
    expect(Object.keys(a)).toHaveLength(21);
    for (const v of Object.values(a)) expect(v).toMatch(/^[0-9a-f]{40}$/);
  });
});
