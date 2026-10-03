/**
 * FieldResolver v0 Golden fixture の integrity テスト（fixture integrity のみ。FieldResolver の inference テストではない）。
 * 実PDFには依存しない（fixture は評価専用の JSON）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { goldenCoverage, GOLDEN_SCHEMA_VERSION, STATUS_VOCABULARY, validateGolden } from './budget-request-field-resolver-golden';

const FIXTURE = path.join(__dirname, '../../../tests/fixtures/budget-request-field-resolver/v0/golden.json');
const load = (): any => JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); // eslint-disable-line @typescript-eslint/no-explicit-any
const mutate = (f: (fx: any) => void): string[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const fx = load();
  f(fx);
  return validateGolden(fx);
};
const t0 = (fx: any) => fx.samples[0].targets; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Golden fixture（実物）の整合性', () => {
  it('検証エラーが無い', () => {
    expect(validateGolden(load())).toEqual([]);
  });
  it('status 語彙が Contract の status model と一致し、schema version が合っている', () => {
    const fx = load();
    expect(fx.schemaVersion).toBe(GOLDEN_SCHEMA_VERSION);
    expect(fx.statusVocabulary).toEqual([...STATUS_VOCABULARY]);
  });
  it('サンプル数と target 数（8ページ・20 target）。ID は重複しない', () => {
    const fx = load();
    expect(fx.samples).toHaveLength(8);
    const ids = fx.samples.flatMap((s: any) => s.targets.map((t: any) => t.id)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });
  it('観測方法が記録されている（アシスタントの視覚観測・抽出テキストを値に使っていない）', () => {
    const fx = load();
    expect(fx.observationMethod).toMatchObject({ method: 'assistant-visual-render', observer: 'assistant (AI)', usedExtractedTextForValues: false });
  });
  it('human review の記録: row-local の視覚 field は確認済み、MEXT p876 の名称の全角性だけ pending、階層の期待値は対象外、値は変更していない', () => {
    const fx = load();
    expect(fx.humanReview).toMatchObject({ status: 'row-local-visual-confirmed-with-exception', goldenValuesChanged: false });
    expect(fx.humanReview.exceptions).toHaveLength(1);
    expect(fx.humanReview.exceptions[0]).toMatchObject({ target: 'mext-p876-line015', field: 'name' });
    expect(fx.humanReview.excludedFromHumanVisualReview).toContain('hierarchy.expected');
    const targets = fx.samples.flatMap((s: any) => s.targets); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(targets.filter((t: any) => t.humanReview === 'visual-confirmed')).toHaveLength(19); // eslint-disable-line @typescript-eslint/no-explicit-any
    const exc = targets.find((t: any) => t.id === 'mext-p876-line015'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(exc.humanReview).toBe('visual-confirmed-except-name-unicode-pending');
    expect(exc.observationConfidence).toBe('medium');
  });
  it('既存の人間確認アンカー（human-observations.json）は位置のアンカーとして参照されている', () => {
    const anchors = load().samples.flatMap((s: any) => s.humanAnchors); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(anchors.length).toBe(6);
    expect(anchors.every((a: any) => a.source.endsWith('human-observations.json'))).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('coverage（Contract の必須の境界。TBD を残さない）', () => {
  const cov = goldenCoverage(load());
  it('必須の挙動が全て、少なくとも1つの target でカバーされている', () => {
    for (const k of ['explicit sign (difference)', 'explicit sign (requested)', 'sign-like symbol that is not an amount sign', 'blank amount', 'explicit zero', 'blank and explicit zero on the same page', 'auxiliary region beside the core row', 'auxiliary number must not fill an amount', 'wrapped name', 'hierarchy safe', 'hierarchy explicitly unresolved (root)', 'hierarchy level_gap + strong header', 'hierarchy resolved + strong header', 'page unit label observed', 'page unit label not observed']) {
      expect(cov.covered[k].length, k).toBeGreaterThan(0);
    }
  });
  it('例が見つからなかったものは NOT FOUND として明示されている（値を作っていない）', () => {
    expect(cov.notFound).toEqual(['missing difference (previous and requested shown, difference not shown)', 'single-organization B placement as a field-level behavior']);
    // 差額が表示されない行を作っていない: 要求額が resolved で差額が blank の target は無い
    const fx = load();
    const bad = fx.samples.flatMap((s: any) => s.targets).filter((t: any) => t.rowLocal.previousBudget.status === 'resolved' && t.rowLocal.requestedBudget.status === 'resolved' && t.rowLocal.difference.status === 'blank'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bad).toEqual([]);
  });
});

describe('検証が不正な fixture を拒否する', () => {
  it('重複する target ID', () => {
    expect(mutate(fx => { fx.samples[0].targets[1].id = fx.samples[0].targets[0].id; }).some(e => e.includes('duplicate'))).toBe(true);
  });
  it('重複する sample ID', () => {
    expect(mutate(fx => { fx.samples[1].id = fx.samples[0].id; }).some(e => e.includes('duplicate or missing sample id'))).toBe(true);
  });
  it('不正な status', () => {
    expect(mutate(fx => { t0(fx)[0].rowLocal.previousBudget.status = 'maybe'; }).some(e => e.includes('invalid status'))).toBe(true);
  });
  it('blank が数値を持つ（blank は 0 でも値でもない）', () => {
    const errs = mutate(fx => { const a = t0(fx)[4].rowLocal.previousBudget; a.magnitudeNumeric = 0; a.magnitudeRaw = '0'; });
    expect(errs.some(e => e.includes('blank is not 0'))).toBe(true);
  });
  it('resolved の金額が raw を持たない（evidence なしの resolved）', () => {
    expect(mutate(fx => { t0(fx)[1].rowLocal.requestedBudget.magnitudeRaw = null; }).some(e => e.includes('magnitudeRaw'))).toBe(true);
  });
  it('code が resolved なのに raw が無い', () => {
    expect(mutate(fx => { t0(fx)[1].rowLocal.code.raw = ''; }).some(e => e.includes('code must be resolved with raw'))).toBe(true);
  });
  it('magnitudeNumeric が raw と合わない／explicitZero が 0 と対応しない', () => {
    expect(mutate(fx => { t0(fx)[1].rowLocal.requestedBudget.magnitudeNumeric = 1; }).some(e => e.includes('does not match'))).toBe(true);
    expect(mutate(fx => { t0(fx)[3].rowLocal.difference.explicitZero = false; }).some(e => e.includes('explicitZero'))).toBe(true);
  });
  it('sign が不正な記号／位置なし', () => {
    expect(mutate(fx => { t0(fx)[2].rowLocal.difference.sign.raw = '+'; }).some(e => e.includes('resolved sign'))).toBe(true);
  });
  it('name.normalized が rawLines と整合しない', () => {
    expect(mutate(fx => { t0(fx)[1].rowLocal.name.normalized = '別の名称'; }).some(e => e.includes('name.normalized'))).toBe(true);
  });
  it('補助領域が金額へ attach する期待', () => {
    expect(mutate(fx => { t0(fx)[1].auxiliary[0].expectedAttachToAmountFields = 'previousBudget'; }).some(e => e.includes('must not attach'))).toBe(true);
  });
  it('hierarchy の期待: resolved に value が無い／not_resolved に acceptableStatuses が無い／artifact が無いのに resolved を期待', () => {
    expect(mutate(fx => { delete t0(fx)[1].hierarchy.expected.parentItemAssociation.value; }).some(e => e.includes('needs value'))).toBe(true);
    expect(mutate(fx => { const t = fx.samples.find((s: any) => s.id === 'meti-ippan-p105').targets[0]; delete t.hierarchy.expected.parentOrganizationAssociation.acceptableStatuses; }).some(e => e.includes('acceptableStatuses'))).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(mutate(fx => { const t = fx.samples.find((s: any) => s.id === 'mhlw-ippan-p1268').targets[0]; t.hierarchy.expected.parentItemAssociation = { status: 'resolved', value: { code: '010', name: 'x' } }; }).some(e => e.includes('outside_v0_scope'))).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('観測方法・provenance が欠ける', () => {
    expect(mutate(fx => { delete fx.observationMethod.humanReview; }).some(e => e.includes('observationMethod'))).toBe(true);
    expect(mutate(fx => { delete fx.samples[0].document.canonicalUrl; }).some(e => e.includes('canonicalUrl'))).toBe(true);
  });
});

describe('static boundary: 推論側が Golden を参照しない', () => {
  it('Golden の fixture / validator を参照してよいのは、Golden 検証・評価側（evaluator・評価CLI・テスト）だけ', () => {
    const root = path.join(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(root);
    const evaluationSide = /(budget-request-field-resolver-golden(\.test)?|budget-request-field-resolver-evaluator|budget-request-field-resolver-heldout[a-z-]*(\.test)?|budget-request-field-resolver-freeze(\.test)?|budget-request-incomplete-name-guard[a-z0-9-]*(\.test)?|build-budget-request-h1-guard-fire-worklist|build-budget-request-h1-human-validation-worklist|build-budget-request-h1-human-validation-gt|stage-budget-request-h1-human-review-package|evaluate-budget-request-incomplete-name-guard-h1|evaluate-budget-request-field-resolver-heldout|budget-request-field-resolver(-boundary)?\.test|evaluate-budget-request-field-resolver)\.ts$/;
    const referencesGolden = /fixtures['"/,\s]+budget-request-field-resolver|budget-request-field-resolver-golden/;
    const offenders = files.filter(f => !evaluationSide.test(f)).filter(f => referencesGolden.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
