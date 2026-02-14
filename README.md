# RS2024 サンキー図システム

2024年度 行政事業レビューシステムの予算・支出データをサンキー図で可視化するWebアプリケーション。

> **データについて**: 2024年度シート（事業年度）に記録された**予算年度2023年度の実績**データです。
> 総予算 **151.12兆円**（歳出予算現額）/ **5,003事業** / **26,823支出先**（再委託先含む）

## 概要

本システムは、日本政府の行政事業レビューシステム（RS System）の2024年度データを使用して、予算配分と支出フローを視覚的に表現します。
対象データは行政事業レビューの対象事業のみ（国の全予算 約556兆円の約27%）です。詳細は [docs/rs-data-scope.md](docs/rs-data-scope.md) を参照してください。

### 主な機能

- **📊 5列サンキー図**: 予算総計 → 府省庁（予算）→ 事業（予算）→ 事業（支出）→ 支出先の全体フローを可視化
- **🔍 4つのビューモード**:
  - **全体ビュー**: 受給者ファースト - TopN支出先から主要な資金フローを追跡
  - **府省庁ビュー**: 特定府省庁の事業と支出先の詳細
  - **事業ビュー**: 個別事業の支出内訳を詳細表示
  - **支出ビュー**: 受給者からの逆引き - 特定支出先への全資金源を表示（4列: 府省庁予算 → 事業予算 → 事業支出 → 受給者）
- **🔗 再委託先ノード（全体ビュー）**: 再委託先への支出フローを独立ノードとして表示
- **👥 間接支出先表示**: 支出先一覧に直接委託先を経由した再委託先情報を展開表示（委託元チェーンパス付き）
- **📋 事業一覧モーダル**: 全5,003事業を検索・ソート・フィルタリング
  - 府省庁フィルター（マルチ選択、予算額降順）
  - 事業名・支出先検索
  - 支出先展開/まとめ表示切替
  - クリック位置による自動ビュー遷移（府省庁列→府省庁ビュー、事業列→事業ビュー、支出先列→支出ビュー）
  - ソート機能（府省庁、事業名、支出先、予算、支出、執行率）
  - 金額範囲フィルター（予算・支出それぞれに上限下限設定可能、日本語単位入力対応: 例 `5,074.75億円`）
  - 予算・支出の合計値表示（重複カウント防止機能付き）
  - ページネーション（100件/ページ）
- **⚙️ カスタマイズ可能なTopN設定**: 各ビューで表示する項目数を調整可能（デフォルト: 府省庁10, 支出先10, 事業15, 支出元20）
- **💰 支出先名「その他」の独立表示**: 支出先名が「その他」の項目を「支出先(TopN以外)」とは別に集約表示
- **📱 モバイル対応**: スマートフォンでも横スクロールで閲覧可能
- **🎨 ビュー別の色分け**:
  - 予算ビュー: 予算ノード（緑系）、支出ノード（赤系）
  - 支出ビュー: 予算ノード（緑系）、支出ノード（赤系）で予算から支出への流れを表現
  - TopN以外ノード: グレー系で明確に区別
- **🔗 インタラクティブなナビゲーション**: ノードクリックでドリルダウン、パンくずリストで階層移動
- **💾 URL状態同期**: すべてのビュー状態がURLに保存され、共有・ブックマーク可能
- **📌 固定UIボタン**: 画面右上に常時表示される「事業一覧」「設定」「Topへ戻る」ボタン

## 技術スタック

- **フロントエンド**: Next.js 15 (App Router), React 18, TypeScript
- **スタイリング**: Tailwind CSS
- **可視化**: @nivo/sankey
- **データ処理**: Python 3 (neologdn), Node.js (TypeScript)

## データフロー

### 5列サンキー図構造（全体ビュー）

```
予算総計 (151.12兆円)
  ├─ 府省庁（予算）TopN (デフォルト10)
  │   ├─ 事業（予算）TopN
  │   │   ├─ 事業（支出）
  │   │   │   ├─ 支出先 TopN (デフォルト10)
  │   │   │   ├─ その他（支出先名が「その他」）
  │   │   │   └─ 支出先(TopN以外)
  │   │   └─ 事業(TopN以外) → その他 / 支出先(TopN以外)
  │   └─ 府省庁(TopN以外) → 事業(TopN以外) → その他 / 支出先(TopN以外)
  └─ 府省庁(TopN以外) → その他 / 支出先(TopN以外)
```

