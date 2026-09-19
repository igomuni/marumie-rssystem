/**
 * Pipeline V2用の汎用CSVパーサ（クォート対応）。
 *
 * RS CSVは自由記述列（事業の目的・契約概要等）にカンマや改行を含みうるため、
 * MOF側で使っている単純な`split(',')`（scripts/mof-budget-csv.ts）は使えない。
 */

/** BOMを除去し、ヘッダー行をキーにしたレコード配列を返す */
export function parseCsv(content: string): Record<string, string>[] {
  const rows = parseRows(content.replace(/^﻿/, ''));
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map(cells => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) row[h] = cells[i] ?? ''; });
    return row;
  });
}

/** クォート・改行入りセルに対応したCSVパース（RFC4180準拠の最小実装） */
function parseRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // CR単独・CRLFのどちらも行区切りとして終端する（CRのみ改行のファイルも対応）。
      // CRLFの場合はLFを消費して二重に行が終わらないようにする
      row.push(field);
      field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      if (next === '\n') i++;
    } else if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}

/** 金額文字列を数値に変換する。カンマ・空欄に対応し、非数値は0 */
export function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}
