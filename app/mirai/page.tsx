'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ResponsiveBar } from '@nivo/bar';
import type { MiraiSummaryData } from '@/types/mirai';

const INCOME_COLOR = '#3b82f6';
const EXPENSE_COLOR = '#ef4444';

function formatYen(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億円`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}万円`;
  return `${n.toLocaleString()}円`;
}

function SummaryCard({ label, amount, count, color }: {
  label: string; amount: number; count: number; color: string;
}) {
  return (
    <div style={{
      background: '#fff', border: `2px solid ${color}`, borderRadius: 12,
      padding: '20px 28px', minWidth: 200, flex: 1,
    }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{formatYen(amount)}</div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{count.toLocaleString()}件</div>
    </div>
  );
}

function HBar({ label, value, max, color, sub }: {
  label: string; value: number; max: number; color: string; sub?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: '#555' }}>{formatYen(value)}{sub ? `（${sub}）` : ''}</span>
      </div>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 10 }}>
        <div style={{ width: `${pct}%`, background: color, borderRadius: 4, height: 10, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

export default function MiraiPage() {
  const [data, setData] = useState<MiraiSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/mirai-summary.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: MiraiSummaryData) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#999' }}>
      読み込み中…
    </div>
  );
  if (error || !data) return (
    <div style={{ padding: 40, color: '#ef4444' }}>エラー: {error ?? 'データが読み込めませんでした'}</div>
  );

  const { summary, monthly, incomeByCategory, expenseByCategory, partyFeeDistribution, donationDistribution } = data;
  const balance = summary.totalIncome - summary.totalExpense;

  // 月別グラフ用データ
  const monthlyChartData = monthly.map(m => ({
    month: m.month.replace('2025-', ''),
    収入: m.income,
    支出: m.expense,
  }));

  // 党費分布グラフ用データ
  const feeChartData = partyFeeDistribution.map(f => ({
    金額: f.amount >= 10000 ? `${(f.amount / 10000).toFixed(1)}万円` : `${f.amount.toLocaleString()}円`,
    件数: f.count,
    割合: f.percentage,
  }));

  // 収入カテゴリ最大値
  const incomeMax = Math.max(...incomeByCategory.map(c => c.amount));
  const expenseMax = Math.max(...expenseByCategory.map(c => c.amount));

  const tooltipStyle = {
    background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '6px 10px',
    borderRadius: 6, fontSize: 12,
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px', fontFamily: 'sans-serif', color: '#111' }}>
      {/* ヘッダー */}
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          チームみらい 政治資金ダッシュボード
        </h1>
        <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
          出典:{' '}
          <a
            href="https://marumie.team-mir.ai/o/team-mirai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#3b82f6' }}
          >
            marumie.team-mir.ai
          </a>
          {' '}／ 対象期間: {summary.dateRange.from} 〜 {summary.dateRange.to}
          {' '}／ 集計日: {data.generatedAt.slice(0, 10)}
        </div>
      </div>

      {/* サマリーカード */}
      <div style={{ display: 'flex', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
        <SummaryCard label="総収入" amount={summary.totalIncome} count={monthly.reduce((s, m) => s + m.incomeCount, 0)} color={INCOME_COLOR} />
        <SummaryCard label="総支出" amount={summary.totalExpense} count={monthly.reduce((s, m) => s + m.expenseCount, 0)} color={EXPENSE_COLOR} />
        <SummaryCard
          label="差引残高"
          amount={Math.abs(balance)}
          count={summary.totalTransactions}
          color={balance >= 0 ? '#10b981' : '#f59e0b'}
        />
      </div>

      {/* 月別収支推移 */}
      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>月別収支推移</h2>
        <div style={{ height: 280 }}>
          <ResponsiveBar
            data={monthlyChartData}
            keys={['収入', '支出']}
            indexBy="month"
            groupMode="grouped"
            margin={{ top: 10, right: 20, bottom: 40, left: 80 }}
            padding={0.25}
            colors={[INCOME_COLOR, EXPENSE_COLOR]}
            axisBottom={{ tickSize: 0, tickPadding: 8, legend: '月', legendOffset: 32, legendPosition: 'middle' }}
            axisLeft={{
              tickSize: 0,
              format: (v: number) => v >= 1e8 ? `${(v / 1e8).toFixed(0)}億` : v >= 1e4 ? `${(v / 1e4).toFixed(0)}万` : String(v),
              legend: '金額（円）', legendOffset: -70, legendPosition: 'middle',
            }}
            enableLabel={false}
            tooltip={({ id, value, indexValue }) => (
              <div style={tooltipStyle}>{indexValue}月 {id}: {formatYen(value as number)}</div>
            )}
            legends={[{
              dataFrom: 'keys', anchor: 'top-right', direction: 'row', itemWidth: 60,
              itemHeight: 20, translateY: -10, symbolSize: 12,
            }]}
          />
        </div>
      </section>

      {/* 収入内訳 */}
      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>収入内訳</h2>
        {incomeByCategory.map(c => (
          <HBar
            key={`${c.category}-${c.subCategory}`}
            label={c.subCategory === c.category ? c.category : `${c.category} / ${c.subCategory}`}
            value={c.amount}
            max={incomeMax}
            color={INCOME_COLOR}
            sub={`${c.count.toLocaleString()}件`}
          />
        ))}
      </section>

      {/* 党費金額分布 */}
      <section style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>党費の金額分布</h2>
          <Link href="/mirai/party-fee" style={{ fontSize: 13, color: '#2aa693', textDecoration: 'none', fontWeight: 600 }}>
            詳細ビュー →
          </Link>
        </div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          全{partyFeeDistribution.reduce((s, f) => s + f.count, 0).toLocaleString()}件。
          最頻値は <strong>{partyFeeDistribution[0]?.amount.toLocaleString()}円</strong>（{partyFeeDistribution[0]?.percentage}%）。
        </p>
        <div style={{ height: 220 }}>
          <ResponsiveBar
            data={feeChartData}
            keys={['件数']}
            indexBy="金額"
            margin={{ top: 10, right: 20, bottom: 50, left: 70 }}
            padding={0.3}
            colors={['#8b5cf6']}
            axisBottom={{ tickSize: 0, tickPadding: 8, legend: '党費金額', legendOffset: 36, legendPosition: 'middle' }}
            axisLeft={{ tickSize: 0, legend: '件数', legendOffset: -55, legendPosition: 'middle' }}
            label={(d) => `${d.value?.toLocaleString()}`}
            labelSkipHeight={16}
            tooltip={({ indexValue, value, data: d }) => (
              <div style={tooltipStyle}>{indexValue}: {(value as number).toLocaleString()}件（{d['割合']}%）</div>
            )}
          />
        </div>
      </section>

      {/* 個人寄附分布 */}
      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>個人寄附の金額帯分布</h2>
        {donationDistribution.map(d => (
          <HBar
            key={d.label}
            label={d.label}
            value={d.totalAmount}
            max={Math.max(...donationDistribution.map(x => x.totalAmount))}
            color={INCOME_COLOR}
            sub={`${d.count.toLocaleString()}件`}
          />
        ))}
      </section>

      {/* 支出内訳 */}
      <section style={{ marginTop: 40, marginBottom: 60 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>支出内訳</h2>
        {expenseByCategory.map(c => (
          <HBar
            key={c.category}
            label={c.category}
            value={c.amount}
            max={expenseMax}
            color={EXPENSE_COLOR}
            sub={`${c.count.toLocaleString()}件`}
          />
        ))}
      </section>
    </div>
  );
}
