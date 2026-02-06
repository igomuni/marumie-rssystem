'use client';

/**
 * MOF予算全体ビューページ
 *
 * 財務省予算総額（556.3兆円）とRS対象範囲（151.1兆円）を
 * 財源詳細から最終的な支出先まで可視化する
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ResponsiveSankey } from '@nivo/sankey';
import type {
  MOFBudgetOverviewData,
  MOFBudgetNodeDetails,
} from '@/types/mof-budget-overview';
import type { SankeyNode } from '@/types/sankey';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

export default function MOFBudgetOverviewPage() {
  const [data, setData] = useState<MOFBudgetOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // モバイル判定
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const response = await fetch('/api/sankey/mof-overview');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-2xl">
          <h2 className="text-red-800 text-xl font-bold mb-2">
            データ読み込みエラー
          </h2>
          <p className="text-red-700">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">データがありません</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                MOF予算全体ビュー
              </h1>
              <p className="text-gray-600 mt-2">
                財務省予算総額（556.3兆円）とRS対象範囲（151.1兆円）の可視化
              </p>
              <p className="text-sm text-gray-500 mt-1">
                データ年度: 2023年度（令和5年度）当初予算
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              ホームに戻る
            </Link>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="container mx-auto px-4 py-8">
        {/* サンキー図 */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">予算の流れ</h2>
          <div
            style={{
              height: isMobile ? '600px' : '900px',
              minWidth: isMobile ? '1200px' : '100%',
              overflowX: isMobile ? 'auto' : 'visible',
            }}
          >
            <ResponsiveSankey
              data={data.sankey}
              margin={
                isMobile
                  ? { top: 40, right: 150, bottom: 40, left: 150 }
                  : { top: 40, right: 250, bottom: 40, left: 250 }
              }
              align="justify"
              colors={getNodeColor}
              nodeOpacity={1}
              nodeHoverOthersOpacity={0.35}
              nodeThickness={24}
              nodeSpacing={16}
              nodeBorderWidth={0}
              nodeBorderRadius={3}
              linkOpacity={0.4}
              linkHoverOthersOpacity={0.1}
              linkBlendMode="multiply"
              enableLinkGradient={false}
              label={(node) => {
                const budget = formatBudgetFromYen(node.value);
                return `${node.name}\n${budget}`;
              }}
              labelPosition="outside"
              labelPadding={16}
              labelTextColor="#333"
              tooltip={({ node }) => renderTooltip(node as any)}
            />
          </div>
        </div>

        {/* サマリー情報 */}
        <SummaryPanel summary={data.summary} metadata={data.metadata} />

        {/* 説明パネル */}
        <ExplanationPanel />

        {/* 注記 */}
        <NotesPanel notes={data.metadata.notes} />
      </main>
    </div>
  );
}

/**
 * ノードの配色
 */
function getNodeColor(node: SankeyNode): string {
  const details = node.details as MOFBudgetNodeDetails | undefined;

  // 税目別
  if (node.type === 'tax-detail') {
    return '#10b981'; // 緑（持続可能な財源）
  }

  // 公債金
  if (node.type === 'public-bonds') {
    return '#ef4444'; // 赤（将来世代の負担）
  }

  // 社会保険料
  if (node.type === 'insurance-premium') {
    return '#3b82f6'; // 青（社会保険料）
  }

  // その他収入
  if (node.type === 'other-revenue') {
    return '#f59e0b'; // オレンジ
  }

  // 一般会計
  if (details?.accountType === '一般会計') {
    return '#bbdefb'; // 薄青
  }

  // 特別会計
  if (details?.accountType === '特別会計') {
    return '#90caf9'; // 青
  }

  // RS対象
  if (details?.category === 'RS対象') {
    return '#81c784'; // 緑
  }

  // RS対象外
  if (details?.category === 'RS対象外') {
    return '#ef9a9a'; // 薄赤
  }

  // 詳細内訳（RS対象）
  if (node.type === 'budget-detail' && details?.isRSTarget) {
    return '#66bb6a'; // 緑
  }

  // 詳細内訳（RS対象外）
  if (node.type === 'budget-detail' && !details?.isRSTarget) {
    return '#e57373'; // 赤
  }

  // RS集約
  if (node.type === 'rs-summary') {
    if (node.id === 'summary-rs-target') {
      return '#4caf50'; // 濃い緑
    }
    return '#f44336'; // 濃い赤
  }

  return '#9ca3af'; // デフォルト（グレー）
}

