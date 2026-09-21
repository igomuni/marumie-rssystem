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
import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import { parseCsv as parseQuoteAwareCsv } from '../csv';
import { normalizeText } from '../stable-id';
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
 * C-2: Derived MOF Budget Event provenance（双方向・非parliamentary系のみ）。
 *
 * initial/provisional/supplement/settlementはbudget-items.jsonlの1行から機械的に
 * 1件（settlementは10件）のeventが常に生成される単純な1:1〜1:N変換のため、RS B-3と
 * 同様に「sourceから期待eventを再構成する」順方向と「実在eventがsourceから再現できるか」
 * 逆方向の両方を検査する。
 *
 * これらのeventは常にsourceRecordIdsを1件だけ持つ設計のため、それ自体をinvariantとして
 * 検査する（review指摘: 複数sourceRecordIdsを持つ壊れたeventが複数のexpected identityを
 * 満たしてしまう余地を無くすため）。parliamentary_amendment系は別関数
 * `checkMofParliamentaryAmendmentProvenance()`で扱う（複数sourceRecordIdsを持つ設計のため）。
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
export const PARLIAMENTARY_EVENT_TYPES = new Set(['parliamentary_amendment', 'parliamentary_amendment_added', 'parliamentary_amendment_removed']);
const KNOWN_MOF_EVENT_TYPES = new Set([...PER_ROW_EVENT_TYPES, ...SETTLEMENT_EVENT_FIELDS.map(([t]) => t)]);

function mofEventIdentity(recordId: string, eventType: string): string {
  return `${recordId}\x1f${eventType}`;
}

