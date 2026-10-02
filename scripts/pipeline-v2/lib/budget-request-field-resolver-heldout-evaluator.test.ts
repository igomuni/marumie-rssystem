import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { evaluateHeldout, metricsFromOutcomes, renderHeldoutMarkdown } from './budget-request-field-resolver-heldout-evaluator';
import type { FieldResolverResult } from './budget-request-field-resolver';

const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('held-out 境界（GT 汚染）', () => {
  it('held-out の推論CLIは Golden を読まず、freeze した resolveFields だけを使う', () => {
    const src = read('../extract-budget-request-field-resolver-heldout.ts');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/golden|human-observations|evaluator/i);
    expect(src).toContain("from './lib/budget-request-field-resolver'");
    expect(src).toContain('hierarchy: null');
  });
  it('評価CLIは評価の前に freeze verification を実行し、不一致なら評価を実行しない', () => {
    const src = read('../evaluate-budget-request-field-resolver-heldout.ts');
    expect(src.indexOf('verifyFreeze(')).toBeGreaterThan(-1);
    expect(src.indexOf('verifyFreeze(')).toBeLessThan(src.indexOf('evaluateHeldout('));
    expect(src).toMatch(/allMatch[\s\S]*process\.exitCode = 1/);
  });
  it('held-out の manifest は選定のメタ情報だけで、真値（amount / sign 等）を持たない', () => {
    const m = read('../../../tests/fixtures/budget-request-field-resolver/heldout-v0/manifest.json');
    expect(m).not.toMatch(/magnitude|explicitZero|rowLocal/);
  });
});

const target = (id: string, prev: unknown, req: unknown, diff: unknown, tier = 'normal') => ({
  id, kind: 'detail_line', visualLocator: { approxYPt: 100, yToleranceBandPt: 8 },
  rowLocal: { code: { status: 'resolved', raw: '003' }, name: { status: 'resolved', rawLines: ['例'], normalized: '例' }, previousBudget: prev, requestedBudget: req, difference: diff },
  expectedSourceClass: { code: 'same_row' }, auxiliary: [{ class: 'none' }],
  hierarchy: { inputState: 'not_available', expected: { parentItemAssociation: { status: 'outside_v0_scope' }, parentOrganizationAssociation: { status: 'outside_v0_scope' } } }, tier,
});
const n = (raw: string) => ({ cellState: raw === '0' ? 'explicit zero' : 'explicit number', status: 'resolved', magnitudeRaw: raw, magnitudeNumeric: Number(raw.replace(/,/g, '')), explicitZero: raw === '0', sign: { status: 'not_observed', raw: null } });
const blank = { cellState: 'visual blank', status: 'blank', magnitudeRaw: null, magnitudeNumeric: null, explicitZero: false, sign: { status: 'not_applicable', raw: null } };
const golden = () => ({
  schemaVersion: 't', freezeCommit: 'x', humanReview: { status: 'pending', exceptions: [] },
  columnBandsPt: { 'standard-ledger': { previousBudget: [204, 256], requestedBudget: [256, 307], difference: [411, 463] } },
  samples: [{ id: 's', tier: 'normal', columnLayout: 'standard-ledger', document: { canonicalUrl: 'u' }, sourcePage: 1, pageUnitLabel: { status: 'not_observed', raw: null }, targets: [target('t', n('10'), blank, n('0'))] }],
});
const ok = (status: string, value: unknown, x: [number, number]) => ({ status, value, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: x[0], xMax: x[1], yMin: 0, yMax: 1 } } });
const rec = (over: Record<string, unknown>) => ({
  records: [{
    anchor: { page: 1, logicalRowIndex: 0 }, anchorBBox: { xMin: 0, yMin: 95, xMax: 800, yMax: 105 }, recordKind: 'detail_line', recordKindBasis: '',
    rowLocal: {
      code: ok('resolved', { raw: '003' }, [0, 1]), name: ok('resolved', { raw: '例', normalized: '例' }, [0, 1]),
      previousBudget: ok('resolved', { magnitudeRaw: '10', magnitudeNumeric: 10, explicitZero: false }, [240, 255]),
      requestedBudget: ok('blank', null, [259, 307]),
      difference: ok('resolved', { magnitudeRaw: '0', magnitudeNumeric: 0, explicitZero: true }, [440, 462]),
      previousBudgetSign: { status: 'not_observed', value: null, reasonCode: 'x', evidence: null }, requestedBudgetSign: { status: 'not_applicable', value: null, reasonCode: 'x', evidence: null }, differenceSign: { status: 'not_observed', value: null, reasonCode: 'x', evidence: null },
      ...over,
    },
    hierarchyDependent: { parentItemAssociation: { status: 'not_observed', value: null, reasonCode: 'hierarchy_artifact_not_available', evidence: null }, parentOrganizationAssociation: { status: 'not_observed', value: null, reasonCode: 'hierarchy_artifact_not_available', evidence: null } }, auxiliaryEvidenceRefs: [], pageUnitLabel: { status: 'not_observed', value: null, reasonCode: 'x', evidence: null },
  }],
} as unknown as FieldResolverResult);
const run = (over: Record<string, unknown>) => evaluateHeldout(golden() as never, () => rec(over));

describe('held-out evaluator（追加指標）', () => {
  it('全て一致: blank precision/recall・explicit-zero accuracy が 100%、false resolved 0', () => {
    const r = run({});
    expect(r.overall.falseResolved).toBe(0);
    expect(r.blank).toMatchObject({ gtBlank: 1, outputBlank: 1, exactBlank: 1, blankPrecision: 1, blankRecall: 1 });
    expect(r.explicitZero).toMatchObject({ gtZero: 1, exactZero: 1, accuracy: 1 });
    expect(r.confusion).toEqual({ blankConfirmedAsZero: 0, zeroConfirmedAsBlank: 0 });
  });
  it('blank を 0 として確定／0 を blank として確定した場合を取り違えとして数える', () => {
    const a = run({ requestedBudget: ok('resolved', { magnitudeRaw: '0', magnitudeNumeric: 0, explicitZero: true }, [259, 307]) });
    expect(a.confusion.blankConfirmedAsZero).toBe(1);
    expect(a.overall.falseResolved).toBeGreaterThan(0);
    const b = run({ difference: ok('blank', null, [440, 462]) });
    expect(b.confusion.zeroConfirmedAsBlank).toBe(1);
  });
  it('備考領域（差額列の右）の根拠で確定した金額を auxiliary 由来として数える', () => {
    const r = run({ previousBudget: ok('resolved', { magnitudeRaw: '10', magnitudeNumeric: 10, explicitZero: false }, [600, 620]) });
    expect(r.auxiliaryIsolation.auxiliaryDerivedCoreValues).toBe(1);
    expect(r.overall.wrongSource).toBeGreaterThan(0);
  });
  it('record が無ければ not_found（確定扱いにしない）で template abstention に数える', () => {
    const r = evaluateHeldout(golden() as never, () => ({ records: [] } as unknown as FieldResolverResult));
    expect(r.recordNotFound).toEqual(['t']);
    expect(r.overall.falseResolved).toBe(0);
    expect(r.templateAbstention['standard-ledger'].notFound).toBeGreaterThan(0);
  });
  it('集計は決定的で Markdown に出力できる', () => {
    expect(JSON.stringify(run({}))).toBe(JSON.stringify(run({})));
    expect(renderHeldoutMarkdown(run({}))).toContain('held-out 評価');
    expect(metricsFromOutcomes([]).precision).toBeNull();
  });
});
