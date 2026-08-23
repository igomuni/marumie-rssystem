'use client';

/**
 * MOF 事項別内訳の階層サンキー。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 の6列で、
 * 国の予算がどの省庁のどの事業まで下りるかを1枚で追えるようにする。
 *
 * 画面構成は `/sankey-svg` を踏襲する。図を全画面（`fixed inset-0`）に敷き、
 * 見出し・コントロール・ズームはその上に浮かせる。ページスクロールは持たず、
 * 図の中をパン・ズームして見る。
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MOF_HIERARCHY_COLUMNS,
  type LabelDensity,
  type MOFHierarchyColumn,
  type MOFHierarchyData,
  type MOFHierarchyTopN,
} from '@/types/mof-hierarchy';
import type { MOFBudgetType } from '@/types/mof-jikou';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { HierarchyChart, LABEL_FONT_PX_DEFAULT } from '@/client/components/mof-hierarchy/HierarchyChart';
import { HierarchyControls } from '@/client/components/mof-hierarchy/HierarchyControls';
import { useMofBudgetData } from '@/client/components/mof-budget/useMofBudgetData';

/**
 * TopN の列と、URL・API のパラメータ名の対応。
 * 列を増やしたときに3箇所を直す必要がないよう1本にまとめる。
 */
const TOP_N_KEYS: Array<{
  column: Exclude<MOFHierarchyColumn, 'total'>;
  /** ブラウザの URL に載せる短い名前 */
  urlKey: string;
  /** API に渡す名前 */
  apiKey: string;
}> = MOF_HIERARCHY_COLUMNS.filter(c => c !== 'total').map(column => ({
  column: column as Exclude<MOFHierarchyColumn, 'total'>,
  urlKey: `t${column.slice(0, 2)}`,
  apiKey: `top${column[0].toUpperCase()}${column.slice(1)}`,
}));

export default function MOFHierarchyPage() {
  return (
    <Suspense fallback={<CenterMessage text="読み込み中…" />}>
      <MOFHierarchyContent />
    </Suspense>
  );
}

function CenterMessage({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <p className={error ? 'text-sm text-red-600' : 'text-sm text-gray-500'}>{text}</p>
    </div>
  );
}

