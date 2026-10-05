import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { hierarchyContractFor } from './budget-request-corpus-plan';
import { decideRefined, evaluateGates, segmentStat, segmentsOf, type GatePdf } from './budget-request-header-gates';

describe('decideRefined（事前登録の D1 / D2 / D3）', () => {
  const ok = { G1: true, G3: true, G4: true, G5: true };
  it('判定', () => {
    expect(decideRefined(ok, true)).toEqual({ decision: 'REFINED_HEADER_BOUNDARY_SUPPORTED', rule: 1 });
    expect(decideRefined({ ...ok, G4: false }, true)).toEqual({ decision: 'HEADER_LABEL_INTRINSICALLY_NOT_BOUNDARY_SPECIFIC', rule: 2 });
    expect(decideRefined({ ...ok, G3: false }, true).rule).toBe(3);
    expect(decideRefined({ ...ok, G1: false, G4: false }, true).rule).toBe(3);
    expect(decideRefined(ok, false).rule).toBe(3);
  });
});

describe('gate の移植の equivalence（alternative projection に適用して frozen の評価と同じ値）', () => {
  const FX = 'tests/fixtures';
  const alt = JSON.parse(fs.readFileSync(`${FX}/budget-request-alt-title-projection/2024/alt-title-projection.json`, 'utf8')) as { pdfs: { localPath: string; group: string; pages: { p: number; s: string; n: string | null; sh: (number | null)[] | null }[] }[] };
  const frozen = JSON.parse(fs.readFileSync(`${FX}/budget-request-alt-title-projection/2024/segment-structural-evaluation.json`, 'utf8')) as { reusedGates: { G1: { allNonblankRatio: number; nonDiscoveryNonblankRatio: number }; G3: { pass: boolean }; G4: { mextOtherTransitions: number; mhlwOtherTransitions: number; pass: boolean }; G5: { pdfsWithNonblank: number; pdfsParenthesizedMajority: number; ratio: number } }; segmentComparison: { alternative: Record<string, number>; mextSegments: { alternative: number }; mhlwSegments: { alternative: number } } };
  const layoutSummary = JSON.parse(fs.readFileSync(`${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, 'utf8')) as { perPdf: { localPath: string; ranges: { from: number; to: number }[] }[] };
  const paired = JSON.parse(fs.readFileSync(`${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`, 'utf8')) as { documents: { localPath: string; canonicalUrl: string; class: string }[] };
  const layout = new Map(layoutSummary.perPdf.map(p => [p.localPath, p.ranges]));
  const contract = new Map(paired.documents.filter(d => d.class === 'paired_evaluable').map(d => [d.localPath, hierarchyContractFor(d.canonicalUrl)!.pages as [number, number]]));
  const pdfs: GatePdf[] = alt.pdfs;
  const segsBy = new Map(pdfs.map(p => [p.localPath, segmentsOf(p)]));
  it('G1・G3・G4・G5 と segment 統計が frozen 値に一致', () => {
    const g = evaluateGates(pdfs, segsBy, layout, contract);
    expect(g.G1.allNonblankRatio).toBe(frozen.reusedGates.G1.allNonblankRatio);
    expect(g.G1.nonDiscoveryNonblankRatio).toBe(frozen.reusedGates.G1.nonDiscoveryNonblankRatio);
    expect(g.G3.pass).toBe(frozen.reusedGates.G3.pass);
    expect([g.G4.mextOtherTransitions, g.G4.mhlwOtherTransitions, g.G4.pass]).toEqual([frozen.reusedGates.G4.mextOtherTransitions, frozen.reusedGates.G4.mhlwOtherTransitions, frozen.reusedGates.G4.pass]);
    expect([g.G5.pdfsWithNonblank, g.G5.pdfsParenthesizedMajority, g.G5.ratio]).toEqual([frozen.reusedGates.G5.pdfsWithNonblank, frozen.reusedGates.G5.pdfsParenthesizedMajority, frozen.reusedGates.G5.ratio]);
    const s = segmentStat(segsBy);
    expect(s.labelSegments).toBe(frozen.segmentComparison.alternative.labelSegments);
    expect(s.allSegments).toBe(frozen.segmentComparison.alternative.allSegments);
    expect(s.directLabelTransitions).toBe(frozen.segmentComparison.alternative.directLabelTransitions);
    expect(s.sameLabelNonContiguousRecurrence).toBe(frozen.segmentComparison.alternative.sameLabelNonContiguousRecurrence);
  });
});
