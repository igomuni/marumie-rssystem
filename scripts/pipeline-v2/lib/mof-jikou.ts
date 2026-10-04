/**
 * #370 の frozen parser v0（mof-budget-xml-items.ts）の出力を、V2 normalized の事項 record（MofBudgetJikouRecord）へ写像する純関数。
 * 親子判定（carry-forward）は parser の出力をそのまま使い、ここでは再実装しない。fs・network に触れない。
 * 設計: docs/tasks/20261004_2152_MOF_PipelineV2_事項NormalizedOutput_Inventory_設計.md
 */
import { sectionNaturalKey } from './mof-keys';
import { sectionKeyOf } from './mof-sections';
import { stableId } from './stable-id';
import type { MofXmlItemRecord } from './mof-budget-xml-items';
import type { MofBudgetJikouRecord, MofBudgetStatus, MofAccountType, MofPhase } from '../types';

export const MOF_JIKOU_SCHEMA_VERSION = 1;

export interface JikouDocumentContext {
  fiscalYear: number;
  documentId: string;
  accountType: MofAccountType;
  phase: MofPhase;
  budgetStatus: MofBudgetStatus;
  /** raw_root（data/download）からの XML ディレクトリの相対パス */
  xmlDirRelPath: string;
  sourceUrlBase: string;
}

/** FY2024 一般会計 当初予算（成立版 archive）。parser v0 の frozen scope と同じ */
export const JIKOU_CONTEXT_FY2024_GENERAL_INITIAL: JikouDocumentContext = {
  fiscalYear: 2024, documentId: '202411001', accountType: 'general', phase: 'initial', budgetStatus: 'enacted',
  xmlDirRelPath: 'mof.go.jp/archive/2024/2024/xml', sourceUrlBase: 'https://www.bb.mof.go.jp/server/2024/xml',
};

const SOURCE_AMOUNT_COLUMNS = { current: '令和6年度 要求額(千円)', previous: '前年度 予算額(千円)', difference: '比較増△減額(千円)' };
const MENU_MINISTRY_MARKER = '甲号予定経費要求書';

/** menu の祖先 chain で「甲号予定経費要求書」の直前の要素から、末尾の「所管」を除いた名称（例: 内閣府所管→内閣府、皇室費→皇室費）。無ければ throw */
export function ministryFromMenuChain(chain: readonly string[]): string {
  const i = chain.indexOf(MENU_MINISTRY_MARKER);
  if (i < 1) throw new Error(`menu の祖先 chain に「${MENU_MINISTRY_MARKER}」の直前の要素が無い: ${chain.join(' > ')}`);
  return chain[i - 1].replace(/所管$/, '');
}

export function jikouScopeFields(ctx: JikouDocumentContext, ministry: string, organization: string) {
  return { accountType: ctx.accountType, ministry, organization, specialAccount: '', subAccount: '', agency: '' };
}

/** parser の 1 record → normalized の事項 record。金額は整数 ×1000 のみ（blank→0 にする既存の yenFromThousand は使わない） */
export function mapParserRecordToJikou(rec: MofXmlItemRecord, ctx: JikouDocumentContext, ministry: string, sourceSha256: string): MofBudgetJikouRecord {
  const scope = jikouScopeFields(ctx, ministry, rec.organization);
  const natKey = sectionNaturalKey(ctx.accountType, { ministry, organization: rec.organization, specialAccount: '', subAccount: '', agency: '' }, rec.itemCode, rec.itemName);
  const parentSectionId = stableId([sectionKeyOf({ ...scope, sectionCode: rec.itemCode, sectionName: rec.itemName })], 'mofsec_');
  return {
    schemaVersion: MOF_JIKOU_SCHEMA_VERSION,
    recordType: 'mof_budget_jikou',
    recordId: stableId([ctx.fiscalYear, ctx.phase, ctx.budgetStatus, natKey, rec.requestName], 'mofjik_'),
    fiscalYear: ctx.fiscalYear, phase: ctx.phase, budgetStatus: ctx.budgetStatus,
    ...scope,
    sectionCode: rec.itemCode, sectionName: rec.itemName, sectionNaturalKey: natKey, parentSectionId,
    jikouName: rec.requestName, jikouNameLines: rec.requestNameLines, nameQtCount: rec.requestQtCount, nameGaiji: rec.requestGaiji,
    col4Raw: rec.col4Raw,
    amountYen: rec.amountsThousandYen.col6 * 1000, previousAmountYen: rec.amountsThousandYen.col8 * 1000, differenceYen: rec.amountsThousandYen.col10 * 1000,
    amountsRawThousand: { current: rec.amountsRaw.col6, previous: rec.amountsRaw.col8, difference: rec.amountsRaw.col10 },
    sourceAmountColumns: SOURCE_AMOUNT_COLUMNS,
    source: { domain: 'mof.go.jp', path: `${ctx.xmlDirRelPath}/${rec.file}`, file: rec.file, dataset: 'budget-xml-jikou-table', year: ctx.fiscalYear, sourceUrl: `${ctx.sourceUrlBase}/${rec.file}` },
    sourceLocator: { documentId: ctx.documentId, row: rec.row, page: rec.page, rowNo: rec.rowNo, sourceSha256 },
  };
}