### ビューモード詳細

#### 1. 全体ビュー（Global View）
- **特徴**: 受給者ファースト - TopN支出先を基準にデータを選択
- **データ選択フロー**:
  1. TopN支出先を選択（支出額順）
  2. それらに支出しているプロジェクトをTopN選択（寄与額順）
  3. それらのプロジェクトが属する府省庁をTopN選択（予算順）
- **色**: 予算ノード（緑系）、支出ノード（赤系）

#### 2. 府省庁ビュー（Ministry View）
- **特徴**: 特定府省庁の全事業と支出先を詳細表示
- **ナビゲーション**: 全体ビューで府省庁ノードをクリック
- **ドリルダウン機能**: 「事業(TopN以外)」ノードをクリックすることで、次のTopN事業を表示
  - 動的ラベル: ドリルダウンレベルに応じて「事業(Top20以外)」「事業(Top30以外)」と表示
  - 支出先TopN: 現在表示中の事業のみから選出（ドリルダウンで除外された事業の支出先は含まれない）
- **色**: 予算ノード（緑系）、支出ノード（赤系）

#### 3. 事業ビュー（Project View）
- **特徴**: 個別事業の支出内訳を詳細表示（TopNデフォルト15）
- **ナビゲーション**: 府省庁ビューまたは全体ビューで事業ノードをクリック
- **色**: 予算ノード（緑系）、支出ノード（赤系）

#### 4. 支出ビュー（Spending View）
- **特徴**: 受給者への全資金源を4列で表示（支出元TopNデフォルト15）
  - Column 0: 府省庁予算ノード（緑）
  - Column 1: 事業予算ノード（緑）+ 事業(TopN以外)予算ノード
  - Column 2: 事業支出ノード（赤）+ 事業(TopN以外)支出ノード
  - Column 3: 受給者ノード（赤）
- **ナビゲーション**: 任意のビューで受給者ノードをクリック、または事業一覧モーダルの支出先列をクリック
- **色**: 予算ノード（緑系）、支出ノード（赤系）で予算から支出への流れを明示

### 重要な設計ポイント

1. **「その他」ノードと「支出先(TopN以外)」ノードの分離**
   - **「その他」ノード**: 支出先名が「その他」である全事業からの支出を集約（約26兆円）
   - **「支出先(TopN以外)」ノード**: TopN以外の支出先 + 事業(TopN以外) + 府省庁(TopN以外)（約51兆円）
   - 両者は独立した最終ノードで、相互にリンクは存在しない

2. **TopN選択アルゴリズム**
   - **全体ビュー**: 受給者ファースト - 支出先 → プロジェクト → 府省庁の順で選択
   - **府省庁/事業ビュー**: 予算額ベースでソート（歳出予算現額合計）
   - **支出ビュー**: 寄与額順でプロジェクトをソート
   - 支出先選択時に「その他」を事前除外してTopNを選択

3. **予算0円で支出がある事業の扱い**
   - ノード値: ダミー値0.001円を使用（表示では0円と表示）
   - リンク値: 同様にダミー値0.001円
   - 理由: Sankey図でノードを表示するため（値0だと非表示になる）
   - 例: 経済産業省グリーンイノベーション基金事業

4. **URL状態管理**
   - すべてのビュー状態（選択府省庁、事業、受給者、TopN設定）をURLクエリパラメータに保存
   - ページリロード、ブックマーク、共有が可能
   - ブラウザの戻る/進むボタンに対応

## セットアップ

### 前提条件

- Node.js 18以上
- Python 3.x
- pip3

### 1. リポジトリのクローン

```bash
git clone git@github.com:igomuni/marumie-rssystem.git
cd marumie-rssystem
```

### 2. 依存パッケージのインストール

```bash
# Node.js依存関係
npm install

# Python依存関係（正規化ライブラリ）
pip3 install neologdn
```

### 3. CSVデータの準備と正規化

