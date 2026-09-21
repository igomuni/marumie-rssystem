/**
 * Pipeline V2 Validator Hardening Stage C: MOF monetary/provenance invariants。
 * 独立検証（docs/chats/20260921_0954_V2パイプラインの検証/03_mof-money-preservation.md）で
 * 確認済みの金額保存性を、既存の`validateSettlementEquations()`（lib/mof-settlement.ts）が
 * 生成する`settlement-equation.json`の数値をそのまま信じるのではなく、Validator自身が
 * Normalized itemsから独立に再検算する形で自動回帰検証へ落とし込む（Validator hardening
 * plan C-1「既存settlement-equation.jsonの数だけ信じず独立再検算する」の方針どおり）。
 *
 * 原則: 差異を検出・報告するだけで、自動補正しない。Pipeline本体（normalize/derive）は変更しない。
 */
import type { MofBudgetItemRecord, MofDerivedBudgetEvent } from '../../types';
import type { Finding } from '../validate-checks';

const SETTLEMENT_REQUIRED_FIELDS: (keyof MofBudgetItemRecord)[] = [
  'budgetAmountYen', 'carryoverInYen', 'reserveUseYen', 'budgetRuleIncreaseYen',
  'reallocationYen', 'transferAdjustmentYen', 'currentBudgetYen', 'spentYen',
  'carryoverOutYen', 'unusedYen',
];

/**
 * C-1: MOF決算（settlement）行の検算。lib/mof-settlement.tsの`validateSettlementEquations()`を
 * 呼び出すのではなく、同じ会計上の等式をこのファイルで独立に再実装して検算する
 * （Pipeline側の実装バグをValidatorが継承しないようにするため）。
 *
 * 歳出予算額 + 前年度繰越額 + 予備費使用額 + 予算総則の規定による経費増額 + 流用等増△減額
 *   + 予算決定後移替増△減額 = 歳出予算現額
 * 歳出予算現額 = 支出済歳出額 + 翌年度繰越額 + 不用額
 */
export function checkMofSettlementEquation(items: MofBudgetItemRecord[]): { findings: Finding[]; checked: number; skipped: number; mismatches: number } {
  const findings: Finding[] = [];
  let checked = 0;
  let skipped = 0;
  let mismatches = 0;

  for (const row of items) {
    if (row.phase !== 'settlement') continue;
    if (SETTLEMENT_REQUIRED_FIELDS.some(f => row[f] === null || row[f] === undefined)) { skipped++; continue; }
    checked++;
    const scope = { fiscalYear: row.fiscalYear, recordId: row.recordId };

    const componentsSum = (row.budgetAmountYen ?? 0) + (row.carryoverInYen ?? 0) + (row.reserveUseYen ?? 0)
      + (row.budgetRuleIncreaseYen ?? 0) + (row.reallocationYen ?? 0) + (row.transferAdjustmentYen ?? 0);
    const currentBudget = row.currentBudgetYen ?? 0;
    if (componentsSum !== currentBudget) {
      mismatches++;
      findings.push({
        severity: 'error', check: 'mof-settlement-equation', category: 'invariant', scope,
        metrics: { expectedCurrentBudgetYen: componentsSum, actualCurrentBudgetYen: currentBudget, differenceYen: currentBudget - componentsSum, side: 'components-to-current' },
        message: `recordId=${row.recordId}: 決算の内訳合計(${componentsSum})と歳出予算現額(${currentBudget})が不一致`,
      });
    }

    const spentSum = (row.spentYen ?? 0) + (row.carryoverOutYen ?? 0) + (row.unusedYen ?? 0);
    if (spentSum !== currentBudget) {
      mismatches++;
      findings.push({
        severity: 'error', check: 'mof-settlement-equation', category: 'invariant', scope,
        metrics: { expectedCurrentBudgetYen: spentSum, actualCurrentBudgetYen: currentBudget, differenceYen: currentBudget - spentSum, side: 'current-to-spent' },
        message: `recordId=${row.recordId}: 歳出予算現額(${currentBudget})と支出済+繰越+不用の合計(${spentSum})が不一致`,
      });
    }
  }
  return { findings, checked, skipped, mismatches };
}

