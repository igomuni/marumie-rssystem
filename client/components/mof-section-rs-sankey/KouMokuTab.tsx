'use client';

/**
 * サイドパネルの「目」タブ。項・RS事業では見せ方が違う:
 *
 * - 項ノード選択時（mode='section'）: その項の目一覧（`/api/mof-kou/detail`）を
 *   金額の大きい順に出し、RS紐づけがある目には繋がるRS事業名を添える
 * - RS事業ノード選択時（mode='project'）: その事業が計上されている目を
 *   `/api/mof-sankey/rs-project` から集め、どの項のどの目かを1行ずつ出す
 *   （1つの事業が複数の項にまたがることがあるため、項名も併記する）
 *
 * main API（/api/mof-sankey）には目単位の明細までは含めていないため、
 * タブを開いたときに遅延取得する（/mof-kou の行展開と同じ方針）。
 */

import { useEffect, useState } from 'react';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

interface Row {
  sectionName?: string;
  subItemName: string;
  amount: number;
  rsProjectNames?: string[];
}

interface KouMokuLeafLike {
  key: string;
  subItemName: string;
  amount: number;
}

interface RsLinkLike {
  kouMokuKey: string;
  projectName: string;
}

interface SectionDetailResponse {
  kouMokuItems?: KouMokuLeafLike[];
  rsLinks?: RsLinkLike[];
}

interface RsProjectLinkRow {
  sectionName: string;
  subItemName: string;
  rsAmount: number;
}

interface RsProjectResponse {
  rows?: RsProjectLinkRow[];
}

type Props =
  | { mode: 'section'; fiscalYear: number; sectionId: string }
  | { mode: 'project'; fiscalYear: number; budgetType: string; projectId: number };

export function KouMokuTab(props: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);

    const url =
      props.mode === 'section'
        ? `/api/mof-kou/detail?year=${props.fiscalYear}&id=${encodeURIComponent(props.sectionId)}`
        : `/api/mof-sankey/rs-project?year=${props.fiscalYear}&projectId=${props.projectId}&budgetType=${encodeURIComponent(props.budgetType)}`;

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: SectionDetailResponse | RsProjectResponse) => {
        if (cancelled) return;
        if (props.mode === 'section') {
          const { kouMokuItems = [], rsLinks = [] } = data as SectionDetailResponse;
          const rsByKey = new Map<string, string[]>();
          for (const link of rsLinks) {
            const list = rsByKey.get(link.kouMokuKey) ?? [];
            list.push(link.projectName);
            rsByKey.set(link.kouMokuKey, list);
          }
          const items: Row[] = kouMokuItems
            .map(k => ({
              subItemName: k.subItemName,
              amount: k.amount,
              rsProjectNames: rsByKey.get(k.key),
            }))
            .sort((a, b) => b.amount - a.amount);
          setRows(items);
        } else {
          const { rows: linkRows = [] } = data as RsProjectResponse;
          const items: Row[] = linkRows
            .map(l => ({ sectionName: l.sectionName, subItemName: l.subItemName, amount: l.rsAmount }))
            .sort((a, b) => b.amount - a.amount);
          setRows(items);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, props.fiscalYear, props.mode === 'section' ? props.sectionId : props.projectId]);

  if (error) return <div className="p-4 text-xs text-red-600">目の取得に失敗しました</div>;
  if (!rows) return <div className="p-4 text-xs text-gray-400">読み込み中…</div>;
  if (rows.length === 0) return <div className="p-4 text-xs text-gray-400">該当する目がありません</div>;

  return (
    <div className="p-4 pt-1">
      {rows.map((r, i) => (
        <div key={`${i}-${r.subItemName}`} className="flex items-baseline justify-between gap-3 border-b border-gray-50 py-1.5">
          <div className="min-w-0">
            {r.sectionName && <div className="truncate text-[10px] text-gray-400">{r.sectionName}</div>}
            <div className="truncate text-xs text-gray-700">{r.subItemName}</div>
            {r.rsProjectNames && r.rsProjectNames.length > 0 && (
              <div className="truncate text-[10px] text-emerald-600">→ {r.rsProjectNames.join('、')}</div>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{formatBudgetFromYen(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}