function MOFHierarchyContent() {
  const searchParams = useSearchParams();
  const rawYear = searchParams.get('year');
  const [budgetType, setBudgetType] = useState<MOFBudgetType | null>(
    (searchParams.get('bt') as MOFBudgetType | null) ?? null
  );
  const [topN, setTopN] = useState<MOFHierarchyTopN>(() =>
    Object.fromEntries(
      TOP_N_KEYS.map(({ column, urlKey }) => [
        column,
        Number(searchParams.get(urlKey)) || undefined,
      ])
    )
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('sel')
  );
  const [focusRelated, setFocusRelated] = useState(searchParams.get('fr') !== '0');
  const [fontPx, setFontPx] = useState(
    () => Number(searchParams.get('fs')) || LABEL_FONT_PX_DEFAULT
  );
  const [labelDensity, setLabelDensity] = useState<LabelDensity>(
    () => (searchParams.get('ld') === 'major' ? 'major' : 'all')
  );

  const buildUrl = useCallback(
    (target: number | null) => {
      const params = new URLSearchParams();
      if (target) params.set('year', String(target));
      if (budgetType) params.set('budgetType', budgetType);
      for (const { column, apiKey } of TOP_N_KEYS) {
        const value = topN[column];
        if (value) params.set(apiKey, String(value));
      }
      const query = params.toString();
      return `/api/mof-hierarchy${query ? `?${query}` : ''}`;
    },
    [budgetType, topN]
  );

  const { data, year, loading, error, fetchData } = useMofBudgetData<MOFHierarchyData>(
    buildUrl,
    rawYear ? Number(rawYear) : null
  );

  /**
   * 表示条件を URL に残す。
   * 見ている状態を共有・再訪できないと、深い階層まで辿った意味が失われる。
   * 履歴を汚さないよう replaceState を使う（/sankey-svg と同じ方針）。
   */
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams();
    params.set('year', String(data.metadata.fiscalYear));
    params.set('bt', data.metadata.budgetType);
    // 表示数は画面で選んでいる値を正とする。
    // 応答（metadata）を待つと、選んだ直後に古い値へ戻って見える
    for (const { column, urlKey } of TOP_N_KEYS) {
      const value = topN[column];
      if (value) params.set(urlKey, String(value));
    }
    if (selectedId) params.set('sel', selectedId);
    if (!focusRelated) params.set('fr', '0');
    if (fontPx !== LABEL_FONT_PX_DEFAULT) params.set('fs', String(fontPx));
    if (labelDensity !== 'all') params.set('ld', labelDensity);
    const next = `?${params.toString()}`;
    if (next !== window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [data, selectedId, focusRelated, fontPx, labelDensity, topN]);

  // ブラウザの戻る／進むで選択を辿れるようにする
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedId(params.get('sel'));
      setFocusRelated(params.get('fr') !== '0');
      setFontPx(Number(params.get('fs')) || LABEL_FONT_PX_DEFAULT);
      setLabelDensity(params.get('ld') === 'major' ? 'major' : 'all');
      setTopN(
        Object.fromEntries(
          TOP_N_KEYS.map(({ column, urlKey }) => [
            column,
            Number(params.get(urlKey)) || undefined,
          ])
        )
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * 選択は「辿った操作」なので履歴に積み、戻るで1つ前に戻せるようにする。
   *
   * pushState は state 更新関数の外で呼ぶこと。中に置くと React が更新関数を
   * 2回評価する場面（開発時の StrictMode など）で履歴が二重に積まれ、
   * 1回の「戻る」では戻らなくなる。
   */
  const selectNode = useCallback(
    (id: string | null) => {
      if (id === selectedId) return;
      const params = new URLSearchParams(window.location.search);
      if (id) params.set('sel', id);
      else params.delete('sel');
      window.history.pushState(null, '', `?${params.toString()}`);
      setSelectedId(id);
    },
    [selectedId]
  );

  const accountsLabel = useMemo(
    () =>
      data?.accounts.map(a => `${a.label} ${formatBudgetFromYen(a.amount)}`).join(' / ') ??
      '',
    [data]
  );

  if (loading && !data) return <CenterMessage text="読み込み中…" />;
  if (error || !data) {
    // data だけが無い場合もここに来る。error が null のまま埋め込むと "null" と出る
    return (
      <CenterMessage
        text={error ? `読み込みに失敗しました: ${error}` : 'データを取得できませんでした'}
        error
      />
    );
  }

  const { metadata } = data;

  return (
    <div className="fixed inset-0 overflow-hidden bg-white">
      {/* 図。全画面に敷き、その上にコントロールを浮かせる */}
      <HierarchyChart
        nodes={data.sankey.nodes}
        links={data.sankey.links}
        selectedId={selectedId}
        onSelect={selectNode}
        focusRelated={focusRelated}
        fontPx={fontPx}
        labelDensity={labelDensity}
      />

      {/* コントロール・年度・ページ切替。/sankey-svg と同じく右上に並べる */}
      <div className="absolute right-3 top-3 z-30 flex items-start gap-2">
        <div className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 shadow-md backdrop-blur">
          <HierarchyControls
            budgetType={metadata.budgetType}
            budgetTypes={metadata.budgetTypes}
            topN={topN}
            disabled={loading}
            onBudgetTypeChange={setBudgetType}
            onTopNChange={setTopN}
            summary={`${metadata.itemCount.toLocaleString()}事項 / ${accountsLabel}`}
            focusRelated={focusRelated}
            onFocusRelatedChange={setFocusRelated}
            fontPx={fontPx}
            onFontPxChange={setFontPx}
            labelDensity={labelDensity}
            onLabelDensityChange={setLabelDensity}
          />
        </div>
        <YearSelect
          value={String(year ?? metadata.fiscalYear)}
          onChange={y => fetchData(Number(y))}
          years={metadata.availableYears}
          theme="light"
        />
        <PageNavMenu current="/mof-hierarchy" theme="light" />
      </div>
    </div>
  );
}
