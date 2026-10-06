import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import type { AmountCell, SourceRecord } from './budget-request-rule-line-item-population';
import { BAND_MAX, BAND_MIN, inBand, isCandidate, universeRow } from './budget-request-rule-8p6-candidate';

const blank: AmountCell = { status: 'blank', value: null, evidence: null };
const rec = (o: { kind?: string; code?: string | null; codeStatus?: string; nameStatus?: string; nameReason?: string | null; nameRaw?: string | null } = {}): SourceRecord => ({
  anchor: { page: 2, logicalRowIndex: 5 }, anchorBBox: { xMin: 50, yMin: 100, xMax: 400, yMax: 110 }, recordKind: o.kind ?? 'unclassified',
  rowLocal: {
    code: { status: o.codeStatus ?? 'resolved', value: o.code === null ? null : { raw: o.code ?? '123' }, evidence: { sourceTokenRefs: [1], bboxUnion: { xMin: 60 } } },
    name: { status: o.nameStatus ?? 'resolved', reasonCode: o.nameReason ?? null, value: (o.nameStatus ?? 'resolved') === 'resolved' ? { raw: o.nameRaw ?? '内閣官房', normalized: 'x' } : null, evidence: { sourceTokenRefs: [3] } },
    previousBudget: blank, requestedBudget: blank, difference: blank,
  },
});
describe('band 境界（8.6 ± 3.0）', () => {
  it('5.6 ≤ delta ≤ 11.6、端を含む', () => {
    expect([BAND_MIN, BAND_MAX]).toEqual([5.6, 11.6]);
    expect([inBand(5.59), inBand(5.6), inBand(8.6), inBand(11.6), inBand(11.61)]).toEqual([false, true, true, true, false]);
  });
});
describe('universeRow', () => {
  it('request-shaped・非 plain3・code 非 resolved は除外。金額が blank でも candidate 対象', () => {
    expect(universeRow(rec({ kind: 'request' }))).toBeNull();
    expect(universeRow(rec({ code: '12-34' }))).toBeNull();
    expect(universeRow(rec({ code: '1234' }))).toBeNull();
    expect(universeRow(rec({ code: '12' }))).toBeNull();
    expect(universeRow(rec({ codeStatus: 'unresolved' }))).toBeNull();
    expect(universeRow(rec())).toMatchObject({ codeRaw: '123', nameClass: 'resolved', nameComplete: true, nameNormalized: '内閣官房' });
  });
  it('名称: resolved 非空 / continuation_ambiguous は candidate 可（nameComplete=false）/ unresolved と空白のみは不可', () => {
    expect(universeRow(rec({ nameStatus: 'ambiguous', nameReason: 'continuation_ambiguous' }))).toMatchObject({ nameClass: 'continuation_ambiguous', nameComplete: false, nameNormalized: null });
    expect(universeRow(rec({ nameStatus: 'unresolved', nameReason: 'no_name_token' }))!.nameClass).toBe('name_unresolved');
    expect(universeRow(rec({ nameRaw: '  ' }))!.nameClass).toBe('name_unresolved');
  });
  it('candidate は名称 text あり・rule linked・band 内', () => {
    const u = universeRow(rec())!, un = universeRow(rec({ nameStatus: 'unresolved', nameReason: 'no_name_token' }))!;
    expect(isCandidate(u, 'rule_linked', 8.6)).toBe(true);
    expect(isCandidate(u, 'rule_linked', 15.5)).toBe(false);
    expect(isCandidate(u, 'rule_unavailable', null)).toBe(false);
    expect(isCandidate(u, 'rule_ambiguous', null)).toBe(false);
    expect(isCandidate(un, 'rule_linked', 8.6)).toBe(false);
  });
});
describe('Phase A は MOF・hierarchy・manual・既存 item を参照しない（source scan）', () => {
  it.each(['scripts/pipeline-v2/lib/budget-request-rule-8p6-candidate.ts', 'scripts/pipeline-v2/run-budget-request-rule-8p6-phase-a.ts'])('%s', f => {
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/mof-|budget-jikou|MofBudget|mofJikou|normalized\/mof/i, /=== 'item'/, /\.manual\b/, /hierarchyDependent/, /DocumentHierarchy|observeDocumentHierarchy/, /ITEM_INDENT_STEP|budget-request-item-candidate/, /candidate-count/, /amountPattern|previousBudget\b.*status/]) expect(forbidden.test(src), `${f}: ${forbidden}`).toBe(false);
  });
});