/**
 * ツールチップ
 */
function renderTooltip(node: SankeyNode & { details?: MOFBudgetNodeDetails }) {
  const details = node.details;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-md">
      <h3 className="font-bold text-lg mb-2">{node.name}</h3>
      <p className="text-2xl font-bold text-blue-600 mb-2">
        {formatBudgetFromYen(node.value)}
      </p>

      {details?.description && (
        <p className="text-sm text-gray-600 mb-2">{details.description}</p>
      )}

      {/* 税目別ノード */}
      {details?.taxType && (
        <div className="mt-2 text-sm">
          <p className="font-semibold">税目: {details.taxType}</p>
        </div>
      )}

      {/* 会計区分ノード */}
      {details?.accountType && (
        <div className="mt-2 text-sm border-t pt-2">
          <p>
            <span className="font-semibold">RS対象:</span>{' '}
            {formatBudgetFromYen(details.rsTargetAmount || 0)} (
            {details.rsTargetRate?.toFixed(1)}%)
          </p>
          <p>
            <span className="font-semibold">RS対象外:</span>{' '}
            {formatBudgetFromYen(details.rsExcludedAmount || 0)} (
            {(100 - (details.rsTargetRate || 0)).toFixed(1)}%)
          </p>
        </div>
      )}

      {/* RS対象区分ノード */}
      {details?.category && (
        <div className="mt-2 text-sm">
          <p>
            <span className="font-semibold">区分:</span> {details.category}
          </p>
          <p>
            <span className="font-semibold">親会計:</span>{' '}
            {details.parentAccount}
          </p>
        </div>
      )}

      {/* 詳細内訳ノード */}
      {details?.detailType && (
        <div className="mt-2 text-sm">
          <p>
            <span className="font-semibold">種別:</span> {details.detailType}
          </p>
          <p>
            <span className="font-semibold">RS対象:</span>{' '}
            {details.isRSTarget ? 'はい' : 'いいえ'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * サマリーパネル
 */
function SummaryPanel({
  summary,
  metadata,
}: {
  summary: MOFBudgetOverviewData['summary'];
  metadata: MOFBudgetOverviewData['metadata'];
}) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
      <h2 className="text-xl font-bold mb-4">予算サマリー</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 全体 */}
        <div className="border-l-4 border-blue-600 pl-4">
          <h3 className="font-semibold text-gray-700 mb-2">予算総額</h3>
          <p className="text-3xl font-bold text-blue-600">
            {formatBudgetFromYen(metadata.totalBudget)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            一般会計 + 特別会計（重複含む）
          </p>
        </div>

        {/* RS対象 */}
        <div className="border-l-4 border-green-600 pl-4">
          <h3 className="font-semibold text-gray-700 mb-2">RS対象</h3>
          <p className="text-3xl font-bold text-green-600">
            {formatBudgetFromYen(metadata.rsTargetBudget)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            事業レビュー対象（{summary.overall.rsTargetRate.toFixed(1)}%）
          </p>
        </div>

        {/* RS対象外 */}
        <div className="border-l-4 border-red-600 pl-4">
          <h3 className="font-semibold text-gray-700 mb-2">RS対象外</h3>
          <p className="text-3xl font-bold text-red-600">
            {formatBudgetFromYen(metadata.rsExcludedBudget)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            制度的支出（{(100 - summary.overall.rsTargetRate).toFixed(1)}%）
          </p>
        </div>
      </div>

      {/* 詳細情報 */}
      <div className="mt-6 pt-6 border-t grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 一般会計 */}
        <div>
          <h4 className="font-semibold text-gray-800 mb-3">一般会計</h4>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="py-1 text-gray-600">総額</td>
                <td className="py-1 text-right font-semibold">
                  {formatBudgetFromYen(summary.generalAccount.total)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象</td>
                <td className="py-1 text-right text-green-600 font-semibold">
                  {formatBudgetFromYen(summary.generalAccount.rsTarget)} (
                  {summary.generalAccount.rsTargetRate.toFixed(1)}%)
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象外</td>
                <td className="py-1 text-right text-red-600 font-semibold">
                  {formatBudgetFromYen(summary.generalAccount.rsExcluded)} (
                  {(100 - summary.generalAccount.rsTargetRate).toFixed(1)}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 特別会計 */}
        <div>
          <h4 className="font-semibold text-gray-800 mb-3">特別会計</h4>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="py-1 text-gray-600">総額</td>
                <td className="py-1 text-right font-semibold">
                  {formatBudgetFromYen(summary.specialAccount.total)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象</td>
                <td className="py-1 text-right text-green-600 font-semibold">
                  {formatBudgetFromYen(summary.specialAccount.rsTarget)} (
                  {summary.specialAccount.rsTargetRate.toFixed(1)}%)
                </td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">RS対象外</td>
                <td className="py-1 text-right text-red-600 font-semibold">
                  {formatBudgetFromYen(summary.specialAccount.rsExcluded)} (
                  {(100 - summary.specialAccount.rsTargetRate).toFixed(1)}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * 説明パネル
 */
function ExplanationPanel() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
      <h2 className="text-xl font-bold text-blue-900 mb-4">
        サンキー図の見方
      </h2>

      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-blue-800 mb-2">各列の説明</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li>
              <span className="font-semibold">Column 1（左端）:</span>{' '}
              財源詳細（税目別、公債金、社会保険料等）
            </li>
            <li>
              <span className="font-semibold">Column 2:</span>{' '}
              会計区分（一般会計 vs 特別会計）
            </li>
            <li>
              <span className="font-semibold">Column 3:</span>{' '}
              RS対象区分（事業レビュー対象 vs 対象外）
            </li>
            <li>
              <span className="font-semibold">Column 4:</span>{' '}
              詳細内訳（国債費、地方交付税、年金事業等）
            </li>
            <li>
              <span className="font-semibold">Column 5（右端）:</span>{' '}
              RS集約（RSシステム対象 vs RS対象外）
            </li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-blue-800 mb-2">配色の意味</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-600 rounded mr-2"></div>
              <span>租税（持続可能な財源）</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-red-600 rounded mr-2"></div>
              <span>公債金（国債、将来世代の負担）</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-blue-600 rounded mr-2"></div>
              <span>社会保険料</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-500 rounded mr-2"></div>
              <span>RS対象（事業レビュー対象）</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-red-400 rounded mr-2"></div>
              <span>RS対象外（制度的支出）</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 注記パネル
 */
function NotesPanel({ notes }: { notes: string[] }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
      <h2 className="text-xl font-bold text-yellow-900 mb-4">重要な注意事項</h2>

      <ul className="space-y-3 text-sm text-gray-700">
        {notes.map((note, index) => (
          <li key={index} className="flex items-start">
            <span className="text-yellow-600 mr-2">⚠️</span>
            <span>{note}</span>
          </li>
        ))}

        <li className="flex items-start mt-4 pt-4 border-t border-yellow-300">
          <span className="text-yellow-600 mr-2">📊</span>
          <span>
            詳細な分析結果は以下のドキュメントをご参照ください:{' '}
            <Link
              href="https://github.com/igomuni/marumie-rssystem/blob/main/docs/20260202_0000_MOF%E4%BA%88%E7%AE%97%E5%85%A8%E4%BD%93%E3%81%A8RS%E5%AF%BE%E8%B1%A1%E7%AF%84%E5%9B%B2%E3%81%AE%E5%8F%AF%E8%A6%96%E5%8C%96.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              MOF予算全体とRS対象範囲の可視化
            </Link>
          </span>
        </li>
      </ul>
    </div>
  );
}