/** 文書順（ソース file 名 → 頁 → 行）に並べる。決定的 */
export function sortJikou(rows: MofBudgetJikouRecord[]): MofBudgetJikouRecord[] {
  return [...rows].sort((a, b) => {
    if (a.source.file !== b.source.file) return a.source.file < b.source.file ? -1 : 1;
    if (a.sourceLocator.page !== b.sourceLocator.page) return a.sourceLocator.page - b.sourceLocator.page;
    return a.sourceLocator.rowNo - b.sourceLocator.rowNo;
  });
}

export interface JikouValidation {
  recordCount: number;
  duplicateRecordIds: string[];
  missingRequiredFields: { recordId: string; field: string }[];
  missingProvenance: string[];
  parentResolved: { bySectionNaturalKey: number; bySectionId: number; both: number };
  orphanParent: string[];
  /** 一方の参照だけが解決する（不整合）ため ambiguous として数える */
  ambiguousParent: string[];
  notInDocumentOrder: number;
}

/** 事項 record 群の検証（件数・重複・必須 field・provenance・親の解決・順序）。親の集合は既存 output（budget-items / sections）から渡す */
export function validateJikouRecords(rows: MofBudgetJikouRecord[], parentSectionKeys: ReadonlySet<string>, parentSectionIds: ReadonlySet<string>): JikouValidation {
  const seen = new Set<string>();
  const dup = new Set<string>();
  const missingRequiredFields: JikouValidation['missingRequiredFields'] = [];
  const missingProvenance: string[] = [];
  const orphan: string[] = [];
  const ambiguous: string[] = [];
  let byKey = 0, byId = 0, both = 0, order = 0;
  const required: (keyof MofBudgetJikouRecord)[] = ['recordId', 'fiscalYear', 'phase', 'budgetStatus', 'accountType', 'ministry', 'organization', 'sectionCode', 'sectionName', 'sectionNaturalKey', 'parentSectionId', 'jikouName', 'col4Raw', 'amountYen', 'previousAmountYen', 'differenceYen'];
  rows.forEach((r, i) => {
    if (seen.has(r.recordId)) dup.add(r.recordId); else seen.add(r.recordId);
    for (const f of required) { const v = r[f]; if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) missingRequiredFields.push({ recordId: r.recordId, field: f }); }
    const loc = r.sourceLocator;
    if (!r.source?.file || !r.source.path || !r.source.sourceUrl || !loc?.documentId || !loc.row || !loc.sourceSha256 || !Number.isInteger(loc.page) || !Number.isInteger(loc.rowNo)) missingProvenance.push(r.recordId);
    const k = parentSectionKeys.has(r.sectionNaturalKey), d = parentSectionIds.has(r.parentSectionId);
    if (k) byKey++; if (d) byId++;
    if (k && d) both++; else if (k !== d) ambiguous.push(r.recordId); else orphan.push(r.recordId);
    if (i > 0 && sortJikou([rows[i - 1], r])[0] !== rows[i - 1]) order++;
  });
  return { recordCount: rows.length, duplicateRecordIds: [...dup], missingRequiredFields, missingProvenance, parentResolved: { bySectionNaturalKey: byKey, bySectionId: byId, both }, orphanParent: orphan, ambiguousParent: ambiguous, notInDocumentOrder: order };
}
