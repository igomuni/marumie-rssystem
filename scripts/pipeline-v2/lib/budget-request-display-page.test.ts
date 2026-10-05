import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import type { DrawingPrimitive } from './budget-request-drawing-primitives';
import { applyMatrix, extractDisplayPage, normalizeItemTransform, normalizeLinePrimitives, type PdfjsPageLike } from './budget-request-display-page';

const M90 = [0, 1, 1, 0, 0, 0]; // 実 PDF（rotate=90、view 0,0,595.22,842）で観測した viewport.transform
describe('正規化', () => {
  it('rotate=90 の text transform [0,s,-s,0,e,f] は上向きの水平 text [s,0,0,s,f,vh-e] になる', () => {
    const u = normalizeItemTransform([0, 5.517, -5.517, 0, 50.2548, 469.6446], M90, 595.22);
    expect(u.map(x => Math.round(x * 1e4) / 1e4)).toEqual([5.517, 0, 0, 5.517, 469.6446, 544.9652]);
  });
  it('rotate=0 の viewport（[1,0,0,-1,0,H]）では x 座標が保たれる', () => {
    const u = normalizeItemTransform([6.944, 0, 0, 6.944, 44.926, 568.204], [1, 0, 0, -1, 0, 595], 595);
    expect([u[0], u[3], u[4], u[5]]).toEqual([6.944, 6.944, 44.926, 568.204]);
  });
  it('縦罫線（user space で水平）が表示では垂直になり、x が display の x に対応する', () => {
    const view = [0, 0, 595.22, 842];
    // user space の水平線 y=100（左上原点では 842-100=742）、x 50〜300 → 表示では x_d = y_u = 100、y_d = x_u 50〜300 の垂直線
    const prim: DrawingPrimitive = { operatorIndex: 0, pathIndex: 0, kind: 'line', paint: 'stroke', lineWidth: 0.3, x1: 50, y1: 742, x2: 300, y2: 742, orientation: 'horizontal', length: 250 };
    const [n] = normalizeLinePrimitives([prim], view, M90);
    expect(n).toMatchObject({ orientation: 'vertical', x1: 100, x2: 100, y1: 50, y2: 300 });
  });
  it('applyMatrix', () => { expect(applyMatrix(M90, 3, 7)).toEqual([7, 3]); });
});
describe('extractDisplayPage', () => {
  const item = (tr: number[]) => ({ str: '010', transform: tr, width: 10, height: 5.517, fontName: 'f', hasEOL: false, dir: 'ltr' });
  const mk = (rotate: number, vp: { width: number; height: number; transform: number[] }, view: number[], tr: number[]): PdfjsPageLike => ({ rotate, view, getViewport: () => vp, getTextContent: async () => ({ items: [item(tr)], styles: { f: { ascent: 0.9, descent: -0.2 } } }) });
  it('rotate=90 の token は表示向きの bbox（xMin = 表示 x）になり meta は正規化 page', async () => {
    const r = await extractDisplayPage(mk(90, { width: 842, height: 595.22, transform: M90 }, [0, 0, 595.22, 842], [0, 5.517, -5.517, 0, 50.2548, 469.6446]), 3, 6);
    expect(r.rotate).toBe(90);
    expect(r.meta).toMatchObject({ rotate: 0, width: 842, height: 595.22 });
    expect(r.tokens[0].bbox.xMin).toBe(469.645);
    expect(r.tokens[0].bbox.xMax).toBeCloseTo(479.645, 3);
    expect(r.tokens[0].bbox.yMax).toBeCloseTo(50.255 + 0.2 * 5.517, 2);
  });
  it('rotate=0 は production と同じ導出', async () => {
    const r = await extractDisplayPage(mk(0, { width: 842, height: 595, transform: [1, 0, 0, -1, 0, 595] }, [0, 0, 842, 595], [6.944, 0, 0, 6.944, 44.926, 568.204]), 3, 6);
    expect(r.rotate).toBe(0);
    expect(r.tokens[0].bbox.xMin).toBe(44.926);
  });
});

describe('Phase A は MOF・hierarchy・manual・既存 item を参照しない（source scan）', () => {
  it.each(['scripts/pipeline-v2/lib/budget-request-display-page.ts', 'scripts/pipeline-v2/run-budget-request-rule-8p6-rotate-phase-a.ts'])('%s', f => {
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/mof-|budget-jikou|MofBudget|mofJikou|normalized\/mof/i, /=== 'item'/, /\.manual\b/, /hierarchyDependent/, /observeDocumentHierarchy/, /ITEM_INDENT_STEP|budget-request-item-candidate/, /candidate-count/]) expect(forbidden.test(src), `${f}: ${forbidden}`).toBe(false);
  });
});
