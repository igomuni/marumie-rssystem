import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { classifyRepresentation, findNameHits, isNameCellContinuation, leftCodeOf, normalizeText, type TokenLite } from './budget-request-unmatched-source-search';

const t = (index: number, rawText: string, xMin: number, y: number, w = 20): TokenLite => ({ index, rawText, bbox: { xMin, xMax: xMin + w, yMin: y, yMax: y + 6.944 }, fontSize: 6.944 });
describe('findNameHits', () => {
  it('単一 token の全体一致・埋め込み・名称セル内の複数 token・その他', () => {
    const name = normalizeText('独立行政法人国立美術館施設整備費');
    const single = [t(0, '050', 58.7, 55), t(1, '独立行政法人国立美術館 施設整備費', 75.9, 55)];
    expect(findNameHits(single, name)[0].kind).toBe('SINGLE_TOKEN_EXACT');
    const embedded = [t(0, '説明: 独立行政法人国立美術館施設整備費に必要な経費', 75.9, 55)];
    expect(findNameHits(embedded, name)[0].kind).toBe('EMBEDDED_IN_LARGER_TOKEN');
    const multi = [t(0, '050', 58.7, 55), t(1, '独立行政法人国立美術館', 75.9, 55), t(2, '施設整備費', 75.9, 61.944)];
    const h = findNameHits(multi, name)[0];
    expect(h.kind).toBe('MULTI_TOKEN_NAME_CELL_CONTINUATION'); expect(h.tokens.map(x => x.index)).toEqual([1, 2]);
    const other = [t(1, '独立行政法人国立美術館', 75.9, 55), t(2, '施設整備費', 300, 55)];
    expect(findNameHits(other, name)[0].kind).toBe('MULTI_TOKEN_OTHER');
    expect(findNameHits([t(0, '無関係', 1, 1)], name)).toEqual([]);
  });
  it('isNameCellContinuation: x が揃わない・行間が範囲外は false', () => {
    expect(isNameCellContinuation([t(0, 'a', 75.9, 55), t(1, 'b', 75.9, 61.944)])).toBe(true);
    expect(isNameCellContinuation([t(0, 'a', 75.9, 55), t(1, 'b', 90, 61.944)])).toBe(false);
    expect(isNameCellContinuation([t(0, 'a', 75.9, 55), t(1, 'b', 75.9, 80)])).toBe(false);
  });
});
describe('leftCodeOf / classifyRepresentation', () => {
  it('同じ行の左隣の token の形', () => {
    const toks = [t(0, '050', 58.7, 55, 10), t(1, '名称', 75.9, 55), t(2, '01-95', 40, 80)];
    expect(leftCodeOf(toks, toks[1])).toMatchObject({ text: '050', shape: 'plain3' });
    expect(leftCodeOf(toks, toks[0])).toBeNull();
  });
  it('representation', () => {
    expect(classifyRepresentation({ tokens: 10, asciiDigitTokens: 3, sampledImages: 0, sampledPaths: 0, sampledPages: 0 })).toBe('TEXT_GEOMETRY_AVAILABLE');
    expect(classifyRepresentation({ tokens: 10, asciiDigitTokens: 0, sampledImages: 0, sampledPaths: 0, sampledPages: 0 })).toBe('TEXT_PRESENT_UNICODE_UNRESOLVED');
    expect(classifyRepresentation({ tokens: 0, asciiDigitTokens: 0, sampledImages: 0, sampledPaths: 5000, sampledPages: 3 })).toBe('DRAWING_PATH_TEXT');
    expect(classifyRepresentation({ tokens: 0, asciiDigitTokens: 0, sampledImages: 3, sampledPaths: 10, sampledPages: 3 })).toBe('RASTER_IMAGE_ONLY');
    expect(classifyRepresentation({ tokens: 0, asciiDigitTokens: 0, sampledImages: 0, sampledPaths: 0, sampledPages: 3 })).toBe('OTHER');
    expect(classifyRepresentation({ tokens: 0, asciiDigitTokens: 0, sampledImages: 0, sampledPaths: 0, sampledPages: 0 })).toBe('UNKNOWN');
  });
});
describe('source scan', () => {
  it('lib は MOF 名・page・filename を参照しない', () => {
    const src = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-unmatched-source-search.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of [/mof-|budget-jikou|MofBudget|normalized\/mof/i, /mext\.go\.jp|moj\.go\.jp|fsa\.go\.jp|cao\.go\.jp/, /施設整備|法務|金融/]) expect(f.test(src), String(f)).toBe(false);
  });
});
