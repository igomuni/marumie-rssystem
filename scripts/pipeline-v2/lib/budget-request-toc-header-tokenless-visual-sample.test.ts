import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { buildManifest, loadCensus, pageKey, selectSample, strataOf, type Census, type CensusCandidate, type CensusPage } from './budget-request-toc-header-tokenless-visual-sample';

const CENSUS = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-failure-isolation', '2024', 'census.json');
const MANIFEST = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-visual-failure-isolation', '2024', 'review-sample-manifest.json');

const cand = (lineIndex: number, o: Partial<CensusCandidate> = {}): CensusCandidate => ({
  lineIndex, position: lineIndex, charStart: 40, offsetFromE: 0, rightTextChars: 3, rightTextSha256: 'x', leftBlank: true, distanceToHeaderEnd: 3,
  precedingTriggerDistance: null, followingTriggerDistance: null, wholeLineTitleInOutput: true, primary: 'P', knownFlagMatch: false, pageRefTokenless: false, otherHeaderTokenless: false, ...o,
});
const page = (n: number, trig: number, att: number, partition: string, cands: CensusCandidate[]): CensusPage => ({
  localPdfPath: `p${String(n).padStart(2, '0')}.pdf`, physicalPage: 1, partition, pageState: 'ASSEMBLED_SPLIT', edge: 40, triggerCount: trig, negativeControlCount: cands.length, knownFlag: false, currentFragmentsAttached: att, candidates: cands,
});
const synthetic = (): Census => {
  const parts = ['X', 'Y', 'Z'];
  const pages: CensusPage[] = [page(0, 2, 1, 'X', [cand(0), cand(1)]), page(1, 2, 1, 'X', [cand(0)])];
  let n = 2;
  for (const [t, a] of [[1, 1], [1, 0], [0, 1], [0, 0]]) for (let i = 0; i < 4; i++, n++) pages.push(page(n, t, a, parts[n % 3], [cand(0, { distanceToHeaderEnd: 1 + i, offsetFromE: i * 3 }), cand(2, { leftBlank: i % 2 === 0 })]));
  return { anchors: [{ id: 'H2', localPdfPath: 'p00.pdf', physicalPage: 1, humanLine: 1 }, { id: 'H7', localPdfPath: 'p01.pdf', physicalPage: 1, humanLine: 0 }], pages };
};

describe('visual sample selection（合成 census）', () => {
  it('stratum は triggerCount / currentFragmentsAttached で決まる', () => {
    expect(strataOf(page(0, 1, 1, 'X', []))).toBe('A');
    expect(strataOf(page(0, 1, 0, 'X', []))).toBe('B');
    expect(strataOf(page(0, 0, 1, 'X', []))).toBe('C');
    expect(strataOf(page(0, 0, 0, 'X', []))).toBe('D');
  });
  it('anchors 2 + controls 10、anchor ページ・重複ページなし、各 stratum 2 件以上、決定的', () => {
    const s = selectSample(synthetic());
    expect(s.filter(x => x.role === 'ANCHOR').map(x => x.anchorId)).toEqual(['H2', 'H7']);
    expect(s.filter(x => x.role === 'CONTROL')).toHaveLength(10);
    const ctrlPages = s.filter(x => x.role === 'CONTROL').map(x => pageKey(x.page));
    expect(new Set(ctrlPages).size).toBe(10);
    expect(ctrlPages).not.toContain('p00.pdf#1');
    expect(ctrlPages).not.toContain('p01.pdf#1');
    for (const st of ['A', 'B', 'C', 'D']) expect(s.filter(x => x.role === 'CONTROL' && x.stratum === st).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(selectSample(synthetic()))).toBe(JSON.stringify(s));
    const ids = buildManifest(synthetic(), 'h', s).samples.map(x => x.sampleId);
    expect(ids[0]).toBe('FB-01');
    expect(ids).toHaveLength(12);
  });
  it('anchor 行が一意でなければ STOP、stratum の eligible ページが不足しても STOP', () => {
    const c = synthetic(); c.anchors[0].humanLine = 99;
    expect(() => selectSample(c)).toThrow(/STOP/);
    const d = synthetic(); d.pages = d.pages.filter(p => !(p.triggerCount === 0 && p.currentFragmentsAttached === 0));
    expect(() => selectSample(d)).toThrow(/STOP/);
  });
});

describe('committed review-sample-manifest 整合', () => {
  const { census, sha256 } = loadCensus(CENSUS);
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as ReturnType<typeof buildManifest>;
  it('source census hash 固定・手順の再実行が manifest と完全一致', () => {
    expect(sha256).toBe('d2c3f9b0878614466a3f69034164c86f60050c4783633e31a4b7fbaf2ceda5e7');
    expect(m.sourceCensus.sha256).toBe(sha256);
    expect(`${JSON.stringify(buildManifest(census, sha256, selectSample(census)), null, 1)}\n`).toBe(fs.readFileSync(MANIFEST, 'utf8'));
  });
  it('12 件・anchors 2・controls 10・重複ページなし・絶対パスなし', () => {
    expect(m.samples).toHaveLength(12);
    expect(m.samples.filter(s => s.role === 'ANCHOR')).toHaveLength(2);
    expect(m.samples.filter(s => s.role === 'CONTROL')).toHaveLength(10);
    expect(new Set(m.samples.map(s => `${s.localPdfPath}#${s.physicalPage}`)).size).toBe(12);
    expect(JSON.stringify(m)).not.toMatch(/\/Users\//u);
    expect(m.samples.map(s => s.sampleId)).toEqual(Array.from({ length: 12 }, (_, i) => `FB-${String(i + 1).padStart(2, '0')}`));
  });
});
