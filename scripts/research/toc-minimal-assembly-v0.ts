import { createHash } from 'node:crypto';
import type { Primitive, Side } from './toc-column-primitives-v1';

export type AssemblyHypothesis = 'H1' | 'H2';
export type AssemblyStatus = 'RESOLVED' | 'CANDIDATE_UNRESOLVED' | 'AMBIGUOUS' | 'UNMATCHED';

export interface AssemblyPrimitive {
  primitiveId: string;
  sourcePdf: string;
  physicalPage: number;
  primitive: Primitive;
}

export interface AssemblyBarrier {
  barrierId: string;
  sourcePdf: string;
  physicalPage: number;
  lineIndex: number;
  lineStartUtf16: number;
  side: Side;
  sourceRangeUtf16: [number, number];
  rawText: string;
  reasonCode: string;
}

export interface AssemblyPageInput {
  sourcePdf: string;
  physicalPage: number;
  primitives: AssemblyPrimitive[];
  barriers: AssemblyBarrier[];
}

export interface AssemblyObservation {
  observationId: string;
  hypothesis: AssemblyHypothesis;
  status: AssemblyStatus;
  sourcePdf: string;
  physicalPage: number;
  side: Side;
  sourcePrimitiveIds: string[];
  titleCandidate: string | null;
  titleFragments: string[];
  pageRef: string | null;
  reasonCodes: string[];
}

export interface AssemblyResult {
  observations: AssemblyObservation[];
  sourcePrimitiveIds: string[];
  barrierIds: string[];
}

type Unit =
  | { kind: 'primitive'; lineIndex: number; side: Side; primitive: AssemblyPrimitive }
  | { kind: 'barrier'; lineIndex: number; side: Side; barrier: AssemblyBarrier };

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Stable provenance identifier; it does not encode a semantic record identity. */
export function stablePrimitiveId(sourcePdf: string, physicalPage: number, primitive: Primitive): string {
  const canonical = JSON.stringify({
    sourcePdf,
    physicalPage,
    lineIndex: primitive.sourceLineIndex,
    side: primitive.side,
    range: primitive.sourceRangeUtf16,
    kind: primitive.kind,
    rawText: primitive.rawText,
  });
  return `prim-${digest(canonical).slice(0, 20)}`;
}

export function stableBarrierId(barrier: Omit<AssemblyBarrier, 'barrierId'>): string {
  return `bar-${digest(JSON.stringify(barrier)).slice(0, 20)}`;
}

