/**
 * RS 5-4（支出先_国庫債務負担行為等による契約）の正規化。
 * Python参照実装のnormalize_multi_year_contractsと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { parseIntValue, parseNumber } from './parse';
import type { RsMultiYearContract, SourceInventory } from '../types';

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '支出先ブロック（国庫債務負担行為等による契約）', '契約先名（国庫債務負担行為等による契約）',
  '契約先の法人番号（国庫債務負担行為等による契約）', '契約先の所在地（国庫債務負担行為等による契約）',
  '契約先の法人種別（国庫債務負担行為等による契約）', '契約概要（契約名）（国庫債務負担行為等による契約）',
  'その他の契約', '契約額（国庫債務負担行為等による契約）', '契約方式等（国庫債務負担行為等による契約）',
  '具体的な契約方式等（国庫債務負担行為等による契約）', '入札者数（応募者数）（国庫債務負担行為等による契約）',
  '落札率（％）（国庫債務負担行為等による契約）',
  '一者応札・一者応募又は競争性のない随意契約となった理由及び改善策（契約額10億円以上）（国庫債務負担行為等による契約）',
  'その他の契約（国庫債務負担行為等による契約）',
]);

export function normalizeMultiYearContracts(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsMultiYearContract>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsMultiYearContract> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      const amountRaw = (row['契約額（国庫債務負担行為等による契約）'] ?? '').trim();
      const recipientName = (row['契約先名（国庫債務負担行為等による契約）'] ?? '').trim();
      const summary = (row['契約概要（契約名）（国庫債務負担行為等による契約）'] ?? '').trim();
      yield {
        ...rsBase(row, year),
        recordType: 'rs_multi_year_contract' as const,
        contractId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsmulti_'),
        blockId: (row['支出先ブロック（国庫債務負担行為等による契約）'] ?? '').trim(),
        recipientName,
        corporateNumber: (row['契約先の法人番号（国庫債務負担行為等による契約）'] ?? '').trim(),
        location: (row['契約先の所在地（国庫債務負担行為等による契約）'] ?? '').trim(),
        corporateType: (row['契約先の法人種別（国庫債務負担行為等による契約）'] ?? '').trim(),
        summary,
        amountYen: parseNumber(amountRaw),
        amountRaw,
        method: (row['契約方式等（国庫債務負担行為等による契約）'] ?? '').trim(),
        methodDetail: (row['具体的な契約方式等（国庫債務負担行為等による契約）'] ?? '').trim(),
        bidderCount: parseIntValue(row['入札者数（応募者数）（国庫債務負担行為等による契約）'], { noneIfBlank: true }),
        winningRate: parseNumber(row['落札率（％）（国庫債務負担行為等による契約）']),
        singleBidReason: (row['一者応札・一者応募又は競争性のない随意契約となった理由及び改善策（契約額10億円以上）（国庫債務負担行為等による契約）'] ?? '').trim(),
        otherContractRaw: (row['その他の契約（国庫債務負担行為等による契約）'] || row['その他の契約'] || '').trim(),
        hasContract: Boolean(amountRaw || recipientName || summary),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '支出先_国庫債務負担行為等による契約', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '5-4', '支出先_国庫債務負担行為等による契約', year),
  };
}
