import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'tests/fixtures/budget-request-toc-b-layer-column-continuity-visual-failure-isolation/2024';
const OUTCOMES = ['UNIQUE_PAGE_LOCAL_CONTINUATION', 'AMBIGUOUS_PAGE_LOCAL_CONTINUATION', 'NO_PAGE_LOCAL_CONTEXT', 'EXPLICIT_RESET', 'UNREADABLE'];

const manifestRaw = readFileSync(`${DIR}/review-sample-manifest.json`);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const obsRaw = readFileSync(`${DIR}/visual-observations.json`, 'utf8');
const obs = JSON.parse(obsRaw);

describe('column continuity 視覚観察 fixture の整合', () => {
  it('manifest の sha256 が freeze 時から不変', () => {
    const sha = createHash('sha256').update(manifestRaw).digest('hex');
    expect(sha).toBe('50fc4d46e6d207bae1e9e014211433bf04a3c554bda85a01f41ea65ac475fac8');
    expect(obs.manifest.sha256).toBe(sha);
  });
  it('探索的・GT でない', () => {
    expect(obs.exploratory).toBe(true);
    expect(obs.notGroundTruth).toBe(true);
  });
  it('6 sample・各 2 判定・sampleId が manifest と 1:1', () => {
    expect(obs.samples.map((s: { sampleId: string }) => s.sampleId)).toEqual(manifest.samples.map((s: { sampleId: string }) => s.sampleId));
    expect(obs.samples).toHaveLength(6);
    for (const s of obs.samples) {
      expect(s.reviews).toHaveLength(2);
      expect(s.reviews.map((r: { role: string }) => r.role)).toEqual(['primary', 'second']);
      for (const r of s.reviews) expect(r.record.sampleId).toBe(s.sampleId);
    }
  });
  it('visualOutcome が許可 enum・UNIQUE なら targetContext が非 null', () => {
    for (const s of obs.samples) for (const r of s.reviews) {
      expect(OUTCOMES).toContain(r.record.visualOutcome);
      if (r.record.visualOutcome === 'UNIQUE_PAGE_LOCAL_CONTINUATION') expect(r.record.targetContext).not.toBeNull();
    }
  });
  it('agreement と集計が judgment から再計算した値と一致', () => {
    let agree = 0;
    const counts: Record<string, number> = Object.fromEntries(OUTCOMES.map(o => [o, 0]));
    for (const s of obs.samples) {
      const [p, q] = s.reviews.map((r: { record: { visualOutcome: string } }) => r.record.visualOutcome);
      expect(s.agreement.status).toBe(p === q ? 'REVIEWER_AGREEMENT' : 'REVIEWER_DISAGREEMENT');
      if (p === q) agree++;
      counts[p]++; counts[q]++;
    }
    expect(obs.agreementSummary).toEqual({ reviewerAgreement: agree, reviewerDisagreement: 6 - agree });
    expect(obs.outcomeCountsByJudgment).toEqual({ ...counts, total: 12 });
  });
  it('絶対パス・/tmp パスを含まない', () => {
    expect(obsRaw).not.toMatch(/\/tmp\/|\/Users\/|\/private\//);
  });
});
