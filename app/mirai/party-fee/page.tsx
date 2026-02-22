'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ResponsiveBar } from '@nivo/bar';
import type { MiraiSummaryData } from '@/types/mirai';

// --- チームみらい ブランドカラー ---
const TEAL_400 = '#30bca7';
const TEAL_500 = '#2aa693';
const TEAL_600 = '#238778';
const BG_GRADIENT = 'linear-gradient(135deg, rgba(226,246,243,1) 0%, rgba(238,246,226,1) 100%)';
const TEXT_PRIMARY = '#171717';
const TEXT_MUTED = '#6b7280';

// 党費ティアごとの色
const TIER_COLORS: Record<number, { bg: string; border: string; label: string }> = {
  1500:  { bg: TEAL_400,  border: TEAL_600, label: '月1,500円' },
  5000:  { bg: '#10b981', border: '#059669', label: '月5,000円' },
  10000: { bg: '#3b82f6', border: '#2563eb', label: '月10,000円' },
};
const OTHER_COLOR = { bg: '#94a3b8', border: '#64748b', label: 'その他' };

function tierColor(amount: number) {
  return TIER_COLORS[amount] ?? OTHER_COLOR;
}

function formatYen(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億円`;
  if (n >= 10_000)      return `${(n / 10_000).toFixed(0)}万円`;
  return `${n.toLocaleString()}円`;
}

// --- ドーナツ風SVGアーク ---
function DonutArc({ percentage, color, radius = 70, stroke = 18 }: {
  percentage: number; color: string; radius?: number; stroke?: number;
}) {
  const cx = radius + stroke;
  const cy = radius + stroke;
  const size = (radius + stroke) * 2;
  const circ = 2 * Math.PI * radius;
  const dash = (percentage / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      <circle
        cx={cx} cy={cy} r={radius} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
    </svg>
  );
}

// --- ティアカード ---
function TierCard({ amount, count, percentage, total }: {
  amount: number; count: number; percentage: number; total: number;
}) {
  const { bg, border, label } = tierColor(amount);
  return (
    <div style={{
      background: '#fff', border: `2px solid ${border}`, borderRadius: 16,
      padding: '24px 20px', flex: 1, minWidth: 180, textAlign: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <DonutArc percentage={percentage} color={bg} />
        <div style={{
          position: 'absolute', fontWeight: 700, fontSize: 20, color: TEXT_PRIMARY,
        }}>
          {percentage}%
        </div>
      </div>
      <div style={{ marginTop: 12, fontSize: 22, fontWeight: 800, color: bg }}>{label}</div>
      <div style={{ fontSize: 15, color: TEXT_PRIMARY, marginTop: 4, fontWeight: 600 }}>
        {count.toLocaleString()}人
      </div>
      <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>
        合計 {formatYen(amount * count)}
      </div>
      <div style={{ marginTop: 12, background: '#f3f4f6', borderRadius: 6, height: 6 }}>
        <div style={{
          width: `${(count / total) * 100}%`, background: bg,
          borderRadius: 6, height: 6, transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}

export default function PartyFeePage() {
  const [data, setData] = useState<MiraiSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/mirai-summary.json')
      .then(r => r.json())
      .then((d: MiraiSummaryData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: BG_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: TEAL_500, fontSize: 16 }}>読み込み中…</div>
    </div>
  );
  if (!data) return <div style={{ padding: 40, color: '#ef4444' }}>データが読み込めませんでした</div>;

  const { partyFeeDistribution, partyFeeMonthly, summary } = data;

  const totalFeeCount = partyFeeDistribution.reduce((s, f) => s + f.count, 0);
  const totalFeeAmount = partyFeeDistribution.reduce((s, f) => s + f.amount * f.count, 0);
  const topTier = partyFeeDistribution[0];

  // 主要3ティア + その他
  const mainTiers = [1500, 5000, 10000];
  const mainDist = mainTiers.map(a => partyFeeDistribution.find(f => f.amount === a) ?? { amount: a, count: 0, percentage: 0 });
  const otherCount = partyFeeDistribution.filter(f => !mainTiers.includes(f.amount)).reduce((s, f) => s + f.count, 0);
  const otherPct = Math.round((otherCount / totalFeeCount) * 1000) / 10;

  // 月別積み上げバーチャート用データ
  const monthlyChartData = partyFeeMonthly.map(m => {
    const entry: Record<string, string | number> = { month: m.month.replace('2025-', '') };
    for (const tier of m.byTier) {
      const key = mainTiers.includes(tier.amount)
        ? `${tier.amount.toLocaleString()}円`
        : 'その他';
      entry[key] = ((entry[key] as number) ?? 0) + tier.count;
    }
    return entry;
  });

  const barKeys = ['1,500円', '5,000円', '10,000円', 'その他'].filter(k =>
    monthlyChartData.some(d => (d[k] as number) > 0)
  );
  const barColors = [TEAL_400, '#10b981', '#3b82f6', '#94a3b8'];

  const tooltipStyle = {
    background: 'rgba(23,23,23,0.85)', color: '#fff',
    padding: '6px 12px', borderRadius: 8, fontSize: 12,
  };

  return (
    <div style={{ minHeight: '100vh', background: BG_GRADIENT, fontFamily: 'sans-serif', color: TEXT_PRIMARY }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px 80px' }}>

        {/* ナビゲーション */}
        <div style={{ marginBottom: 24, fontSize: 13, color: TEXT_MUTED }}>
          <Link href="/mirai" style={{ color: TEAL_500, textDecoration: 'none' }}>
            ← 政治資金ダッシュボード
          </Link>
        </div>

        {/* ヘッダー */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            display: 'inline-block', background: TEAL_500, color: '#fff',
            borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, marginBottom: 10,
          }}>
            チームみらい 党費分析
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 8px', lineHeight: 1.2 }}>
            党費の金額分布
          </h1>
          <p style={{ fontSize: 14, color: TEXT_MUTED, margin: 0 }}>
            対象期間: {summary.dateRange.from} 〜 {summary.dateRange.to}　／
            出典:{' '}
            <a href="https://marumie.team-mir.ai/o/team-mirai" target="_blank" rel="noopener noreferrer"
              style={{ color: TEAL_500 }}>
              marumie.team-mir.ai
            </a>
          </p>
        </div>

        {/* ヒーロー数値 */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40,
        }}>
          {[
            { label: '党費納付件数', value: `${totalFeeCount.toLocaleString()}件`, sub: '集計期間合計' },
            { label: '党費総額', value: formatYen(totalFeeAmount), sub: '集計期間合計' },
            { label: '最頻値（最多の金額）', value: `${topTier?.amount.toLocaleString()}円`, sub: `全体の ${topTier?.percentage}%` },
          ].map(({ label, value, sub }) => (
            <div key={label} style={{
              background: '#fff', borderRadius: 14, padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderTop: `4px solid ${TEAL_500}`,
            }}>
              <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: TEAL_600 }}>{value}</div>
              <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ティアカード */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: TEXT_PRIMARY }}>
            金額ティア別の内訳
          </h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {mainDist.map(f => (
              <TierCard
                key={f.amount}
                amount={f.amount}
                count={f.count}
                percentage={f.percentage}
                total={totalFeeCount}
              />
            ))}
            {otherCount > 0 && (
              <div style={{
                background: '#fff', border: `2px solid ${OTHER_COLOR.border}`, borderRadius: 16,
                padding: '24px 20px', flex: 1, minWidth: 180, textAlign: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DonutArc percentage={otherPct} color={OTHER_COLOR.bg} />
                  <div style={{ position: 'absolute', fontWeight: 700, fontSize: 20, color: TEXT_PRIMARY }}>
                    {otherPct}%
                  </div>
                </div>
                <div style={{ marginTop: 12, fontSize: 22, fontWeight: 800, color: OTHER_COLOR.bg }}>{OTHER_COLOR.label}</div>
                <div style={{ fontSize: 15, color: TEXT_PRIMARY, marginTop: 4, fontWeight: 600 }}>{otherCount.toLocaleString()}件</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>
                  {partyFeeDistribution.filter(f => !mainTiers.includes(f.amount))
                    .map(f => `${f.amount.toLocaleString()}円×${f.count}件`).join('、')}
                </div>
                <div style={{ marginTop: 12, background: '#f3f4f6', borderRadius: 6, height: 6 }}>
                  <div style={{
                    width: `${(otherCount / totalFeeCount) * 100}%`, background: OTHER_COLOR.bg,
                    borderRadius: 6, height: 6,
                  }} />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 月別党費件数推移 */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: TEXT_PRIMARY }}>
            月別 党費納付件数の推移
          </h2>
          <p style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 20 }}>
            ティア（金額）別に積み上げ表示しています。
          </p>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '28px 20px 16px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)', height: 320,
          }}>
            <ResponsiveBar
              data={monthlyChartData}
              keys={barKeys}
              indexBy="month"
              groupMode="stacked"
              margin={{ top: 10, right: 120, bottom: 45, left: 60 }}
              padding={0.35}
              colors={barKeys.map((_, i) => barColors[i])}
              axisBottom={{
                tickSize: 0, tickPadding: 8,
                legend: '月', legendOffset: 36, legendPosition: 'middle',
              }}
              axisLeft={{
                tickSize: 0,
                legend: '件数', legendOffset: -48, legendPosition: 'middle',
              }}
              enableLabel={false}
              tooltip={({ id, value, indexValue }) => (
                <div style={tooltipStyle}>
                  {indexValue}月　{id}：{(value as number).toLocaleString()}件
                </div>
              )}
              legends={[{
                dataFrom: 'keys', anchor: 'right', direction: 'column',
                itemWidth: 100, itemHeight: 22, translateX: 110, translateY: 0,
                symbolSize: 12, symbolShape: 'circle',
              }]}
            />
          </div>
        </section>

        {/* 全金額一覧 */}
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: TEXT_PRIMARY }}>
            全金額の詳細（件数順）
          </h2>
          <div style={{
            background: '#fff', borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: TEAL_500, color: '#fff' }}>
                  {['金額', '件数', '割合', '小計'].map(h => (
                    <th key={h} style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partyFeeDistribution.map((f, i) => {
                  const { bg } = tierColor(f.amount);
                  return (
                    <tr key={f.amount} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td style={{ padding: '11px 20px', textAlign: 'right', fontWeight: 700, color: bg }}>
                        {f.amount.toLocaleString()}円
                      </td>
                      <td style={{ padding: '11px 20px', textAlign: 'right' }}>
                        {f.count.toLocaleString()}件
                      </td>
                      <td style={{ padding: '11px 20px', textAlign: 'right' }}>
                        <span style={{
                          display: 'inline-block', background: `${bg}22`,
                          color: bg, borderRadius: 12, padding: '2px 10px', fontWeight: 600,
                        }}>
                          {f.percentage}%
                        </span>
                      </td>
                      <td style={{ padding: '11px 20px', textAlign: 'right', color: TEXT_MUTED }}>
                        {formatYen(f.amount * f.count)}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: TEAL_500 + '18', fontWeight: 700 }}>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: TEAL_600 }}>合計</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: TEAL_600 }}>{totalFeeCount.toLocaleString()}件</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: TEAL_600 }}>100%</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: TEAL_600 }}>{formatYen(totalFeeAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}
