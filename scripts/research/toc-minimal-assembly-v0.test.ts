import { describe, expect, it } from 'vitest';
import { assemblePage, stableBarrierId, stablePrimitiveId, type AssemblyPageInput } from './toc-minimal-assembly-v0';
import type { Primitive, Side } from './toc-column-primitives-v1';
import fixture from '../../tests/fixtures/budget-request-toc-minimal-assembly/2024/fixture.json';
import expected from '../../tests/fixtures/budget-request-toc-minimal-assembly/2024/expected-results.json';

type FixturePrimitive = (typeof fixture.cases)[number]['primitives'][number] & { reason?: 'UNRESOLVED_BOUNDARY_CUT' };

function caseInput(testCase: (typeof fixture.cases)[number]): AssemblyPageInput {
  const primitives: AssemblyPageInput['primitives'] = [];
  const barriers: AssemblyPageInput['barriers'] = [];
  for (const rawItem of testCase.primitives as FixturePrimitive[]) {
    const side = rawItem.side as Side;
    const range = rawItem.sourceRangeUtf16 as [number, number];
    if (rawItem.kind === 'unresolved') {
      const partial = {
        sourcePdf: testCase.sourcePdf,
        physicalPage: testCase.physicalPage,
        lineIndex: rawItem.lineIndex,
        lineStartUtf16: rawItem.lineStartUtf16,
        side,
        sourceRangeUtf16: range,
        rawText: rawItem.rawText,
        reasonCode: rawItem.reason ?? 'FIXTURE_UNRESOLVED_BARRIER',
      };
      barriers.push({ ...partial, barrierId: stableBarrierId(partial) });
      continue;
    }
    const primitive: Primitive = {
      kind: rawItem.kind as Primitive['kind'],
      side,
      pageRef: rawItem.pageRef,
      ...(rawItem.titleText === null ? {} : { titleText: rawItem.titleText }),
      rawText: rawItem.rawText,
      sourceLineIndex: rawItem.lineIndex,
      sourceLineStartUtf16: rawItem.lineStartUtf16,
      sourceRangeUtf16: range,
    } as const;
    primitives.push({
      primitiveId: stablePrimitiveId(testCase.sourcePdf, testCase.physicalPage, primitive),
      sourcePdf: testCase.sourcePdf,
      physicalPage: testCase.physicalPage,
      primitive,
    });
  }
  return { sourcePdf: testCase.sourcePdf, physicalPage: testCase.physicalPage, primitives, barriers };
}

describe('TOC minimal assembly v0 frozen development fixtures', () => {
  it('matches each frozen H1/H2 status, direction, and source-line pair', () => {
    for (const expectation of expected.expectations) {
      const testCase = fixture.cases.find(item => item.caseId === expectation.caseId);
      expect(testCase, expectation.caseId).toBeDefined();
      const result = assemblePage(caseInput(testCase!));
      const observations = result.observations.filter(item => item.hypothesis === expectation.hypothesis);
      const counts: Record<string, number> = {};
      for (const observation of observations) counts[observation.status] = (counts[observation.status] ?? 0) + 1;
      expect(counts, expectation.caseId).toEqual(expectation.statusCounts);
      const linePairs = observations.filter(item => item.sourcePrimitiveIds.length === 2).map(item => {
        const sourceById = new Map(caseInput(testCase!).primitives.map(source => [source.primitiveId, source.primitive.sourceLineIndex]));
        return item.sourcePrimitiveIds.map(id => sourceById.get(id)!);
      });
      expect(linePairs, expectation.caseId).toEqual(expectation.candidateSourceLinePairs);
      expect(observations.filter(item => item.status === 'RESOLVED'), expectation.caseId).toHaveLength(expectation.resolvedCount);
      for (const reason of expectation.requiredReasons) {
        expect(observations.some(item => item.reasonCodes.includes(reason)), `${expectation.caseId}: ${reason}`).toBe(true);
      }
    }
  });

  it('preserves source primitive provenance and is deterministic', () => {
    for (const testCase of fixture.cases) {
      const input = caseInput(testCase);
      const first = assemblePage(input);
      const second = assemblePage(input);
      expect(second).toEqual(first);
      expect(new Set(first.sourcePrimitiveIds).size).toBe(first.sourcePrimitiveIds.length);
      for (const source of input.primitives) {
        expect(source.sourcePdf).toBe(testCase.sourcePdf);
        expect(source.physicalPage).toBe(testCase.physicalPage);
        const { rawText, sourceRangeUtf16 } = source.primitive;
        const sourceLine = (testCase.primitives as FixturePrimitive[]).find(item =>
          item.lineIndex === source.primitive.sourceLineIndex
          && item.sourceRangeUtf16[0] === sourceRangeUtf16[0]
          && item.sourceRangeUtf16[1] === sourceRangeUtf16[1]);
        expect(sourceLine?.sourceLineRawText.slice(sourceRangeUtf16[0], sourceRangeUtf16[1])).toBe(rawText);
      }
      expect(first.observations.some(item => item.status === 'RESOLVED')).toBe(false);
      expect(first.observations.filter(item => item.status !== 'UNMATCHED').every(item => item.sourcePrimitiveIds.length === 2)).toBe(true);
    }
  });

  it('keeps the NDL pair unknown-side and the CFA continuation fragments unjoined', () => {
    const ndl = fixture.cases.find(item => item.caseId === 'H2-D1')!;
    const ndlResult = assemblePage(caseInput(ndl));
    const ndlCandidate = ndlResult.observations.find(item => item.hypothesis === 'H2');
    expect(ndlCandidate?.status).toBe('CANDIDATE_UNRESOLVED');
    expect(ndlCandidate?.side).toBe('unknown');
    expect(ndlCandidate?.pageRef).toBe('国(国)13');
    expect(ndlCandidate?.titleCandidate).toBe('令和６年度概算要求定員表');

    const cfa = fixture.cases.find(item => item.caseId === 'H1-D1')!;
    const cfaResult = assemblePage(caseInput(cfa));
    const cfaCandidate = cfaResult.observations.find(item => item.hypothesis === 'H1');
    expect(cfaCandidate?.status).toBe('CANDIDATE_UNRESOLVED');
    expect(cfaCandidate?.pageRef).toBe('94');
    expect(cfaCandidate?.titleCandidate).toBeNull();
    expect(cfaCandidate?.titleFragments).toEqual([
      '8    01‑05 子ども・子育て支援の財源の年金特別会計子ども・子育て支援勘定へ繰入れに',
      '必要な経費',
    ]);
  });

  it('preserves the independent left/right candidates in H2-D4', () => {
    const testCase = fixture.cases.find(item => item.caseId === 'H2-D4')!;
    const right = testCase.primitives.find(item => item.side === 'right')!;
    expect(right.rawText).toBe('TITLE B');
    expect(right.sourceRangeUtf16).toEqual([11, 18]);
    const result = assemblePage(caseInput(testCase));
    expect(result.observations.filter(item => item.hypothesis === 'H2').every(item => item.status === 'AMBIGUOUS')).toBe(true);
  });
});
