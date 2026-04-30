---
allowed-tools: Bash(python3:*), Bash(tsx:*), Bash(ls:*), Bash(find:*), Read
description: データ分析・調査スクリプトを案内・実行する
---

## 目的

`scripts/` 配下の既存分析スクリプトを再発明せず活用する。
ユーザーの調査内容に最も近いスクリプトを選んで実行すること。

## スクリプト一覧（用途別）

### ラベリング・支出先分類

| 用途 | コマンド |
|------|---------|
| ラベルカバレッジ全体確認 | `python3 scripts/analyze-label-coverage.py` |
| Invalid支出先の分類分析 | `python3 scripts/analyze-invalid-recipients.py` |
| Invalid支出先（組織別） | `python3 scripts/analyze-invalid-by-org.py` |
| Invalid支出先（事業・府省庁別） | `python3 scripts/analyze-invalid-by-project-ministry.py` |
| 支出先妥当性評価 | `python3 scripts/assess-spending-validity.py` |
| 法人番号品質調査 | `python3 scripts/investigate-houjin-quality.py` |
| 未ラベル支出先（法人番号あり） | `python3 scripts/investigate-unlabeled-with-houjin.py` |
| 合計なし支出先の分析 | `tsx scripts/analyze-recipients-no-total.ts` |
| その他支出先の分析 | `tsx scripts/analyze-other-recipients.ts` |

### 品質スコア

| 用途 | コマンド |
|------|---------|
| 事業別品質スコア（2024年度） | `npm run score-quality` |
| 事業別品質スコア（2025年度） | `npm run score-quality-2025` |

### MOF（財務省）データ比較

| 用途 | コマンド |
|------|---------|
| RSシステムとMOF比較（会計年度別） | `tsx scripts/analyze-rs-mof-by-year.ts` |
| RSシステムとMOF差異分析 | `tsx scripts/analyze-rs-mof-comparison.ts` |
| MOF特別会計分析 | `tsx scripts/analyze-rs-special-accounts.ts` |
| MOF除外項目分析 | `tsx scripts/analyze-mof-exclusions.ts` |
| MOF歳入分析 | `tsx scripts/analyze-mof-revenue.ts` |
| MOF特別会計資金源分析 | `tsx scripts/analyze-special-account-funding.ts` |
| 年金勘定分析 | `tsx scripts/analyze-nenkin-kanjou.ts` |
| 厚生年金勘定分析 | `tsx scripts/analyze-mof-kousei-nenkin.ts` |

### 会計・予算カテゴリ

| 用途 | コマンド |
|------|---------|
| 会計カテゴリ分析 | `tsx scripts/analyze-account-category.ts` |

## タスク

1. ユーザーの調査内容を確認する
2. 上記スクリプト一覧から最も適切なものを選択する
3. スクリプトを実行し、結果をユーザーに報告する
4. 既存スクリプトで対応できない場合のみ、新規スクリプトの作成を提案する

## 注意事項

- 上記スクリプトに対応するものがあれば必ず使うこと。新規に調査コードを書かないこと
- `.ts` スクリプトは `tsx scripts/xxx.ts`、`.py` スクリプトは `python3 scripts/xxx.py` で実行する
- 出力が大量の場合は `| head -50` などで絞って確認する
