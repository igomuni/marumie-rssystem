/**
 * MOF（項・事項・目）× 概算要求（TOC・総表・明細表）の突合（M0〜M3）。契約は docs/tasks/*_MOF_x_BudgetRequest_Matching_Contract.md（事前登録済み）。
 * 名称は空白を除いた完全一致だけ。階層は TOC の見出しだけで決める。金額は選択に使わない（診断の列のみ）。
 */

/** 幅の統一（追補 B）: 全角の ASCII 相当（U+FF01〜FF5E）を ASCII に、半角のカナ・約物（U+FF61〜FF9F）を NFKC で全角に。それ以外の互換文字は変えない */
export const fold = (s: string): string => s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\uFF61-\uFF9F]+/g, m => m.normalize('NFKC'));
/** 名称の比較キー: 幅の統一のあと、空白（半角・全角）を除く */
export const ns = (s: string | undefined): string => fold(s ?? '').replace(/[\s\u3000]+/g, '');
/** コード中のハイフン類（U+2010〜2015, U+2212, U+FF0D, '-'）を '-' に揃える（コードの区切りの字形の違いだけを吸収する。名称には使わない） */
export const hy = (s: string): string => s.replace(/[‐-―−－]/g, '-');

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; }
    else if (c === ',') { row.push(field); field = ''; i++; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (c === '\r') { i++; }
    else { field += c; i++; }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
export type Rec = Record<string, string>;
export function readCsv(text: string): Rec[] {
  const [h, ...rest] = parseCsv(text.replace(/^﻿/, ''));
  return rest.filter(r => r.length > 1 || (r[0] ?? '') !== '').map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
/** "△1,234" → -1234、"1,234" → 1234、空 → null */
export function amount(s: string | undefined): number | null {
  const t = (s ?? '').replace(/[\s,]/g, '');
  if (t === '') return null;
  const neg = t.startsWith('△');
  const body = neg ? t.slice(1) : t;
  if (!/^\d+$/.test(body)) return null;
  return neg ? -Number(body) : Number(body);
}

// ---------------------------------------------------------------- 概算要求側の木（TOC）
export type Label = '所管' | '会計' | '組織' | '勘定' | '項';
const LABELS = new Set<string>(['所管', '会計', '組織', '勘定', '項']);
export interface TocKou { idx: number; slug: string; code: string; name: string; page: string; ministry: string | null; org: string | null; account: string | null; sub: string | null }
export interface TocJikou { slug: string; reqNo: string; first: string; class2: string; name: string; page: string; kouIdx: number | null }
export interface TocTree {
  slug: string;
  labels: { kind: Label; code: string; name: string; page: string }[];
  kous: TocKou[];
  jikous: TocJikou[];
  unclassified: number;
}
/** TOC の行（要求番号, 区分, ページ）を文書順に読み、見出しの直後の事項をその見出しの子にする。想定外の見出しの種類は例外 */
export function buildTocTree(slug: string, rows: Rec[]): TocTree {
  const t: TocTree = { slug, labels: [], kous: [], jikous: [], unclassified: 0 };
  let ministry: string | null = null, account: string | null = null, sub: string | null = null, org: string | null = null, kouIdx: number | null = null;
  for (const r of rows) {
    const kind = r['区分'] ?? '';
    const h = /^（([^）]*)）\s*(\S+)\s+(.+)$/.exec(kind);
    if (/^（/.test(kind) && !h) throw new Error(`STOP: ${slug} TOC の見出しが読めない: ${kind}`);
    if (h) {
      if (!LABELS.has(h[1])) throw new Error(`STOP: ${slug} TOC の見出しの種類が想定外: ${kind}`);
      const label = h[1] as Label, code = h[2], name = ns(h[3]);
      t.labels.push({ kind: label, code, name, page: r['ページ'] ?? '' });
      if (label === '所管') { ministry = name; account = null; sub = null; org = null; kouIdx = null; }
      else if (label === '会計') { account = name; sub = null; org = null; kouIdx = null; }
      else if (label === '勘定') { sub = name; org = null; kouIdx = null; }
      else if (label === '組織') { org = name; kouIdx = null; }
      else { kouIdx = t.kous.length; t.kous.push({ idx: kouIdx, slug, code, name, page: r['ページ'] ?? '', ministry, org, account, sub }); }
      continue;
    }
    const m = /^(\d{2})[‐-―−－-](\d{2})\s*(.+)$/.exec(kind);
    if (m && (r['要求番号'] ?? '') !== '') { t.jikous.push({ slug, reqNo: r['要求番号'], first: m[1], class2: m[2], name: ns(m[3]), page: r['ページ'] ?? '', kouIdx }); continue; }
    t.unclassified++;
  }
  return t;
}

// ---------------------------------------------------------------- MOF 側
export interface MofRows { kou: Rec[]; jikou: Rec[]; moku: Rec[] }
export interface MofSide { general: MofRows; special: MofRows }
const col = (r: Rec, pred: (k: string) => boolean): string => { const k = Object.keys(r).find(pred); return k ? r[k] : ''; };
export const mofAmountKou = (r: Rec): number | null => amount(col(r, k => /^令和.*年度(要求額|予定額).*の合計$/.test(k)));
export const mofAmountJikou = (r: Rec): number | null => amount(col(r, k => /^令和.*年度(要求額|予定額)/.test(k)));
export const mofAmountMoku = (r: Rec): number | null => amount(col(r, k => /^令和.*年度(要求額|予定額)$/.test(k)));