/**
 * C-2: Derived MOF Budget Event provenance（双方向）。
 *
 * initial/provisional/supplement/settlementはbudget-items.jsonlの1行から機械的に
 * 1件（settlementは10件）のeventが常に生成される単純な1:1〜1:N変換のため、RS B-3と
 * 同様に「sourceから期待eventを再構成する」順方向と「実在eventがsourceから再現できるか」
 * 逆方向の両方を検査できる。
 *
 * parliamentary_amendment系（parliamentary_amendment/_added/_removed）は、当初予算の
 * 提出版・成立版を項目同一性キー単位でグルーピングした結果から生成される（derive-mof.tsの
 * semanticItemKey+比較ロジック）。このグルーピングを独立再実装するとderive-mof.ts側の
 * ロジックをほぼ丸ごと複製することになるため、ここでは軽量な整合性検査
 * （sourceRecordIds全件の参照整合性、enactedAmountYen-submittedAmountYen===amountYenの算術）
 * のみを行う。グルーピング自体の独立検証はStage Cのこの回では対象外（7節参照）。
 */
const PER_ROW_EVENT_TYPES = new Set(['initial_budget_state', 'provisional_budget_state', 'supplement_adjustment']);
const SETTLEMENT_EVENT_FIELDS: [string, keyof MofBudgetItemRecord][] = [
  ['settlement_budget_appropriation', 'budgetAmountYen'],
  ['carryover_in', 'carryoverInYen'],
  ['reserve_use', 'reserveUseYen'],
  ['budget_rule_increase', 'budgetRuleIncreaseYen'],
  ['reallocation', 'reallocationYen'],
  ['transfer_adjustment', 'transferAdjustmentYen'],
  ['current_budget_state', 'currentBudgetYen'],
  ['spent', 'spentYen'],
  ['carryover_out', 'carryoverOutYen'],
  ['unused', 'unusedYen'],
];
const PARLIAMENTARY_EVENT_TYPES = new Set(['parliamentary_amendment', 'parliamentary_amendment_added', 'parliamentary_amendment_removed']);
const KNOWN_MOF_EVENT_TYPES = new Set([...PER_ROW_EVENT_TYPES, ...SETTLEMENT_EVENT_FIELDS.map(([t]) => t), ...PARLIAMENTARY_EVENT_TYPES]);

function mofEventIdentity(recordId: string, eventType: string): string {
  return `${recordId}\x1f${eventType}`;
}

