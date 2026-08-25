'use client';

/**
 * 紐づく RS 事業。行を展開したときに詳細の中へ出す。
 *
 * データ取得はページ層の責務（client/components/ は API を直接叩かない）。
 * MOF事項とRS事業を直結する公式キーは無いため、表示するのは自動突合の結果
 * （確定=構造キー一致+名称完全一致／候補=語幹一致等、誤検出を含みうる）。
 * 詳細: docs/tasks/20260825_2112_MOFとRSの名寄せに必要な情報の洗い出し.md
 */

import type { MofRsLinkageRecord } from '@/types/mof-rs-linkage';
import { formatYen } from './format';

const STATUS_LABEL: Record<MofRsLinkageRecord['status'], string> = {
  confirmed: '確定',
  candidate: '候補',
};

const STATUS_CLASS: Record<MofRsLinkageRecord['status'], string> = {
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  candidate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

export function JikouLinkage({
  links,
  available,
  loading,
  error,
}: {
  links: MofRsLinkageRecord[] | null;
  available: boolean;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return <p className="text-[11px] text-red-600">紐づけの取得に失敗しました: {error}</p>;
  }
  if (loading || links === null) {
    return <p className="text-[11px] text-neutral-400">RS事業との紐づけを読み込み中…</p>;
  }
  if (!available) {
    return (
      <p className="max-w-[18rem] text-[11px] text-neutral-400">
        この年度は RS 事業との紐づけデータが未生成です（
        <code className="font-mono">npm run generate-mof-rs-linkage</code>）。現状は予算年度2024（RS_2025）のみ対応。
      </p>
    );
  }

  return (
    <div className="min-w-[20rem] max-w-2xl">
      <div className="mb-1 text-[11px] font-medium text-neutral-400">
        紐づく RS 事業（自動突合・{links.length} 件）
      </div>
      {links.length === 0 ? (
        <p className="text-[11px] text-neutral-400">
          紐づく RS 事業は見つかりませんでした。国債費・地方交付税・特会繰入など事業として計上されない経費か、名称が大きく異なり自動突合の対象外の可能性があります。
        </p>
      ) : (
        <ul className="space-y-1 text-[11px]">
          {links.map(l => (
            <li key={`${l.projectId}-${l.method}`} className="flex items-start gap-1.5">
              <span
                className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[l.status]}`}
              >
                {STATUS_LABEL[l.status]}
              </span>
              <span className="flex-1">
                <span className="text-neutral-700 dark:text-neutral-300">{l.projectName}</span>
                <span className="ml-1 text-neutral-400">
                  （{l.projectMinistry}・{formatYen(l.rsAmount)}）
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
        事項と事業を直結する公式キーが無いため、構造キー（所管×組織×項）と名称の自動突合による参考情報です。
        確定＝名称完全一致、候補＝語幹一致など誤検出を含みうる判定です。
      </p>
    </div>
  );
}
