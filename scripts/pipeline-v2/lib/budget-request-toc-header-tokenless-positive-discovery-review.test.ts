import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-positive-discovery', '2024');
const MANIFEST = path.join(DIR, 'discovery-sample-manifest.json');
const OBS = path.join(DIR, 'visual-review-observations.json');
const MANIFEST_SHA256 = '18c745a126c65981336e408aa69369416247670f5c56461e0266cd9724660018';
const ROLES = ['CONTINUATION', 'COLUMN_HEADING', 'HEADER_OR_TITLE', 'OTHER', 'AMBIGUOUS', 'UNREADABLE'];
const RELATIONS = ['UNIQUE_VISUAL_OWNER', 'MULTIPLE_PLAUSIBLE_OWNERS', 'NO_VISUAL_OWNER', 'UNREADABLE'];

interface Observation {
  sampleId: string;
  visualRole: string;
  rowRelation: string | null;
  ownerVisual: string | null;
  visibleText: string;
  confidence: string;
  needsSecondReview: boolean;
  renderConditions: { dpi: number; cropUsed: boolean };
}
interface Observations {
  exploratory: boolean;
  notGroundTruth: boolean;
  blindReview: string;
  sampleSelection: string;
  sourceManifest: { sha256: string };
  reviewerIds: string[];
  reviewerAssignment: Record<string, string[]>;
  observations: Observation[];
}

const manifestRaw = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(manifestRaw) as { samples: { sampleId: string }[] };
const rawObs = fs.readFileSync(OBS, 'utf8');
const doc = JSON.parse(rawObs) as Observations;

describe('positive-discovery visual-review-observations 整合', () => {
  it('manifest sha256 は不変で、観察 fixture が同じ hash を参照する', () => {
    expect(crypto.createHash('sha256').update(manifestRaw).digest('hex')).toBe(MANIFEST_SHA256);
    expect(doc.sourceManifest.sha256).toBe(MANIFEST_SHA256);
  });
  it('観察 20 件で sampleId が manifest と 1:1・sampleId 順', () => {
    const ids = doc.observations.map(o => o.sampleId);
    expect(ids).toHaveLength(20);
    expect(ids).toEqual(manifest.samples.map(s => s.sampleId));
    expect(new Set(ids).size).toBe(20);
  });
  it('visualRole は許可 enum 内、CONTINUATION は rowRelation 定義済み・それ以外は null', () => {
    for (const o of doc.observations) {
      expect(ROLES).toContain(o.visualRole);
      if (o.visualRole === 'CONTINUATION') {
        expect(RELATIONS).toContain(o.rowRelation);
        expect(o.ownerVisual).toBeTruthy();
      } else expect(o.rowRelation).toBeNull();
      expect(o.visibleText.length).toBeGreaterThan(0);
    }
  });
  it('全件に renderConditions があり、全件 110dpi・crop なし', () => {
    for (const o of doc.observations) {
      expect(o.renderConditions).toBeDefined();
      expect(o.renderConditions.dpi).toBe(110);
      expect(o.renderConditions.cropUsed).toBe(false);
    }
  });
  it('reviewer 4 名・担当 5 件ずつで全 sampleId を過不足なく覆う', () => {
    expect(doc.reviewerIds).toHaveLength(4);
    expect(Object.values(doc.reviewerAssignment).every(a => a.length === 5)).toBe(true);
    const assigned = Object.values(doc.reviewerAssignment).flat().sort();
    expect(assigned).toEqual(doc.observations.map(o => o.sampleId));
  });
  it('exploratory・非 GT・blind・選定時系列が明記され、絶対パス・一時パスを含まない', () => {
    expect(doc.exploratory).toBe(true);
    expect(doc.notGroundTruth).toBe(true);
    expect(doc.blindReview).toMatch(/知らされていない/u);
    expect(doc.sampleSelection).toContain('9eff9e0');
    expect(rawObs).not.toMatch(/\/Users\/|\/tmp\/|\/private\//u);
  });
  it('role totals: CONTINUATION 0 / COLUMN_HEADING 12 / HEADER_OR_TITLE 4 / OTHER 4、second review 0、confidence high 17 / medium 3', () => {
    const t: Record<string, number> = {};
    const c: Record<string, number> = {};
    for (const o of doc.observations) {
      t[o.visualRole] = (t[o.visualRole] ?? 0) + 1;
      c[o.confidence] = (c[o.confidence] ?? 0) + 1;
      expect(o.needsSecondReview).toBe(false);
    }
    expect(t).toEqual({ COLUMN_HEADING: 12, HEADER_OR_TITLE: 4, OTHER: 4 });
    expect(c).toEqual({ high: 17, medium: 3 });
  });
});
