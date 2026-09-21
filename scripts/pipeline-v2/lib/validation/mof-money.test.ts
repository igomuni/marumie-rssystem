import { describe, it, expect } from 'vitest';
import {
  checkMofSettlementEquation, checkMofDerivedEventProvenance,
  checkMofParliamentaryAmendmentProvenance, checkMofStructuralZeroFromRaw, classifyRawValue,
} from './mof-money';
import type { MofBudgetItemRecord, MofDerivedBudgetEvent } from '../../types';

function item(overrides: Partial<MofBudgetItemRecord>): MofBudgetItemRecord {
  return {
    schemaVersion: 2, recordType: 'mof_budget_item', recordId: 'r1', fiscalYear: 2024,
    phase: 'settlement', budgetStatus: 'settled', revision: null,
    accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemCode: '01', subItemName: 'I',
    sectionNaturalKey: 'k', legacySectionKey: 'lk', itemNaturalKey: 'ik', scopeNameItemKey: 'sk',
    source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    budgetAmountYen: 1000, carryoverInYen: 0, reserveUseYen: 0, budgetRuleIncreaseYen: 0,
    reallocationYen: 0, transferAdjustmentYen: 0, currentBudgetYen: 1000,
    spentYen: 800, carryoverOutYen: 100, unusedYen: 100,
    ...overrides,
  };
}
function event(overrides: Partial<MofDerivedBudgetEvent>): MofDerivedBudgetEvent {
  return {
    schemaVersion: 2, recordType: 'budget_event', eventId: 'evt_1', sourceSystem: 'mof',
    fiscalYear: 2024, eventType: 'initial_budget_state', amountYen: 0,
    accountType: 'general', ministry: 'X', organization: 'Y', specialAccount: '', subAccount: '', agency: '',
    sectionCode: '001', sectionName: 'S', subItemName: 'I',
    sourceRecordIds: ['r1'], source: { domain: 'mof.go.jp', path: 'x', file: 'x.zip' },
    ...overrides,
  };
}

