import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildManifest, eligibleRows, excludedRows, loadCensus, loadControlManifest, pageKey, rowKey, selectSample,
  type ControlManifest,
} from './budget-request-toc-header-tokenless-positive-discovery-sample';
import type { Census, CensusCandidate, CensusPage } from './budget-request-toc-header-tokenless-visual-sample';

const CENSUS = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-failure-isolation', '2024', 'census.json');
const CTRL = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-visual-failure-isolation', '2024', 'review-sample-manifest.json');
const MANIFEST = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-positive-discovery', '2024', 'discovery-sample-manifest.json');

describe('synthetic', () => {
  const cand = (lineIndex: number, o: Partial<CensusCandidate> = {}): CensusCandidate => ({
    lineIndex, position: lineIndex, charStart: 40, offsetFromE: lineIndex, rightTextChars: 3, rightTextSha256: 'x', leftBlank: true, distanceToHeaderEnd: 3 + lineIndex,
    precedingTriggerDistance: null, followingTriggerDistance: null, wholeLineTitleInOutput: true, primary: 'P', knownFlagMatch: false, pageRefTokenless: false, otherHeaderTokenless: false, ...o,
  });
  const page = (n: number, partition: string): CensusPage => ({
    localPdfPath: `p${String(n).padStart(2, '0')}.pdf`, physicalPage: 1, partition, pageState: 'S', edge: 40, triggerCount: n % 2, negativeControlCount: 2, knownFlag: false, currentFragmentsAttached: n % 3 === 0 ? 1 : 0,
    candidates: [cand(0, { rightTextChars: n }), cand(2, { leftBlank: n % 2 === 0, precedingTriggerDistance: n % 4 })],
  });
  const census = (): Census => ({ anchors: [], pages: Array.from({ length: 30 }, (_, n) => page(n, ['X', 'Y', 'Z'][n % 3])) });
  const rows = () => census().pages.flatMap(p => p.candidates.map(cand => ({ page: p, cand })));

  it('20 件・20 unique page・各 partition 5 件以上・決定的', () => {
    const s = selectSample(rows());
    expect(s).toHaveLength(20);
    expect(new Set(s.map(x => pageKey(x.page))).size).toBe(20);
    for (const p of ['X', 'Y', 'Z']) expect(s.filter(x => x.page.partition === p).length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(selectSample(rows()))).toBe(JSON.stringify(s));
    expect(buildManifest(census(), 'h', 'h', [], rows(), s).samples.map(x => x.sampleId)[19]).toBe('PD-20');
  });
  it('partition のページが保証数に満たなければ STOP', () => {
    const r = rows().filter(x => !(x.page.partition === 'Z' && x.page.localPdfPath > 'p05.pdf'));
    expect(() => selectSample(r)).toThrow(/STOP/);
  });
  it('eligible が 79 でなければ STOP', () => {
    expect(() => eligibleRows(census(), [])).toThrow(/STOP/);
  });
});

describe('committed discovery-sample-manifest 整合', () => {
  const { census, sha256 } = loadCensus(CENSUS);
  const { manifest: ctrl, sha256: ctrlSha } = loadControlManifest(CTRL);
  const text = fs.readFileSync(MANIFEST, 'utf8');
  const m = JSON.parse(text) as ReturnType<typeof buildManifest>;
  const excluded = excludedRows(census, ctrl as ControlManifest);
  const eligible = eligibleRows(census, excluded);

  it('source hash 固定・手順の再実行が manifest と完全一致', () => {
    expect(sha256).toBe('d2c3f9b0878614466a3f69034164c86f60050c4783633e31a4b7fbaf2ceda5e7');
    expect(ctrlSha).toBe('d4afe8153e5b77379ce7ad6578c4060a670ddbbda69b97c50d25f375697ab01a');
    expect(`${JSON.stringify(buildManifest(census, sha256, ctrlSha, excluded, eligible, selectSample(eligible)), null, 1)}\n`).toBe(text);
  });
  it('eligible 79・除外 12・20 件・重複ページなし・overlap 0・絶対パスなし', () => {
    expect(eligible).toHaveLength(79);
    expect(m.excludedRows).toHaveLength(12);
    expect(m.samples).toHaveLength(20);
    expect(new Set(m.samples.map(s => `${s.localPdfPath}#${s.physicalPage}`)).size).toBe(20);
    const ex = new Set(m.excludedRows.map(rowKey));
    expect(m.samples.filter(s => ex.has(rowKey(s)))).toHaveLength(0);
    expect(new Set(m.samples.map(s => s.partition)).size).toBe(3);
    expect(JSON.stringify(m)).not.toMatch(/\/Users\//u);
    expect(m.samples.map(s => s.sampleId)).toEqual(Array.from({ length: 20 }, (_, i) => `PD-${String(i + 1).padStart(2, '0')}`));
  });
});
