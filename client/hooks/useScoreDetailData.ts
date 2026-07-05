'use client';

import { useEffect, useState } from 'react';
import type { RecipientRow } from '@/app/api/quality-scores/recipients/route';
import type { ProjectDetail } from '@/types/project-details';

/**
 * 品質スコア詳細ダイアログ（ScoreDetailDialog）が必要とするデータの取得フック。
 *
 * ScoreDetailDialog は client/components 配下の再利用UIであり、直接 API を叩かない方針
 * （Issue #246）。フェッチはページ側がこのフック経由で所有し、結果を props で渡す。
 *
 * 状態の意味:
 *   - recipients:     null=読み込み中 / 配列=取得済み（recipientsError=true 時は取得失敗）
 *   - projectInfo:    undefined=読み込み中 / null=データなし・取得失敗 / オブジェクト=取得済み
 */
export interface ScoreDetailData {
  recipients: RecipientRow[] | null;
  recipientsError: boolean;
  projectInfo: ProjectDetail | null | undefined;
}

export function useScoreDetailData(
  pid: string | null | undefined,
  year: string,
): ScoreDetailData {
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [recipientsError, setRecipientsError] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectDetail | null | undefined>(undefined);

  useEffect(() => {
    // pid 未指定（ダイアログ非表示）は待機状態にリセットして何もフェッチしない。
    setRecipients(null);
    setRecipientsError(false);
    setProjectInfo(undefined);
    if (!pid) return;

    // 古い pid/year の fetch が後着で新しい表示を上書きしないようガードする
    let cancelled = false;
    fetch(`/api/quality-scores/recipients?pid=${pid}&year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((rows: RecipientRow[]) => { if (!cancelled) setRecipients(rows); })
      .catch(() => { if (!cancelled) setRecipientsError(true); });
    fetch(`/api/project-details/${pid}?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((d: ProjectDetail) => { if (!cancelled) setProjectInfo(d); })
      .catch(() => { if (!cancelled) setProjectInfo(null); });
    return () => { cancelled = true; };
  }, [pid, year]);

  return { recipients, recipientsError, projectInfo };
}
