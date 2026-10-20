'use client';

import type { BudgetRequestTrendRow } from '@/types/budget-request-trend';
import { AccountBadge } from '@/client/components/mof-kou/Badge';
import { assessmentGap, groupOf, orgOf, publisherOf, yearOf } from '@/app/lib/budget-request-trend';
import { changeColor, formatSen, formatSenSigned } from './format';

const W = 380, H = 180, LEFT = 74, BOTTOM = 22, TOP = 10, BAR = 34;

export function TrendDetailPane({
  row,
  years,
  year,
  urls,
  rows,
  onSelectRow,
  onSelectYear,
}: {
  row: BudgetRequestTrendRow | null;
  years: readonly number[];
  year: number;
  urls: readonly string[];
  /** 全行（紐づけ候補の行を引く） */
  rows: readonly BudgetRequestTrendRow[];
  onSelectRow: (r: BudgetRequestTrendRow) => void;
  /** グラフの年度・年度の表の行をクリックしたとき、一覧の年度を切り替える */
  onSelectYear: (y: number) => void;
}) {
  if (!row) {
    return <p className="p-6 text-center text-xs text-neutral-500">一覧から項を選ぶと、全年度の推移とグラフ、元の PDF へのリンクが出ます。</p>;
  }
  const present = years.filter(y => yearOf(row, y));
  const first = years[0], last = years[years.length - 1];
  const max = Math.max(1, ...present.flatMap(y => [yearOf(row, y)?.req ?? 0, yearOf(row, y)?.prev ?? 0]));
  const plotH = H - BOTTOM - TOP;
  const gap = (W - LEFT - 10 - years.length * BAR) / (years.length - 1);
  const h = (v: number | null) => ((v ?? 0) / max) * plotH;
  const notes: string[] = [];
  if (yearOf(row, last) && !yearOf(row, last - 1)) notes.push(`FY${last - 1} に同じキーが無く、FY${last} で初めて出ました。新設の項か、名称変更の可能性があります（紐づけは未対応）。`);
  if (!yearOf(row, last) && yearOf(row, last - 1)) notes.push(`FY${last} に同じキーが無い項です。廃止、名称変更、または FY${last} の未収録（例: 厚生労働省）の可能性があります。`);
  if (present.some(y => (yearOf(row, y)?.src.length ?? 0) > 1)) notes.push('同じ項が複数の要求書に載っている年度があります。額が同じ書どうしは按分されておらず、所管をまたいだ合計では二重になります。');
  for (const y of present) {
    const e = yearOf(row, y)!;
    if (e.moved) notes.push(`FY${y}: 前の項（${e.moved.from}）から${e.moved.kind === '移管' ? '移管された' : '改称・組織変更された'}項としてつないでいます（${e.moved.kind === '移管' ? '移管先の会計・勘定がこの年度に新設' : '所管・勘定は同じ'}、同名に近く、前年度予算額が前年の要求額に近い）。`);
    if (e.newAcct) notes.push(`FY${y}: ${row.min}${row.sub ? `（${row.sub}）` : ''}はこの年度に初めて現れた会計・勘定です（corpus に前年度の書が無いだけの場合もあります）。`);
  }
  const xfers = [...new Set(present.flatMap(y => yearOf(row, y)?.xfer ?? []))];
  if (xfers.length > 0) notes.push(`この項の目に繰入があります（${xfers.join('、')}）。受け側の会計にも載るため、会計をまたぐ合計では二重になりえます。`);
  if (present.some(y => yearOf(row, y)?.mismatch)) notes.push('同じキーで、要求書によって額が違う年度があります（各書が取り分だけを載せている場合は、最も大きい額＝合計書の額を表示しています）。各書の額は PDF の右に示します。');

  // 所管コードは年度で変わることがある（例: 年金特会 9207 → 2507）。年度順に、変わった所で区切って示す
  const codes = present.reduce<string[]>((acc, y) => { const c = yearOf(row, y)?.code ?? ''; if (c && acc[acc.length - 1] !== c) acc.push(c); return acc; }, []);
  // 紐づけの候補: 同名で、翌年度に新規の項の前年度予算額が、この項の要求額に近い（キーは別のまま）
  const links = present.flatMap(y => {
    const a = yearOf(row, y)!;
    const out: { text: string; target: BudgetRequestTrendRow }[] = [];
    if (a.from !== undefined && rows[a.from]) { const t = rows[a.from], b = yearOf(t, y - 1); out.push({ text: `FY${y - 1} の「${t.name}」（${groupOf(t, y - 1, urls)}${orgOf(t) ? ` › ${orgOf(t)}` : ''}、要求額 ${formatSen(b?.req ?? null)}）が、FY${y} の前年度予算額 ${formatSen(a.prev)} と近い同名の項です`, target: t }); }
    if (a.to !== undefined && rows[a.to]) { const t = rows[a.to], b = yearOf(t, y + 1); out.push({ text: `FY${y + 1} に新規の「${t.name}」（${groupOf(t, y + 1, urls)}${orgOf(t) ? ` › ${orgOf(t)}` : ''}、前年度予算額 ${formatSen(b?.prev ?? null)}）が、FY${y} の要求額 ${formatSen(a.req)} と近い同名の項です`, target: t }); }
    return out;
  });

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-neutral-500">
          <AccountBadge accountType={row.acct === 0 ? 'general' : 'special'} />
          <span>{groupOf(row, year, urls)}{orgOf(row) ? ` › ${orgOf(row)}` : ''} · 所管コード {codes.length > 0 ? codes.join(' → ') : row.code}</span>
        </div>
        <h2 className="mt-0.5 text-base font-semibold leading-snug">{row.name}{row.kou && <span className="ml-1 text-xs font-normal text-neutral-400">(項コード {row.kou})</span>}</h2>
      </div>
      <div className="flex flex-wrap gap-x-4 text-[11px] text-neutral-500">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 bg-emerald-700 align-[-1px] dark:bg-emerald-400" />要求額</span>
        <span><i className="mr-1 inline-block h-0.5 w-3 bg-neutral-400 align-middle" />前年度予算額（その年度の要求書が載せる値）</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="年度ごとの要求額と前年度予算額">
        {[0, 0.5, 1].map(f => {
          const y = H - BOTTOM - f * plotH;
          return (
            <g key={f}>
              <line x1={LEFT} x2={W - 4} y1={y} y2={y} className="stroke-neutral-200 dark:stroke-neutral-700" />
              <text x={LEFT - 4} y={y + 3} textAnchor="end" className="fill-neutral-500 text-[10px]">{formatSen(max * f)}</text>
            </g>
          );
        })}
        {years.map((y, i) => {
          const a = yearOf(row, y);
          const x = LEFT + i * (BAR + gap);
          const selected = y === year;
          return (
            <g key={y} onClick={() => onSelectYear(y)} className="cursor-pointer">
              <rect x={x - gap / 2} y={0} width={BAR + gap} height={H} fill="transparent" />
              {a ? (
                <>
                  <rect x={x} y={H - BOTTOM - h(a.req)} width={BAR} height={h(a.req)} className="fill-emerald-700 dark:fill-emerald-400" opacity={selected ? 1 : 0.6} />
                  {a.prev !== null && (
                    <line x1={x - 3} x2={x + BAR + 3} y1={H - BOTTOM - h(a.prev)} y2={H - BOTTOM - h(a.prev)} strokeWidth={2.4} strokeDasharray="4 2" className="stroke-neutral-400" />
                  )}
                </>
              ) : (
                <text x={x + BAR / 2} y={H - BOTTOM - 6} textAnchor="middle" className="fill-neutral-500 text-[10px]">–</text>
              )}
              <text x={x + BAR / 2} y={H - 6} textAnchor="middle" className={`text-[10px] ${selected ? 'fill-neutral-900 font-semibold dark:fill-neutral-100' : 'fill-neutral-500'}`}>{y}</text>
            </g>
          );
        })}
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[11px] text-neutral-500">
              <th className="px-1.5 py-1 text-left font-medium">年度</th>
              <th className="px-1.5 py-1 text-right font-medium">前年度予算額</th>
              <th className="px-1.5 py-1 text-right font-medium">要求額</th>
              <th className="px-1.5 py-1 text-right font-medium">増減</th>
              <th className="px-1.5 py-1 text-right font-medium" title="翌年度の要求書が載せる前年度予算額 − その年度の要求額（要求→予算の査定）">査定差</th>
              <th className="px-1.5 py-1 text-left font-medium">元の要求書（頁）</th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => {
              const a = yearOf(row, y);
              const hl = y === year ? 'bg-emerald-50 dark:bg-emerald-950/40' : '';
              if (!a) {
                return (
                  <tr key={y} onClick={() => onSelectYear(y)} className={`cursor-pointer border-t border-neutral-100 dark:border-neutral-800 ${hl}`}>
                    <td className="px-1.5 py-1">FY{y}</td>
                    <td colSpan={5} className="px-1.5 py-1 text-neutral-500">この年度の要求書に載っていません</td>
                  </tr>
                );
              }
              const ch = a.req !== null && a.prev !== null ? a.req - a.prev : null;
              const gapV = assessmentGap(row, y);
              return (
                <tr key={y} onClick={() => onSelectYear(y)} className={`cursor-pointer border-t border-neutral-100 dark:border-neutral-800 ${hl}`}>
                  <td className="px-1.5 py-1">FY{y}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{formatSen(a.prev)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{formatSen(a.req)}</td>
                  <td className={`whitespace-nowrap px-1.5 py-1 text-right tabular-nums ${changeColor(ch)}`}>{formatSenSigned(ch)}</td>
                  <td className={`whitespace-nowrap px-1.5 py-1 text-right tabular-nums ${changeColor(gapV)}`}>{formatSenSigned(gapV)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1">
                    {a.src.map(([u, page, pdfPage], i) => (
                      <span key={u} className="mr-1.5">
                        <a onClick={e => e.stopPropagation()} href={pdfPage ? `${urls[u]}#page=${pdfPage}` : urls[u]} target="_blank" rel="noopener noreferrer" title={urls[u]} className="text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-400">
                          {publisherOf(urls[u])}
                        </a>
                        <span className="text-neutral-500"> ({page})</span>
                        {a.srcAmt?.[i] && <span className="text-neutral-400"> {formatSen(a.srcAmt[i][1])}</span>}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-500">査定差 = 翌年度の「前年度予算額」− その年度の要求額（負なら要求より予算が少ない）。選択中の年度は色付き。FY{first}〜FY{last}。</p>
      {links.length > 0 && (
        <div className="rounded border-l-[3px] border-sky-600 bg-sky-50 px-2.5 py-1.5 text-neutral-800 dark:bg-sky-950/40 dark:text-neutral-200">
          <p className="font-medium">紐づけの候補（キーは別の行のまま）</p>
          {links.map(l => (
            <p key={l.text} className="mt-0.5">
              {l.text}。<button type="button" onClick={() => onSelectRow(l.target)} className="text-sky-700 underline hover:text-sky-900 dark:text-sky-400">その項を開く</button>
            </p>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="rounded border-l-[3px] border-amber-600 bg-amber-50 px-2.5 py-1.5 text-neutral-800 dark:bg-amber-950/40 dark:text-neutral-200">
          {notes.map(n => <p key={n}>{n}</p>)}
        </div>
      )}
    </div>
  );
}
