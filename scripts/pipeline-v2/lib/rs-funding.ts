/**
 * RS 5-2（支出先_支出ブロックのつながり）の正規化。
 * 1行＝1辺として、重複辺・循環・多始点・孤立ブロックを一切削除・統合しない
 * 「一般有向グラフ」として保持する（tree/DAG/single-rootを前提にしない）。
 * Python参照実装 pipeline_v2/normalize_rs.py の normalize_funding_relations と同じ。
 */
import { rsBase, rsSourceRef, rsRecordId } from './rs-common';
import { stableId } from './stable-id';
import { parseNumber } from './parse';
import type { RsFundingRelationRecord, RsIndirectExpenseRecord } from '../types';

function parseBoolOrNull(raw: string | undefined): boolean | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (['○', '有', 'あり', 'TRUE', '1', 'YES', 'Y'].includes(s) || ['TRUE', '1', 'YES', 'Y'].includes(s.toUpperCase())) return true;
  if (['×', '無', 'なし', 'FALSE', '0', 'NO', 'N'].includes(s) || ['FALSE', '0', 'NO', 'N'].includes(s.toUpperCase())) return false;
  return null;
}

export function normalizeFundingRelations(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { relations: RsFundingRelationRecord[]; indirect: RsIndirectExpenseRecord[] } {
  const relations: RsFundingRelationRecord[] = [];
  const indirect: RsIndirectExpenseRecord[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const base = rsBase(row, year);
    const source = rsSourceRef(rawRoot, zipPath, entry, rowNumber, '支出先_支出ブロックのつながり', year);
    const rowId = rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rsflowrow_');

    const sbid = (row['支出元の支出先ブロック'] ?? '').trim();
    const sname = (row['支出元の支出先ブロック名'] ?? '').trim();
    const tbid = (row['支出先の支出先ブロック'] ?? '').trim();
    const tname = (row['支出先の支出先ブロック名'] ?? '').trim();
    const fromOrg = parseBoolOrNull(row['担当組織からの支出']);

    // ターゲット（支出先）が無い行はグラフの辺として意味を持たないため対象外。
    // ソースが無い行は「事業自体からの直接支出（ルートブロックへの入力）」として保持する
    if (tbid || tname) {
      relations.push({
        ...base,
        recordType: 'rs_funding_relation',
        relationId: stableId([rowId, 'relation'], 'rsfundrel_'),
        sourceBlockId: sbid || null,
        sourceBlockName: sname,
        fromResponsibleOrganization: fromOrg,
        targetBlockId: tbid,
        targetBlockName: tname,
        note: (row['資金の流れの補足情報'] ?? '').trim(),
        sourceRowId: rowId,
        source,
      });
    }

    const cat = (row['国自らが支出する間接経費'] ?? '').trim();
    const item = (row['国自らが支出する間接経費の項目'] ?? '').trim();
    const amountRaw = (row['国自らが支出する間接経費の金額'] ?? '').trim();
    if (cat || item || amountRaw) {
      indirect.push({
        ...base,
        recordType: 'rs_indirect_expense',
        expenseId: stableId([rowId, 'indirect'], 'rsindirect_'),
        categoryRaw: cat,
        item,
        amountYen: parseNumber(amountRaw),
        amountRaw,
        sourceRowId: rowId,
        source,
      });
    }
  });

  return { relations, indirect };
}
