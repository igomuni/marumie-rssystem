/**
 * MOF目 ↔ RS事業 紐づけデータの読み込み。
 *
 * 生成は npm run generate-mof-rs-kou-moku-linkage
 * （scripts/generate-mof-rs-kou-moku-linkage.ts）。
 * ファイルは予算年度（= mof-kou-moku の会計年度）ごとに1本。
 * 未生成の年度は「対象外」として扱い、呼び出し側でエラーにしない。
 */

import type { MofRsKouMokuLinkageData, MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { dataFileExists, readDataJson } from './data-file';
import { availableYears as kouMokuAvailableYears, identityKey, loadYear as loadKouMokuYear } from './mof-kou-moku-loader';

const fileName = (budgetYear: number) => `mof-rs-kou-moku-linkage-${budgetYear}.json`;

const cache = new Map<number, MofRsKouMokuLinkageData>();

/** その予算年度の紐づけデータが生成済みか */
export function linkageAvailable(budgetYear: number): boolean {
  return dataFileExists(fileName(budgetYear));
}

function loadYear(budgetYear: number): MofRsKouMokuLinkageData {
  const cached = cache.get(budgetYear);
  if (cached) return cached;
  const data = readDataJson<MofRsKouMokuLinkageData>(
    fileName(budgetYear),
    `npm run generate-mof-rs-kou-moku-linkage を実行してください（対象年度: ${budgetYear}）。`
  );
  cache.set(budgetYear, data);
  return data;
}

/** その年度の紐づけ全件。一覧側での列表示・詳細パネルの両方をクライアント側の1回のフェッチで賄う */
export function allLinks(budgetYear: number): MofRsKouMokuLinkageRecord[] {
  if (!linkageAvailable(budgetYear)) return [];
  return loadYear(budgetYear).links;
}

/** その年度の紐づけデータの RS 事業年度（/sankey-svg の yr パラメータに使う） */
export function linkageRsYear(budgetYear: number): number | null {
  if (!linkageAvailable(budgetYear)) return null;
  return loadYear(budgetYear).metadata.rsYear;
}

export interface LinkageResolution {
  /** 実際にリンクを取得した予算年度。データが全く無ければ null */
  sourceBudgetYear: number | null;
  /** 要求年度自体の紐づけデータが無く、過去年度から識別子で引き継いだ場合 true */
  isCarriedOver: boolean;
  links: MofRsKouMokuLinkageRecord[];
}

/**
 * 指定年度の紐づけを解決する。RSシステムのデータ公開はMOF予算より遅れるため、
 * 最新の予算年度は自前の紐づけデータを持たないのが通常。その場合、識別子
 * （会計区分・所管・組織/特会・勘定・項コード・目分類コード・目名。予算種別を除く。
 * `mof-kou-moku-loader.ts` の identityKey と同じ）が一致する直近の過去年度の紐づけを
 * 参考値として引き継ぐ（決算目の予算種別間引き継ぎと同じ発想を年度間に広げたもの）。
 */
export function resolveLinks(budgetYear: number): LinkageResolution {
  if (linkageAvailable(budgetYear)) {
    return { sourceBudgetYear: budgetYear, isCarriedOver: false, links: allLinks(budgetYear) };
  }

  const candidateYear = kouMokuAvailableYears()
    .filter(y => y < budgetYear && linkageAvailable(y))
    .sort((a, b) => b - a)[0];
  if (candidateYear === undefined) {
    return { sourceBudgetYear: null, isCarriedOver: false, links: [] };
  }

  const scoped = (items: ReturnType<typeof loadKouMokuYear>['items']) =>
    items.filter(it => it.accountType === 'general' || it.accountType === 'special');

  const pastKeyByIdentity = new Map<string, string>();
  for (const it of scoped(loadKouMokuYear(candidateYear).items)) {
    pastKeyByIdentity.set(identityKey(it), it.key);
  }
  const pastLinksByKey = new Map<string, MofRsKouMokuLinkageRecord[]>();
  for (const link of allLinks(candidateYear)) {
    const list = pastLinksByKey.get(link.kouMokuKey) ?? [];
    list.push(link);
    pastLinksByKey.set(link.kouMokuKey, list);
  }

  const carried: MofRsKouMokuLinkageRecord[] = [];
  for (const item of scoped(loadKouMokuYear(budgetYear).items)) {
    const pastKey = pastKeyByIdentity.get(identityKey(item));
    if (!pastKey) continue;
    for (const pastLink of pastLinksByKey.get(pastKey) ?? []) {
      carried.push({
        ...pastLink,
        kouMokuKey: item.key,
        mofAccountType: item.accountType,
        mofBudgetType: item.budgetType,
        mofMinistry: item.ministry,
        mofOrganization: item.accountType === 'special' ? item.specialAccount : item.organization,
        mofSubAccount: item.subAccount,
        sectionCode: item.sectionCode,
        sectionName: item.sectionName,
        subItemCode: item.subItemCode,
        subItemName: item.subItemName,
        kouMokuAmount: item.amount,
      });
    }
  }

  return { sourceBudgetYear: candidateYear, isCarriedOver: true, links: carried };
}
