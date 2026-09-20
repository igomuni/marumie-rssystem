/**
 * RS 5-1（支出先_支出情報）の正規化。1行にブロック集計行・支出先行・契約行の情報が
 * 混在するCSVを、block/recipient/contractの3種類に分離する。
 * Python参照実装 pipeline_v2/normalize_rs.py の normalize_spending と同じdedupキー・
 * 「同一行に支出先名が無い契約行は直前の支出先に紐づける」ロジック。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, sourceInventory, COMMON_COLUMNS } from './rs-common';
import { stableId } from './stable-id';
import { parseIntValue, parseNumber, parseBool } from './parse';
import type { RsSpendingBlockRecord, RsRecipientRecord, RsContractRecord, SourceRef, SourceInventory } from '../types';

const CONTRACT_COLUMNS = [
  '契約概要', '金額', '契約方式等', '具体的な契約方式等', '入札者数', '落札率',
  '一者応札・一者応募又は競争性のない随意契約となった理由及び改善策（支出額10億円以上）', 'その他の契約',
];

const MAPPED = new Set([
  ...COMMON_COLUMNS,
  '支出先ブロック番号', '支出先ブロック名', '支出先の数', '事業を行う上での役割', 'ブロックの合計支出額',
  '支出先名', '法人番号', '所在地', '法人種別', 'その他支出先', '支出先の合計支出額',
  ...CONTRACT_COLUMNS,
]);

export function normalizeSpending(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { blocks: RsSpendingBlockRecord[]; recipients: RsRecipientRecord[]; contracts: RsContractRecord[]; sourceInventory: SourceInventory } {
  const blocks = new Map<string, RsSpendingBlockRecord>();
  const recipients = new Map<string, RsRecipientRecord>();
  const contracts: RsContractRecord[] = [];
  const lastRecipientByBlock = new Map<string, string>();

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const base = rsBase(row, year);
    const pid = base.projectId;
    const bid = (row['支出先ブロック番号'] ?? '').trim();
    const source = rsSourceRef(rawRoot, zipPath, entry, rowNumber, '支出先_支出情報', year);
    const rowId = rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsspendrow_');
    const bkey = `${pid}\x1f${bid}`;

    const summaryPresent = ['支出先ブロック名', '支出先の数', '事業を行う上での役割', 'ブロックの合計支出額'].some(c => (row[c] ?? '').trim());
    if (bid && !blocks.has(bkey)) {
      blocks.set(bkey, {
        ...base,
        recordType: 'rs_spending_block',
        nodeId: `project:${pid}:block:${bid}`,
        blockId: bid,
        blockName: '',
        blockNames: [],
        recipientCountValues: [],
        roles: [],
        totalAmountValuesYen: [],
        evidenceRowIds: [],
        sources: [],
        summaryRowCount: 0,
        extraFields: {},
      });
    }
    if (bid && summaryPresent) {
      const b = blocks.get(bkey)!;
      b.summaryRowCount++;
      b.evidenceRowIds.push(rowId);
      b.sources.push(source);
      const name = (row['支出先ブロック名'] ?? '').trim();
      const role = (row['事業を行う上での役割'] ?? '').trim();
      const cnt = parseIntValue(row['支出先の数'], { noneIfBlank: true });
      const amt = parseNumber(row['ブロックの合計支出額']);
      if (name && !b.blockNames.includes(name)) b.blockNames.push(name);
      if (!b.blockName && name) b.blockName = name;
      if (role && !b.roles.includes(role)) b.roles.push(role);
      if (cnt !== null && !b.recipientCountValues.includes(cnt)) b.recipientCountValues.push(cnt);
      if (amt !== null && !b.totalAmountValuesYen.includes(amt)) b.totalAmountValuesYen.push(amt);
      for (const [k, v] of Object.entries(extraFields(row, MAPPED))) {
        const existing = b.extraFields[k] ?? [];
        if (!existing.includes(v)) b.extraFields[k] = [...existing, v].sort();
      }
    }

    const rname = (row['支出先名'] ?? '').trim();
    const corp = (row['法人番号'] ?? '').trim();
    const loc = (row['所在地'] ?? '').trim();
    const ctype = (row['法人種別'] ?? '').trim();
    const other = (row['その他支出先'] ?? '').trim();
    let recipientId = '';
    if (bid && (rname || corp || loc || ctype || other || (row['支出先の合計支出額'] ?? '').trim())) {
      const rkey = [pid, bid, rname, corp, loc, ctype, other].join('\x1f');
      if (!recipients.has(rkey)) {
        recipientId = stableId([year, pid, bid, rname, corp, loc, ctype, other], 'rsrecipient_');
        recipients.set(rkey, {
          ...base,
          recordType: 'rs_recipient',
          recipientId,
          blockId: bid,
          recipientName: rname,
          corporateNumber: corp,
          location: loc,
          corporateType: ctype,
          otherRecipient: parseBool(other),
          totalAmountValuesYen: [],
          evidenceRowIds: [],
          sources: [],
          // 支出先行はマップ済み列のみで構成が完結するため、参照実装と同じく常に空
          extraFields: {},
        });
      }
      const r = recipients.get(rkey)!;
      recipientId = r.recipientId;
      r.evidenceRowIds.push(rowId);
      r.sources.push(source);
      const tamt = parseNumber(row['支出先の合計支出額']);
      if (tamt !== null && !r.totalAmountValuesYen.includes(tamt)) r.totalAmountValuesYen.push(tamt);
      lastRecipientByBlock.set(bkey, recipientId);
    }

    if (bid && CONTRACT_COLUMNS.some(c => (row[c] ?? '').trim())) {
      if (!recipientId) recipientId = lastRecipientByBlock.get(bkey) ?? '';
      const amountRaw = (row['金額'] ?? '').trim();
      contracts.push({
        ...base,
        recordType: 'rs_contract',
        contractId: stableId([rowId, 'contract'], 'rscontract_'),
        blockId: bid,
        recipientId: recipientId || null,
        recipientLinkMethod: rname ? 'same-row' : recipientId ? 'preceding-row' : null,
        recipientNameRaw: rname,
        corporateNumberRaw: corp,
        summary: (row['契約概要'] ?? '').trim(),
        amountYen: parseNumber(amountRaw),
        amountRaw,
        method: (row['契約方式等'] ?? '').trim(),
        methodDetail: (row['具体的な契約方式等'] ?? '').trim(),
        bidderCount: parseIntValue(row['入札者数'], { noneIfBlank: true }),
        winningRate: parseNumber(row['落札率']),
        singleBidReason: (row['一者応札・一者応募又は競争性のない随意契約となった理由及び改善策（支出額10億円以上）'] ?? '').trim(),
        otherContract: parseBool(row['その他の契約']),
        sourceRowId: rowId,
        extraFields: extraFields(row, MAPPED),
        source,
      });
    }
  });

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    blocks: [...blocks.values()], recipients: [...recipients.values()], contracts,
    sourceInventory: sourceInventory(rawRoot, zipPath, entry, headers, rows, MAPPED, '5-1', '支出先_支出情報', year),
  };
}

/** compat: 旧expenditures相当のフラットビュー（契約から導出。canonicalはblocks/recipients/contracts） */
export function toExpenditureCompat(contracts: RsContractRecord[], year: number): {
  schemaVersion: number; recordType: 'rs_expenditure_compat'; projectId: string; projectIdRaw: string;
  sourceYear: number; blockId: string; recipientId: string | null; recipientName: string;
  corporateNumber: string; amount: number | null; contractId: string; source: SourceRef;
}[] {
  return contracts.map(c => ({
    schemaVersion: 2,
    recordType: 'rs_expenditure_compat',
    projectId: c.projectId,
    projectIdRaw: c.projectIdRaw,
    sourceYear: year,
    blockId: c.blockId,
    recipientId: c.recipientId,
    recipientName: c.recipientNameRaw,
    corporateNumber: c.corporateNumberRaw,
    amount: c.amountYen,
    contractId: c.contractId,
    source: c.source,
  }));
}
