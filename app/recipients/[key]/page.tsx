'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { RecipientEntry } from '@/types/recipient-index';
import { buildRecipientSankey } from '@/app/lib/recipient-sankey-generator';
import { formatYen } from '@/app/lib/format/yen';
import RecipientSankey from '@/client/components/RecipientSankey';

interface RecipientApiResponse {
  metadata: { year: number; appearanceTotal: number };
  recipient: RecipientEntry;
  links?: { external?: { gbizinfo: string } };
}

// /subcontracts 系と同じ規約色
const COLOR_DIRECT_SUBTLE = '#b33434';
const COLOR_SUBCONTRACT_SUBTLE = '#b45309';

const CARD_STYLE: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '12px 16px',
  background: '#fff',
};

const PILL_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid #e0e0e0',
  background: 'rgba(255,255,255,0.95)',
  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
  color: '#666',
  textDecoration: 'none',
  flexShrink: 0,
};

const TH_STYLE: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
};

function originKindBadge(kind: string) {
  const isDirect = kind === 'direct';
  const isSub = kind === 'subcontract';
  return (
    <span
      style={{
        padding: '2px 6px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: isDirect ? '#f9dddd' : isSub ? '#fbe3d7' : '#e0e7ff',
        color: isDirect ? COLOR_DIRECT_SUBTLE : isSub ? COLOR_SUBCONTRACT_SUBTLE : '#3730a3',
        whiteSpace: 'nowrap',
      }}
    >
      {isDirect ? '直接' : isSub ? '再委託' : '別財源'}
    </span>
  );
}

