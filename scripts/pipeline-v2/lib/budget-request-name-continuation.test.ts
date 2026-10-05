import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import type { ColumnLayout, FieldResolverPageInput } from './budget-request-field-resolver';
import { composeContinuation, joinedName, nameLinesOf } from './budget-request-name-continuation';

const REF = 6.944;
const tk = (index: number, text: string, xMin: number, y: number, w = 10) => ({ index, rawText: text, page: 1, bbox: { xMin, xMax: xMin + w, yMin: y, yMax: y + REF }, transform: [1, 0, 0, 1, 0, 0], width: w, fontSize: REF, fontName: 'f', hasEOL: false, dir: 'ltr' });
const layout = { regions: { name: [Number.NEGATIVE_INFINITY, 203.5], previousBudget: [203.5, 258.8], requestedBudget: [258.8, 307.4], gap: [307.4, 410.6], difference: [410.6, 462.7], right: [462.7, 1e9] } } as unknown as ColumnLayout;
/** physical row ごとの token を作る。baselineY は y + REF */
function page(rows: { y: number; toks: ReturnType<typeof tk>[] }[]): FieldResolverPageInput {
  const tokens: ReturnType<typeof tk>[] = []; const physicalRows: { baselineY: number; rawTokenIndexes: number[]; visualTokenIndexes: number[] }[] = []; const logical: { logicalRowIndex: number; physicalRowIndexes: number[]; visualTokenIndexes: number[]; rawTokenIndexes: number[] }[] = [];
  rows.forEach((r, i) => { const idx = r.toks.map(t => { const ix = tokens.length; tokens.push({ ...t, index: ix }); return ix; }); physicalRows.push({ baselineY: r.y + REF, rawTokenIndexes: idx, visualTokenIndexes: idx }); logical.push({ logicalRowIndex: i, physicalRowIndexes: [i], visualTokenIndexes: idx, rawTokenIndexes: idx }); });
  return { meta: { number: 1 }, tokens, geometry: { physicalRows, parameters: { rowClustering: { referenceFontSize: REF } } }, logical: { logicalRowCandidates: logical } } as unknown as FieldResolverPageInput;
}
const L = (y: number) => ({ y, toks: [tk(0, '050', 58.7, y, 10), tk(0, '独立行政法人国立美術館', 75.9, y, 90), tk(0, '(内', 469.3, y, 8)] });
const CONT = (y: number) => ({ y, toks: [tk(0, '施設整備費', 75.9, y, 40), tk(0, '右側の説明', 472.8, y, 50)] });
const NEXTITEM = (y: number) => ({ y, toks: [tk(0, '94', 38, y, 5), tk(0, '05-95', 65.6, y, 20), tk(0, '別の事項', 89.7, y, 30)] });

describe('composeContinuation', () => {
  it('直下・名称開始 x が揃い・code も金額もない行を name 領域の token だけ連結する（右側の別セルは追記しない）', () => {
    const p = page([L(100), CONT(106.944), NEXTITEM(120.8)]);
    const r = composeContinuation(p, layout, 0, 0);
    expect(r.fired).toBe(true);
    expect(joinedName(r).concatenated).toBe('独立行政法人国立美術館施設整備費');
    expect(r.appended).toHaveLength(1);
    expect(r.stop).toMatchObject({ reason: 'guard_not_satisfied' });
    expect(r.stop.guard?.C).toBe(true); // 次の行は code で始まるため guard が成立しない
  });
  it('code で始まる行・金額を持つ行・x が揃わない行・直下でない行では発火しない', () => {
    expect(composeContinuation(page([L(100), NEXTITEM(106.944)]), layout, 0, 0).fired).toBe(false);
    expect(composeContinuation(page([L(100), { y: 106.944, toks: [tk(0, '施設整備費', 75.9, 106.944), tk(0, '1,000', 230, 106.944)] }]), layout, 0, 0).fired).toBe(false);
    expect(composeContinuation(page([L(100), { y: 106.944, toks: [tk(0, '施設整備費', 90, 106.944)] }]), layout, 0, 0).fired).toBe(false);
    expect(composeContinuation(page([L(100), { y: 130, toks: [tk(0, '施設整備費', 75.9, 130)] }]), layout, 0, 0).fired).toBe(false);
  });
  it('複数行の折り返しを guard が満たされる間つなぐ。page の末尾で終了', () => {
    const p = page([L(100), CONT(106.944), { y: 113.888, toks: [tk(0, '補助金', 75.9, 113.888, 20)] }]);
    const r = composeContinuation(p, layout, 0, 0);
    expect(joinedName(r).concatenated).toBe('独立行政法人国立美術館施設整備費補助金');
    expect(r.appended).toHaveLength(2);
    expect(r.stop.reason).toBe('page_end');
  });
  it('基底名称は code と name 領域外の token を除く', () => {
    const p = page([L(100)]);
    expect(nameLinesOf(p, layout, 0, new Set([0])).map(l => l.text)).toEqual(['独立行政法人国立美術館']);
  });
});
describe('source scan（MOF・金額 0・対象の filename / page / 名称を参照しない）', () => {
  it('lib', () => {
    const src = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-name-continuation.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of [/mof-|budget-jikou|MofBudget|mofJikou|normalized\/mof/i, /mext\.go\.jp|_03\.pdf|1141|1142|556/, /施設整備|美術館|芸術文化|科学技術/, /amountYen/]) expect(f.test(src), String(f)).toBe(false);
  });
});
