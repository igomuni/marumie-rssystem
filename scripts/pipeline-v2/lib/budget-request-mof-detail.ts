/**
 * /budget-request-mof の詳細の事項・目: 概算要求側と MOF 側を名前でつなぐ。仕様: docs/budget-request-mof-ui.md
 */

/** 片側の 1 行（目はコード付き）。額は千円、空欄は null */
export type Side = { name: string; code?: string; amt: number | null };
/** つないだ行: [名前, コード, 要求額, 当初予算額]。無い側は null（その側に名前が無い） */
export type Pair = [string, string, number | null, number | null];

const add = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : a + b);

/** 名前で集計する（同じ名前の行の額を足す。コードは最初の行のもの）。出現順を保つ */
function byName(rows: readonly Side[]): Map<string, { code: string; amt: number | null }> {
  const m = new Map<string, { code: string; amt: number | null }>();
  for (const r of rows) {
    const e = m.get(r.name);
    if (e) e.amt = add(e.amt, r.amt);
    else m.set(r.name, { code: r.code ?? '', amt: r.amt });
  }
  return m;
}

/**
 * 要求側と MOF 側を名前でつなぐ。並びは MOF の順。要求にだけある行は、同じコードの MOF の行の最後の後ろに置き、
 * 同じコードが無ければ末尾に要求の順で置く（コードは分類で 1 つのコードに複数の行が入るので、名前の違う行を組にはしない）。
 */
export function pairByName(req: readonly Side[], mof: readonly Side[]): Pair[] {
  const R = byName(req), M = byName(mof);
  const out: Pair[] = [...M].map(([n, e]) => [n, e.code, R.has(n) ? R.get(n)!.amt ?? 0 : null, e.amt ?? 0]);
  for (const [n, e] of R) {
    if (M.has(n)) continue;
    const row: Pair = [n, e.code, e.amt ?? 0, null];
    let at = -1;
    if (e.code) for (let i = 0; i < out.length; i++) if (out[i][1] === e.code) at = i;
    if (at < 0) out.push(row); else out.splice(at + 1, 0, row);
  }
  return out;
}

/**
 * 目のコード（主要経費＋目的別-目別。例: 95016-02）。中段（財政法・経済性質・使途）は、特別会計の要求書の原文と MOF とで桁の取り方が
 * 違う（要求書 65061-9-18、MOF は財政法の列が無い）ので使わない。並べる位置と表示にだけ使う
 */
export const mofMokuCode = (r: Record<string, string>): string => `${r['主要経費別分類コード']}${r['目的別分類コード']}-${r['目別分類コード']}`;
/** 要求書の目のコード（原文。例: 95016-2111-02-0000）から、mofMokuCode と同じ形を取る。複数のコードが「、」で並ぶときは最初のもの */
export const reqMokuCode = (s: string): string => { const p = s.split('、')[0].split('-'); return p.length >= 3 ? `${p[0]}-${p[2]}` : ''; };
