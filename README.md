# RS2024 サンキー図システム

2024年度 行政事業レビューシステムの予算・支出データをサンキー図で可視化するWebアプリケーション。

## 概要

本システムは、日本政府の行政事業レビューシステム（RS System）の2024年度データを使用して、予算配分と支出フローを視覚的に表現します。

### 主な機能

- **📊 5列サンキー図**: 予算総計 → 府省庁（予算）→ 事業（予算）→ 事業（支出）→ 支出先の全体フローを可視化
- **🔝 Top3再帰選択**: 各階層で予算額上位3項目を再帰的に選択し、主要な予算・支出の流れを追跡
- **💰 支出先名「その他」の独立表示**: 支出先名が「その他」の項目を「その他の支出先」とは別に集約表示
- **📱 モバイル対応**: スマートフォンでも横スクロールで閲覧可能
- **🎨 予算/支出の色分け**: 予算ベースのノード（緑系）と支出ベースのノード（赤系）を視覚的に区別

## 技術スタック

- **フロントエンド**: Next.js 15 (App Router), React 18, TypeScript
- **スタイリング**: Tailwind CSS
- **可視化**: @nivo/sankey
- **データ処理**: Python 3 (neologdn), Node.js (TypeScript)

## データフロー

### 5列サンキー図構造
```
予算総計
  ├─ 府省庁（予算）Top3
  │   ├─ 事業（予算）Top3
  │   │   ├─ 事業（支出）
  │   │   │   ├─ 支出先 Top3
  │   │   │   ├─ その他（支出先名が「その他」）
  │   │   │   └─ その他の支出先
  │   │   └─ その他の事業（予算）→ その他 / その他の支出先
  │   └─ その他の府省庁 → その他 / その他の支出先
  └─ その他の府省庁 → その他 / その他の支出先
```

### 重要な設計ポイント

1. **「その他」ノードと「その他の支出先」ノードの分離**
   - **「その他」ノード**: 支出先名が「その他」である全事業からの支出を集約（約26兆円）
   - **「その他の支出先」ノード**: TopN以外の支出先 + その他の事業 + その他の府省庁（約51兆円）
   - 両者は独立した最終ノードで、相互にリンクは存在しない

2. **Top3再帰選択アルゴリズム**
   - 各親ノードが独立して子ノードのTop3を選択
   - 予算額ベースでソート（歳出予算現額合計）
   - 支出先選択時に「その他」を事前除外してTopNを選択

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
- ファイルサイズ: 約110MB

### 5. プリセットTop3サンキー図データの生成

```bash
npm run generate-preset
```

このコマンドは `public/data/rs2024-preset-top3.json` を生成します。
- Top3再帰選択によるサンキー図データ
- ノード数: 45、リンク数: 61
- カバー率: 約50%（73.58兆円 / 146.63兆円）
- ファイルサイズ: 約29KB

### 6. 開発サーバーの起動

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
4. `npm run generate-preset` - プリセットTop3サンキー図データの生成

**注意**: 事前に `data/download/RS_2024/` にZIPファイルを配置し、Python 3とneologdnをインストールしてください。

## プロジェクト構成

```
marumie-rssystem/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # ルートレイアウト
│   ├── page.tsx                 # ホーム画面（リダイレクト）
│   └── sankey/                  # サンキー図表示画面
│       └── page.tsx             # Top3サンキー図コンポーネント
├── scripts/                     # データ生成スクリプト
│   ├── normalize_csv.py         # CSV正規化（Python + neologdn）
│   ├── csv-reader.ts            # CSV読み込み（UTF-8/Shift_JIS対応）
│   ├── generate-structured-json.ts  # 構造化JSON生成
│   └── generate-preset-json.ts      # プリセットTop3サンキー図生成
├── types/                       # TypeScript型定義
│   ├── structured.ts            # 構造化データ型定義
│   ├── preset.ts                # プリセットデータ型定義
│   └── rs-system.ts             # 元CSVデータ型定義
├── data/                        # データディレクトリ（.gitignore）
│   ├── download/RS_2024/        # 手動ダウンロードしたZIPファイル
│   └── year_2024/               # 正規化済みCSV
├── public/data/                 # 生成JSONファイル
│   ├── rs2024-structured.json   # 構造化データ（約110MB）
│   └── rs2024-preset-top3.json  # Top3サンキー図データ（約29KB）
└── docs/                        # 仕様書・設計文書
```

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run setup` | 初回セットアップ（install + normalize + generate-structured + generate-preset） |
| `npm run normalize` | CSVファイルを正規化（Python 3.x + neologdn必須） |
| `npm run generate-structured` | 構造化JSONファイル生成（rs2024-structured.json） |
| `npm run generate-preset` | プリセットTop3サンキー図JSON生成（rs2024-preset-top3.json） |
| `npm run dev` | 開発サーバー起動（Turbopack有効、ポート3002） |
| `npm run build` | プロダクションビルド |
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
- `public/data/rs2024-structured.json`（約110MB）が生成済み

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
- `rs2024-structured.json`（約110MB）は`.gitignore`で除外されています
- ビルド時にこのファイルが必要なため、以下のいずれかの方法で対応してください:
  1. **推奨**: Vercelのビルドステップで`generate-structured`を実行（ただしビルド時間が長くなる）
  2. **代替**: `public/data/`をGitに含める（リポジトリサイズが大きくなる）
  3. **最適**: 外部ストレージ（S3等）にアップロードしてCDN配信

現在の実装では、`rs2024-structured.json`を事前に生成してGitにコミットせず、デプロイ時のビルドステップで生成するか、または小さいプリセットJSONのみを使用する方式を推奨します。

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
npm run generate-preset
```

## データ統計（2024年度）

### 元データ（CSV）
- 組織情報: 8,537件
- 予算情報: 37,981件（うち2024年度: 15,111件）
- プロジェクト数: 15,111件
- 支出情報: 194,133件
- 支出先数: 25,892件

### プリセットTop3サンキー図
- 総予算額: 146.63兆円
- カバー率: 50.18%（73.58兆円）
- Top3府省庁: 厚生労働省、国土交通省、経済産業省
- Top3事業数: 9件
- Top3支出先数: 17件
- 「その他」ノード: 約26兆円（全事業からの支出先名「その他」への支出）
- 「その他の支出先」ノード: 約51兆円（TopN以外 + その他の事業・府省庁）

## 仕様書

詳細な仕様は `docs/` ディレクトリを参照してください:

- [データ処理仕様](docs/20251118_1530_データ処理仕様.md)
- [型定義仕様](docs/20251118_1443_型定義仕様.md)
- [設計文書](docs/20251118_新リポジトリ設計_RS2024サンキー図.md)

## データソース

- [行政事業レビューシステム](https://rssystem.go.jp/)
- [2024年度CSVダウンロード](https://rssystem.go.jp/download-csv/2024)

## ライセンス

MIT

## 開発者

開発に関する質問や提案は、GitHubのIssuesまでお願いします。
