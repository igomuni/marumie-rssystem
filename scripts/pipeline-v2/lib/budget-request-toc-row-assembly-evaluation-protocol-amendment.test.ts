import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const asm = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const par = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const a = read(path.join(asm, 'evaluation-protocol-amendment.json'));
const pre = read(path.join(asm, 'preregistration.json'));
const stop = read(path.join(asm, 'evaluation-protocol-clarification.json'));
const impl = read(path.join(par, 'implementation-freeze-manifest.json'));

describe('toc row assembly evaluation protocol amendment（evaluation procedure のみ。評価ではない）', () => {
  it('#391 / #392 / #393 / #394 の hash・status・membership が不変', () => {
    const d = a.dependencyHashes;
    expect(sha(path.join(asm, 'preregistration.json'))).toBe(d.preregistrationSha256);
    expect(d.preregistrationSha256).toBe('0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8');
    expect(sha(path.join(asm, 'gt-freeze-manifest.json'))).toBe(d.gtFreezeManifestSha256);
    expect(sha(path.join(par, 'implementation-freeze-manifest.json'))).toBe(d.implementationFreezeManifestSha256);
    expect(impl.status).toBe('IMPLEMENTATION_FROZEN');
    expect(d.parserSourceSha256).toBe(impl.sourceSha256['scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts']);
    expect(d.ruleConfigSha256).toBe(impl.ruleConfigSha256);
    expect(sha(path.join(asm, 'evaluation-protocol-clarification.json'))).toBe(d.stopArtifact394Sha256);
    expect(a.membershipDigestSha256).toBe(read(path.join(asm, 'gt-freeze-manifest.json')).membershipDigestSha256);
    expect(a.population).toEqual({ heldoutCandidates: 23, direct: 14, inherited: 9, developmentExplored: 34, overlap: 0 });
  });
  it('#394 の STOP artifact は NOT_FROZEN のまま、amendment はそれを理由として参照する', () => {
    expect(stop.status).toBe('STOP_PROTOCOL_AMENDMENT_REQUIRED');
    expect(stop.frozenStatus).toMatch(/^NOT_FROZEN/);
    expect(a.reasonForAmendment).toMatch(/#394/);
    expect(a.reasonForAmendment).toMatch(/STOP_PROTOCOL_AMENDMENT_REQUIRED/);
    expect(a.status).toBe('EVALUATION_PROTOCOL_AMENDMENT_FROZEN');
    expect(a.provenance).toMatchObject({ discoveredBeforeFormalEvaluation: true, heldoutParserExecutionsBeforeAmendment: 0, formalEvaluationsBeforeAmendment: 0 });
    expect(a.triggerNature).toMatch(/held-out の性能[^。]*ではない/);
  });
  it('supersede 対象は #391 の alignment 前半のみで、original text を保持している', () => {
    expect(a.supersedesEvaluationClause.originalText).toBe('parser row と GT row の対応は row-start token（number/code/marker）+ column + column 内順序で取る');
    expect(pre.gtProtocol.alignment.startsWith(a.supersedesEvaluationClause.originalText)).toBe(true);
    expect(a.doesNotModify.join()).toMatch(/preregistration/);
  });
  it('severe taxonomy・四状態・threshold が不変、PLAIN_ROW の mapping がなく、評価結果 field もない', () => {
    expect(a.severeOperationalization.taxonomyUnchanged).toEqual(pre.metrics.severe);
    expect(a.applicability.states.fourStates).toEqual(['CORRECT', 'INCORRECT', 'ABSTAINED', 'UNRESOLVED']);
    expect(a.applicability.rule).toMatch(/四状態のいずれにも数えず/);
    expect(a.plainRow.semanticMapping).toMatch(/^なし/);
    expect(JSON.stringify(a)).not.toMatch(/PLAIN_ROW\s*(→|->)\s*(TITLE_OR_HEADING|OTHER_CODE|UNKNOWN_ABSTAINED|WRAPPED_FRAGMENT|REQUEST_NUMBER_ROW|MARKER_ROW)(?!\s*の mapping)/);
    expect(a.acceptanceThresholds.status).toMatch(/^UNRESOLVED_ACCEPTANCE_THRESHOLD/);
    expect(JSON.stringify(a.acceptanceThresholds)).not.toMatch(/\d+\s*%|>=\s*0\.\d/);
    expect(a.evaluationRun).toMatchObject({ heldoutParserExecutions: 0, heldoutOutputArtifacts: 0, formalEvaluationPerformed: false });
    expect(JSON.stringify(Object.keys(a))).not.toMatch(/accuracy|severeCount|resultCounts|evaluationResult/i);
    expect(fs.readdirSync(par).sort()).toEqual(['development-regression.json', 'implementation-freeze-manifest.json']);
  });
  it('column は identity 外で column 不一致が検出可能、duplicate は group 件数比較で deterministic、fallback と header-zone 例外がない', () => {
    expect(a.amendedAlignment.evaluatedAttributesNotInIdentity).toEqual(expect.arrayContaining(['column']));
    expect(JSON.stringify(a.amendedAlignment.identityKeys)).not.toMatch(/column|order|occurrence/);
    expect(a.amendedAlignment.columnComparison).toMatch(/WRONG_COLUMN_ASSIGNMENT/);
    expect(a.amendedAlignment.duplicateHandling).toMatch(/m>n/);
    expect(a.amendedAlignment.duplicateHandling).toMatch(/pairing は行わない/);
    expect(a.amendedAlignment.noFallback).toMatch(/救済対応させない/);
    expect(a.evidenceOnlyPredicates.mergeDetection).toMatch(/TITLE_OR_HEADING を含む/);
    expect(a.headerZone).toMatch(/例外・tolerance なし/);
    expect(a.proposal394Disposition.occurrence.disposition).toBe('REJECT');
    for (const v of Object.values(a.proposal394Disposition) as { disposition: string }[]) expect(['ACCEPT', 'MODIFY', 'REJECT', 'OUT_OF_SCOPE']).toContain(v.disposition);
    expect(a.judgment).toBe('READY_FOR_TOC_ROW_ASSEMBLY_ONE_SHOT_FROZEN_EVALUATION_AFTER_AMENDMENT');
  });
});
