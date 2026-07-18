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

## 完了条件

- lint エラー 0件
- tsc エラー 0件
- テスト全件パス
- （対象変更時のみ）check-traces 違反 0件
