import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <main className="max-w-4xl w-full">
        <h1 className="text-4xl font-bold text-center mb-4 text-gray-900 dark:text-gray-100">
          RS2024 サンキー図
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-12">
          2024年度 行政事業レビューシステムの予算・支出データを可視化
        </p>

        <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
          {/* インタラクティブサンキー図 */}
          <Link href="/sankey">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
              <h2 className="text-2xl font-semibold mb-3 text-blue-600 dark:text-blue-400">
                📊 インタラクティブサンキー図
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                予算総計 → 府省庁（予算） → 事業（予算） → 事業（支出） → 支出先の5列フローを動的に可視化します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>府省庁ビュー</strong>: 府省庁ノードをクリックで詳細表示</li>
                <li>• <strong>事業ビュー</strong>: 事業ノードをクリックで支出先を詳細表示</li>
                <li>• <strong>支出ビュー</strong>: 支出先ノードをクリックで支出元（事業・府省庁）を逆向き表示</li>
                <li>• TopN設定: 各ビューごとに表示数を調整可能（デフォルト: 全体3、詳細10）</li>
                <li>• カバー率: 約50%（73.58兆円 / 146.63兆円）</li>
              </ul>
            </div>
          </Link>

          {/* MOF予算全体ビュー（NEW） */}
          <Link href="/mof-budget-overview">
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900 dark:to-pink-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-purple-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-purple-600 dark:text-purple-400">
                  🏛️ MOF予算全体ビュー
                </h2>
                <span className="ml-3 px-2 py-1 bg-purple-600 text-white text-xs font-bold rounded">
                  NEW
                </span>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                財務省予算総額（556.3兆円）とRS対象範囲（151.1兆円）を財源詳細から支出先まで一貫して可視化します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>財源詳細</strong>: 租税を税目別に分解（消費税、所得税、法人税等）</li>
                <li>• <strong>予算の流れ</strong>: 財源 → 会計区分 → RS対象区分 → 詳細内訳 → RS集約</li>
                <li>• <strong>RS対象率</strong>: 全体27.2%（一般会計63.4%、特別会計17.8%）</li>
                <li>• <strong>誤解防止</strong>: 国債費・地方交付税等の制度的支出を明示</li>
                <li>• データ年度: 2023年度（令和5年度）当初予算</li>
              </ul>
            </div>
          </Link>
        </div>

        <footer className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>データソース: <a href="https://rssystem.go.jp/download-csv/2024" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">行政事業レビューシステム (2024年度)</a></p>
        </footer>
      </main>
    </div>
  );
}
