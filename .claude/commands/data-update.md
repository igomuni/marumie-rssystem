---
allowed-tools: Bash(npm run generate-sankey-svg:*), Bash(npm run generate-sankey-svg-2025:*), Bash(npm run generate-subcontracts:*), Bash(npm run generate-subcontracts-2025:*), Bash(npm run generate-mof-data:*), Bash(npm run generate-project-details:*), Bash(npm run score-quality:*), Bash(npm run score-quality-2025:*), Bash(npm run generate-project-map-2025:*), Bash(python3 scripts/generate-project-outcomes.py:*), Bash(npm run compress-data:*), Bash(ls:*), Bash(git:*)
description: RS SystemのCSVデータを更新してJSON生成・圧縮・Gitに反映する
---

## タスク

RS System（rssystem.go.jp）のデータを更新する手順を実行する。

### 前提確認

1. **ZIPファイルの確認**: `data/download/RS_{YEAR}/` に最新のCSV ZIPファイルが配置されているか確認する。
   - 必要なファイル（RSシステムの公開15ファイルのうち、パイプラインが使うもの）:
     - 基本情報: `1-1_..._組織情報.zip`、`1-2_..._事業概要等.zip`、`1-5_..._関連事業.zip`
     - 予算・執行: `2-1_..._サマリ.zip`、`2-2_..._予算種別・歳出予算項目.zip`
     - **効果発現経路: `3-1_..._目標・実績.zip`**（成果指標・目標値・実績値・達成率。AI評価の検証可能性軸で必須）、**`3-2_..._目標のつながり.zip`**（派生元→派生先のロジックモデル）
     - **点検・評価: `4-1_..._点検・評価.zip`**（外部有識者・レビュー推進チームの所見）
     - 支出先: `5-1_..._支出情報.zip`、`5-2_..._支出ブロックのつながり.zip`、`5-3_..._費目・使途.zip`
   - URL形式: `https://rssystem.go.jp/files/{YEAR}/rs/{ファイル名}.zip`（ダウンロードページはSPAのため直接URLで取得する）
   - 3-1・3-2・4-1・1-5 は長らく取得対象から漏れており、成果指標を読まないまま評価していた。必ず含めること。
   - ファイルがない場合は `https://rssystem.go.jp/download-csv/{YEAR}` からダウンロードするようユーザーに案内して終了する

### 実行手順

公開5ページが消費する JSON を再生成する。上から順に実行する（成果指標 → AI採点 → 座標マップ の順に依存がある）。

2. **/sankey-svg 用**
   ```bash
   npm run generate-sankey-svg         # 2024年度
   npm run generate-sankey-svg-2025    # 2025年度
   ```

3. **/subcontracts 用**
   ```bash
   npm run generate-subcontracts       # 2024年度
   npm run generate-subcontracts-2025  # 2025年度
   ```

4. **/mof-budget-overview 用**
   ```bash
   npm run generate-mof-data
   ```

5. **/api/project-details 用**
   ```bash
   npm run generate-project-details
   ```

6. **成果指標・点検所見（AI評価の入力）**
   ```bash
   python3 scripts/generate-project-outcomes.py --year 2025
   ```
   3-1・3-2・4-1・1-5 から `rs{YEAR}-project-outcomes.json` を作る。**次の採点より先に実行すること**（無いと検証可能性軸が散文推測に戻る）。実行時に `[warn] ... 列 "..." がヘッダに無い` が出たら、RS システム側の列名変更なので採点前に直す。

7. **/quality 用**
   ```bash
   npm run score-quality               # 2024年度
   npm run score-quality-2025          # 2025年度
   ```

8. **/project-bubble 用**（品質スコアの生成後に実行する。AI評価の結果を使うため）
   ```bash
   npm run generate-project-map-2025
   ```

9. **ファイルサイズ確認**: 生成された JSON の極端な小ささ（数百KB以下等）がないかユーザーに報告する。

10. **圧縮**: `npm run compress-data` で `.json` から `.gz` を再生成する。

11. **差分確認**: `git diff --stat public/data/*.gz` で変更があるか確認する。変更がない場合はユーザーに報告して終了する。

12. **コミット確認**: ユーザーに「コミット・プッシュしますか？」と確認を取る。

13. **コミット・プッシュ**（ユーザーが OK した場合のみ）:
    ```bash
    git add public/data/*.gz
    git commit -m "chore: RS System 2024/2025データを更新"
    git push origin main
    ```

## 注意事項

- `public/data/*.json`（展開後の本体）は `.gitignore` 対象、`.json.gz` のみコミットする
- コミット前に必ずユーザー確認を取ること
- Vercel へのデプロイは `git push` で自動トリガー
