import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const asm = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const par = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const p = read(path.join(asm, 'evaluation-protocol-clarification.json'));
const pre = read(path.join(asm, 'preregistration.json'));
const impl = read(path.join(par, 'implementation-freeze-manifest.json'));

describe('toc row assembly evaluation protocol clarification（contract のみ。評価ではない）', () => {
  it('dependency hash・membership・implementation freeze が現行 artifact と一致する', () => {
    expect(p.status).toBe('EVALUATION_PROTOCOL_CLARIFIED_FROZEN');
    expect(p.dependencyHashes.preregistrationSha256).toBe(sha(path.join(asm, 'preregistration.json')));
    expect(p.dependencyHashes.gtFreezeManifestSha256).toBe(sha(path.join(asm, 'gt-freeze-manifest.json')));
    expect(p.dependencyHashes.implementationFreezeManifestSha256).toBe(sha(path.join(par, 'implementation-freeze-manifest.json')));
    expect(p.dependencyHashes.implementationCommit).toBe(impl.implementationCommit);
    expect(p.dependencyHashes.parserSourceSha256).toBe(impl.sourceSha256['scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts']);
    expect(p.dependencyHashes.ruleConfigSha256).toBe(impl.ruleConfigSha256);
    expect(p.membershipDigestSha256).toBe(read(path.join(asm, 'gt-freeze-manifest.json')).membershipDigestSha256);
    expect(p.population).toEqual({ heldoutCandidates: 23, direct: 14, inherited: 9, developmentExplored: 34, overlap: 0 });
  });
  it('PLAIN_ROW に parser kind への semantic mapping がなく、row-level metric は NOT_COMPARABLE、WRONG_ROW_START_CLASSIFICATION の対象外', () => {
    expect(p.rowCorrespondence.unmatchable.gtRowKinds).toEqual(['PLAIN_ROW']);
    expect(p.rowCorrespondence.unmatchable.state).toBe('NOT_COMPARABLE');
    expect(p.rowLevelOutcomeForGtTokenKeyedRow.wrongRowStartClassification).toMatch(/PLAIN_ROW[^。]*対象外/);
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/PLAIN_ROW\s*(→|->|=|は)\s*(TITLE_OR_HEADING|OTHER_CODE|UNKNOWN_ABSTAINED|WRAPPED_FRAGMENT|REQUEST_NUMBER_ROW|MARKER_ROW)(?!\s*unit)/);
    expect(p.forbiddenPostHocChanges.join()).toMatch(/PLAIN_ROW → parser kind の mapping/);
  });
  it('NOT_COMPARABLE は四状態に混入せず、四状態・severe 定義・閾値が #391 から変わらない', () => {
    expect(p.comparabilityStates.fourStates).toEqual(['CORRECT', 'INCORRECT', 'ABSTAINED', 'UNRESOLVED']);
    expect(p.comparabilityStates.fourStates).not.toContain('NOT_COMPARABLE');
    expect(p.comparabilityStates.notComparableRule).toMatch(/四状態のいずれにも数えず/);
    expect(p.severeRules.definitionsUnchanged).toEqual(pre.metrics.severe);
    expect(p.acceptanceThresholds.items.length).toBeGreaterThan(0);
    expect(p.acceptanceThresholds.status).toMatch(/^UNRESOLVED_ACCEPTANCE_THRESHOLD/);
    expect(JSON.stringify(p.acceptanceThresholds)).not.toMatch(/\d+\s*%|>=\s*0\.\d/);
  });
  it('評価結果の field・held-out parser output artifact を持たず、parser / GT / preregistration は freeze 値のまま', () => {
    expect(p.evaluationRun).toMatchObject({ heldoutParserExecutions: 0, heldoutOutputArtifacts: 0, evaluationPerformed: false });
    const keys = JSON.stringify(Object.keys(p));
    expect(keys).not.toMatch(/accuracy|severeCount|resultCounts|evaluationResult/i);
    expect(fs.readdirSync(par).sort()).toEqual(['development-regression.json', 'implementation-freeze-manifest.json']);
    expect(fs.readdirSync(asm).filter(f => /output|evaluation-result|parser-output/.test(f))).toEqual([]);
    expect(sha(path.join(asm, 'preregistration.json'))).toBe('0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8');
    expect(p.judgment).toBe('READY_FOR_TOC_ROW_ASSEMBLY_ONE_SHOT_FROZEN_EVALUATION');
  });
  it('severe・descriptive metric・abstention 区別の contract が揃っている', () => {
    for (const k of ['FALSE_POSITIVE_ROW_ASSEMBLY', 'WRONG_COLUMN_ASSIGNMENT', 'WRONG_FRAGMENT_ATTACHMENT', 'PROVENANCE_MISMATCH']) expect(p.severeRules[k]).toBeDefined();
    for (const k of ['pageResolutionCoverage', 'physicalRowCoverage', 'comparableRowClassificationCoverage', 'fragmentAttachmentCoverage']) expect(p.descriptiveMetrics[k]).toMatch(/分子.*分母/);
    expect(p.abstentionHandling.distinct).toHaveLength(3);
    expect(p.rowCorrespondence.identityKeys.REQUEST).toBeDefined();
    expect(p.rowCorrespondence.identityKeys.MARKER).toBeDefined();
    expect(p.rowCorrespondence.attributesNotInKey).toEqual(['column', 'order']);
  });
});