[行政事業レビューシステム](https://rssystem.go.jp/download-csv/2024)からZIPファイルをダウンロードし、`data/download/RS_2024/` に配置してください。

```bash
npm run normalize
```

このコマンドは以下の処理を自動実行します:

1. **ZIP解凍**: `data/download/RS_2024/` 内の全ZIPファイルを解凍
2. **CSV正規化**: 解凍したCSVファイルを正規化
   - neologdnによる正規化（最優先）
   - 丸数字の変換（①→1）
   - Unicode NFKC正規化
   - 和暦→西暦変換
   - 全角括弧→半角括弧変換
   - ハイフン・長音記号の統一
   - 連続空白の削除
3. **出力**: 正規化されたCSVを `data/year_2024/` にUTF-8形式で保存
4. **クリーンアップ**: `data/download/RS_2024/` 内のZIP以外のファイルを削除

### 4. 構造化JSONデータの生成

```bash
npm run generate-structured
```

このコマンドは `public/data/rs2024-structured.json` を生成します。
- 府省庁・事業・支出先の階層構造を保持
- 予算情報（当初予算、補正予算、繰越等）を統合
- 支出情報と関連付け
- ファイルサイズ: 約96MB

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3002](http://localhost:3002) を開いてください。

---

### クイックセットアップ（初回）

依存関係のインストールから正規化・JSON生成まで一括実行:

```bash
npm run setup
```

このコマンドは以下を自動実行します:
1. `npm install` - 依存パッケージのインストール
2. `npm run normalize` - CSVファイルの正規化
3. `npm run generate-structured` - 構造化JSONの生成

**注意**: 事前に `data/download/RS_2024/` にZIPファイルを配置し、Python 3とneologdnをインストールしてください。

## プロジェクト構成

```
marumie-rssystem/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # ルートレイアウト
│   ├── page.tsx                 # ホーム画面（リダイレクト）
│   ├── sankey/
│   │   └── page.tsx             # サンキー図メインページ（状態管理、ビュー制御）
│   ├── api/sankey/
│   │   └── route.ts             # サンキー図データAPI（動的生成）
│   └── lib/
│       └── sankey-generator.ts  # サンキー図データ生成ロジック
├── client/                      # クライアントコンポーネント
│   ├── components/
│   │   ├── ProjectListModal.tsx # 事業一覧モーダル（検索・フィルター・ソート）
│   │   └── TopNSettingsPanel.tsx # TopN設定パネル
│   ├── hooks/
│   │   └── useTopNSettings.ts   # TopN設定カスタムフック
│   └── lib/
│       ├── buildHierarchyPath.ts # 組織階層パス構築
│       └── formatBudget.ts      # 金額フォーマット
├── scripts/                     # データ生成スクリプト
│   ├── normalize_csv.py         # CSV正規化（Python + neologdn）
│   ├── csv-reader.ts            # CSV読み込み（UTF-8/Shift_JIS対応）
│   ├── generate-structured-json.ts  # 構造化JSON生成
│   └── decompress-data.sh       # ビルド時データ展開スクリプト
├── types/                       # TypeScript型定義
│   ├── structured.ts            # 構造化データ型定義
│   ├── preset.ts                # プリセットデータ型定義
│   ├── sankey.ts                # サンキー図型定義
│   └── rs-system.ts             # 元CSVデータ型定義
├── data/                        # データディレクトリ（.gitignore）
│   ├── download/RS_2024/        # 手動ダウンロードしたZIPファイル
│   └── year_2024/               # 正規化済みCSV
├── public/data/                 # 生成JSONファイル
│   ├── rs2024-structured.json.gz # 構造化データ（gzip圧縮、~11MB）※Gitに含む
│   ├── rs2024-structured.json   # 構造化データ（展開後、~96MB）※.gitignore
└── docs/                        # 仕様書・設計文書
```

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run normalize` | CSVファイルを正規化（Python 3.x + neologdn必須） |
| `npm run generate-structured` | 構造化JSONファイル生成（rs2024-structured.json） |
| `npm run compress-data` | 構造化JSONをgzip圧縮（rs2024-structured.json.gz） |
| `npm run dev` | 開発サーバー起動（Turbopack有効、ポート3002） |
| `npm run build` | プロダクションビルド（自動的にprebuildでデータ展開） |
| `npm start` | プロダクションサーバー起動 |
| `npm run lint` | ESLintによるコードチェック |

## ビルドとデプロイ

### プロダクションビルド

```bash
npm run build
npm start
```

### Vercelへのデプロイ

#### 前提条件

- Vercel CLIのインストール: `npm i -g vercel`
- GitHubリポジトリとの連携
- `public/data/rs2024-structured.json`（約96MB）が生成済み

#### デプロイ手順

1. **Vercel CLIでログイン**
```bash
vercel login
```

2. **初回デプロイ**
```bash
vercel
```
プロジェクト名やチーム設定を確認し、デプロイを実行します。

3. **本番デプロイ**
```bash
vercel --prod
```

#### Vercel ダッシュボードからのデプロイ

1. [Vercel Dashboard](https://vercel.com/dashboard) にアクセス
2. 「Import Project」をクリック
3. GitHubリポジトリ `igomuni/marumie-rssystem` を選択
4. ビルド設定:
   - **Framework Preset**: Next.js
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`
5. 「Deploy」をクリック

#### 環境変数（必要に応じて）

Vercelのプロジェクト設定で以下を設定:
- `NODE_ENV`: `production`

#### 重要な注意事項

**データファイルについて**:
- `rs2024-structured.json`（約96MB）は`.gitignore`で除外されています
- **gzip圧縮版** `rs2024-structured.json.gz`（約11MB）をGitリポジトリに含めています
- ビルド時に自動的に展開されます（`prebuild`スクリプト）

**デプロイフロー**:
1. `npm run build`が実行される
2. `prebuild`スクリプトが自動実行され、`.gz`ファイルを展開
3. Next.jsビルドが実行される
4. デプロイ完了

**データ更新時の手順**:
```bash
npm run generate-structured  # 構造化JSON生成
npm run compress-data         # gzip圧縮
git add public/data/rs2024-structured.json.gz
git commit -m "Update structured data"
git push
```

## トラブルシューティング

### neologdnがインストールされていない

```
⚠️  neologdn がインストールされていません
```

→ `pip3 install neologdn` を実行してください。

### ZIPファイルが見つからない

```
⚠️  ZIPファイルが見つかりません
```

→ `data/download/RS_2024/` にZIPファイルを配置し、`npm run normalize` を実行してください。

### データ読み込みエラー

```
データの読み込みに失敗しました (404)
```

→ 以下のコマンドを実行してJSONファイルを生成してください:
```bash
npm run generate-structured
```

## データ統計（2024年度シート / 予算年度2023年度実績）

> 2024年度シートに記録されているのは**予算年度2023年度の実績**です（FY2024は作成時点で未完了のため）。
> 詳細: [docs/rs-data-scope.md](docs/rs-data-scope.md)

### 主要統計
| 項目 | 数値 |
|------|------|
| 総事業数 | **5,003事業** |
| 総支出先数 | **26,823先**（再委託先含む） |
| 当初予算合計 | 117.57兆円 |
| 歳出予算現額 | **151.12兆円** |
| 一般会計 | 40.83兆円（34.7%） |
| 特別会計 | 75.76兆円（64.4%） |

> **注意**: アプリ内の「総予算」は**歳出予算現額**（当初＋補正＋繰越等）を使用しています。

### サンキー図統計（全体ビュー・デフォルト設定）
- デフォルト設定: 府省庁Top10, 支出先Top10
- Top3府省庁: 厚生労働省、経済産業省、国土交通省
- 「その他」ノード: 約26兆円（支出先名が「その他」への支出）
- 「支出先(TopN以外)」ノード: 約51兆円（TopN以外 + 事業(TopN以外) + 府省庁(TopN以外)）

## 仕様書・ドキュメント

詳細な仕様は `docs/` ディレクトリおよび `CLAUDE.md` を参照してください:

### アーキテクチャガイド
- [CLAUDE.md](CLAUDE.md) - システム全体のアーキテクチャと技術詳細
- [docs/rs-data-scope.md](docs/rs-data-scope.md) - RSシステム対象データリファレンス（年度定義・対象外項目・MOF比較）
- [docs/sankey-architecture-guide.md](docs/sankey-architecture-guide.md) - Sankey生成ロジック設計
- [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) - CSV→JSON データパイプライン詳細
- [docs/api-guide.md](docs/api-guide.md) - APIエンドポイント仕様
- [docs/構造化JSON仕様書.md](docs/構造化JSON仕様書.md) - rs2024-structured.jsonのデータ構造

## データソース

- [行政事業レビューシステム](https://rssystem.go.jp/)
- [2024年度CSVダウンロード](https://rssystem.go.jp/download-csv/2024)

## ライセンス

MIT

## 開発者

開発に関する質問や提案は、GitHubのIssuesまでお願いします。
