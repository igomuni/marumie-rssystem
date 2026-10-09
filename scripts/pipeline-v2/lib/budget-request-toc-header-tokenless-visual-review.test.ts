import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-visual-failure-isolation', '2024');
const MANIFEST = path.join(DIR, 'review-sample-manifest.json');
const OBS = path.join(DIR, 'visual-review-observations.json');
const MANIFEST_SHA256 = 'd4afe8153e5b77379ce7ad6578c4060a670ddbbda69b97c50d25f375697ab01a';
const ROLES = ['CONTINUATION', 'COLUMN_HEADING', 'HEADER_OR_TITLE', 'OTHER', 'AMBIGUOUS', 'UNREADABLE'];
const RELATIONS = ['UNIQUE_VISUAL_OWNER', 'MULTIPLE_PLAUSIBLE_OWNERS', 'NO_VISUAL_OWNER', 'UNREADABLE'];

interface Observation { sampleId: string; visualRole: string; rowRelation: string | null; ownerVisual: string | null; physicalObservations: Record<string, unknown>; visibleText: string; confidence: string; notes: string }
interface Observations { schema: string; exploratory: boolean; notGroundTruth: boolean; blindReview: string; sampleSelection: string; sourceManifest: { sha256: string }; reviewerIds: string[]; reviewerAssignment: Record<string, string[]>; observations: Observation[] }

const manifestRaw = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(manifestRaw) as { samples: { sampleId: string }[] };
const rawObs = fs.readFileSync(OBS, 'utf8');
const doc = JSON.parse(rawObs) as Observations;

describe('visual-review-observations 整合', () => {
  it('manifest sha256 は不変で、観察 fixture が同じ hash を参照する', () => {
    expect(crypto.createHash('sha256').update(manifestRaw).digest('hex')).toBe(MANIFEST_SHA256);
    expect(doc.sourceManifest.sha256).toBe(MANIFEST_SHA256);
  });
  it('観察 12 件で sampleId が manifest と 1:1・sampleId 順', () => {
    const ids = doc.observations.map(o => o.sampleId);
    expect(ids).toHaveLength(12);
    expect(ids).toEqual(manifest.samples.map(s => s.sampleId));
    expect(new Set(ids).size).toBe(12);
  });
  it('visualRole は許可 enum 内、CONTINUATION は rowRelation 定義済み・それ以外は null', () => {
    for (const o of doc.observations) {
      expect(ROLES).toContain(o.visualRole);
      if (o.visualRole === 'CONTINUATION') {
        expect(RELATIONS).toContain(o.rowRelation);
        expect(o.ownerVisual).toBeTruthy();
      } else expect(o.rowRelation).toBeNull();
      expect(o.visibleText.length).toBeGreaterThan(0);
      expect(o).not.toHaveProperty('renderFiles');
    }
  });
  it('reviewer 3 名・担当 4 件ずつで全 sampleId を過不足なく覆う', () => {
    expect(doc.reviewerIds).toHaveLength(3);
    const assigned = Object.values(doc.reviewerAssignment).flat().sort();
    expect(Object.values(doc.reviewerAssignment).every(a => a.length === 4)).toBe(true);
    expect(assigned).toEqual(doc.observations.map(o => o.sampleId));
  });
  it('exploratory・非 GT・blind・選定時系列が明記され、絶対パス・一時パスを含まない', () => {
    expect(doc.exploratory).toBe(true);
    expect(doc.notGroundTruth).toBe(true);
    expect(doc.blindReview).toMatch(/blind|知らされていない/u);
    expect(doc.sampleSelection).toContain('218cf34');
    expect(rawObs).not.toMatch(/\/Users\/|\/tmp\/|\/private\//u);
  });
  it('role totals: CONTINUATION 2 / COLUMN_HEADING 5 / OTHER 4 / HEADER_OR_TITLE 1', () => {
    const t: Record<string, number> = {};
    for (const o of doc.observations) t[o.visualRole] = (t[o.visualRole] ?? 0) + 1;
    expect(t).toEqual({ CONTINUATION: 2, COLUMN_HEADING: 5, OTHER: 4, HEADER_OR_TITLE: 1 });
  });
});
