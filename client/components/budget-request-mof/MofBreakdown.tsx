'use client';

import type { BudgetRequestMofDetail, BudgetRequestMofRow } from '@/types/budget-request-mof';
import { changeColor, formatSen, formatSenSigned } from '@/client/components/budget-request-trend/format';

const th = 'px-1.5 py-1 font-medium';
const num = 'whitespace-nowrap px-1.5 py-1 text-right tabular-nums';
const NAME_COL = 'sticky left-0 z-[1] min-w-[8rem] bg-white dark:bg-neutral-900';

/** 名前で事項・目をつないだ表（要求額・当初予算額・差）。片側にしか無い行は、無い側を「—」にして印を付ける */
export function MofBreakdown({ row, d, what }: { row: BudgetRequestMofRow; d: BudgetRequestMofDetail; what: 'jikou' | 'moku' }) {
  const ps = what === 'jikou' ? d.j : d.m;
  const label = what === 'jikou' ? '事項' : '目';
  if (ps.length === 0) return <p className="text-neutral-500">{label}が取れていません。</p>;
  const sum = (i: 2 | 3) => (ps.some(p => p[i] !== null) ? ps.reduce((s, p) => s + (p[i] ?? 0), 0) : null);
  const req = sum(2), mof = sum(3);
  // 片側にしか無い印は、両側がそろう行（対応あり）で、要求側の内訳が取れているときだけ
  const onlyOf = (p: BudgetRequestMofDetail['m'][number]) => (d.noReq || row.req === null || row.mof === null ? null : p[2] === null ? '予算のみ' : p[3] === null ? '要求のみ' : null);
  const n = (k: string | null) => ps.filter(p => onlyOf(p) === k).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-neutral-500">
        {row.req !== null && row.mof !== null && !d.noReq ? `${label}名でつないだもの（両方 ${n(null)}・要求のみ ${n('要求のみ')}・予算のみ ${n('予算のみ')}）。` : ''}
        {what === 'moku' ? '要求の目は事項をまたいで足してある（予算書の目は項ごと）。コードは主要経費＋目的別-目別で、同じコードの目を隣に並べる（名前の違う目を組にはしない）。' : '予算書の事項は項の中の事項。'}
      </p>
      {d.noReq && <p className="text-[11px] text-amber-700 dark:text-amber-400">要求側の{label}が取れていません（要求書の明細表につながらない項）。</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse">
          <thead>
            <tr className="text-[11px] text-neutral-500">
              <th className={`${th} ${NAME_COL} text-left`}>{label}</th>
              <th className={`${th} text-right`}>概算要求</th>
              <th className={`${th} text-right`}>当初予算</th>
              <th className={`${th} text-right`}>差</th>
            </tr>
          </thead>
          <tbody>
            {ps.map(([name, code, r, m]) => {
              const diff = r !== null && m !== null ? m - r : null;
              const only = onlyOf([name, code, r, m]);
              return (
                <tr key={`${name}|${code}`} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className={`px-1.5 py-1 ${NAME_COL}`}>
                    {name}
                    {only && <span className={`ml-1 whitespace-nowrap text-[10px] ${only === '予算のみ' ? 'text-sky-700 dark:text-sky-400' : 'text-amber-700 dark:text-amber-400'}`}>{only}</span>}
                    {code && <span className="block text-[10px] tabular-nums text-neutral-400">{code}</span>}
                  </td>
                  <td className={num}>{r === null ? '—' : formatSen(r)}</td>
                  <td className={num}>{m === null ? '—' : formatSen(m)}</td>
                  <td className={`${num} ${changeColor(diff)}`}>{formatSenSigned(diff)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-neutral-300 font-semibold dark:border-neutral-700">
              <td className={`px-1.5 py-1 ${NAME_COL}`}>計</td>
              <td className={num}>{formatSen(req)}</td>
              <td className={num}>{formatSen(mof)}</td>
              <td className={`${num} ${changeColor(req !== null && mof !== null ? mof - req : null)}`}>{formatSenSigned(req !== null && mof !== null ? mof - req : null)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Check label={label} req={req} mof={mof} row={row} />
    </div>
  );
}

/** Σ と項の額の検算。合わないときだけ出す */
function Check({ label, req, mof, row }: { label: string; req: number | null; mof: number | null; row: BudgetRequestMofRow }) {
  const off = (a: number | null, b: number | null) => a !== null && b !== null && a !== b;
  if (!off(req, row.req) && !off(mof, row.mof)) return null;
  return (
    <p className="text-[11px] text-neutral-500">
      {off(req, row.req) && `要求側の${label}の計は項の要求額と ${formatSenSigned((req ?? 0) - (row.req ?? 0))} 違う（明細表の読み取りの欠け・額の空き、または同じ項が複数の書に載る場合）。`}
      {off(mof, row.mof) && `予算書の${label}の計は項の当初予算額と ${formatSenSigned((mof ?? 0) - (row.mof ?? 0))} 違う。`}
    </p>
  );
}
