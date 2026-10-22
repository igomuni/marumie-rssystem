'use client';

import type { BudgetRequestTrendDetailData, BudgetRequestTrendDetailKou, BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { jikouKeyOf, yearOf } from '@/app/lib/budget-request-trend';
import { changeColor, formatSen, formatSenSigned } from './format';

/** 検算の状態（一致以外）の説明。仕様: docs/budget-request-trend-detail-csv.md */
const STATUS_NOTE: Record<string, string> = {
  不一致: '目の合計が事項の額と合わない',
  額の空きあり: '額の取れない目がある',
  目なし: '目が取れていない',
  画像の頁: '頁が画像で、目が取れていない',
  事項の額なし: '総表に無い事項（額なし）',
};

/** 項のその年度の内訳。キーは事項要求と同じ（会計区分 | 所管 | 勘定 | 組織 | 項名）。名前・所属が年度で変わった年度は引けない */
export const breakdownOf = (detail: BudgetRequestTrendDetailData | null, row: BudgetRequestTrendRow, y: number): BudgetRequestTrendDetailKou | undefined =>
  detail?.years[String(y)]?.[jikouKeyOf(row)];

const th = 'px-1.5 py-1 font-medium';
const num = 'whitespace-nowrap px-1.5 py-1 text-right tabular-nums';

function Missing({ year }: { year: number }) {
  return <p className="text-neutral-500">FY{year} の内訳はありません（この年度の要求書に無い、明細表が取れていない、または項の名前・所属がこの年度で違う）。</p>;
}

/**
 * 年度の表: 行 = 事項・目、列 = 年度の要求額。列の年度を押すと年度が切り替わる。最後に計（項の要求額と合わなければ色付き）。
 * value が undefined の年度は、その行がその年度に無い
 */
function YearMatrix({ row, years, year, onSelectYear, head, keys, label, badge, value, has, totalLabel }: {
  row: BudgetRequestTrendRow; years: readonly number[]; year: number; onSelectYear: (y: number) => void;
  head: string; keys: string[]; label: (k: string) => string; badge?: (k: string) => React.ReactNode;
  value: (y: number, k: string) => number | null | undefined; has: (y: number) => boolean; totalLabel: string;
}) {
  const hl = (y: number) => (y === year ? 'bg-emerald-50 dark:bg-emerald-950/40' : '');
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[11px] text-neutral-500">
            <th className={`${th} text-left`}>{head}</th>
            {years.map(y => (
              <th key={y} onClick={() => onSelectYear(y)} className={`${th} cursor-pointer text-right ${y === year ? 'bg-emerald-50 text-neutral-900 dark:bg-emerald-950/40 dark:text-neutral-100' : ''}`}>{y}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map(k => (
            <tr key={k} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="px-1.5 py-1">{label(k)}{badge?.(k)}</td>
              {years.map(y => { const v = value(y, k); return <td key={y} className={`${num} ${hl(y)}`}>{v === undefined ? <span className="text-neutral-400">–</span> : formatSen(v)}</td>; })}
            </tr>
          ))}
          <tr className="border-t border-neutral-300 font-medium dark:border-neutral-600">
            <td className="px-1.5 py-1">{totalLabel}</td>
            {years.map(y => {
              if (!has(y)) return <td key={y} className={`${num} ${hl(y)}`}><span className="text-neutral-400">–</span></td>;
              const s = keys.reduce((t, k) => t + (value(y, k) ?? 0), 0); const kou = yearOf(row, y)?.req ?? null;
              return <td key={y} title={s !== kou ? `項の要求額 ${formatSen(kou)} と合わない` : undefined} className={`${num} ${hl(y)} ${s !== kou ? 'text-amber-700 dark:text-amber-400' : ''}`}>{formatSen(s)}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 並び: 選択中の年度の順、続けてほかの年度にだけあるもの（新しい年度から） */
const orderKeys = (years: readonly number[], year: number, keysOf: (y: number) => string[]): string[] => {
  const out: string[] = [];
  for (const y of [year, ...[...years].reverse()]) for (const k of keysOf(y)) if (!out.includes(k)) out.push(k);
  return out;
};

/** 事項の年度推移（行 = 事項名、列 = 年度の要求額。総表の値）と、選択中の年度の事項ごとの目 */
export function JikouTab({ row, years, year, detail, onSelectYear }: { row: BudgetRequestTrendRow; years: readonly number[]; year: number; detail: BudgetRequestTrendDetailData; onSelectYear: (y: number) => void }) {
  const byYear = new Map(years.map(y => [y, breakdownOf(detail, row, y)]));
  if (![...byYear.values()].some(Boolean)) return <Missing year={year} />;
  const names = orderKeys(years, year, y => (byYear.get(y)?.j ?? []).map(j => j[1]));
  const cell = (y: number, name: string) => byYear.get(y)?.j.find(j => j[1] === name);
  const cur = byYear.get(year);
  const odd = cur?.j.filter(j => j[5] !== '一致') ?? [];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-neutral-500">事項ごとの要求額（総表の値）。列の年度を押すと、その年度に切り替わります。選択中の年度は色付き。</p>
      <YearMatrix row={row} years={years} year={year} onSelectYear={onSelectYear} head="事項" keys={names} label={n => n} totalLabel="事項の計"
        badge={n => { const c = cell(year, n); return c && c[5] !== '一致' ? <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400" title={STATUS_NOTE[c[5]]}>{c[5]}</span> : null; }}
        value={(y, n) => { const c = cell(y, n); return c ? c[3] : undefined; }} has={y => !!byYear.get(y)} />
      {odd.length > 0 && (
        <div className="rounded border-l-[3px] border-amber-600 bg-amber-50 px-2.5 py-1.5 text-neutral-800 dark:bg-amber-950/40 dark:text-neutral-200">
          {odd.map(j => <p key={j[1]}>FY{year}「{j[1]}」: {STATUS_NOTE[j[5]] ?? j[5]}{j[4] !== null ? `（目の合計 ${formatSen(j[4])}、事項の額 ${formatSen(j[3])}）` : ''}。</p>)}
        </div>
      )}
      {cur ? <MokuByJikou b={cur} year={year} /> : <Missing year={year} />}
    </div>
  );
}

/** 選択中の年度の目を事項ごとに: 目の前年度予算額・要求額・増減（事項タブの下段） */
function MokuByJikou({ b, year }: { b: BudgetRequestTrendDetailKou; year: number }) {
  const groups = [...(b.m.some(m => m[0] === -1) ? [-1] : []), ...b.j.map((_, i) => i)];
  const fromSub = b.m.some(m => m[5] > 0), blanks = b.m.some(m => m[6] > 0);
  // 目の数は、タブのラベル・一覧の列と同じく、事項をまたいで目名 + 目別で数える
  const nMoku = new Set(b.m.map(m => `${m[1]}|${m[2]}`)).size;
  return (
    <div className="flex flex-col gap-3">
      <p className="mt-1 text-[11px] font-semibold text-neutral-500">FY{year} の事項ごとの目（事項 {b.j.length}・目 {nMoku}{b.m.length !== nMoku ? `。2 つ以上の事項にまたがる目があり、下は ${b.m.length} 行` : ''}。同じ事項の中の同じ目は足してある）</p>
      {groups.map(gi => {
        const ms = b.m.filter(m => m[0] === gi); const j = gi >= 0 ? b.j[gi] : null;
        return (
          <div key={gi}>
            <h3 className="mb-0.5 flex justify-between gap-2 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
              <span>{j ? j[1] : '（事項の行より前の目）'}</span>
              {j && <span className="shrink-0 tabular-nums">{formatSen(j[3])}</span>}
            </h3>
            {ms.length === 0 ? <p className="text-neutral-500">目が取れていません。</p> : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[11px] text-neutral-500">
                    <th className={`${th} text-left`}>目</th>
                    <th className={`${th} text-right`}>前年度予算額</th>
                    <th className={`${th} text-right`}>要求額</th>
                    <th className={`${th} text-right`}>増減</th>
                  </tr>
                </thead>
                <tbody>
                  {ms.map(m => {
                    const ch = m[4] !== null && m[3] !== null ? m[4] - m[3] : null;
                    return (
                      <tr key={`${m[1]}-${m[2]}`} className="border-t border-neutral-100 dark:border-neutral-800">
                        <td className="px-1.5 py-1">
                          {m[1]}
                          {m[5] > 0 && <sup className="ml-0.5 text-neutral-400" title="目の行が空欄で、細分の合計">※</sup>}
                          {m[6] > 0 && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">額なしの行 {m[6]}</span>}
                        </td>
                        <td className={num}>{formatSen(m[3])}</td>
                        <td className={num}>{formatSen(m[4])}</td>
                        <td className={`${num} ${changeColor(ch)}`}>{formatSenSigned(ch)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <MokuFootnote fromSub={fromSub} blanks={blanks} />
    </div>
  );
}

function MokuFootnote({ fromSub, blanks }: { fromSub: boolean; blanks: boolean }) {
  if (!fromSub && !blanks) return null;
  return (
    <p className="text-[11px] text-neutral-500">
      {fromSub && '※ 目の行が空欄で、下の細分（職員俸給など）の合計を目の額にしたもの。'}
      {blanks && '額なしの行: 明細表で額の取れない目の行（列の決まらない行など）。'}
    </p>
  );
}

/** 選択中の年度の目を項全体で集計（目名 + 目別で、事項をまたいで足す）。各目の下に事項ごとの内訳 */
export function MokuTab({ row, years, year, detail, onSelectYear }: { row: BudgetRequestTrendRow; years: readonly number[]; year: number; detail: BudgetRequestTrendDetailData; onSelectYear: (y: number) => void }) {
  const b = breakdownOf(detail, row, year);
  if (!b) return <Missing year={year} />;
  type G = { name: string; prev: number | null; req: number | null; fromSub: number; blanks: number; parts: { jikou: string; prev: number | null; req: number | null }[] };
  const groups = new Map<string, G>();
  for (const m of b.m) {
    const k = `${m[1]}|${m[2]}`;
    const g = groups.get(k) ?? groups.set(k, { name: m[1], prev: null, req: null, fromSub: 0, blanks: 0, parts: [] }).get(k)!;
    if (m[3] !== null) g.prev = (g.prev ?? 0) + m[3];
    if (m[4] !== null) g.req = (g.req ?? 0) + m[4];
    g.fromSub += m[5]; g.blanks += m[6];
    g.parts.push({ jikou: m[0] >= 0 ? b.j[m[0]][1] : '（事項の行より前の目）', prev: m[3], req: m[4] });
  }
  const list = [...groups.values()];
  const total = (f: 'prev' | 'req') => list.reduce((t, g) => t + (g[f] ?? 0), 0);
  const kouReq = yearOf(row, year)?.req ?? null;
  // 年度の表: 目名 + 目別ごとに、事項をまたいで足した要求額
  const sums = new Map(years.map(y => { const bb = breakdownOf(detail, row, y); const m = new Map<string, number | null>(); for (const x of bb?.m ?? []) { const k = `${x[1]}|${x[2]}`; m.set(k, x[4] === null ? m.get(k) ?? null : (m.get(k) ?? 0) + x[4]); } return [y, bb ? m : null]; }));
  const keys = orderKeys(years, year, y => [...(sums.get(y)?.keys() ?? [])]);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-neutral-500">目ごとの要求額（項の中の同じ目を事項をまたいで足した額）。列の年度を押すと、その年度に切り替わります。選択中の年度は色付き。</p>
      <YearMatrix row={row} years={years} year={year} onSelectYear={onSelectYear} head="目" keys={keys} label={k => k.split('|')[0]} totalLabel="目の計"
        value={(y, k) => { const m = sums.get(y); return m && m.has(k) ? m.get(k)! : undefined; }} has={y => !!sums.get(y)} />
      <p className="mt-1 text-[11px] font-semibold text-neutral-500">FY{year} の目（目 {list.length}）と事項ごとの内訳</p>
      <p className="text-[11px] text-neutral-500">項の中の同じ目（目名 + 目別）を事項をまたいで足した額。各目の下は事項ごとの内訳（2 つ以上の事項にまたがる目だけ）。</p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[11px] text-neutral-500">
            <th className={`${th} text-left`}>目</th>
            <th className={`${th} text-right`}>前年度予算額</th>
            <th className={`${th} text-right`}>要求額</th>
            <th className={`${th} text-right`}>増減</th>
          </tr>
        </thead>
        <tbody>
          {list.map(g => {
            const ch = g.req !== null && g.prev !== null ? g.req - g.prev : null;
            return [
              <tr key={g.name} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-1.5 py-1">
                  {g.name}
                  {g.fromSub > 0 && <sup className="ml-0.5 text-neutral-400" title="目の行が空欄で、細分の合計">※</sup>}
                  {g.blanks > 0 && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">額なしの行 {g.blanks}</span>}
                  {g.parts.length === 1 && <span className="block text-[10px] text-neutral-400">{g.parts[0].jikou}</span>}
                </td>
                <td className={num}>{formatSen(g.prev)}</td>
                <td className={num}>{formatSen(g.req)}</td>
                <td className={`${num} ${changeColor(ch)}`}>{formatSenSigned(ch)}</td>
              </tr>,
              ...(g.parts.length > 1 ? g.parts.map((p, i) => (
                <tr key={`${g.name}-${i}`} className="text-[11px] text-neutral-500">
                  <td className="py-0.5 pl-4 pr-1.5">{p.jikou}</td>
                  <td className="whitespace-nowrap px-1.5 py-0.5 text-right tabular-nums">{formatSen(p.prev)}</td>
                  <td className="whitespace-nowrap px-1.5 py-0.5 text-right tabular-nums">{formatSen(p.req)}</td>
                  <td />
                </tr>
              )) : []),
            ];
          })}
          <tr className="border-t border-neutral-300 font-medium dark:border-neutral-600">
            <td className="px-1.5 py-1">目の計</td>
            <td className={num}>{formatSen(total('prev'))}</td>
            <td className={`${num} ${kouReq !== null && total('req') !== kouReq ? 'text-amber-700 dark:text-amber-400' : ''}`} title={kouReq !== null && total('req') !== kouReq ? `項の要求額 ${formatSen(kouReq)} と合わない` : undefined}>{formatSen(total('req'))}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <MokuFootnote fromSub={list.some(g => g.fromSub > 0)} blanks={list.some(g => g.blanks > 0)} />
    </div>
  );
}
