import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';
import { ruleConfigSha256 } from './budget-request-toc-row-assembly';

const asm = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const out = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const m = JSON.parse(fs.readFileSync(path.join(out, 'implementation-freeze-manifest.json'), 'utf8'));

describe('toc row assembly implementation freeze（integrity のみ。評価ではない）', () => {
  it('source・rule/config・development fixture の hash が freeze manifest と一致する', () => {
    for (const [f, h] of Object.entries(m.sourceSha256 as Record<string, string>)) expect(sha(f)).toBe(h);
    expect(ruleConfigSha256()).toBe(m.ruleConfigSha256);
    expect(sha(path.join(out, 'development-regression.json'))).toBe(m.developmentRegressionSha256);
    expect(m.implementationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
  it('preregistration / GT freeze / membership が不変で、held-out は未実行', () => {
    expect(sha(path.join(asm, 'preregistration.json'))).toBe(m.preregistrationSha256);
    expect(m.preregistrationSha256).toBe('0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8');
    expect(sha(path.join(asm, 'gt-freeze-manifest.json'))).toBe(m.gtFreezeManifest.sha256);
    expect(m.gtFreezeManifest.status).toBe('GT_FROZEN');
    expect(m.membershipDigestSha256).toBe('8fa5a8a8444be31a637fae618235b0a77c6b37745441edc06534fe63c5a44156');
    expect([m.developmentSummary.pages, m.developmentSummary.heldoutPagesExecuted]).toEqual([34, 0]);
    expect(m.judgment).toBe('READY_FOR_TOC_ROW_ASSEMBLY_FROZEN_EVALUATION');
  });
});
