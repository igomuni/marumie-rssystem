'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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

const CARD_STYLE: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '12px 16px',
  background: '#fff',
  minWidth: 200,
};

function originKindLabel(kind: string): string {
  if (kind === 'direct') return '直接';
  if (kind === 'subcontract') return '再委託';
  return '別財源';
}

function RecipientPageInner() {
  const params = useParams<{ key: string }>();
  const searchParams = useSearchParams();
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
      <div style={{ padding: 24 }}>
        <p style={{ color: '#b91c1c' }}>支出先が見つかりませんでした（{error}）</p>
        <p style={{ fontSize: 14, color: '#64748b' }}>
          年度を切り替えると見つかる場合があります:{' '}
          <Link href={`/recipients/${encodeURIComponent(key)}?year=${year === 2024 ? 2025 : 2024}`}>
            {year === 2024 ? 2025 : 2024}年度で表示
          </Link>
        </p>
      </div>
    );
  }
  if (!data || !sankey) {
    return <div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>;
  }

  const r = data.recipient;
  const gbiz = data.links?.external?.gbizinfo;

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1080, margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/sankey-svg">サンキー図</Link>
        {' / '}
        <Link href="/subcontracts">再委託構造</Link>
        {' / 支出先プロフィール'}
      </div>

      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{r.name}</h1>
        <div style={{ fontSize: 13, color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{year}年度（予算年度{year - 1}実績）</span>
          {r.corporateNumber && <span>法人番号: {r.corporateNumber}</span>}
          {gbiz && (
            <a href={gbiz} target="_blank" rel="noopener noreferrer">
              gBizINFOで見る ↗
            </a>
          )}
          <Link href={`/recipients/${encodeURIComponent(key)}?year=${year === 2024 ? 2025 : 2024}`}>
            {year === 2024 ? 2025 : 2024}年度に切替
          </Link>
          <Link href={`/sankey-svg?fnr=${encodeURIComponent(r.name)}&fp=1&yr=${year}`}>
            サンキー図でこの支出先を見る →
          </Link>
        </div>
        {r.aliases.length > 1 && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            表記ゆれ: {r.aliases.slice(1).join(' / ')}
          </div>
        )}
      </header>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: '#64748b' }}>直接受注（事業からの直接支出）</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatYen(r.totals.directAmount)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{r.totals.directCount} 件</div>
        </div>
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: '#64748b' }}>再委託・別起点での受注</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatYen(r.totals.subcontractAmount)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{r.totals.subcontractCount} 件</div>
        </div>
        <div style={{ ...CARD_STYLE, background: '#fffbeb', borderColor: '#fde68a' }}>
          <div style={{ fontSize: 12, color: '#92400e' }}>
            ※ 直接受注と再委託受注は資金の流れが重なるため
            <br />
            合算できません（二重計上になります）
          </div>
        </div>
      </section>

      <section style={{ ...CARD_STYLE, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>受注の流れ（企業中心サンキー）</h2>
        <RecipientSankey data={sankey} />
        {sankey.aggregatedProjectCount > 0 && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            金額上位10事業のみ表示。残り{sankey.aggregatedProjectCount}事業は「その他の発注元」に集約しています。
          </div>
        )}
      </section>

      <section style={{ ...CARD_STYLE, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>府省庁別内訳</h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>府省庁</th>
              <th style={{ padding: '4px 8px' }}>直接受注</th>
              <th style={{ padding: '4px 8px' }}>再委託受注</th>
              <th style={{ padding: '4px 8px' }}>事業数</th>
            </tr>
          </thead>
          <tbody>
            {r.byMinistry.map(m => (
              <tr key={m.ministry} style={{ borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>
                <td style={{ textAlign: 'left', padding: '4px 8px' }}>{m.ministry}</td>
                <td style={{ padding: '4px 8px' }}>{m.directAmount > 0 ? formatYen(m.directAmount) : '—'}</td>
                <td style={{ padding: '4px 8px' }}>{m.subcontractAmount > 0 ? formatYen(m.subcontractAmount) : '—'}</td>
                <td style={{ padding: '4px 8px' }}>{m.projectCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ ...CARD_STYLE }}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>
          出現事業（金額降順・最大200件 / 全{data.metadata.appearanceTotal}件）
        </h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>事業</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>府省庁</th>
              <th style={{ textAlign: 'center', padding: '4px 8px' }}>区分</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>委託元</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>金額</th>
            </tr>
          </thead>
          <tbody>
            {r.appearances.map((a, i) => (
              <tr key={`${a.pid}-${a.blockId}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '4px 8px' }}>
                  <Link href={`/subcontracts/${a.pid}?year=${year}`}>{a.projectName}</Link>
                </td>
                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{a.ministry}</td>
                <td style={{ padding: '4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <span
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontSize: 11,
                      background: a.originKind === 'direct' ? '#dbeafe' : '#fef3c7',
                      color: a.originKind === 'direct' ? '#1d4ed8' : '#b45309',
                    }}
                  >
                    {originKindLabel(a.originKind)}
                  </span>
                </td>
                <td style={{ padding: '4px 8px', fontSize: 12, color: '#64748b' }}>
                  {a.upstream
                    ? a.upstream.recipientKey
                      ? (
                          <Link href={`/recipients/${encodeURIComponent(a.upstream.recipientKey)}?year=${year}`}>
                            {a.upstream.blockName}
                          </Link>
                        )
                      : a.upstream.blockName
                    : '—'}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {formatYen(a.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function RecipientPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <RecipientPageInner />
    </Suspense>
  );
}
