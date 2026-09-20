/**
 * RS 2-1（予算・執行サマリ）・2-2（予算種別・歳出予算項目）の正規化。
 * Python参照実装 pipeline_v2/normalize_rs.py の normalize_budget_summary/
 * normalize_budget_items と同じ列マッピング・イベント化ロジック。
 *
 * 重要: `予備費等`はneutralな'adjustment'として扱い、決算の'reserve_use'（予備費使用額）と
 * 混同しない。RS側に所管/組織/項/目が記録されておらずMOFのどの予備費使用に対応するか
 * 特定できないため（'予備費等N'という原本表記のまま保持し、断定しない）。
 */
import { rsBase, rsSourceRef, rsRecordId } from './rs-common';
import { normalizeText, stableId } from './stable-id';
import { parseNumber } from './parse';
import type { RsAccountType, RsBudgetEventRecord, RsBudgetSummaryRecord, RsBudgetItemRecordV2, RsEventType } from '../types';

function accountType(value: string): RsAccountType {
  const v = normalizeText(value);
  if (v === normalizeText('一般会計')) return 'general';
  if (v === normalizeText('特別会計')) return 'special';
  if (v) return 'other';
  return '';
}

/** 事業合計の列。会計区分が空欄（事業全体の合計行）に現れる */
const PROJECT_TOTAL_AMOUNT_COLUMNS: Record<string, [RsEventType, number | null]> = {
  '当初予算（合計）': ['initial', 0],
  '補正予算（合計）': ['supplementary', null],
  '前年度からの繰越し（合計）': ['carryover_in', null],
  '予備費等（合計）': ['adjustment', null],
  '計（歳出予算現額合計）': ['current_budget', null],
  '執行額（合計）': ['execution', null],
  '翌年度への繰越し(合計）': ['carryover_out', null],
  '翌年度要求額（合計）': ['request', null],
};

/** 会計別の列。会計区分が入っている行（一般会計/特別会計別の内訳行）に現れる */
const ACCOUNT_AMOUNT_COLUMNS: Record<string, [RsEventType, number | null]> = {
  '当初予算': ['initial', 0],
  '第1次補正予算': ['supplementary', 1],
  '第2次補正予算': ['supplementary', 2],
  '第3次補正予算': ['supplementary', 3],
  '第4次補正予算': ['supplementary', 4],
  '第5次補正予算': ['supplementary', 5],
  '前年度から繰越し': ['carryover_in', null],
  '予備費等1': ['adjustment', 1],
  '予備費等2': ['adjustment', 2],
  '予備費等3': ['adjustment', 3],
  '予備費等4': ['adjustment', 4],
  '歳出予算現額': ['current_budget', null],
  '執行額': ['execution', null],
  '翌年度要求額': ['request', null],
  '要望額': ['request_preference', null],
};

const ALL_AMOUNT_COLUMNS = [...Object.keys(PROJECT_TOTAL_AMOUNT_COLUMNS), ...Object.keys(ACCOUNT_AMOUNT_COLUMNS)];

