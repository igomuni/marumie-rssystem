import { getScoreBadgeColor } from '@/app/lib/quality-score-color';

/** 品質スコア表示に必要な項目（メイン/再委託どちらのスコア型からも渡せる最小集合） */
export interface QualityScoreLike {
  totalScore?: number | null;
  axisIdentify?: number | null;
  axisPurpose?: number | null;
  axisBudget?: number | null;
  axisEffective?: number | null;
  axisStructure?: number | null;
  effectiveReason?: string | null;
  aiSource?: string | null;
}

/**
 * 品質スコアブロックの共有コンポーネント。メインSankey（/sankey-svg）と
 * 再委託ビュー（/subcontracts）で同一の見た目（フォント・配色・レイアウト）を保つ。
 *
 * フォントはメイン画面の流儀に合わせ、見出し＝13px相当・細字メタ＝11px相当（scaleFont 経由）。
 * onOpenDetail を渡すと「詳細」ボタン＋クリック可能バッジを表示する（ScoreDetailDialog はページ側で描画）。
 */
export function QualityScoreBlock({
  score,
  year,
  scaleFont,
  onOpenDetail,
  detailLoading = false,
}: {
  score: QualityScoreLike | null | undefined;
  year: string | number;
  scaleFont: (px: number) => number;
  onOpenDetail?: () => void;
  detailLoading?: boolean;
}) {
  if (score === undefined) return null; // fetch中は非表示（パネルのちらつき防止）
  const hasScore = score !== null && score.totalScore != null;
  const LABEL_PX = scaleFont(13);
  const META_PX = scaleFont(11);

  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', padding: '7px 14px 9px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: LABEL_PX, fontWeight: 600, color: '#555' }}>品質スコア</span>
        {!hasScore ? (
          <span style={{ fontSize: META_PX, color: '#aaa' }}>スコアなし</span>
        ) : (
          <span
            onClick={onOpenDetail && !detailLoading ? onOpenDetail : undefined}
            title="スコアの計算根拠・支出先一覧を表示"
            style={{
              background: getScoreBadgeColor(score!.totalScore!),
              color: '#fff', padding: '1px 8px', borderRadius: 10, fontSize: LABEL_PX, fontWeight: 700,
              cursor: onOpenDetail ? (detailLoading ? 'wait' : 'pointer') : 'default',
            }}>
            {score!.totalScore!.toFixed(1)}
          </span>
        )}
        {hasScore && onOpenDetail && (
          <button
            onClick={() => !detailLoading && onOpenDetail()}
            disabled={detailLoading}
            title="スコアの計算根拠・支出先一覧を表示"
            style={{
              fontSize: META_PX, color: '#4a90d9', background: 'none', border: 'none', padding: 0,
              cursor: detailLoading ? 'wait' : 'pointer', flexShrink: 0,
            }}
          >{detailLoading ? '読込中…' : '詳細'}</button>
        )}
        <a href={`/quality?year=${year}`} target="_blank" rel="noopener noreferrer"
          title="品質スコア一覧ページを開く"
          style={{ fontSize: META_PX, color: '#4a90d9', textDecoration: 'none', marginLeft: 'auto', flexShrink: 0 }}
        >一覧 ↗</a>
      </div>
      {hasScore && (
        <>
          <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
            {([
              ['特定可能性', score!.axisIdentify],
              ['使途', score!.axisPurpose],
              ['収支', score!.axisBudget],
              ['有効性', score!.axisEffective],
            ] as [string, number | null | undefined][]).map(([label, v]) => (
              <span key={label} style={{ fontSize: META_PX, color: '#777' }}>
                {label} <span style={{ fontWeight: 600, color: '#555' }}>{v != null ? Math.round(v) : '—'}</span>
              </span>
            ))}
            {score!.axisStructure != null && (
              <span style={{ fontSize: META_PX, color: '#bbb' }}>構造 {Math.round(score!.axisStructure)}（参考）</span>
            )}
          </div>
          {score!.effectiveReason && score!.aiSource !== 'heuristic' && (
            <div
              title={`${score!.effectiveReason}\n※実測成果ではなく成果設計の明確さの評価`}
              style={{ fontSize: META_PX, color: '#999', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              有効性根拠: {score!.effectiveReason}
            </div>
          )}
        </>
      )}
    </div>
  );
}