export function checkMofDerivedEventProvenance(
  events: MofDerivedBudgetEvent[], items: MofBudgetItemRecord[]
): {
  findings: Finding[]; checkedEvents: number; expectedEvents: number; actualEvents: number;
  missingExpectedEvents: number; duplicateOrUnexpectedEvents: number; amountMismatches: number;
  fiscalYearMismatches: number; eventTypeMismatches: number; sourceCardinalityErrors: number;
} {
  const nonParliamentaryEvents = events.filter(e => !PARLIAMENTARY_EVENT_TYPES.has(e.eventType));

  const findings: Finding[] = [];
  let amountMismatches = 0;
  let fiscalYearMismatches = 0;
  let missingExpectedEvents = 0;
  let duplicateOrUnexpectedEvents = 0;
  let eventTypeMismatches = 0;
  let sourceCardinalityErrors = 0;

  const itemsById = new Map(items.map(i => [i.recordId, i]));

  // 1) sourceから期待eventを再構成する（per-row変換のみ）
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

  // 2) 実在eventを(recordId, eventType)でindex化する。cardinality invariant（sourceRecordIds.length===1）
  //    に違反するeventは、複数のexpected identityを誤って満たさないようindex化せず別途errorにする
  const actualByIdentity = new Map<string, MofDerivedBudgetEvent[]>();
  for (const e of nonParliamentaryEvents) {
    if (e.sourceRecordIds.length !== 1) {
      sourceCardinalityErrors++;
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant',
        scope: { fiscalYear: e.fiscalYear, eventId: e.eventId },
        metrics: { eventType: e.eventType, sourceRecordIdCount: e.sourceRecordIds.length },
        sampleIds: e.sourceRecordIds,
        message: `eventId=${e.eventId}: non-parliamentary eventはsourceRecordIdsが1件のはずだが${e.sourceRecordIds.length}件ある`,
      });
      continue;
    }
    const key = mofEventIdentity(e.sourceRecordIds[0], e.eventType);
    const list = actualByIdentity.get(key) ?? [];
    list.push(e);
    actualByIdentity.set(key, list);
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

  // 4) 逆方向: 実在するeventがsourceを持ち、期待済みidentityに属するか
  let checkedEvents = 0;
  for (const e of nonParliamentaryEvents) {
    if (e.sourceRecordIds.length !== 1) continue; // 2)で別途error済み
    checkedEvents++;
    const sourceId = e.sourceRecordIds[0];
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
    if (!itemsById.has(sourceId)) {
      findings.push({
        severity: 'error', check: 'mof-derived-event-provenance', category: 'invariant', scope,
        message: `eventId=${e.eventId}: sourceRecordId=${sourceId}のNormalizedレコードが実在しない`,
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

  return {
    findings, checkedEvents, expectedEvents: expected.length, actualEvents: nonParliamentaryEvents.length,
    missingExpectedEvents, duplicateOrUnexpectedEvents, amountMismatches, fiscalYearMismatches, eventTypeMismatches,
    sourceCardinalityErrors,
  };
}

/**
 * C-2フォローアップ: 国会修正（parliamentary_amendment系）のsource→expected event方向の検証。
 *
 * derive-mof.tsは当初予算(phase='initial')の提出版(submitted)・成立版(enacted)を
 * 項目同一性キー単位でグルーピングし、両方に存在するaccountTypeだけを対象に金額差分から
 * イベントを作る。ここではderive-mof.tsの`semanticItemKey()`をimportせず、Validator側で
 * 独立に同じ意味のキー（sectionNaturalKey + 正規化したsubItemName）を構築する
 * （review指摘: 正解をPipeline実装と共有しない）。
 */
function mofSemanticKey(row: MofBudgetItemRecord): string {
  return [row.sectionNaturalKey, normalizeText(row.subItemName)].join('|');
}

export function checkMofParliamentaryAmendmentProvenance(
  events: MofDerivedBudgetEvent[], items: MofBudgetItemRecord[]
): {
  findings: Finding[]; expectedEvents: number; actualEvents: number;
  missingExpectedEvents: number; duplicateOrUnexpectedEvents: number;
  amountMismatches: number; expectedNetAmendmentAmountYen: number;
} {
  const findings: Finding[] = [];
  let amountMismatches = 0;
  let missingExpectedEvents = 0;
  let duplicateOrUnexpectedEvents = 0;

  const initialRows = items.filter(i => i.phase === 'initial');
  const submitted = initialRows.filter(i => i.budgetStatus === 'submitted');
  const enacted = initialRows.filter(i => i.budgetStatus === 'enacted');

  const comparableAccountTypes = new Set(
    [...new Set(submitted.map(r => r.accountType))].filter(a => enacted.some(r => r.accountType === a))
  );

  const submittedByKey = new Map<string, MofBudgetItemRecord[]>();
  const enactedByKey = new Map<string, MofBudgetItemRecord[]>();
  for (const row of submitted) { const list = submittedByKey.get(mofSemanticKey(row)) ?? []; list.push(row); submittedByKey.set(mofSemanticKey(row), list); }
  for (const row of enacted) { const list = enactedByKey.get(mofSemanticKey(row)) ?? []; list.push(row); enactedByKey.set(mofSemanticKey(row), list); }

  interface ExpectedAmendment {
    eventType: string; expectedAmountYen: number; submittedAmountYen: number; enactedAmountYen: number;
    sourceRecordIdsKey: string; sourceRecordIds: string[]; fiscalYear: number;
  }
  const expected: ExpectedAmendment[] = [];
  const allKeys = new Set([...submittedByKey.keys(), ...enactedByKey.keys()]);
  for (const key of allKeys) {
    const srows = submittedByKey.get(key) ?? [];
    const erows = enactedByKey.get(key) ?? [];
    const templateRow = (erows.length > 0 ? erows : srows)[0];
    if (!templateRow || !comparableAccountTypes.has(templateRow.accountType)) continue;

    const sAmt = srows.reduce((sum, r) => sum + (r.amountYen ?? 0), 0);
    const eAmt = erows.reduce((sum, r) => sum + (r.amountYen ?? 0), 0);
    if (srows.length > 0 && erows.length > 0 && sAmt === eAmt) continue; // 両方存在し金額同一→eventなし

    const eventType = srows.length > 0 && erows.length > 0 ? 'parliamentary_amendment'
      : erows.length > 0 ? 'parliamentary_amendment_added' : 'parliamentary_amendment_removed';
    const sourceRecordIds = [...srows, ...erows].map(r => r.recordId).sort();
    expected.push({
      eventType, expectedAmountYen: eAmt - sAmt, submittedAmountYen: sAmt, enactedAmountYen: eAmt,
      sourceRecordIdsKey: sourceRecordIds.join(','), sourceRecordIds, fiscalYear: templateRow.fiscalYear,
    });
  }
  const expectedNetAmendmentAmountYen = expected.reduce((sum, e) => sum + e.expectedAmountYen, 0);

  const actualAmendmentEvents = events.filter(e => PARLIAMENTARY_EVENT_TYPES.has(e.eventType));
  const actualByRecordSet = new Map<string, MofDerivedBudgetEvent[]>();
  for (const e of actualAmendmentEvents) {
    const idKey = [...e.sourceRecordIds].sort().join(',');
    const list = actualByRecordSet.get(idKey) ?? [];
    list.push(e);
    actualByRecordSet.set(idKey, list);
  }

  const consumedRecordSets = new Set<string>();
  for (const spec of expected) {
    consumedRecordSets.add(spec.sourceRecordIdsKey);
    const matches = actualByRecordSet.get(spec.sourceRecordIdsKey) ?? [];
    const scope = { fiscalYear: spec.fiscalYear };

    if (matches.length === 0) {
      missingExpectedEvents++;
      findings.push({
        severity: 'error', check: 'mof-parliamentary-amendment-provenance', category: 'invariant', scope,
        metrics: { expectedEventType: spec.eventType, expectedAmountYen: spec.expectedAmountYen, submittedAmountYen: spec.submittedAmountYen, enactedAmountYen: spec.enactedAmountYen },
        sampleIds: spec.sourceRecordIds,
        message: `sourceRecordIds=[${spec.sourceRecordIds.join(',')}]: eventType=${spec.eventType}を期待するDerived eventが存在しない`,
      });
      continue;
    }
    if (matches.length > 1) {
      duplicateOrUnexpectedEvents += matches.length - 1;
      findings.push({
        severity: 'error', check: 'mof-parliamentary-amendment-provenance', category: 'invariant',
        scope: { ...scope, eventId: matches[0].eventId },
        metrics: { eventType: spec.eventType, duplicateCount: matches.length },
        sampleIds: matches.map(m => m.eventId),
        message: `sourceRecordIds=[${spec.sourceRecordIds.join(',')}]: 同一sourceRecordId集合からDerived eventが${matches.length}件重複生成されている`,
      });
    }

    const e = matches[0];
    const eventScope = { ...scope, eventId: e.eventId };
    if (e.eventType !== spec.eventType || e.amountYen !== spec.expectedAmountYen
      || (e.submittedAmountYen ?? 0) !== spec.submittedAmountYen || (e.enactedAmountYen ?? 0) !== spec.enactedAmountYen) {
      amountMismatches++;
      findings.push({
        severity: 'error', check: 'mof-parliamentary-amendment-provenance', category: 'invariant', scope: eventScope,
        metrics: {
          expectedEventType: spec.eventType, actualEventType: e.eventType,
          expectedAmountYen: spec.expectedAmountYen, actualAmountYen: e.amountYen,
          expectedSubmittedAmountYen: spec.submittedAmountYen, actualSubmittedAmountYen: e.submittedAmountYen ?? null,
          expectedEnactedAmountYen: spec.enactedAmountYen, actualEnactedAmountYen: e.enactedAmountYen ?? null,
        },
        message: `eventId=${e.eventId}: 再構成した期待値（eventType=${spec.eventType} amount=${spec.expectedAmountYen}）と実在eventが不一致`,
      });
    }
  }

  // 逆方向: 期待されない実在amendment eventが無いか
  for (const [idKey, matches] of actualByRecordSet) {
    if (consumedRecordSets.has(idKey)) continue;
    duplicateOrUnexpectedEvents += matches.length;
    for (const e of matches) {
      findings.push({
        severity: 'error', check: 'mof-parliamentary-amendment-provenance', category: 'invariant',
        scope: { fiscalYear: e.fiscalYear, eventId: e.eventId },
        metrics: { eventType: e.eventType },
        message: `eventId=${e.eventId}: 対応する期待eventが無いのに生成されている（unexpected event）`,
      });
    }
  }

  return {
    findings, expectedEvents: expected.length, actualEvents: actualAmendmentEvents.length,
    missingExpectedEvents, duplicateOrUnexpectedEvents, amountMismatches,
    expectedNetAmendmentAmountYen,
  };
}

/**
 * C-3: structural-zero diagnostic（raw CSVまで含めた完全版）。
 *
 * NormalizedのbudgetRuleIncreaseYen/transferAdjustmentYenは`parseIntValue(undefined)`が
 * 0にフォールバックするため、"column absent"（列自体が無い）・"blank"（列はあるが空欄）・
 * "explicit 0"（列があり値が0）が全て同じ0に潰れて区別できない（F-001）。
 *
 * 新しいdownload経路は作らず、Normalized rowが既に持つsource ref（source.path/zipEntry/
 * rowNumber）から、Normalizeが読んだのと同じraw ZIP/CSVをvalidatorが直接読み返して分類する
 * （normalize-mof.tsのparseCsv相当のtrim/空ヘッダー除外ロジックをこのファイルでも再現する。
 * 実装をimportして共有するのではなく、`listZipEntries`/`readZipEntryText`/`lib/csv.ts`の
 * 汎用部品だけを再利用する）。
 *
 * 政府関係機関のtransferAdjustmentYenはraw列を確認するまでもなくnormalize-mof.ts側で
 * `= 0`のハードコードと判明しているため、raw読み込みをスキップしdeterministicに分類する。
 */
export type StructuralZeroState = 'columnAbsent' | 'blank' | 'explicitZero' | 'nonzero';
const BLANK_TOKENS = new Set(['-', '--', '―', 'ー']);
const BUDGET_RULE_INCREASE_COLUMN = '予算総則の規定による経費増額(円)';
const TRANSFER_ADJUSTMENT_COLUMN = '予算決定後移替増△減額(円)';

interface RawCsvCache { headers: Set<string>; rows: Record<string, string>[] }

/**
 * raw CSVセルを独立に数値化する。normalize-mof.tsの`parseIntValue()`は呼ばず、
 * NFKC正規化・カンマ除去・trim・Number化・整数化という同程度の処理をここで再現する
 * （review指摘: 正解をPipeline実装と共有せず、raw値とNormalized値を独立に突き合わせるため）。
 * blank/column absentはnull、非数値もnullを返す。
 */
function parseRawInt(raw: string | undefined): number | null {
  const cleaned = (raw ?? '').normalize('NFKC').replace(/,/g, '').trim();
  if (!cleaned || BLANK_TOKENS.has(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function classifyRawValue(raw: string | undefined, present: boolean): StructuralZeroState {
  if (!present) return 'columnAbsent';
  const n = parseRawInt(raw);
  if (n === null) return 'blank';
  return n === 0 ? 'explicitZero' : 'nonzero';
}

/** normalize-mof.tsの`parseCsv()`と同じtrim/空ヘッダー除外ロジックをraw provenance確認用に再現する */
function parseRawMofCsv(text: string): Record<string, string>[] {
  return parseQuoteAwareCsv(text).map(row => {
    const trimmed: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const header = key.trim();
      if (header) trimmed[header] = value.trim();
    }
    return trimmed;
  });
}

function loadRawCsv(rawRoot: string, relZipPath: string, zipEntry: string, cache: Map<string, RawCsvCache | null>): RawCsvCache | null {
  const cacheKey = `${relZipPath}\x1f${zipEntry}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const zipPath = path.join(rawRoot, relZipPath);
  if (!fs.existsSync(zipPath) || !listZipEntries(zipPath).includes(zipEntry)) { cache.set(cacheKey, null); return null; }
  const rows = parseRawMofCsv(readZipEntryText(zipPath, zipEntry));
  const headers = new Set(rows.length > 0 ? Object.keys(rows[0]) : []);
  const entry: RawCsvCache = { headers, rows };
  cache.set(cacheKey, entry);
  return entry;
}

export function checkMofStructuralZeroFromRaw(rawRoot: string, items: MofBudgetItemRecord[]): {
  findings: Finding[];
  counts: Record<'budgetRuleIncreaseYen' | 'transferAdjustmentYen', Record<string, Partial<Record<StructuralZeroState | 'notApplicableHardcoded', number>>>>;
  rawSourceUnavailableRows: number;
} {
  const findings: Finding[] = [];
  const cache = new Map<string, RawCsvCache | null>();
  const counts: ReturnType<typeof checkMofStructuralZeroFromRaw>['counts'] = { budgetRuleIncreaseYen: {}, transferAdjustmentYen: {} };
  const bump = (field: 'budgetRuleIncreaseYen' | 'transferAdjustmentYen', accountType: string, state: StructuralZeroState | 'notApplicableHardcoded') => {
    const byAccount = counts[field][accountType] ?? {};
    byAccount[state] = (byAccount[state] ?? 0) + 1;
    counts[field][accountType] = byAccount;
  };
  let rawSourceUnavailableRows = 0;
  const unavailableSampleIds: string[] = [];

  /**
   * raw値とNormalized値をexact numericで突き合わせる。
   * review指摘: 「rawがnonzeroなのにNormalizedが0」だけでなく「raw=100, normalized=200」
   * のような値の食い違いもsource-preservation違反として検出する。
   */
  const checkConsistency = (row: MofBudgetItemRecord, field: 'budgetRuleIncreaseYen' | 'transferAdjustmentYen', state: StructuralZeroState, rawNumericValue: number | null) => {
    const normalizedValue = row[field] ?? 0;
    const expectedValue = state === 'nonzero' ? rawNumericValue : 0;
    if (normalizedValue !== expectedValue) {
      findings.push({
        severity: 'error', check: 'mof-structural-zero', category: 'invariant',
        scope: { fiscalYear: row.fiscalYear, recordId: row.recordId },
        metrics: { field, rawState: state, rawNumericValue, normalizedValue },
        message: `recordId=${row.recordId}: raw${field}列（状態=${state}、値=${rawNumericValue}）とNormalized値(${normalizedValue})が不一致`,
      });
    }
  };

  for (const row of items) {
    if (row.phase !== 'settlement') continue;

    if (row.accountType === 'agency') {
      // ハードコード仕様（normalize-mof.ts）の前提が崩れていないか検証する。
      // review指摘: カウントするだけでNormalized値自体を確認していなかった
      if ((row.transferAdjustmentYen ?? null) !== 0) {
        findings.push({
          severity: 'error', check: 'mof-structural-zero', category: 'invariant',
          scope: { fiscalYear: row.fiscalYear, recordId: row.recordId },
          metrics: { field: 'transferAdjustmentYen', normalizedValue: row.transferAdjustmentYen ?? null },
          message: `recordId=${row.recordId}: 政府関係機関のtransferAdjustmentYenは常に0のはずだが${row.transferAdjustmentYen ?? null}になっている（normalize-mof.tsのハードコード前提が崩れている）`,
        });
      } else {
        bump('transferAdjustmentYen', 'agency', 'notApplicableHardcoded');
      }
    }

    const zipEntry = row.source.zipEntry;
    if (!zipEntry || row.source.rowNumber === undefined) { rawSourceUnavailableRows++; if (unavailableSampleIds.length < 10) unavailableSampleIds.push(row.recordId); continue; }
    const cached = loadRawCsv(rawRoot, row.source.path, zipEntry, cache);
    const dataRow = cached?.rows[row.source.rowNumber - 2];
    if (!cached || !dataRow) { rawSourceUnavailableRows++; if (unavailableSampleIds.length < 10) unavailableSampleIds.push(row.recordId); continue; }

    // budgetRuleIncreaseYen: 全accountType共通の列名
    const rulePresent = cached.headers.has(BUDGET_RULE_INCREASE_COLUMN);
    const ruleValue = dataRow[BUDGET_RULE_INCREASE_COLUMN];
    const ruleState = classifyRawValue(ruleValue, rulePresent);
    bump('budgetRuleIncreaseYen', row.accountType, ruleState);
    checkConsistency(row, 'budgetRuleIncreaseYen', ruleState, rulePresent ? parseRawInt(ruleValue) : null);

    // transferAdjustmentYen: 政府関係機関は上でハードコード検証済みのためraw確認は不要
    if (row.accountType !== 'agency') {
      const transferPresent = cached.headers.has(TRANSFER_ADJUSTMENT_COLUMN);
      const transferValue = dataRow[TRANSFER_ADJUSTMENT_COLUMN];
      const transferState = classifyRawValue(transferValue, transferPresent);
      bump('transferAdjustmentYen', row.accountType, transferState);
      checkConsistency(row, 'transferAdjustmentYen', transferState, transferPresent ? parseRawInt(transferValue) : null);
    }
  }

  if (rawSourceUnavailableRows > 0) {
    // review指摘: raw sourceを読めない場合をsilent countだけにせず、
    // 「検査できなかった」事実自体をFindingとして残す（既定ではexit codeに影響しないwarning）
    findings.push({
      severity: 'warning', check: 'mof-structural-zero', category: 'source-preservation',
      metrics: { rawSourceUnavailableRows },
      sampleIds: unavailableSampleIds,
      message: `決算行${rawSourceUnavailableRows}件でraw ZIP/CSVを読めず、structural-zero分類を検査できなかった`,
    });
  }

  // 集約finding（1行ずつではなく1件に集約。Stage Aの5-1-5-2-consistency等と同じ方針）
  for (const [field, byAccount] of Object.entries(counts) as [keyof typeof counts, Record<string, Record<string, number>>][]) {
    for (const [accountType, states] of Object.entries(byAccount)) {
      for (const [state, count] of Object.entries(states)) {
        if (!count || state === 'nonzero') continue; // nonzeroはNormalizedも非0のため報告不要
        findings.push({
          severity: 'info', check: 'mof-structural-zero', category: 'source-preservation',
          metrics: { field, accountType, state, count },
          message: `accountType=${accountType}の${field}: raw provenance上は${state}が${count}件（Normalizedでは全て0に見えるが原本の意味が異なる）`,
        });
      }
    }
  }

  return { findings, counts, rawSourceUnavailableRows };
}