export function checkMofDerivedEventProvenance(
  events: MofDerivedBudgetEvent[], items: MofBudgetItemRecord[]
): {
  findings: Finding[]; checkedEvents: number; expectedEvents: number; actualEvents: number;
  missingExpectedEvents: number; duplicateOrUnexpectedEvents: number; amountMismatches: number;
  fiscalYearMismatches: number; eventTypeMismatches: number; parliamentaryEventsChecked: number; parliamentaryIntegrityErrors: number;
} {
  const findings: Finding[] = [];
  let amountMismatches = 0;
  let fiscalYearMismatches = 0;
  let missingExpectedEvents = 0;
  let duplicateOrUnexpectedEvents = 0;
  let eventTypeMismatches = 0;
  let parliamentaryEventsChecked = 0;
  let parliamentaryIntegrityErrors = 0;

  const itemsById = new Map(items.map(i => [i.recordId, i]));

  // 1) sourceから期待eventを再構成する（per-row変換のみ。parliamentary系は対象外）
  interface ExpectedSpec { recordId: string; eventType: string; expectedAmountYen: number; fiscalYear: number }
  const expected: ExpectedSpec[] = [];
  for (const row of items) {
    if (row.phase === 'initial' || row.phase === 'provisional') {
      const eventType = row.phase === 'initial' ? 'initial_budget_state' : 'provisional_budget_state';
      expected.push({ recordId: row.recordId, eventType, expectedAmountYen: row.amountYen ?? 0, fiscalYear: row.fiscalYear });
    } else if (row.phase === 'supplement') {
      expected.push({ recordId: row.recordId, eventType: 'supplement_adjustment', expectedAmountYen: row.supplementDeltaYen ?? 0, fiscalYear: row.fiscalYear });
    } else if (row.phase === 'settlement') {
      for (const [eventType, field] of SETTLEMENT_EVENT_FIELDS) {
        expected.push({ recordId: row.recordId, eventType, expectedAmountYen: Number(row[field]) || 0, fiscalYear: row.fiscalYear });
      }
    }
  }

  // 2) 実在eventを(recordId, eventType)でindex化する。parliamentary系は複数sourceRecordIdsを
  //    持つため全sourceRecordIdに対してindexする（軽量整合性チェック用）
  const actualByIdentity = new Map<string, MofDerivedBudgetEvent[]>();
  const parliamentaryEvents: MofDerivedBudgetEvent[] = [];
  for (const e of events) {
    if (PARLIAMENTARY_EVENT_TYPES.has(e.eventType)) { parliamentaryEvents.push(e); continue; }
    for (const sourceId of e.sourceRecordIds) {
      const key = mofEventIdentity(sourceId, e.eventType);
      const list = actualByIdentity.get(key) ?? [];
      list.push(e);
      actualByIdentity.set(key, list);
    }
  }

  // 3) 順方向: 期待した各eventが1件だけ・正しい値で存在するか
  const consumedIdentities = new Set<string>();
  for (const spec of expected) {
    const key = mofEventIdentity(spec.recordId, spec.eventType);
    consumedIdentities.add(key);
    const matches = actualByIdentity.get(key) ?? [];
    const baseScope = { fiscalYear: spec.fiscalYear, recordId: spec.recordId };

    if (matches.length === 0) {
      missingExpectedEvents++;
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant', scope: baseScope,
        metrics: { expectedEventType: spec.eventType, expectedAmountYen: spec.expectedAmountYen },
        message: `recordId=${spec.recordId}: eventType=${spec.eventType}を期待するDerived eventが存在しない`,
      });
      continue;
    }
    if (matches.length > 1) {
      duplicateOrUnexpectedEvents += matches.length - 1;
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant',
        scope: { ...baseScope, eventId: matches[0].eventId },
        metrics: { eventType: spec.eventType, duplicateCount: matches.length },
        sampleIds: matches.map(m => m.eventId),
        message: `recordId=${spec.recordId}: eventType=${spec.eventType}のDerived eventが${matches.length}件重複生成されている`,
      });
    }

    const e = matches[0];
    const eventScope = { ...baseScope, eventId: e.eventId };
    if (e.amountYen !== spec.expectedAmountYen) {
      amountMismatches++;
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant', scope: eventScope,
        metrics: { expectedAmountYen: spec.expectedAmountYen, actualAmountYen: e.amountYen },
        message: `eventId=${e.eventId}: 期待金額(${spec.expectedAmountYen})とevent.amountYen(${e.amountYen})が不一致`,
      });
    }
    if (e.fiscalYear !== spec.fiscalYear) {
      fiscalYearMismatches++;
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant', scope: eventScope,
        metrics: { expectedFiscalYear: spec.fiscalYear, actualFiscalYear: e.fiscalYear },
        message: `eventId=${e.eventId}: fiscalYearが期待値(${spec.fiscalYear})と不一致（実際${e.fiscalYear}）`,
      });
    }
  }

  // 4) 逆方向: 実在する非parliamentary eventがsourceを持ち、期待済みidentityに属するか
  let checkedEvents = 0;
  for (const e of events) {
    if (PARLIAMENTARY_EVENT_TYPES.has(e.eventType)) continue;
    checkedEvents++;
    const sourceId = e.sourceRecordIds[0] as string | undefined;
    const scope = { fiscalYear: e.fiscalYear, eventId: e.eventId, recordId: sourceId };

    if (!KNOWN_MOF_EVENT_TYPES.has(e.eventType)) {
      eventTypeMismatches++;
      findings.push({
        severity: 'warning', check: 'mof-derived-event-provenance', category: 'semantic-diagnostic', scope,
        metrics: { eventType: e.eventType },
        message: `eventId=${e.eventId}: 未知のeventType「${e.eventType}」はこのvalidatorの対応対象外（診断のみ・silent skipしない）`,
      });
      continue;
    }
    if (!sourceId || !itemsById.has(sourceId)) {
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant', scope,
        message: `eventId=${e.eventId}: sourceRecordId=${sourceId ?? '(なし)'}のNormalizedレコードが実在しない`,
      });
      continue;
    }
    const key = mofEventIdentity(sourceId, e.eventType);
    if (!consumedIdentities.has(key)) {
      duplicateOrUnexpectedEvents++;
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant', scope,
        metrics: { eventType: e.eventType },
        message: `eventId=${e.eventId}: 対応するsourceから期待されないeventが生成されている（unexpected event）`,
      });
    }
  }

  // 5) parliamentary系: グルーピングは独立再実装せず、軽量な整合性検査のみ行う
  for (const e of parliamentaryEvents) {
    parliamentaryEventsChecked++;
    const scope = { fiscalYear: e.fiscalYear, eventId: e.eventId };
    const missingRefs = e.sourceRecordIds.filter(id => !itemsById.has(id));
    if (missingRefs.length > 0) {
      parliamentaryIntegrityErrors++;
      findings.push({
        severity: 'error', check: 'mof-parliamentary-amendment-integrity', category: 'invariant', scope,
        sampleIds: missingRefs,
        message: `eventId=${e.eventId}: sourceRecordIdsに実在しないレコードが${missingRefs.length}件ある`,
      });
    }
    const submitted = e.submittedAmountYen ?? 0;
    const enacted = e.enactedAmountYen ?? 0;
    if (enacted - submitted !== e.amountYen) {
      parliamentaryIntegrityErrors++;
      findings.push({
        severity: 'error', check: 'mof-parliamentary-amendment-integrity', category: 'invariant', scope,
        metrics: { submittedAmountYen: submitted, enactedAmountYen: enacted, amountYen: e.amountYen, expectedAmountYen: enacted - submitted },
        message: `eventId=${e.eventId}: enactedAmountYen-submittedAmountYen(${enacted - submitted})とamountYen(${e.amountYen})が不一致`,
      });
    }
  }

  return {
    findings, checkedEvents, expectedEvents: expected.length, actualEvents: events.length - parliamentaryEvents.length,
    missingExpectedEvents, duplicateOrUnexpectedEvents, amountMismatches, fiscalYearMismatches, eventTypeMismatches,
    parliamentaryEventsChecked, parliamentaryIntegrityErrors,
  };
}

