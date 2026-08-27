/**
 * 項レベルの集計。`/mof-jikou`（事項）・`/mof-kou-moku`（目）・`mof-rs-kou-moku-linkage`
 * （目↔RS事業の紐づけ）の読み込み結果を、リクエスト時に項単位へ束ねる。
 * 3系統とも既にプロセス内キャッシュされているデータを読むだけなので、
 * このモジュール専用の生成JSONファイルは持たない。
 */

import type { MOFBudgetType } from '@/types/mof-jikou';
import type { MOFJikouItem } from '@/types/mof-jikou';
import type { MOFKouMokuAccountType, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import type { MofRsLinkageRecord } from '@/types/mof-rs-linkage';
import type { MOFKouData, MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionHistoryYear, MOFKouSectionSummary } from '@/types/mof-kou';
import { availableYears as jikouAvailableYears, loadYear as loadJikouYear } from './mof-jikou-loader';
import { availableYears as kouMokuAvailableYears, loadYear as loadKouMokuYear } from './mof-kou-moku-loader';
import { resolveLinks } from './mof-rs-kou-moku-linkage-loader';
import { findLinksByKey as findJikouLinksByKey, linkageAvailable as jikouLinkageAvailable } from './mof-rs-linkage-loader';

/** 特別会計名の接尾辞を外す。事項別内訳（Web帳票）は「〜特別会計」付き、科目別内訳（CSV）は無し */
function normSpecialAccount(s: string): string {
  return s.replace(/特別会計$/, '');
}

interface SectionAgg {
  id: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
  jikouItems: MOFJikouItem[];
  kouMokuItems: MOFKouMokuItem[];
  rsLinks: MofRsKouMokuLinkageRecord[];
}

interface BuiltYear {
  fiscalYear: number;
  eraLabel: string;
  budgetTypes: MOFBudgetType[];
  linkage: MOFKouData['metadata']['linkage'];
  sections: Map<string, SectionAgg>;
}

const cache = new Map<number, BuiltYear>();

function sectionKey(
  accountType: string,
  budgetType: string,
  ministry: string,
  org: string,
  subAccount: string,
  sectionCode: string
): string {
  return [accountType, budgetType, ministry, org, subAccount, sectionCode].join('|');
}

function ensureSection(
  sections: Map<string, SectionAgg>,
  accountType: MOFKouMokuAccountType,
  budgetType: MOFBudgetType,
  ministry: string,
  org: string,
  subAccount: string,
  sectionCode: string,
  sectionName: string,
  organization: string,
  specialAccount: string,
  agency: string
): SectionAgg {
  const key = sectionKey(accountType, budgetType, ministry, org, subAccount, sectionCode);
  const existing = sections.get(key);
  if (existing) return existing;
  const row: SectionAgg = {
    id: key,
    accountType,
    budgetType,
    ministry,
    organization,
    specialAccount,
    subAccount,
    agency,
    sectionCode,
    sectionName,
    jikouItems: [],
    kouMokuItems: [],
    rsLinks: [],
  };
  sections.set(key, row);
  return row;
}

function buildYear(fiscalYear: number): BuiltYear {
  const cached = cache.get(fiscalYear);
  if (cached) return cached;

  const jikou = loadJikouYear(fiscalYear);
  const kouMoku = loadKouMokuYear(fiscalYear);
  const linkage = resolveLinks(fiscalYear);

  const sections = new Map<string, SectionAgg>();

  for (const it of jikou.items) {
    const org =
      it.accountType === 'general'
        ? it.organization
        : it.accountType === 'special'
          ? normSpecialAccount(it.specialAccount)
          : it.agency;
    const row = ensureSection(
      sections,
      it.accountType,
      it.budgetType,
      it.ministry,
      org,
      it.subAccount,
      it.sectionCode,
      it.sectionName,
      it.accountType === 'general' ? it.organization : '',
      it.accountType === 'special' ? it.specialAccount : '',
      it.accountType === 'agency' ? it.agency : ''
    );
    row.jikouItems.push(it);
  }

  for (const it of kouMoku.items) {
    const org =
      it.accountType === 'general'
        ? it.organization
        : it.accountType === 'special'
          ? normSpecialAccount(it.specialAccount)
          : it.agency;
    const row = ensureSection(
      sections,
      it.accountType,
      it.budgetType,
      it.ministry,
      org,
      it.subAccount,
      it.sectionCode,
      it.sectionName,
      it.accountType === 'general' ? it.organization : '',
      it.accountType === 'special' ? it.specialAccount : '',
      it.accountType === 'agency' ? it.agency : ''
    );
    row.kouMokuItems.push(it);
  }

  // RS紐づけは一般会計・特別会計のみ（政府関係機関はRSの会計区分に該当値が無く対象外）
  for (const link of linkage.links) {
    const org = link.mofAccountType === 'special' ? normSpecialAccount(link.mofOrganization) : link.mofOrganization;
    const key = sectionKey(link.mofAccountType, link.mofBudgetType, link.mofMinistry, org, link.mofSubAccount, link.sectionCode);
    const row = sections.get(key);
    // 対応する目が必ずkouMoku側に存在するはずだが、無ければ黙って捨てる（不整合を握りつぶさず件数として見えなくするだけ）
    if (row) row.rsLinks.push(link);
  }

  const budgetTypes = [...new Set([...jikou.metadata.budgetTypes, ...kouMoku.metadata.budgetTypes])];

  const built: BuiltYear = {
    fiscalYear,
    eraLabel: kouMoku.metadata.eraLabel,
    budgetTypes,
    linkage: {
      available: linkage.sourceBudgetYear !== null,
      isCarriedOver: linkage.isCarriedOver,
      sourceBudgetYear: linkage.sourceBudgetYear,
      rsYear: null, // ルート層で linkageRsYear() を使って埋める
    },
    sections,
  };
  cache.set(fiscalYear, built);
  return built;
}

/** 生成済みの年度（新しい順）。jikou・kou-moku 双方にデータがある年度だけ対象 */
export function availableYears(): number[] {
  const jSet = new Set(jikouAvailableYears());
  return kouMokuAvailableYears().filter(y => jSet.has(y));
}

/** 項内で金額最大の値を代表値として選ぶ汎用ヘルパ（主要経費・使途別分類で共用） */
function representativeClassification(
  items: MOFKouMokuItem[],
  codeOf: (item: MOFKouMokuItem) => string,
  nameOf: (item: MOFKouMokuItem) => string
): { name: string; mixed: boolean } {
  const byCode = new Map<string, { name: string; amount: number }>();
  for (const it of items) {
    const code = codeOf(it);
    if (!code) continue;
    const existing = byCode.get(code) ?? { name: nameOf(it), amount: 0 };
    existing.amount += it.amount;
    byCode.set(code, existing);
  }
  if (byCode.size === 0) return { name: '', mixed: false };
  const top = [...byCode.values()].sort((a, b) => b.amount - a.amount)[0];
  return { name: top.name, mixed: byCode.size > 1 };
}

function toSummary(row: SectionAgg): MOFKouSectionSummary {
  const amount = row.kouMokuItems.reduce((sum, i) => sum + i.amount, 0);
  const hasAllPrevious = row.kouMokuItems.length > 0 && row.kouMokuItems.every(i => i.previousAmount !== null);
  const previousAmount = hasAllPrevious
    ? row.kouMokuItems.reduce((sum, i) => sum + (i.previousAmount ?? 0), 0)
    : null;
  const difference = previousAmount === null ? null : amount - previousAmount;
  const majorExpense = representativeClassification(
    row.kouMokuItems,
    i => i.majorExpenseCode,
    i => i.majorExpenseName
  );
  const purpose = representativeClassification(
    row.kouMokuItems,
    i => i.purposeCode,
    i => i.purposeName
  );
  return {
    id: row.id,
    accountType: row.accountType,
    budgetType: row.budgetType,
    ministry: row.ministry,
    organization: row.organization,
    specialAccount: row.specialAccount,
    subAccount: row.subAccount,
    agency: row.agency,
    sectionCode: row.sectionCode,
    sectionName: row.sectionName,
    majorExpenseName: majorExpense.name,
    majorExpenseMixed: majorExpense.mixed,
    purposeName: purpose.name,
    purposeMixed: purpose.mixed,
    jikouCount: row.jikouItems.length,
    kouMokuCount: row.kouMokuItems.length,
    rsProjectCount: new Set(row.rsLinks.map(l => l.projectId)).size,
    amount,
    previousAmount,
    difference,
  };
}

/**
 * その年度の項一覧（一覧表示用の集計行のみ。事項・目・RS事業の内訳は含まない）。
 * `metadata.linkage.rsYear` はここでは常に null。`linkage.sourceBudgetYear` を使って
 * 呼び出し側（route.ts）が mof-rs-kou-moku-linkage-loader.linkageRsYear() で埋める。
 */
export function listSections(fiscalYear: number): MOFKouData {
  const built = buildYear(fiscalYear);
  const sections = [...built.sections.values()].map(toSummary);
  const byAccountType = groupBy(sections, s => s.accountType, s => s.amount);
  const byBudgetType = groupBy(sections, s => s.budgetType, s => s.amount);
  return {
    metadata: {
      fiscalYear: built.fiscalYear,
      eraLabel: built.eraLabel,
      budgetTypes: built.budgetTypes,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      linkage: built.linkage,
      notes: [
        '事項（目的別内訳）と目（性質別内訳）は項の下に並列にぶら下がる別系統の内訳で、対応表はありません。事項数・目数は同じ項を2つの異なる切り口で数えた別々の件数です',
        'RS紐づけ事業数は、目単位の完全一致キー突合（mof-rs-kou-moku-linkage）で紐づいたRS事業の実数（重複除き）です。政府関係機関はRSの会計区分に該当値が無く対象外です',
        '本年度額・前年度額・増減額は目（kou-moku）側の合計です（事項側の合計と一致することを確認済み）',
        '前年度額は項内のいずれかの目で比較対象額が無い場合（決算・暫定予算等）null にしています',
        '主要経費・使途別分類はいずれも項と1対1ではありません（実測: 2024年度でkou-mokuの項の約9%が複数の主要経費を含む）。表示は項内で金額最大のもので、複数混在する場合は「他」を付けています',
        '使途別分類コードは目（kou-moku）にしか無いフィールドのため、事項側の内訳からは算出していません',
      ],
    },
    summary: {
      count: sections.length,
      byAccountType,
      byBudgetType,
    },
    sections,
  };
}

/** 1項ぶんの詳細（行の展開時に取得） */
export function sectionDetail(fiscalYear: number, id: string): MOFKouSectionDetail | null {
  const built = buildYear(fiscalYear);
  const row = built.sections.get(id);
  if (!row) return null;

  // 事項単位のRS紐づけ（mof-rs-linkage）はkou-mokuの目単位紐づけと違い年度をまたぐ引き継ぎを
  // 持たないため、ここで直近の過去年度にフォールバックする（identityFromKeyが予算種別・所管を
  // 落とすので、そのままの年度のitem.keyで別年度のファイルを引いても一致する）
  const jikouRsLinkYear = jikouLinkageAvailable(fiscalYear)
    ? fiscalYear
    : (availableYears().filter(y => y < fiscalYear && jikouLinkageAvailable(y)).sort((a, b) => b - a)[0] ?? null);
  const jikouRsLinks: MofRsLinkageRecord[] =
    jikouRsLinkYear !== null ? row.jikouItems.flatMap(it => findJikouLinksByKey(jikouRsLinkYear, it.key)) : [];

  return {
    id,
    jikouItems: row.jikouItems,
    kouMokuItems: row.kouMokuItems,
    rsLinks: row.rsLinks,
    jikouRsLinks,
    jikouRsLinkYear,
  };
}

/** 予算種別・所管を除いた「同じ項」の識別子。所管表記の変更をまたいで継続扱いにする（jikou/kou-mokuのidentityKeyと同じ考え方） */
function sectionIdentity(row: {
  accountType: MOFKouMokuAccountType;
  organization: string;
  specialAccount: string;
  agency: string;
  subAccount: string;
  sectionCode: string;
}): string {
  const org =
    row.accountType === 'general'
      ? row.organization
      : row.accountType === 'special'
        ? normSpecialAccount(row.specialAccount)
        : row.agency;
  return [row.accountType, org, row.subAccount, row.sectionCode].join('|');
}

/**
 * 項の経年推移を組み立てる。
 * `id`（会計区分・予算種別・所管・組織/特会/機関・勘定・項コード）から予算種別・所管を
 * 除いた識別子に落とし、全年度を横断して同じ識別子を持つ行を集める。
 */
export function sectionHistory(fiscalYear: number, id: string): MOFKouSectionHistory | null {
  const built = buildYear(fiscalYear);
  const startRow = built.sections.get(id);
  if (!startRow) return null;
  const identity = sectionIdentity(startRow);

  const years: MOFKouSectionHistoryYear[] = [];
  let sectionName = '';
  for (const year of [...availableYears()].sort((a, b) => a - b)) {
    const y = buildYear(year);
    const matches = [...y.sections.values()].filter(r => sectionIdentity(r) === identity).map(toSummary);
    if (matches.length === 0) continue;
    if (!sectionName) sectionName = matches[0].sectionName;
    years.push({ fiscalYear: year, eraLabel: y.eraLabel, rows: matches });
  }

  return { id, identity, sectionName, availableYears: availableYears(), years };
}

function groupBy<T>(
  rows: T[],
  keyOf: (row: T) => string,
  amountOf: (row: T) => number
): { key: string; count: number; amount: number }[] {
  const map = new Map<string, { key: string; count: number; amount: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const existing = map.get(key) ?? { key, count: 0, amount: 0 };
    existing.count++;
    existing.amount += amountOf(row);
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}
