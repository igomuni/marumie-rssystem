'use client';

import type { BudgetRequestMofRow } from '@/types/budget-request-mof';
import { AccountBadge } from '@/client/components/mof-kou/Badge';
import { KIND_LABEL, diffOf, groupOf, isJoint, orgOf, publishersOf, rateOf } from '@/app/lib/budget-request-mof';
import { publisherOf } from '@/app/lib/budget-request-trend';
import { changeColor, formatRate, formatSen, formatSenSigned } from '@/client/components/budget-request-trend/format';
import { TYPE_INFO } from './typeInfo';

const KIND_NOTE: Record<BudgetRequestMofRow['kind'], string> = {
  matched: '',
  mofOnly: '予算書（MOF）にあり、概算要求書に対応する項がありません。編成で新設・統合された項、または概算要求書が取り込めていない所管（法務省 FY2023・2024 など）の項です。',
  reqOnly: '概算要求書にあり、予算書（MOF）に同じ名前の項がありません。編成で統合・改称された項や、要求段階だけの項（推進費への一括など）です。',
  zero: '前年度予算額・要求額とも 0 と印字された項です（要求書は額のない科目も載せます）。',
};

export function MofDetailPane({ row, urls, version }: { row: BudgetRequestMofRow | null; urls: readonly string[]; version: string }) {
  if (!row) return <p className="p-4 text-center text-xs text-neutral-500">一覧から項を選ぶと、要求額と当初予算額、元の PDF へのリンクが出ます。</p>;
  const d = diffOf(row), t = rateOf(row);
  const cell = 'px-2 py-1 text-right tabular-nums';
  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-neutral-500">
          <AccountBadge accountType={row.acct === 0 ? 'general' : 'special'} />
          <span>{groupOf(row, urls)}{row.acct === 1 ? ` › ${row.min}特別会計` : ''}{orgOf(row) ? ` › ${orgOf(row)}` : ''} · FY{row.y}</span>
        </div>
        <h2 className="mt-1 text-sm font-semibold">{row.name}</h2>
        {row.mofName && <p className="text-[11px] text-neutral-500">予算書の項名: {row.mofName}</p>}
        {isJoint(row, urls) && <p className="text-[11px] text-neutral-500">所管の府省: {publishersOf(row, urls).join('、')}</p>}
        {row.kind !== 'matched' && <p className="mt-1 text-[11px] text-neutral-500"><b>{KIND_LABEL[row.kind]}</b>: {KIND_NOTE[row.kind]}</p>}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 text-[11px] text-neutral-500 dark:border-neutral-800">
            <th className="px-2 py-1 text-left font-normal" />
            <th className="px-2 py-1 text-right font-normal">概算要求</th>
            <th className="px-2 py-1 text-right font-normal">当初予算（{version}）</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-100 dark:border-neutral-800"><td className="px-2 py-1 text-neutral-500">FY{row.y} の額</td><td className={cell}>{formatSen(row.req)}</td><td className={cell}>{formatSen(row.mof)}</td></tr>
          <tr className="border-b border-neutral-100 dark:border-neutral-800"><td className="px-2 py-1 text-neutral-500">前年度予算額</td><td className={cell}>{formatSen(row.reqPrev)}</td><td className={cell}>{formatSen(row.mofPrev)}</td></tr>
          <tr><td className="px-2 py-1 text-neutral-500">差（当初 − 要求）</td><td className={`${cell} ${changeColor(d)}`} colSpan={2}>{formatSenSigned(d)}（{formatRate(t)}）</td></tr>
        </tbody>
      </table>
      {row.books.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold text-neutral-500">概算要求書</h3>
          <ul className="flex flex-col gap-0.5">
            {row.books.map(([u, page, pdf, amt]) => (
              <li key={`${u}-${page}`} className="flex justify-between gap-2">
                <a href={`${urls[u]}${pdf ? `#page=${pdf}` : ''}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{publisherOf(urls[u])}（{page}）</a>
                {row.books.length > 1 && <span className="tabular-nums text-neutral-500">{formatSen(amt)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {row.types.length > 0 && (
        <div className="flex flex-col gap-1 rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-neutral-700 dark:bg-amber-950/30 dark:text-neutral-300">
          {row.types.map(x => <p key={x}><b>{x}</b>: {TYPE_INFO[x].text}{x === '事項要求' && row.jikouText ? `。備考:「${row.jikouText}」` : ''}</p>)}
        </div>
      )}
    </div>
  );
}