function makeObservation(
  hypothesis: AssemblyHypothesis,
  status: AssemblyStatus,
  input: AssemblyPageInput,
  primitives: AssemblyPrimitive[],
  reasonCodes: string[],
): AssemblyObservation {
  const ordered = [...primitives].sort((a, b) =>
    a.primitive.sourceLineIndex - b.primitive.sourceLineIndex
    || a.primitive.sourceRangeUtf16[0] - b.primitive.sourceRangeUtf16[0]
    || a.primitiveId.localeCompare(b.primitiveId));
  const first = ordered[0];
  const titleFragments = ordered.flatMap(item => item.primitive.titleText ? [item.primitive.titleText] : []);
  const titleCandidate = hypothesis === 'H2'
    ? ordered.find(item => item.primitive.kind === 'title_only_candidate')?.primitive.titleText ?? null
    : null;
  const pageRef = ordered.find(item => item.primitive.pageRef !== null)?.primitive.pageRef ?? null;
  const sourcePrimitiveIds = ordered.map(item => item.primitiveId);
  const observationId = `asm-${digest(JSON.stringify({ hypothesis, status, sourcePdf: input.sourcePdf, physicalPage: input.physicalPage, sourcePrimitiveIds })).slice(0, 20)}`;
  return {
    observationId,
    hypothesis,
    status,
    sourcePdf: input.sourcePdf,
    physicalPage: input.physicalPage,
    side: ordered.every(item => item.primitive.side === first.primitive.side) ? first.primitive.side : 'unknown',
    sourcePrimitiveIds,
    titleCandidate,
    titleFragments,
    pageRef,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}

function compatibleKinds(hypothesis: AssemblyHypothesis): { start: Primitive['kind']; target: Primitive['kind'] } {
  return hypothesis === 'H1'
    ? { start: 'title_page', target: 'title_only_candidate' }
    : { start: 'page_only', target: 'title_only_candidate' };
}

/**
 * Find structurally adjacent H1/H2 candidates only. The frozen input contract
 * has no ownership signal, so this function intentionally never resolves a pair.
 */
function assembleHypothesis(input: AssemblyPageInput, hypothesis: AssemblyHypothesis): AssemblyObservation[] {
  const { start: startKind, target: targetKind } = compatibleKinds(hypothesis);
  const units: Unit[] = [
    ...input.primitives.map(primitive => ({ kind: 'primitive' as const, lineIndex: primitive.primitive.sourceLineIndex, side: primitive.primitive.side, primitive })),
    ...input.barriers.map(barrier => ({ kind: 'barrier' as const, lineIndex: barrier.lineIndex, side: barrier.side, barrier })),
  ].sort((a, b) => a.lineIndex - b.lineIndex
    || unitStart(a) - unitStart(b)
    || unitId(a).localeCompare(unitId(b)));
  const starts = input.primitives.filter(item => item.primitive.kind === startKind);
  const targets = input.primitives.filter(item => item.primitive.kind === targetKind);
  const edges: Array<[AssemblyPrimitive, AssemblyPrimitive]> = [];

  for (const start of starts) {
    for (const target of targets) {
      if (target.primitive.sourceLineIndex <= start.primitive.sourceLineIndex) continue;
      if (!isStructurallyAdjacent(start, target, units)) continue;
      edges.push([start, target]);
    }
  }

  const degree = new Map<string, number>();
  for (const [start, target] of edges) {
    degree.set(start.primitiveId, (degree.get(start.primitiveId) ?? 0) + 1);
    degree.set(target.primitiveId, (degree.get(target.primitiveId) ?? 0) + 1);
  }

  const observations: AssemblyObservation[] = [];
  const used = new Set<string>();
  for (const [start, target] of edges) {
    used.add(start.primitiveId);
    used.add(target.primitiveId);
    const ambiguous = (degree.get(start.primitiveId) ?? 0) > 1 || (degree.get(target.primitiveId) ?? 0) > 1;
    const reasons = [ambiguous ? 'MULTIPLE_COUNTERPARTS' : 'OWNERSHIP_NOT_ENCODED'];
    if (start.primitive.side === 'unknown' || target.primitive.side === 'unknown') reasons.push('SIDE_UNKNOWN');
    observations.push(makeObservation(hypothesis, ambiguous ? 'AMBIGUOUS' : 'CANDIDATE_UNRESOLVED', input, [start, target], reasons));
  }

  const relevant = input.primitives.filter(item => item.primitive.kind === startKind || item.primitive.kind === targetKind);
  for (const item of relevant) {
    if (used.has(item.primitiveId)) continue;
    const reason = unmatchedReason(item, input, startKind, targetKind);
    observations.push(makeObservation(hypothesis, 'UNMATCHED', input, [item], [reason]));
  }

  return observations.sort((a, b) => a.hypothesis.localeCompare(b.hypothesis)
    || a.sourcePrimitiveIds.join('|').localeCompare(b.sourcePrimitiveIds.join('|'))
    || a.observationId.localeCompare(b.observationId));
}

function unitStart(unit: Unit): number {
  return unit.kind === 'primitive' ? unit.primitive.primitive.sourceRangeUtf16[0] : unit.barrier.sourceRangeUtf16[0];
}

function unitId(unit: Unit): string {
  return unit.kind === 'primitive' ? unit.primitive.primitiveId : unit.barrier.barrierId;
}

function isStructurallyAdjacent(start: AssemblyPrimitive, target: AssemblyPrimitive, units: Unit[]): boolean {
  const startLine = start.primitive.sourceLineIndex;
  const targetLine = target.primitive.sourceLineIndex;
  const between = units.filter(unit => unit.lineIndex > startLine && unit.lineIndex < targetLine);
  if (start.primitive.side === 'unknown' || target.primitive.side === 'unknown') {
    // Unknown column: only the next nonempty raw-line group may form a candidate.
    const nextLine = units.find(unit => unit.lineIndex > startLine)?.lineIndex;
    if (nextLine !== targetLine) return false;
    return between.length === 0;
  }
  if (start.primitive.side !== target.primitive.side) return false;
  if (between.some(unit => unit.kind === 'barrier' || unit.side === 'unknown' || unit.side === start.primitive.side)) return false;
  const sameSideEarlierOnTargetLine = units.some(unit => unit.lineIndex === targetLine
    && unitStart(unit) < target.primitive.sourceRangeUtf16[0]
    && (unit.kind === 'barrier' || unit.side === 'unknown' || unit.side === start.primitive.side));
  return !sameSideEarlierOnTargetLine;
}

function unmatchedReason(item: AssemblyPrimitive, input: AssemblyPageInput, startKind: Primitive['kind'], targetKind: Primitive['kind']): string {
  const isStart = item.primitive.kind === startKind;
  const wanted = isStart ? targetKind : startKind;
  const allCounterparts = input.primitives.filter(other => other.primitive.kind === wanted);
  if (allCounterparts.some(other => other.primitive.side !== 'unknown' && item.primitive.side !== 'unknown' && other.primitive.side !== item.primitive.side)) {
    return 'NO_SAME_SIDE_COUNTERPART';
  }
  const candidates = input.primitives.filter(other => other.primitive.kind === wanted
    && other.primitive.sourceLineIndex > item.primitive.sourceLineIndex);
  if (candidates.some(other => input.barriers.some(barrier => barrier.lineIndex > item.primitive.sourceLineIndex && barrier.lineIndex < other.primitive.sourceLineIndex))) {
    return 'UNRESOLVED_BARRIER';
  }
  if (candidates.length) return 'INTERVENING_SAME_SIDE_ITEM';
  return 'NO_COUNTERPART';
}

export function assemblePage(input: AssemblyPageInput): AssemblyResult {
  const primitives = [...input.primitives].sort((a, b) =>
    a.primitive.sourceLineIndex - b.primitive.sourceLineIndex
    || a.primitive.sourceRangeUtf16[0] - b.primitive.sourceRangeUtf16[0]
    || a.primitiveId.localeCompare(b.primitiveId));
  const observations = [
    ...assembleHypothesis({ ...input, primitives }, 'H1'),
    ...assembleHypothesis({ ...input, primitives }, 'H2'),
  ].sort((a, b) => a.hypothesis.localeCompare(b.hypothesis)
    || a.sourcePdf.localeCompare(b.sourcePdf)
    || a.physicalPage - b.physicalPage
    || a.sourcePrimitiveIds.join('|').localeCompare(b.sourcePrimitiveIds.join('|'))
    || a.observationId.localeCompare(b.observationId));
  return {
    observations,
    sourcePrimitiveIds: primitives.map(item => item.primitiveId),
    barrierIds: [...input.barriers].sort((a, b) => a.lineIndex - b.lineIndex || a.barrierId.localeCompare(b.barrierId)).map(item => item.barrierId),
  };
}
