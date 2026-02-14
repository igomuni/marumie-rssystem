# Data Pipeline Guide

RS System CSV → 構造化JSON → Sankey表示 までのデータパイプライン詳細。

---

## 1. 全体フロー

```
data/download/RS_2024/*.zip   （手動ダウンロード）
  ↓ npm run normalize
data/year_2024/*.csv           （UTF-8正規化済み、.gitignore）
  ↓ npm run generate-structured
public/data/rs2024-structured.json  （46MB、.gitignore）
  ↓ npm run compress-data
public/data/rs2024-structured.json.gz  （5.9MB、Git管理）
  ↓ npm run build（prebuildフック）
public/data/rs2024-structured.json  （ビルド時に再展開）
  ↓
/api/sankey → /sankey ページ
```

---

## 2. Phase 1: CSV正規化（normalize_csv.py）

**コマンド**: `npm run normalize`（要: `pip3 install neologdn`）

**入力**: `data/download/RS_2024/*.zip`
**出力**: `data/year_2024/*.csv`（UTF-8）

**処理対象ファイル**:
| ファイル | 内容 |
|---------|------|
| 1-1_RS_2024_基本情報_組織情報.csv | 組織階層 |
| 1-2_RS_2024_基本情報_事業概要等.csv | 事業概要 |
| 2-1_RS_2024_予算・執行_サマリ.csv | 予算・執行サマリ |
| 5-1_RS_2024_支出先_支出情報.csv | 支出先情報 |

**正規化ルール（適用順）**:
```python
1. neologdn.normalize(text)           # 日本語テキスト正規化（最優先）
2. convert_circled_numbers(text)      # ① → 1
3. unicodedata.normalize('NFKC', text)# Unicode正規化
4. convert_era_to_year(text)          # 令和5年 → 2024年
5. convert_fullwidth_brackets(text)   # （） → ()
6. unify_hyphens(text)                # 各種ダッシュ → -
7. fix_hyphen_to_choon(text)          # ア- → アー
8. fix_katakana_choon(text)           # ア ー ー → アー
9. remove_consecutive_spaces(text)    # 連続スペース → 1個
```

---

## 3. Phase 2: 構造化JSON生成（generate-structured-json.ts）

**コマンド**: `npm run generate-structured`

**入力**: `data/year_2024/*.csv`
**出力**: `public/data/rs2024-structured.json`（~46MB）

**生成内容**:
- `BudgetTree`: 府省庁 → 局 → 部 → 課 → 室 → 班 → 係 の階層ツリー
- `BudgetRecord[]`: 事業ごとの予算詳細（15,111件）
- `SpendingRecord[]`: 支出先ごとの支出情報（25,892件）
- `Statistics`: 府省庁別・事業別・支出先別の集計

**キーアルゴリズム（階層ツリー構築）**:
```
各BudgetRecordについて:
1. hierarchyPath を抽出: [府省庁, 局, 部, 課, 室, 班, 係]
2. 府省庁ノードを find or create
3. 再帰的に子ノードを find or create
4. リーフノードに projectId を追加
5. totalBudget をツリーの上位に集計
```

---

## 4. Phase 3: 圧縮（compress-data）

**コマンド**: `npm run compress-data`

- `rs2024-structured.json`（46MB）→ `rs2024-structured.json.gz`（5.9MB、94%削減）
- `.gz` ファイルのみ Git 管理（`.json` は `.gitignore`）

---

## 5. Phase 4: ビルド時展開（prebuildフック）

**トリガー**: `npm run build`

- `scripts/decompress-data.sh` が自動実行される
- `.gz` が `.json` より新しい場合のみ展開
- Vercel でも同様に動作

---

## 6. ディレクトリ構成

```
marumie-rssystem/
├── app/                        # Next.js App Router
│   ├── sankey/page.tsx         # メインUI（状態管理・インタラクション）
│   ├── api/sankey/route.ts     # Sankey データAPIエンドポイント
│   └── lib/sankey-generator.ts # Sankey生成コアロジック
├── client/                     # クライアント側再利用コード
│   ├── components/             # Reactコンポーネント
│   ├── hooks/useTopNSettings.ts
│   └── lib/                    # フォーマット・ユーティリティ
├── types/                      # TypeScript型定義
│   ├── structured.ts           # データモデル型（187行）
│   ├── preset.ts               # Sankeyビジュアライゼーション型
│   └── rs-system.ts            # 元CSVの型定義
├── scripts/                    # データ生成スクリプト
│   ├── normalize_csv.py        # CSV正規化（Python）
│   ├── generate-structured-json.ts
│   └── decompress-data.sh      # ビルド時展開
├── data/                       # ローカルデータ（.gitignore）
│   ├── download/RS_2024/       # ZIPダウンロード先
│   └── year_2024/              # 正規化済みCSV
└── public/data/
    ├── rs2024-structured.json.gz  # Git管理（5.9MB）
    └── rs2024-structured.json     # ビルド成果物（46MB、.gitignore）
```

---

## 7. デプロイ（Vercel）

**設定** (`vercel.json`):
```json
{ "buildCommand": "npm run build", "framework": "nextjs", "regions": ["hnd1"] }
```

**フロー**:
1. `git push origin main` → GitHub webhook → Vercel ビルド開始
2. `npm install`
3. `npm run build`:
   - `prebuild`: `.gz` を展開
   - TypeScript コンパイル
   - Next.js バンドル
4. Edge Network にデプロイ

---

## 8. トラブルシューティング

| 症状 | 対処 |
|------|------|
| データ 404 エラー | `npm run build` が完了しているか確認。`decompress-data.sh` の実行ログを確認 |
| `neologdn not installed` | `pip3 install neologdn` を実行 |
| ZIP ファイルが見つからない | `https://rssystem.go.jp/download-csv/2024` からダウンロードして `data/download/RS_2024/` に配置 |
| TypeScript エラー | `types/rs-system.ts` の型定義と CSV のヘッダーが一致しているか確認 |
| JSON が小さすぎる（<1MB） | 正規化・生成スクリプトのエラーログを確認 |
