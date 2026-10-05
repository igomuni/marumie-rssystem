import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { round1, round3, selectLeftRule, structuralRow, type AmountCell, type SourceRecord, type VRule } from './budget-request-rule-line-item-population';

const cell = (status: string, value: unknown = null, refs: number[] = []): AmountCell => ({ status, value, evidence: { sourceTokenRefs: refs } });
const rec = (o: Partial<{ kind: string; code: string | null; codeStatus: string; prev: AmountCell; req: AmountCell; diff: AmountCell; nameStatus: string }> = {}): SourceRecord => ({
  anchor: { page: 3, logicalRowIndex: 7 }, anchorBBox: { xMin: 50, yMin: 100, xMax: 400, yMax: 110 }, recordKind: o.kind ?? 'unclassified',
  rowLocal: {
    code: { status: o.codeStatus ?? 'resolved', value: o.code === null ? null : { raw: o.code ?? '123' }, evidence: { sourceTokenRefs: [2], bboxUnion: { xMin: 60 } } },
    name: { status: o.nameStatus ?? 'resolved', reasonCode: null, value: o.nameStatus && o.nameStatus !== 'resolved' ? null : { raw: '内 閣', normalized: '内閣' }, evidence: { sourceTokenRefs: [4] } },
    previousBudget: o.prev ?? cell('blank'), requestedBudget: o.req ?? cell('resolved', 10, [8]), difference: o.diff ?? cell('blank'),
  },
});
describe('structuralRow', () => {
  it('request-shaped・非 plain3・amount なし・code 非 resolved は除外', () => {
    expect(structuralRow(rec({ kind: 'request' }))).toBeNull();
    expect(structuralRow(rec({ code: '12-345' }))).toBeNull();
    expect(structuralRow(rec({ code: '1234' }))).toBeNull();
    expect(structuralRow(rec({ req: cell('blank') }))).toBeNull();
    expect(structuralRow(rec({ codeStatus: 'unresolved' }))).toBeNull();
  });
  it('amount は列ごとの bit。blank を 0 にしない。名称不明でも消さない', () => {
    const r = structuralRow(rec({ prev: cell('resolved', 5, [6]), nameStatus: 'ambiguous' }))!;
    expect(r).toMatchObject({ amountPattern: 'PR-', previousBudgetEvidence: true, requestBudgetEvidence: true, differenceEvidence: false, nameStatus: 'ambiguous', nameNormalized: null, codeX: 60 });
    expect(r.amountTokenRefs).toEqual([6, 8]);
    expect(structuralRow(rec())!.nameNormalized).toBe('内閣');
  });
});
describe('selectLeftRule', () => {
  const rules: VRule[] = [{ x: 10, yMin: 0, yMax: 800, lineWidths: [1], sourcePaths: [1] }, { x: 52, yMin: 90, yMax: 120, lineWidths: [0.3], sourcePaths: [2] }, { x: 58, yMin: 200, yMax: 300, lineWidths: [0.3], sourcePaths: [3] }, { x: 70, yMin: 0, yMax: 800, lineWidths: [0.3], sourcePaths: [4] }];
  it('midpoint を含む左側の rule のうち最も近いもの（x が codeX 以上や y 区間外は除く）', () => {
    const s = selectLeftRule(rules, 60, { yMin: 100, yMax: 110 });
    expect(s.status).toBe('rule_linked'); expect(s.rule!.x).toBe(52); expect(s.eligibleCount).toBe(2);
  });
  it('無ければ unavailable、同じ x に複数なら ambiguous', () => {
    expect(selectLeftRule(rules, 5, { yMin: 100, yMax: 110 }).status).toBe('rule_unavailable');
    expect(selectLeftRule([rules[1], { ...rules[1], sourcePaths: [9] }], 60, { yMin: 100, yMax: 110 }).status).toBe('rule_ambiguous');
    expect(selectLeftRule([{ ...rules[1], x: 60 }], 60, { yMin: 100, yMax: 110 }).status).toBe('rule_unavailable');
  });
});
describe('丸め', () => { it('0.001 / 0.1', () => { expect(round3(8.6666)).toBe(8.667); expect(round1(8.66)).toBe('8.7'); expect(round1(9)).toBe('9.0'); }); });
describe('Phase A は MOF・hierarchy・manual・既存 item・既知の indent 定数を参照しない（source scan）', () => {
  it.each(['scripts/pipeline-v2/lib/budget-request-rule-line-item-population.ts', 'scripts/pipeline-v2/run-budget-request-rule-line-item-phase-a.ts'])('%s', f => {
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/mof-|budget-jikou|MofBudget|mofJikou|normalized\/mof/i, /=== 'item'/, /recordKind === 'organization'/, /\.manual\b/, /hierarchyDependent/, /DocumentHierarchy|observeDocumentHierarchy/, /ITEM_INDENT_STEP|budget-request-item-candidate/, /candidate-count/]) expect(forbidden.test(src), `${f}: ${forbidden}`).toBe(false);
  });
});
