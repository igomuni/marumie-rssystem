'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { QualityScoreItem } from '@/app/api/quality-scores/route';
import type { RecipientRow } from '@/app/api/quality-scores/recipients/route';
import type { ProjectDetail } from '@/types/project-details';
import { externalCorporateLinks } from '@/app/lib/api/links';
import { scoreColor, formatAmount, pct } from '@/client/components/quality/score-format';

const STATUS_META: Record<RecipientRow['s'], { label: string; cls: string }> = {
  valid:   { label: 'OK',      cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  gov:     { label: '行政機関', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  supp:    { label: '補助辞書', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  // 番号一致(houjin.db裏取り)も表示上は valid と同格の OK に統合（内部 s='cn' と cnVerifiedCount は集計用に保持）
  cn:      { label: 'OK',      cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  invalid: { label: '不一致',  cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  unknown: { label: '未登録',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

// データ（recipients / projectInfo）はページ側が useScoreDetailData で取得して渡す。
// このコンポーネントは client/components 配下の再利用UIのため直接 API を叩かない（Issue #246）。
export function ScoreDetailDialog({
  item,
  onClose,
  recipients,
  recipientsError,
  projectInfo,
}: {
  item: QualityScoreItem;
  onClose: () => void;
  recipients: RecipientRow[] | null;
  recipientsError: boolean;
  projectInfo: ProjectDetail | null | undefined;
}) {
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSortField, setRecipientSortField] = useState<'chain' | 'b' | 's' | 'c' | 'o' | 'a2' | 'pct'>('chain');
  const [recipientSortDir, setRecipientSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAxisDetail, setShowAxisDetail] = useState(false);
  const [showProjectInfo, setShowProjectInfo] = useState(true);
  const COL_MAX_WIDTHS = [undefined, 70, 130, 60, 50, undefined, undefined];
  const [colWidths, setColWidths] = useState<number[]>([200, 70, 120, 60, 50, 200, 200]);
  const resizingCol = useRef<{ index: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const { index, startX, startW } = resizingCol.current;
      const maxW = COL_MAX_WIDTHS[index];
      const newW = Math.min(maxW ?? Infinity, Math.max(40, startW + e.clientX - startX));
      setColWidths(prev => { const next = [...prev]; next[index] = newW; return next; });
    };
    const onMouseUp = () => { resizingCol.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  // Escape で閉じる（キーボード操作でのダイアログ dismiss）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 事業（pid）が切り替わったら表示状態（検索・ソート・折りたたみ）を初期化する。
  // データ取得はページ側の useScoreDetailData が担う。
  useEffect(() => {
    setRecipientSearch('');
    setRecipientSortField('chain');
    setRecipientSortDir('asc');
    setShowAxisDetail(false);
    setShowProjectInfo(true);
  }, [item.pid]);

  const displayedRecipients = useMemo(() => {
    if (!recipients) return [];
    let rows = recipients;
    if (recipientSearch.trim()) {
      const q = recipientSearch.trim().toLowerCase();
      rows = rows.filter(r => r.n.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (recipientSortField === 'chain') cmp = (a.chain ?? a.b).localeCompare(b.chain ?? b.b) || (b.a2 ?? -1) - (a.a2 ?? -1);
      else if (recipientSortField === 'b') cmp = a.b.localeCompare(b.b) || (b.a2 ?? -1) - (a.a2 ?? -1);
      else if (recipientSortField === 's') cmp = a.s.localeCompare(b.s);
      else if (recipientSortField === 'c') cmp = (b.c ? 1 : 0) - (a.c ? 1 : 0);
      else if (recipientSortField === 'o') cmp = (b.o ? 1 : 0) - (a.o ? 1 : 0);
      else if (recipientSortField === 'a2') cmp = (b.a2 ?? -1) - (a.a2 ?? -1);
      else if (recipientSortField === 'pct') {
        const net = item.spendNetTotal || 1;
        const ap = a.a2 !== null && a.a2 > 0 ? a.a2 / net : -1;
        const bp = b.a2 !== null && b.a2 > 0 ? b.a2 / net : -1;
        cmp = bp - ap;
      }
      return recipientSortDir === 'desc' ? -cmp : cmp;
    });
  }, [recipients, recipientSearch, recipientSortField, recipientSortDir]);

  function handleRecipientSort(field: typeof recipientSortField) {
    if (recipientSortField === field) {
      setRecipientSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setRecipientSortField(field);
      setRecipientSortDir(field === 'a2' || field === 'pct' ? 'desc' : 'asc');
    }
  }

  const axes = [
    { key: 'axisIdentify', label: 'A: 特定可能性', weight: 28, score: item.axisIdentify ?? null },
    { key: 'axisPurpose', label: 'B: 使途の説明性', weight: 22, score: item.axisPurpose ?? null },
    { key: 'axisBudget', label: 'C: 収支の整合性', weight: 15, score: item.axisBudget ?? null },
    { key: 'axisEffective', label: 'E: 有効性', weight: 35, score: item.axisEffective ?? null },
    { key: 'axisStructure', label: 'D: 構造(参考)', weight: 0, score: item.axisStructure ?? null },
  ] as const;
  const isAi = !!item.aiSource && item.aiSource !== 'heuristic';

  const axis1Total = item.validCount + item.govAgencyCount + item.suppValidCount + item.invalidCount;
  const axis1Num = item.validCount + item.govAgencyCount + item.suppValidCount;

  function RSortIcon({ field }: { field: typeof recipientSortField }) {
    if (recipientSortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-400 ml-0.5">{recipientSortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="presentation"
      // 背面（サンキー図）の React パンハンドラへドラッグ/リサイズが伝播しないよう遮断
      // （createPortal は DOM を分離するが React 合成イベントは親ツリーへバブリングするため）
      onMouseDown={e => e.stopPropagation()}
      onMouseMove={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-7xl mx-4 max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-3 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3 shrink-0 bg-gray-50 dark:bg-gray-800 rounded-t-2xl">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900 dark:text-white leading-snug">{item.name}</div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="font-mono bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">PID {item.pid}</span>
              {[item.ministry, item.bureau, item.division, item.section, item.office, item.team, item.unit].filter(Boolean).map((org, i) => (
                <span key={i}>{i > 0 ? '' : ''}<span className={i === 0 ? 'font-medium' : ''}>{org}</span>{i < [item.ministry, item.bureau, item.division, item.section, item.office, item.team, item.unit].filter(Boolean).length - 1 ? <span className="text-gray-300 dark:text-gray-600 mx-0.5">›</span> : null}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">×</button>
        </div>

        {/* Score summary — single compact row */}
        <div className="px-3 sm:px-6 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            {/* Score badge */}
            <div className="shrink-0 text-center">
              <div className={`text-2xl font-bold font-mono leading-none ${scoreColor(item.totalScore)}`}>
                {item.totalScore !== null ? item.totalScore.toFixed(1) : '-'}
              </div>
              <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">総合</div>
            </div>
            {/* Divider */}
            <div className="hidden sm:block w-px h-8 bg-gray-200 dark:bg-gray-700 shrink-0" />
            {/* Axis scores — horizontal row */}
            <div className="flex items-center gap-3 shrink-0">
              {axes.map(a => (
                <div key={a.key} className="text-center">
                  <div className={`text-xs font-bold font-mono leading-none ${scoreColor(a.score)}`}>
                    {a.score !== null ? a.score.toFixed(0) : '-'}
                  </div>
                  <div className="text-[8px] text-gray-400 mt-0.5 whitespace-nowrap">{a.label.replace(/^[A-D]: /, '')}</div>
                </div>
              ))}
            </div>
            {/* Divider */}
            <div className="hidden sm:block w-px h-8 bg-gray-200 dark:bg-gray-700 shrink-0" />
            {/* Key metrics — 3 lines inline（モバイルでは独立行に折り返す） */}
            <div className="basis-full sm:basis-0 sm:flex-1 min-w-0 text-[10px] text-gray-700 dark:text-gray-200 space-y-0.5">
              <div className="flex flex-wrap gap-x-3">
                <span><span className="text-gray-400">予算:</span><span className="font-mono">{formatAmount(item.budgetAmount)}</span></span>
                <span><span className="text-gray-400">執行:</span><span className="font-mono">{formatAmount(item.execAmount)}</span></span>
                <span><span className="text-gray-400">実質支出:</span><span className="font-mono">{formatAmount(item.spendNetTotal)}</span></span>
                <span><span className="text-gray-400">乖離率:</span><span className="font-mono">{pct(item.gapRatio)}</span></span>
              </div>
              <div className="flex flex-wrap gap-x-3">
                <span><span className="text-gray-400">支出先数:</span><span className="font-mono">{recipients?.length ?? '...'}</span></span>
                <span><span className="text-gray-400">ブロック:</span>{item.blockCount}件</span>
                {item.hasRedelegation && <span><span className="text-gray-400">深度:</span><span className="text-orange-500">{item.redelegationDepth}</span></span>}
                {item.opaqueRatio !== null && item.opaqueRatio > 0 && <span><span className="text-gray-400">不透明:</span><span className="text-amber-500">{pct(item.opaqueRatio)}</span></span>}
              </div>
              <div className="flex flex-wrap gap-x-3 items-center">
                {item.identifyLevelAvg != null && <span><span className="text-gray-400">特定Lv</span> <span className="font-mono">{item.identifyLevelAvg.toFixed(1)}/3</span></span>}
                {item.purposeLevelAvg != null && <span><span className="text-gray-400">使途Lv</span> <span className="font-mono">{item.purposeLevelAvg.toFixed(1)}/3</span></span>}
                <span><span className="text-gray-400">valid</span> <span className="font-mono">{axis1Num}/{axis1Total}</span></span>
                <span><span className="text-gray-400">法人番号</span> <span className="font-mono">{item.cnFilled}/{item.cnFilled + item.cnEmpty}</span></span>
                {item.aiSource && (
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${isAi ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`} title={item.aiSource}>
                    {isAi ? 'AI評価' : 'ヒューリスティック'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-4">
            <button
              onClick={() => setShowProjectInfo(d => !d)}
              className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showProjectInfo ? '▲ 事業内容を閉じる' : '▼ 事業内容'}
            </button>
            <button
              onClick={() => setShowAxisDetail(d => !d)}
              className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showAxisDetail ? '▲ 計算根拠を閉じる' : '▼ スコア計算根拠'}
            </button>
          </div>
        </div>

        {/* 事業内容（目的・現状課題・概要）— 有効性軸の判定材料 */}
        {showProjectInfo && (
          <div className="px-3 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0 overflow-y-auto max-h-60 bg-gray-50/60 dark:bg-gray-800/40">
            {projectInfo === undefined && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="animate-spin h-3 w-3 border border-gray-400 border-t-transparent rounded-full" />
                事業内容を読み込み中...
              </div>
            )}
            {projectInfo === null && <div className="text-xs text-gray-400">事業内容データなし</div>}
            {projectInfo && (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                  {projectInfo.category && <span>区分: {projectInfo.category}</span>}
                  {projectInfo.startYear && <span>開始: {projectInfo.startYear}年度</span>}
                  <span>終了: {projectInfo.noEndDate ? '予定なし' : (projectInfo.endYear ? `${projectInfo.endYear}年度` : '-')}</span>
                  {projectInfo.implementationMethods?.length > 0 && <span>実施方法: {projectInfo.implementationMethods.join('・')}</span>}
                  {projectInfo.url && <a href={projectInfo.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">事業概要URL ↗</a>}
                </div>
                {([
                  { label: '目的', text: projectInfo.purpose },
                  { label: '現状・課題', text: projectInfo.currentIssues },
                  { label: '概要', text: projectInfo.overview },
                ] as const).map(({ label, text }) => text ? (
                  <div key={label}>
                    <div className="font-semibold text-gray-700 dark:text-gray-300">{label}</div>
                    {/* 「/」を改行に変換しない（URL・補助率1/2・日付を壊さない）。ソース表記のまま表示。
                        経緯は docs/tasks/20260706_1731_事業テキストのスラッシュ改行問題.md 参照。 */}
                    <div className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed break-words">{text}</div>
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        )}

        {/* Axis detail (collapsible) */}
        {showAxisDetail && (
          <div className="border-b border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 shrink-0 overflow-y-auto max-h-72">
            <div className="px-5 py-1.5 bg-violet-50/60 dark:bg-violet-900/20 text-[11px] text-gray-500 dark:text-gray-400">
              軸A・Bは{isAi ? 'AIが' : 'ヒューリスティックが'}支出先ごとに特定可能性・使途を判定し金額加重で集計。軸C・Dは機械計算。
            </div>

            {/* Axis A: 特定可能性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">A: 支出先の特定可能性（重み28%・{isAi ? 'AI' : 'ヒューリスティック'}判定）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>支出先が具体的に誰で、第三者が実在を確認できるか（名称・法人番号有無・契約概要を総合判定）</div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.identifyLevelAvg != null && <span>平均レベル: {item.identifyLevelAvg.toFixed(2)}/3</span>}
                  <span className="text-green-600 dark:text-green-400">valid: {item.validCount}</span>
                  {item.govAgencyCount > 0 && <span className="text-emerald-500">行政機関: {item.govAgencyCount}</span>}
                  {item.suppValidCount > 0 && <span className="text-blue-500">補助: {item.suppValidCount}</span>}
                  <span className="text-red-500">invalid: {item.invalidCount}</span>
                  {item.opaqueRatio != null && item.opaqueRatio > 0 && <span className="text-amber-500">不透明: {pct(item.opaqueRatio)}</span>}
                  <span>= {item.axisIdentify != null ? item.axisIdentify.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis B: 使途の説明性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">B: 使途の説明性（重み22%・{isAi ? 'AI' : 'ヒューリスティック'}判定）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>役割・契約概要から「何にいくら使ったか」が理解・検証できるか</div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.purposeLevelAvg != null && <span>平均レベル: {item.purposeLevelAvg.toFixed(2)}/3</span>}
                  <span>= {item.axisPurpose != null ? item.axisPurpose.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis C: 収支整合性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">C: 収支の整合性（重み15%・機械計算）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span>予算額: {formatAmount(item.budgetAmount)}</span>
                  <span>執行額: {formatAmount(item.execAmount)}</span>
                  <span>実質支出: {formatAmount(item.spendNetTotal)}</span>
                </div>
                <div className="font-mono text-gray-400">
                  執行 vs 実質支出 乖離 {pct(item.gapRatio)}（10%まで満点の許容バンド）→ {item.axisBudget != null ? item.axisBudget.toFixed(1) : '-'}点
                </div>
              </div>
            </div>

            {/* Axis D: 構造整合性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">D: 構造の整合性（参考・総合に不算入・機械計算）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span>ブロック数: {item.blockCount}</span>
                  {item.orphanBlockCount > 0 && <span className="text-orange-500">孤立: {item.orphanBlockCount}</span>}
                  {item.hasRedelegation && <span className="text-gray-400">再委託深度: {item.redelegationDepth}（減点せず参考）</span>}
                </div>
                <div className="flex gap-2 flex-wrap font-mono text-gray-400">
                  <span>基礎100 − ブロック金額不整合 − 孤立ブロック</span>
                  <span>= {item.axisStructure != null ? item.axisStructure.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis E: 有効性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">E: 有効性／成果設計の明確さ（重み35%・{isAi ? 'AI' : 'ヒューリスティック'}判定）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>事業の目的・現状課題・概要から、国民生活への寄与がどれだけ明確・妥当に説明されているか（※実測成果ではなく成果設計の明確さ）</div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.effectiveLevel != null && <span>レベル: {item.effectiveLevel}/10</span>}
                  <span>= {item.axisEffective != null ? item.axisEffective.toFixed(1) : '-'}点</span>
                </div>
                {item.effectiveReason && item.effectiveReason !== 'heuristic' && (
                  <div className="text-gray-500 dark:text-gray-400">根拠: {item.effectiveReason}</div>
                )}
              </div>
            </div>

            {/* Weighted sum */}
            <div className="px-5 py-2 bg-gray-50 dark:bg-gray-800">
              <div className="text-xs font-mono text-gray-400">
                {axes.filter(a => a.score !== null && a.weight > 0).map(a => `${a.score!.toFixed(1)}×${a.weight}`).join(' + ')}
                {' '}= <span className={`font-bold ${scoreColor(item.totalScore)}`}>{item.totalScore?.toFixed(1)}</span>点
              </div>
            </div>
          </div>
        )}

        {/* Recipients */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-3 sm:px-6 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
                支出先一覧
                {recipients && (
                  <span className="ml-1.5 text-gray-400 font-normal font-mono">
                    {recipientSearch.trim() && displayedRecipients.length !== recipients.length
                      ? `${displayedRecipients.length} / ${recipients.length}件`
                      : `${recipients.length}件`}
                  </span>
                )}
              </div>
              {recipients && recipients.length > 0 && (
                <input
                  type="text"
                  placeholder="支出先名で検索..."
                  value={recipientSearch}
                  onChange={e => setRecipientSearch(e.target.value)}
                  className="flex-1 px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none"
                />
              )}
            </div>
          </div>

          {recipientsError && (
            <div className="px-6 py-4 text-xs text-gray-400">
              データを読み込めません（<code>python3 scripts/score-project-quality.py</code> を実行してください）
            </div>
          )}
          {!recipientsError && recipients === null && (
            <div className="px-6 py-4 flex items-center gap-2 text-xs text-gray-400">
              <div className="animate-spin h-3 w-3 border border-gray-400 border-t-transparent rounded-full" />
              読み込み中...
            </div>
          )}
          {recipients && recipients.length === 0 && (
            <div className="px-6 py-4 text-xs text-gray-400">支出先データなし</div>
          )}
          {recipients && recipients.length > 0 && (
            <div className="overflow-auto flex-1">
              <table className="w-full min-w-[720px] text-xs table-fixed">
                <colgroup>
                  {colWidths.map((w, i) => <col key={i} style={{ width: w, maxWidth: COL_MAX_WIDTHS[i] }} />)}
                </colgroup>
                <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10">
                  <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    {([
                      { label: '支出先名', align: 'left', sort: null, title: undefined },
                      { label: '委託チェーン', align: 'left', sort: 'chain' as const, title: '委託チェーン（A→B→C）でソート' },
                      { label: '法人番号', align: 'center', sort: 'c' as const, title: '法人番号(Corporate Number)。記入有無でソート。⚠は形式不正（誤記載の疑い）' },
                      { label: '金額', align: 'right', sort: 'a2' as const, title: '個別支出額（CSVの「金額」列）' },
                      { label: '実支出比', align: 'right', sort: 'pct' as const, title: '実質支出合計に対する割合' },
                      { label: '役割', align: 'left', sort: null, title: '事業を行う上での役割（ブロック単位）' },
                      { label: '契約概要', align: 'left', sort: null, title: undefined },
                    ] as const).map((col, ci) => (
                      <th
                        key={ci}
                        className={`px-3 py-2 font-semibold whitespace-nowrap select-none relative ${col.sort ? 'cursor-pointer hover:text-gray-800 dark:hover:text-gray-200' : ''} text-${col.align}`}
                        onClick={col.sort ? () => handleRecipientSort(col.sort!) : undefined}
                        title={col.title}
                      >
                        <span className="truncate block overflow-hidden">{col.label}{col.sort && <RSortIcon field={col.sort} />}</span>
                        <div
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-500 z-20"
                          onMouseDown={e => { e.preventDefault(); resizingCol.current = { index: ci, startX: e.clientX, startW: colWidths[ci] }; }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {displayedRecipients.map((row, i) => {
                    const sm = STATUS_META[row.s];
                    return (
                      <tr key={i} className="hover:bg-blue-50/50 dark:hover:bg-gray-800/60 transition-colors">
                        <td className="px-4 py-1.5 text-gray-800 dark:text-gray-200 font-medium" title={row.n}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate flex-1">{row.n}</span>
                            {!row.o && <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${sm.cls}`}>{sm.label}</span>}
                            {row.o && <span className="shrink-0 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" title="不透明キーワードにマッチ">不透明</span>}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-500 dark:text-gray-400 truncate" title={row.chain}>
                          {row.chain
                            ? (row.chain.startsWith('組織→') ? row.chain.slice('組織→'.length) : row.chain)
                            : (row.b || '-')}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {(() => {
                            const cn = row.cn?.trim() ?? '';
                            if (!cn) return <span className="text-gray-300 dark:text-gray-600">—</span>;
                            // 有効な法人番号のみ gBizINFO へリンク（検証・URL構築は共有ヘルパーに集約）
                            // 番号はコピペ用に選択可能なテキストのままにし、リンクジャンプはアイコンクリック時のみ
                            const links = externalCorporateLinks(cn);
                            if (links) {
                              return (
                                <span className="inline-flex items-center gap-1 font-mono text-[10px] leading-none text-gray-600 dark:text-gray-300" title={cn}>
                                  <span className="select-text leading-none">{cn}</span>
                                  <a
                                    href={links.gbizinfo}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 inline-flex items-center -mt-0.5 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                                    title={`gBizINFO で法人番号を確認: ${cn}`}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="currentColor" className="block" aria-hidden="true">
                                      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
                                    </svg>
                                  </a>
                                </span>
                              );
                            }
                            return (
                              <span
                                className="font-mono text-[10px] text-amber-700 dark:text-amber-300 font-semibold"
                                title={`法人番号の形式が不正（誤記載の疑い）: ${cn}`}
                              >
                                {cn}<span className="ml-0.5">⚠</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {row.a2 === null ? <span className="text-gray-300 dark:text-gray-600">—</span> : formatAmount(row.a2)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-400 whitespace-nowrap">
                          {row.a2 !== null && row.a2 > 0 && item.spendNetTotal > 0
                            ? (() => { const p = row.a2 / item.spendNetTotal * 100; return p >= 1 ? `${p.toFixed(0)}%` : '<1%'; })()
                            : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 truncate" title={row.role || undefined}>
                          {row.role || <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 truncate" title={row.cc || undefined}>
                          {row.cc || <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
