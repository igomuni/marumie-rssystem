import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { validateHeldoutManifest, type HeldoutManifest } from './budget-request-field-resolver-heldout-manifest';

const load = (): HeldoutManifest => JSON.parse(fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/budget-request-field-resolver/heldout-v0/manifest.json'), 'utf8')) as HeldoutManifest;

describe('held-out selection manifest', () => {
  it('事前登録の規則を満たす（4省庁×4カテゴリ・development省庁を含まない・目視した候補から選択）', () => {
    expect(validateHeldoutManifest(load())).toEqual([]);
  });
  it('development Golden の省庁・カテゴリ欠け・範囲外ページ・重複を検出する', () => {
    const mut = (f: (m: HeldoutManifest) => void) => { const m = load(); f(m); return validateHeldoutManifest(m); };
    expect(mut(m => { m.documents[0].canonicalUrl = 'https://www.meti.go.jp/x.pdf'; }).some(e => e.includes('development'))).toBe(true);
    expect(mut(m => { m.documents[0].pages[0].category = 'normal'; m.documents[0].pages[1].category = 'normal'; }).some(e => e.includes('4カテゴリ'))).toBe(true);
    expect(mut(m => { m.documents[0].pages[0].physicalPage = 9999; }).some(e => e.includes('範囲外'))).toBe(true);
    expect(mut(m => { m.documents[0].pages[1].physicalPage = m.documents[0].pages[0].physicalPage; }).some(e => e.includes('重複'))).toBe(true);
    expect(mut(m => { m.freezeCommit = 'x'; }).some(e => e.includes('freezeCommit'))).toBe(true);
  });
});
