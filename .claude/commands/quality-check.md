---
allowed-tools: Bash(npm run lint:*), Bash(npx tsc:*), Bash(npm test:*), Bash(npm run build:*), Bash(npm run check-traces:*)
description: lint と TypeScript 型チェックとユニットテストを実行する
---

## タスク

以下を順番に実行し、結果を報告する：

1. **Lint チェック**
   ```bash
   npm run lint
   ```
   - エラー（error）がある場合はユーザーに報告して修正を提案する
   - 警告（warning）のみの場合: すべての警告をユーザーに報告する（既存の警告も含む）

2. **TypeScript 型チェック**
   ```bash
   npx tsc --noEmit
   ```
   - エラーがある場合はユーザーに報告して修正を提案する
   - エラーがない場合は「型チェック OK」と報告する

3. **ユニットテスト**（vitest・app/lib/ の Pure 関数対象・実データ非依存）
   ```bash
   npm test
   ```
   - 失敗がある場合はユーザーに報告して修正を提案する

4. **関数トレース検査**（API ルート・ローダ・next.config.ts・package.json・scripts/decompress-data.sh・scripts/check-function-traces.mjs のいずれかを変更した場合のみ）
   ```bash
   npm run build && npm run check-traces
   ```
   - 関数バンドルへのデータ同梱を検査する（Vercel 関数上限 250MB の再燃防止。
     経緯: docs/tasks/20260718_1421_関数バンドル250MB問題の設計的回避.md）
   - 違反がある場合はユーザーに報告して修正を提案する

5. **ドキュメント参照検査**（コード・`docs/*.md` を変更した場合のみ）
   ```bash
   grep -rnE "docs/tasks/[0-9]{8}_" app scripts client tests docs types \
     --exclude-dir=tasks --exclude-dir=.ignore \
     --include='*.ts' --include='*.tsx' --include='*.py' --include='*.mjs' --include='*.md' \
     | grep -v "docs/プロンプトログ"
   ```
   - task doc は rs-vis へ展開されないため、コード・公開ドキュメントからの参照はリンク切れになる。
     ヒットしたら恒久ガイド（`docs/*.md`）への参照に置き換える
   - 検査対象外: `.claude/` 配下（rs-vis へ展開されない）、`docs/tasks/` 内の doc 同士の参照、
     git 管理外の `docs/.ignore/`・`docs/プロンプトログ*.ignore.md`
   - パターンが日付接頭辞（`YYYYMMDD_`）なのは、task doc への参照だけを拾うため。
     `docs/tasks/_assets/` への出力パス（`tests/e2e/responsive-investigation.spec.ts`）は
     リンクではないので対象外

## 完了条件

- lint エラー 0件
- tsc エラー 0件
- テスト全件パス
- （対象変更時のみ）check-traces 違反 0件
- （対象変更時のみ）`docs/tasks/` 参照 0件