export function normalizeBudgetSummary(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { summaries: RsBudgetSummaryRecord[]; events: RsBudgetEventRecord[] } {
  // 注: 参照実装はextraFields（未マッピング列の将来検知）も持つが、このPoCでは
  // budget-summary/eventsの主要フィールドを優先し、extraFieldsは他データセット
  // （5-1等）にのみ実装している
  const summaries: RsBudgetSummaryRecord[] = [];
  const events: RsBudgetEventRecord[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const base = rsBase(row, year);
    const fyRaw = (row['予算年度'] ?? '').trim();
    const fy = fyRaw ? parseInt(fyRaw, 10) : null;
    const ac = (row['会計区分'] ?? '').trim();
    const scope: 'account' | 'project_total' = ac ? 'account' : 'project_total';
    const source = rsSourceRef(rawRoot, zipPath, entry, rowNumber, '予算・執行_サマリ', year);
    const recordId = rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rssum_');

    const amounts: Record<string, number | null> = {};
    for (const col of ALL_AMOUNT_COLUMNS) amounts[col] = parseNumber(row[col]);

    summaries.push({
      ...base,
      recordType: 'rs_budget_summary',
      recordId,
      fiscalYear: Number.isNaN(fy as number) ? null : fy,
      scopeLevel: scope,
      accountType: accountType(ac),
      accountClass: ac,
      account: (row['会計'] ?? '').trim(),
      subAccount: (row['勘定'] ?? '').trim(),
      executionRateRaw: (row['執行率'] ?? '').trim(),
      changeReason: (row['主な増減理由'] ?? '').trim(),
      specialNotes: (row['その他特記事項'] ?? '').trim(),
      note: (row['備考'] ?? '').trim(),
      amounts,
      source,
    });

    const cols = scope === 'project_total' ? PROJECT_TOTAL_AMOUNT_COLUMNS : ACCOUNT_AMOUNT_COLUMNS;
    for (const [col, [eventType, revision]] of Object.entries(cols)) {
      const raw = (row[col] ?? '').trim();
      if (!raw) continue;
      const amount = parseNumber(raw);
      if (amount === null) continue;
      const eventFy = fy !== null && (eventType === 'request' || eventType === 'request_preference') ? fy + 1 : fy;
      events.push({
        ...base,
        recordType: 'rs_budget_event',
        eventId: stableId([recordId, col], 'rsevt_'),
        sourceRecordId: recordId,
        fiscalYear: eventFy,
        sourceFiscalYear: fy,
        eventType,
        revision,
        amountYen: amount,
        amountRaw: raw,
        sourceAmountColumn: col,
        scopeLevel: scope,
        accountType: accountType(ac),
        accountClass: ac,
        account: (row['会計'] ?? '').trim(),
        subAccount: (row['勘定'] ?? '').trim(),
        semanticStatus: eventType === 'adjustment' ? 'source_neutral' : 'source_labeled',
        source,
      });
    }
  });

  return { summaries, events };
}

export function normalizeBudgetItems(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): RsBudgetItemRecordV2[] {
  return rows.map((row, i) => {
    const rowNumber = i + 2;
    const base = rsBase(row, year);
    const fyRaw = (row['予算年度'] ?? '').trim();
    const fy = fyRaw ? parseInt(fyRaw, 10) : null;
    const ac = (row['会計区分'] ?? '').trim();
    const ministry = (row['所管'] ?? '').trim();
    const orgAcc = (row['組織・勘定'] ?? '').trim();
    const section = (row['項'] ?? '').trim();
    const item = (row['目'] ?? '').trim();
    const amountRaw = (row['予算額（歳出予算項目ごと）'] ?? '').trim();
    const requestRaw = (row['翌年度要求額（歳出予算項目ごと）'] ?? '').trim();
    const type = accountType(ac);

    return {
      ...base,
      recordType: 'rs_budget_item',
      recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsitem_'),
      fiscalYear: Number.isNaN(fy as number) ? null : fy,
      accountType: type,
      accountClass: ac,
      account: (row['会計'] ?? '').trim(),
      subAccount: (row['勘定'] ?? '').trim(),
      budgetType: (row['予算種別'] ?? '').trim(),
      organizationOrAccount: orgAcc,
      sectionName: section,
      subItemName: item,
      supplementalInfo: (row['歳出予算項目の補足情報'] ?? '').trim(),
      budgetAmountYen: parseNumber(amountRaw),
      budgetAmountRaw: amountRaw,
      nextYearRequestYen: parseNumber(requestRaw),
      nextYearRequestRaw: requestRaw,
      requestFiscalYear: fy !== null && requestRaw ? fy + 1 : null,
      note: (row['備考（歳出予算項目ごと）'] ?? '').trim(),
      mofNameNaturalKey: [type, ministry, orgAcc, section, item].map(normalizeText).join('|'),
      source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '予算・執行_予算種別・歳出予算項目', year),
    };
  });
}