/**
 * C-3（部分実装）: structural-zero diagnostic。
 *
 * 検出できるのは「政府関係機関（accountType='agency'）のtransferAdjustmentYen」のみ。
 * normalize-mof.tsは政府関係機関に対してこの値を`= 0`とハードコードしており（移替の概念が
 * 無い会計区分のため）、source列の有無に関わらず常に0になる。これはNormalizedデータと
 * ドキュメント化されたPipeline仕様（normalize-mof.tsのコメント）だけから確定的に判定できる
 * （raw CSVを読む必要が無い）ため、Stage Cのこの回で実装する。
 *
 * 一方、F-001の本体である「一般会計・特別会計の予算総則の規定による経費増額(円)列が
 * 年度によってCSVに存在しない」ケースは、Normalized JSONL上は"column absent"と"blank"と
 * "explicit 0"が区別できず（parseIntValueが全て0に潰す）、raw CSVのヘッダーを直接読まないと
 * 判定できない。raw CSV読み込みの設計判断が必要なため、この回では実装せず7節に持ち越す。
 */
export function checkMofStructuralZero(items: MofBudgetItemRecord[]): { findings: Finding[]; agencyTransferAdjustmentRows: number; agencyTransferAdjustmentAnomalies: number } {
  const findings: Finding[] = [];
  const recordIds: string[] = [];
  let agencyTransferAdjustmentAnomalies = 0;
  let fiscalYear: number | undefined;

  for (const row of items) {
    if (row.phase !== 'settlement' || row.accountType !== 'agency') continue;
    fiscalYear = row.fiscalYear;
    if (row.transferAdjustmentYen !== 0) {
      // ハードコードどおりなら常に0のはず。0以外が来ていればnormalize-mof.tsの前提が崩れている
      agencyTransferAdjustmentAnomalies++;
      findings.push({
        severity: 'error', check: 'mof-structural-zero', category: 'invariant',
        scope: { fiscalYear: row.fiscalYear, recordId: row.recordId },
        metrics: { field: 'transferAdjustmentYen', actualValue: row.transferAdjustmentYen ?? null },
        message: `recordId=${row.recordId}: 政府関係機関のtransferAdjustmentYenは常に0のはずだが${row.transferAdjustmentYen}になっている（normalize-mof.tsのハードコード前提が崩れている）`,
      });
      continue;
    }
    recordIds.push(row.recordId);
  }

  if (recordIds.length > 0) {
    // 1件ずつではなく集約1件のfindingにする（Stage Aの5-1-5-2-consistency等と同じ方針）
    findings.push({
      severity: 'info', check: 'mof-structural-zero', category: 'source-preservation',
      scope: { fiscalYear },
      metrics: { field: 'transferAdjustmentYen', count: recordIds.length },
      sampleIds: recordIds.slice(0, 10),
      message: `政府関係機関の決算行${recordIds.length}件でtransferAdjustmentYen=0はsource列非依存のハードコード値（explicit zero evidenceではない。F-001の一部）`,
    });
  }
  return { findings, agencyTransferAdjustmentRows: recordIds.length, agencyTransferAdjustmentAnomalies };
}
