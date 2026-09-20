/**
 * RS 2-1（予算・執行サマリ）・2-2（予算種別・歳出予算項目）の正規化。
 * Python参照実装 pipeline_v2/normalize_rs.py の normalize_budget_summary/
 * normalize_budget_items と同じ列マッピング・イベント化ロジック。
 *
 * 重要: `予備費等`はneutralな'adjustment'として扱い、決算の'reserve_use'（予備費使用額）と
 * 混同しない。RS側に所管/組織/項/目が記録されておらずMOFのどの予備費使用に対応するか
 * 特定できないため（'予備費等N'という原本表記のまま保持し、断定しない）。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, sourceInventory, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { normalizeText, stableId } from './stable-id';
import { parseNumber } from './parse';
import type { RsAccountType, RsBudgetEventRecord, RsBudgetSummaryRecord, RsBudgetItemRecordV2, RsEventType, SourceInventory } from '../types';

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

const SUMMARY_MAPPED = new Set([
  ...COMMON_COLUMNS,
  '予算年度', '執行率', '主な増減理由', 'その他特記事項', '会計区分', '会計', '勘定', '備考',
  ...ALL_AMOUNT_COLUMNS,
]);

export function normalizeBudgetSummary(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { summaries: RsBudgetSummaryRecord[]; events: RsBudgetEventRecord[]; sourceInventory: SourceInventory } {
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
      extraFields: extraFields(row, SUMMARY_MAPPED),
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

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { summaries, events, sourceInventory: sourceInventory(rawRoot, zipPath, entry, headers, rows, SUMMARY_MAPPED, '2-1', '予算・執行_サマリ', year) };
}

const ITEMS_MAPPED = new Set([
  ...COMMON_COLUMNS,
  '予算年度', '会計区分', '会計', '勘定', '予算種別', '所管', '組織・勘定', '項', '目',
  '歳出予算項目の補足情報', '予算額（歳出予算項目ごと）', '翌年度要求額（歳出予算項目ごと）', '備考（歳出予算項目ごと）',
]);

/**
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 * 1行入力→1行出力の単純な変換のため、rows引数を1件も配列化せずgeneratorのまま
 * yieldする。source inventory()はrows消費後にのみ正しい値を返すdeferred function
 * （rs-organizations.ts・rs-projects.tsと同じ設計）。2-1（normalizeBudgetSummary）は
 * 同一行から複数output（summaries/events）を作る都合上、引き続き配列ベースのまま。
 */
export function normalizeBudgetItems(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsBudgetItemRecordV2>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsBudgetItemRecordV2> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
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

      yield {
        ...base,
        // rsBase()のministryは共通列「府省庁」から取るが、2-2 CSVのMOF突合に使うべきは
        // 「所管」列（MOFの科目別内訳と同じ語彙）。府省庁と所管は同じ値のことが多いが、
        // 一致しない行がある場合ここを府省庁のまま残すとMOFリンクを静かに誤らせるため上書きする
        // （CodeRabbit相当の指摘、2026-09-20）
        ministry,
        recordType: 'rs_budget_item' as const,
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
        extraFields: extraFields(row, ITEMS_MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '予算・執行_予算種別・歳出予算項目', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, ITEMS_MAPPED, '2-2', '予算・執行_予算種別・歳出予算項目', year),
  };
}
