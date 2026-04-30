---
allowed-tools: Bash(npm run lint:*), Bash(npx tsc:*)
description: lint と TypeScript 型チェックを実行する
---

## タスク

以下を順番に実行し、結果を報告する：

1. **Lint チェック**
   ```
   npm run lint
   ```
   - エラー（error）がある場合はユーザーに報告して修正を提案する
   - 警告（warning）のみの場合: `sankey-generator.ts` の既存の未使用変数警告（offset, cumulativeSpendings 等）は無視してよい。それ以外の新規警告はユーザーに報告する

2. **TypeScript 型チェック**
   ```
   npx tsc --noEmit
   ```
   - エラーがある場合はユーザーに報告して修正を提案する
   - エラーがない場合は「型チェック OK」と報告する

## 完了条件

- lint エラー 0件
- tsc エラー 0件
