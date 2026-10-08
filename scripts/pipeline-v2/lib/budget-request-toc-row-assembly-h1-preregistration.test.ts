import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const h1dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const ev = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024');
const iso = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-false-positive-failure-isolation', '2024');
const asm = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const p = read(path.join(h1dir, 'preregistration.json'));

describe('H1（header zone right row-start split）preregistration の integrity（実験・実装を含まない）', () => {
  it('依存 artifact（#391 / #392 / #393 / #395 / #396 / #397）の hash が固定値のまま、parser source も不変', () => {
    const d = p.dependencyHashes;
    expect(sha(path.join(ev, 'evaluation-result.json'))).toBe(d.evaluationResult396Sha256);
    expect(sha(path.join(ev, 'heldout-parser-output.json'))).toBe(d.heldoutParserOutput396Sha256);
    expect(sha(path.join(iso, 'observations.json'))).toBe(d.isolationObservations397Sha256);
    expect(sha(path.join(iso, 'failure-families.json'))).toBe(d.isolationFamilies397Sha256);
    expect(sha(path.join(asm, 'preregistration.json'))).toBe(d.preregistration391Sha256);
    expect(sha(path.join(asm, 'ground-truth.json'))).toBe(d.groundTruth392Sha256);
    expect(sha(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024', 'implementation-freeze-manifest.json'))).toBe(d.implementationFreeze393ManifestSha256);
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe(d.parserSource393Sha256);
    expect(sha(path.join(asm, 'evaluation-protocol-amendment.json'))).toBe(d.amendment395Sha256);
    expect(read(path.join(asm, 'heldout-candidates.json')).membershipDigestSha256).toBe(d.heldoutMembershipDigest396);
  });
  it('held-out parser execution は #396 の 1 回のみで、新規 held-out 出力がない', () => {
    expect(p.heldoutParserExecutionCountTotal).toBe(1);
    expect(read(path.join(ev, 'evaluation-result.json')).formalExecutionCount).toBe(1);
    expect(fs.readdirSync(ev).sort()).toEqual(['evaluation-launch-manifest.json', 'evaluation-result.json', 'execution-started.json', 'heldout-parser-output.json']);
    expect(fs.readdirSync(h1dir)).toContain('preregistration.json');
    expect(fs.readdirSync(h1dir).filter(f => /heldout|held-out|evaluation-result|parser-output/.test(f))).toEqual([]);
  });
  it('H1 は単一変更で、tokenless fragment は対象外・特例禁止、PLAIN_ROW mapping・page/publisher/token 固有条件がない', () => {
    expect(p.status).toBe('H1_PREREGISTERED_FROZEN');
    expect(p.hypothesis.family).toBe(read(path.join(iso, 'failure-families.json')).families[0].label);
    expect(p.oneChangeBoundary.changedBehavior).toMatch(/header zone 内/);
    expect(p.oneChangeBoundary.unchangedBehavior).toEqual(expect.arrayContaining(['T=2 / bandMinEvidence=2', 'row-start token grammar（新 grammar なし）', 'row taxonomy（新 row kind なし）']));
    expect(p.knownSecondaryLimitation).toMatchObject({ label: 'KNOWN_SECONDARY_LIMITATION_NOT_TARGETED', h1Target: false, specialCaseAllowed: false });
    expect(p.leftHandling.plainRowMapping).toMatch(/^なし/);
    expect(p.leftHandling.semanticInference).toBe('なし');
    const trig = p.exactTrigger.allOf.join('\n');
    expect(trig).not.toMatch(/令和|230901|\.pdf|publisher|ministry|line index \d|page \d/i);
    expect(p.exactTrigger.noSpecificConditions).toMatch(/publisher/);
    expect(p.exactNonTrigger.unchangedFrozenBehavior).toHaveLength(6);
    expect(p.exactNonTrigger.unchangedFrozenBehavior.join()).toMatch(/NT3[^,]*row-start token で始まらない/);
  });
  it('#396 の 23 page は post-hoc 専用で、将来 held-out から除外され、threshold は未解決のまま', () => {
    expect(p.populations.postHocExcluded.role).toBe('POST_HOC_FAILURE_ANALYSIS_ONLY');
    expect(p.populations.postHocExcluded.forbidden.join()).toMatch(/validation held-out としての再利用/);
    expect(p.populations.futureHeldout.selectionProtocol[0]).toMatch(/#396 の held-out 23/);
    expect(p.populations.futureHeldout.membershipDeferredTo).toMatch(/後続 unit/);
    expect(p.populations.futureHeldout.ifNoPositiveTriggerPage).toMatch(/H1_UNVALIDATED/);
    expect(p.metrics.thresholds).toMatch(/^UNRESOLVED_ACCEPTANCE_THRESHOLD/);
    expect(p.metrics.notUsedAsDevelopmentMetric).toMatch(/#396/);
  });
  it('反証条件・metric・negative control・STOP 条件が揃い、judgment は development 実装開始のみを意味する', () => {
    for (const k of ['safetyRegression', 'triggerInsufficiency', 'noDevelopmentSupport', 'onFalsification']) expect(p.falsificationCriteria[k]).toBeDefined();
    expect(p.metrics.primarySafety).toHaveLength(4);
    expect(p.negativeControls.expected).toMatch(/分割してはならない/);
    expect(p.developmentEvidencePolicy.syntheticOnlyDecision).toMatch(/自動 STOP にしない/);
    expect(p.stopCriteria).toHaveLength(5);
    expect(p.claimBoundary).toMatch(/parser fix GO/);
    expect(p.judgment).toBe('READY_FOR_HEADER_ZONE_RIGHT_ROW_H1_DEVELOPMENT_IMPLEMENTATION');
  });
});