function RecipientPageInner() {
  const params = useParams<{ key: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const key = decodeURIComponent(params.key);

  const parsedYear = Number.parseInt(searchParams.get('year') ?? '2024', 10);
  const year = parsedYear === 2024 || parsedYear === 2025 ? parsedYear : 2024;

  const [data, setData] = useState<RecipientApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    fetch(`/api/recipients/${encodeURIComponent(key)}?year=${year}&limit=200`, {
      signal: controller.signal,
    })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: RecipientApiResponse) => setData(json))
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message ?? String(e));
      });
    return () => controller.abort();
  }, [key, year]);

  const sankey = useMemo(
    () => (data ? buildRecipientSankey(data.recipient) : null),
    [data],
  );

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '12px 16px' }}>
        <p style={{ color: '#991b1b', fontSize: 14 }}>支出先が見つかりませんでした（{error}）</p>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          年度を切り替えると見つかる場合があります:{' '}
          <Link href={`/recipients/${encodeURIComponent(key)}?year=${year === 2024 ? 2025 : 2024}`} style={{ color: '#2563eb' }}>
            {year === 2024 ? 2025 : 2024}年度で表示
          </Link>
          {' / '}
          <Link href="/subcontracts" style={{ color: '#2563eb' }}>← 一覧に戻る</Link>
        </p>
      </div>
    );
  }
  if (!data || !sankey) {
    return <div style={{ minHeight: '100vh', background: '#f9fafb', padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>;
  }

  const r = data.recipient;
  const gbiz = data.links?.external?.gbizinfo;

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '12px 16px', boxSizing: 'border-box' }}>
        {/* ── コントロール行（/subcontracts と同じトーン） ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href="/" aria-label="トップへ戻る" title="トップへ戻る" style={{ ...PILL_BUTTON_STYLE, width: 32, height: 32 }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </Link>
          <Link href="/subcontracts" title="再委託構造の一覧へ" style={{ ...PILL_BUTTON_STYLE, height: 32, padding: '0 10px', fontSize: 13 }}>
            再委託構造一覧
          </Link>
          {/* 年度切替 */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <select
              value={year}
              onChange={(e) => router.replace(`/recipients/${encodeURIComponent(key)}?year=${e.target.value}`)}
              style={{
                fontSize: 13,
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                padding: '6px 28px 6px 10px',
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                color: '#333',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
              }}
            >
              <option value={2025}>2025年度</option>
              <option value={2024}>2024年度</option>
            </select>
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#999" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </div>
          <Link
            href={`/sankey-svg?fnr=${encodeURIComponent(r.name)}&fp=1&yr=${year}`}
            title="サンキー図でこの支出先を見る"
            style={{ ...PILL_BUTTON_STYLE, height: 32, padding: '0 10px', fontSize: 13, gap: 5 }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7z"/>
            </svg>
            サンキー図で見る
          </Link>
          {gbiz && (
            <a href={gbiz} target="_blank" rel="noopener noreferrer" title="gBizINFOで法人情報を見る"
              style={{ ...PILL_BUTTON_STYLE, height: 32, padding: '0 10px', fontSize: 13, gap: 5 }}>
              gBizINFO
              <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 -960 960 960" fill="currentColor">
                <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H520v-80h320v320h-80v-184L388-332Z"/>
              </svg>
            </a>
          )}
        </div>

        {/* ── ヘッダ ── */}
        <header style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, marginBottom: 2 }}>
            受注構造（府省庁横断・{year}年度 / 予算年度{year - 1}実績）
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111', margin: 0, wordBreak: 'break-all', lineHeight: 1.4 }}>
            {r.name}
          </h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {r.corporateNumber && <span>法人番号: {r.corporateNumber}</span>}
            {r.aliases.length > 1 && <span>表記ゆれ: {r.aliases.slice(1).join(' / ')}</span>}
          </div>
        </header>

        {/* ── サマリ ── */}
        <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ ...CARD_STYLE, minWidth: 210 }}>
            <span style={{ padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: '#f9dddd', color: COLOR_DIRECT_SUBTLE }}>
              直接受注 {r.totals.directCount}件
            </span>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginTop: 6 }}>{formatYen(r.totals.directAmount)}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>事業からの直接支出</div>
          </div>
          <div style={{ ...CARD_STYLE, minWidth: 210 }}>
            <span style={{ padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: '#fbe3d7', color: COLOR_SUBCONTRACT_SUBTLE }}>
              再委託受注 {r.totals.subcontractCount}件
            </span>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginTop: 6 }}>{formatYen(r.totals.subcontractAmount)}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>再委託・別起点での受注</div>
          </div>
          <div style={{ ...CARD_STYLE, minWidth: 210, background: '#fffbeb', borderColor: '#fde68a', display: 'flex', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#92400e', lineHeight: 1.6 }}>
              ※ 直接受注と再委託受注は資金の流れが重なるため
              <br />
              合算できません（二重計上になります）
            </div>
          </div>
        </section>

        {/* ── 企業中心サンキー ── */}
        <section style={{ ...CARD_STYLE, marginBottom: 12 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#222', margin: '0 0 8px' }}>受注の流れ（企業中心サンキー）</h2>
          <RecipientSankey data={sankey} />
          {sankey.aggregatedProjectCount > 0 && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              金額上位10事業のみ表示。残り{sankey.aggregatedProjectCount}事業は「その他の発注元」に集約しています。
            </div>
          )}
        </section>

        {/* ── 府省庁別内訳 ── */}
        <section style={{ ...CARD_STYLE, marginBottom: 12, padding: 0, overflow: 'hidden' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#222', margin: 0, padding: '10px 16px 8px' }}>府省庁別内訳</h2>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...TH_STYLE, textAlign: 'left' }}>府省庁</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>直接受注</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>再委託受注</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>事業数</th>
              </tr>
            </thead>
            <tbody>
              {r.byMinistry.map(m => (
                <tr key={m.ministry} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '5px 8px 5px 16px', color: '#333' }}>{m.ministry}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: m.directAmount > 0 ? COLOR_DIRECT_SUBTLE : '#cbd5e1', fontWeight: m.directAmount > 0 ? 600 : 400 }}>
                    {m.directAmount > 0 ? formatYen(m.directAmount) : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: m.subcontractAmount > 0 ? COLOR_SUBCONTRACT_SUBTLE : '#cbd5e1', fontWeight: m.subcontractAmount > 0 ? 600 : 400 }}>
                    {m.subcontractAmount > 0 ? formatYen(m.subcontractAmount) : '—'}
                  </td>
                  <td style={{ padding: '5px 16px 5px 8px', textAlign: 'right', color: '#555' }}>{m.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── 出現事業 ── */}
        <section style={{ ...CARD_STYLE, padding: 0, overflow: 'hidden' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#222', margin: 0, padding: '10px 16px 8px' }}>
            出現事業
            <span style={{ fontSize: 11, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>
              金額降順・最大200件 / 全{data.metadata.appearanceTotal}件
            </span>
          </h2>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...TH_STYLE, textAlign: 'left' }}>事業</th>
                <th style={{ ...TH_STYLE, textAlign: 'left' }}>府省庁</th>
                <th style={{ ...TH_STYLE, textAlign: 'center' }}>区分</th>
                <th style={{ ...TH_STYLE, textAlign: 'left' }}>委託元</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>金額</th>
              </tr>
            </thead>
            <tbody>
              {r.appearances.map((a, i) => (
                <tr key={`${a.pid}-${a.blockId}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '5px 8px 5px 16px' }}>
                    <Link href={`/subcontracts/${a.pid}?year=${year}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                      {a.projectName}
                    </Link>
                  </td>
                  <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: '#555' }}>{a.ministry}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>{originKindBadge(a.originKind)}</td>
                  <td style={{ padding: '5px 8px', fontSize: 11, color: '#64748b' }}>
                    {a.upstream
                      ? a.upstream.recipientKey
                        ? (
                            <Link href={`/recipients/${encodeURIComponent(a.upstream.recipientKey)}?year=${year}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                              {a.upstream.blockName}
                            </Link>
                          )
                        : a.upstream.blockName
                      : '—'}
                  </td>
                  <td style={{ padding: '5px 16px 5px 8px', textAlign: 'right', whiteSpace: 'nowrap', color: '#111', fontWeight: 600 }}>
                    {formatYen(a.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export default function RecipientPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#f9fafb', padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <RecipientPageInner />
    </Suspense>
  );
}