describe('checkMofSettlementEquation', () => {
  it('整合する行はfindingsが空', () => {
    const result = checkMofSettlementEquation([item({})]);
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('内訳合計と現額の不一致を検出する', () => {
    // currentBudgetYenだけを崩すと現額→支出済等の等式も連鎖して崩れるため、
    // unusedYenを合わせて調整し「内訳合計と現額」の不一致だけを単独で発生させる
    const result = checkMofSettlementEquation([item({ currentBudgetYen: 999, unusedYen: 99 })]);
    expect(result.mismatches).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
    expect(result.findings[0].metrics).toMatchObject({ side: 'components-to-current' });
  });

  it('現額と支出済+繰越+不用の不一致を検出する', () => {
    const result = checkMofSettlementEquation([item({ spentYen: 700 })]);
    expect(result.mismatches).toBe(1);
    expect(result.findings[0].metrics).toMatchObject({ side: 'current-to-spent' });
  });

  it('必要フィールドがnullな行は対象外', () => {
    const result = checkMofSettlementEquation([item({ budgetRuleIncreaseYen: null })]);
    expect(result.checked).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('決算以外のphaseは対象外', () => {
    const result = checkMofSettlementEquation([item({ phase: 'initial' })]);
    expect(result.checked).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

describe('checkMofDerivedEventProvenance', () => {
  it('initial_budget_stateが正常なら findings無し', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const e = event({ eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e], [i]);
    expect(result.missingExpectedEvents).toBe(0);
    expect(result.amountMismatches).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('settlement行は10件のeventを期待する', () => {
    const i = item({});
    const events: MofDerivedBudgetEvent[] = [
      event({ eventId: 'e1', eventType: 'settlement_budget_appropriation', amountYen: 1000, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e2', eventType: 'carryover_in', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e3', eventType: 'reserve_use', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e4', eventType: 'budget_rule_increase', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e5', eventType: 'reallocation', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e6', eventType: 'transfer_adjustment', amountYen: 0, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e7', eventType: 'current_budget_state', amountYen: 1000, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e8', eventType: 'spent', amountYen: 800, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e9', eventType: 'carryover_out', amountYen: 100, sourceRecordIds: ['r1'] }),
      event({ eventId: 'e10', eventType: 'unused', amountYen: 100, sourceRecordIds: ['r1'] }),
    ];
    const result = checkMofDerivedEventProvenance(events, [i]);
    expect(result.expectedEvents).toBe(10);
    expect(result.actualEvents).toBe(10);
    expect(result.missingExpectedEvents).toBe(0);
    expect(result.duplicateOrUnexpectedEvents).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('sourceがあるのにeventが丸ごと欠落していれば検出する', () => {
    const i = item({ phase: 'supplement', supplementDeltaYen: 50 });
    const result = checkMofDerivedEventProvenance([], [i]);
    expect(result.missingExpectedEvents).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
  });

  it('同じsourceから同じeventが重複生成されていれば検出する', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const e1 = event({ eventId: 'e1', eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1'] });
    const e2 = event({ eventId: 'e2', eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e1, e2], [i]);
    expect(result.duplicateOrUnexpectedEvents).toBe(1);
  });

  it('金額不一致を検出する', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const e = event({ eventType: 'initial_budget_state', amountYen: 999, sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e], [i]);
    expect(result.amountMismatches).toBe(1);
  });

  it('sourceRecordIdが実在しなければerror', () => {
    const e = event({ sourceRecordIds: ['does-not-exist'] });
    const result = checkMofDerivedEventProvenance([e], []);
    expect(result.findings.some(f => f.message.includes('実在しない'))).toBe(true);
  });

  it('未知のeventTypeはsilent skipせずwarning診断を出す', () => {
    // itemsを空にして「期待eventの欠落」ノイズを排除し、未知eventType診断だけを単独確認する
    const e = event({ eventType: 'future_event_type', sourceRecordIds: ['r1'] });
    const result = checkMofDerivedEventProvenance([e], []);
    expect(result.eventTypeMismatches).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('warning');
    expect(result.findings[0].category).toBe('semantic-diagnostic');
  });

  it('non-parliamentary eventがsourceRecordIdsを複数持てばinvariant errorにする（review指摘のcardinality）', () => {
    const i = item({ phase: 'initial', amountYen: 500 });
    const malformed = event({ eventType: 'initial_budget_state', amountYen: 500, sourceRecordIds: ['r1', 'r2'] });
    const result = checkMofDerivedEventProvenance([malformed], [i]);
    expect(result.sourceCardinalityErrors).toBe(1);
    expect(result.findings.some(f => f.severity === 'error' && f.category === 'invariant' && f.message.includes('sourceRecordIds'))).toBe(true);
    // 複数sourceを持つ壊れたeventが複数のexpected identityを満たしてはいけない
    // （このeventはindex化されないため、r1のinitial_budget_stateは依然として欠落扱いになる）
    expect(result.missingExpectedEvents).toBe(1);
  });

  it('parliamentary系eventは対象外（別関数checkMofParliamentaryAmendmentProvenanceで検証する）', () => {
    const e = event({ eventType: 'parliamentary_amendment', sourceRecordIds: ['s1', 'e1'] });
    const result = checkMofDerivedEventProvenance([e], []);
    expect(result.actualEvents).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

describe('checkMofParliamentaryAmendmentProvenance', () => {
  // fixtureのitem()はデフォルトでsectionNaturalKey='k'/subItemName='I'を共有するため、
  // 上書きしない限り同じsemantic keyにグルーピングされる
  it('submitted/enacted両方存在し金額が異なればparliamentary_amendmentを期待する', () => {
    const submitted = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted', amountYen: 400 });
    const enacted = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted', amountYen: 500 });
    const e = event({
      eventType: 'parliamentary_amendment', amountYen: 100, submittedAmountYen: 400, enactedAmountYen: 500,
      sourceRecordIds: ['s1', 'e1'],
    });
    const result = checkMofParliamentaryAmendmentProvenance([e], [submitted, enacted]);
    expect(result.expectedEvents).toBe(1);
    expect(result.actualEvents).toBe(1);
    expect(result.missingExpectedEvents).toBe(0);
    expect(result.duplicateOrUnexpectedEvents).toBe(0);
    expect(result.amountMismatches).toBe(0);
    expect(result.expectedNetAmendmentAmountYen).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  it('submitted/enacted金額が同一ならeventを期待しない', () => {
    const submitted = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted', amountYen: 400 });
    const enacted = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted', amountYen: 400 });
    const result = checkMofParliamentaryAmendmentProvenance([], [submitted, enacted]);
    expect(result.expectedEvents).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('sourceがあるのにeventが丸ごと欠落していれば検出する', () => {
    const submitted = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted', amountYen: 400 });
    const enacted = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted', amountYen: 500 });
    const result = checkMofParliamentaryAmendmentProvenance([], [submitted, enacted]);
    expect(result.missingExpectedEvents).toBe(1);
    expect(result.findings[0].category).toBe('invariant');
  });

  // comparableAccountTypesはaccountType単位（全体）で判定されるため、対象キー以外にも
  // 同じaccountTypeでsubmitted/enacted両方が存在する行が必要（実データでは常に成立する）
  const baselinePair = (accountType: 'general' | 'special' | 'agency' = 'general') => [
    item({ recordId: 'baseline-s', phase: 'initial', budgetStatus: 'submitted', accountType, sectionNaturalKey: 'baseline', amountYen: 1 }),
    item({ recordId: 'baseline-e', phase: 'initial', budgetStatus: 'enacted', accountType, sectionNaturalKey: 'baseline', amountYen: 1 }),
  ];

  it('enactedのみ（追加）の場合はparliamentary_amendment_addedを期待する', () => {
    const enacted = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted', amountYen: 300 });
    const e = event({ eventType: 'parliamentary_amendment_added', amountYen: 300, submittedAmountYen: 0, enactedAmountYen: 300, sourceRecordIds: ['e1'] });
    const result = checkMofParliamentaryAmendmentProvenance([e], [enacted, ...baselinePair()]);
    expect(result.expectedEvents).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('submittedのみ（削除）の場合はparliamentary_amendment_removedを期待する', () => {
    const submitted = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted', amountYen: 200 });
    const e = event({ eventType: 'parliamentary_amendment_removed', amountYen: -200, submittedAmountYen: 200, enactedAmountYen: 0, sourceRecordIds: ['s1'] });
    const result = checkMofParliamentaryAmendmentProvenance([e], [submitted, ...baselinePair()]);
    expect(result.expectedEvents).toBe(1);
    expect(result.expectedNetAmendmentAmountYen).toBe(-200);
    expect(result.findings).toHaveLength(0);
  });

  it('金額不一致を検出する', () => {
    const submitted = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted', amountYen: 400 });
    const enacted = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted', amountYen: 500 });
    const e = event({ eventType: 'parliamentary_amendment', amountYen: 999, submittedAmountYen: 400, enactedAmountYen: 500, sourceRecordIds: ['s1', 'e1'] });
    const result = checkMofParliamentaryAmendmentProvenance([e], [submitted, enacted]);
    expect(result.amountMismatches).toBe(1);
  });

  it('対応する期待eventが無い実在eventはunexpectedとして検出する', () => {
    const e = event({ eventType: 'parliamentary_amendment', amountYen: 0, submittedAmountYen: 0, enactedAmountYen: 0, sourceRecordIds: ['does-not-exist'] });
    const result = checkMofParliamentaryAmendmentProvenance([e], []);
    expect(result.duplicateOrUnexpectedEvents).toBe(1);
    expect(result.findings.some(f => f.message.includes('unexpected'))).toBe(true);
  });

  it('accountTypeがsubmitted/enacted両方に無い場合は比較対象外', () => {
    const submitted = item({ recordId: 's1', phase: 'initial', budgetStatus: 'submitted', accountType: 'special', amountYen: 400 });
    // enactedには'special'が一切無い（'general'のみ）
    const enacted = item({ recordId: 'e1', phase: 'initial', budgetStatus: 'enacted', accountType: 'general', sectionNaturalKey: 'other', amountYen: 500 });
    const result = checkMofParliamentaryAmendmentProvenance([], [submitted, enacted]);
    expect(result.expectedEvents).toBe(0);
  });

  it('FY2025独立検証sanity: 17件・net -356,655,880,000円相当のスケールでも正しく集計する', () => {
    // 17件の異なるsemantic keyでそれぞれ独立にparliamentary_amendment_removedを作る
    // （実データの正確な再現ではなく、集計ロジックが複数件を正しく合算できることの確認）
    const items: MofBudgetItemRecord[] = [...baselinePair()];
    const events: MofDerivedBudgetEvent[] = [];
    const perEventAmount = -356_655_880_000 / 17;
    for (let i = 0; i < 17; i++) {
      const recordId = `s${i}`;
      items.push(item({ recordId, phase: 'initial', budgetStatus: 'submitted', sectionNaturalKey: `k${i}`, amountYen: -perEventAmount }));
      events.push(event({ eventId: `evt_${i}`, eventType: 'parliamentary_amendment_removed', amountYen: perEventAmount, submittedAmountYen: -perEventAmount, enactedAmountYen: 0, sourceRecordIds: [recordId] }));
    }
    const result = checkMofParliamentaryAmendmentProvenance(events, items);
    expect(result.expectedEvents).toBe(17);
    expect(result.actualEvents).toBe(17);
    expect(result.expectedNetAmendmentAmountYen).toBeCloseTo(-356_655_880_000, -5);
    expect(result.findings).toHaveLength(0);
  });
});

describe('classifyRawValue', () => {
  it('列が存在しなければcolumnAbsent', () => {
    expect(classifyRawValue(undefined, false)).toBe('columnAbsent');
  });
  it('列はあるが空文字ならblank', () => {
    expect(classifyRawValue('', true)).toBe('blank');
  });
  it('blank token（ハイフン等）もblank扱い', () => {
    expect(classifyRawValue('－', true)).toBe('blank');
    expect(classifyRawValue('-', true)).toBe('blank');
  });
  it('0が明記されていればexplicitZero', () => {
    expect(classifyRawValue('0', true)).toBe('explicitZero');
  });
  it('0以外の数値ならnonzero', () => {
    expect(classifyRawValue('1,234', true)).toBe('nonzero');
  });
});

describe('checkMofStructuralZeroFromRaw（raw ZIP読み込みを含む統合テスト）', () => {
  it('column_absent/blank/explicit_zero/nonzeroをraw CSVから正しく分類する', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { buildStoredZip } = await import('./test-helpers/zip-fixture');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mof-structural-zero-'));
    const rawRoot = tmpDir;
    const relZipPath = 'mof.go.jp/archive/fy2024/settlement_general.zip';
    const absZipPath = path.join(rawRoot, relZipPath);
    fs.mkdirSync(path.dirname(absZipPath), { recursive: true });

    // withColumn.csv: header行に予算総則列があり、data行はblank/explicitZero/nonzeroの3種。
    // lib/csv.tsのparseRowsIter()は全列が空文字の行を丸ごとskipするため、ダミー列を
    // 加えて「対象列だけblank」の行が完全に消えないようにする
    // withoutColumn.csv: 予算総則列自体が無い（column absent）
    const withColumnEntry = 'with_column.csv';
    const withoutColumnEntry = 'without_column.csv';
    const withColumnCsv = 'ダミー列,予算総則の規定による経費増額(円)\nX,\nX,0\nX,500\n';
    const withoutColumnCsv = 'その他の列\nX\n';
    const zipBuf = buildStoredZip([
      { name: withColumnEntry, data: Buffer.from(withColumnCsv, 'utf-8') },
      { name: withoutColumnEntry, data: Buffer.from(withoutColumnCsv, 'utf-8') },
    ]);
    fs.writeFileSync(absZipPath, zipBuf);

    const items = [
      item({ recordId: 'blankRow', accountType: 'general', budgetRuleIncreaseYen: 0, source: { domain: 'mof.go.jp', path: relZipPath, file: 'x.zip', zipEntry: withColumnEntry, rowNumber: 2 } }),
      item({ recordId: 'explicitZeroRow', accountType: 'general', budgetRuleIncreaseYen: 0, source: { domain: 'mof.go.jp', path: relZipPath, file: 'x.zip', zipEntry: withColumnEntry, rowNumber: 3 } }),
      item({ recordId: 'nonzeroRow', accountType: 'general', budgetRuleIncreaseYen: 500, source: { domain: 'mof.go.jp', path: relZipPath, file: 'x.zip', zipEntry: withColumnEntry, rowNumber: 4 } }),
      item({ recordId: 'columnAbsentRow', accountType: 'general', budgetRuleIncreaseYen: 0, source: { domain: 'mof.go.jp', path: relZipPath, file: 'x.zip', zipEntry: withoutColumnEntry, rowNumber: 2 } }),
    ];
    const result = checkMofStructuralZeroFromRaw(rawRoot, items);

    expect(result.counts.budgetRuleIncreaseYen.general).toMatchObject({ blank: 1, explicitZero: 1, nonzero: 1, columnAbsent: 1 });
    expect(result.rawSourceUnavailableRows).toBe(0);
    // 全行ともNormalizedの値とraw分類が整合しているため不整合errorは無い
    expect(result.findings.some(f => f.severity === 'error')).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rawがnonzeroなのにNormalizedが0なら値の取りこぼしとしてinvariant errorにする', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { buildStoredZip } = await import('./test-helpers/zip-fixture');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mof-structural-zero-mismatch-'));
    const rawRoot = tmpDir;
    const relZipPath = 'mof.go.jp/archive/fy2024/settlement_general.zip';
    const zipEntry = 'settlement.csv';
    const absZipPath = path.join(rawRoot, relZipPath);
    fs.mkdirSync(path.dirname(absZipPath), { recursive: true });
    fs.writeFileSync(absZipPath, buildStoredZip([{ name: zipEntry, data: Buffer.from('予算総則の規定による経費増額(円)\n500\n', 'utf-8') }]));

    // Normalizedはbudgetamount=0だが、rawは500（本来ありえないPipelineバグを模擬）
    const items = [item({ recordId: 'mismatchRow', accountType: 'general', budgetRuleIncreaseYen: 0, source: { domain: 'mof.go.jp', path: relZipPath, file: 'x.zip', zipEntry, rowNumber: 2 } })];
    const result = checkMofStructuralZeroFromRaw(rawRoot, items);

    expect(result.findings.some(f => f.severity === 'error' && f.category === 'invariant' && f.message.includes('取りこぼし'))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('政府関係機関のtransferAdjustmentYenはraw読み込みせずnotApplicableHardcodedに分類する', () => {
    const items = [
      item({ recordId: 'a1', accountType: 'agency', transferAdjustmentYen: 0, source: { domain: 'mof.go.jp', path: 'does/not/exist.zip', file: 'x.zip', zipEntry: 'x.csv', rowNumber: 2 } }),
    ];
    // rawRootが存在しなくても（raw読み込み不能でも）agencyのtransferAdjustmentYenは
    // Normalized/コードの前提だけからdeterministicに分類できる
    const result = checkMofStructuralZeroFromRaw('/nonexistent-raw-root', items);
    expect(result.counts.transferAdjustmentYen.agency).toMatchObject({ notApplicableHardcoded: 1 });
  });

  it('raw sourceが読めない行はrawSourceUnavailableRowsとして計上し、エラーにはしない', () => {
    const items = [item({ recordId: 'r1', accountType: 'general', source: { domain: 'mof.go.jp', path: 'does/not/exist.zip', file: 'x.zip', zipEntry: 'x.csv', rowNumber: 2 } })];
    const result = checkMofStructuralZeroFromRaw('/nonexistent-raw-root', items);
    expect(result.rawSourceUnavailableRows).toBe(1);
    expect(result.findings).toHaveLength(0);
  });
});
