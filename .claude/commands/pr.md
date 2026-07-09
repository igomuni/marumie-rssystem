---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx tsc:*)
argument-hint: [追加の指示]
description: フィーチャーブランチを作成してPRを出す
---

## 現在の状況

- 現在のブランチ: !`git branch --show-current`
- 変更ファイル: !`git status --short`
- 追加の指示: $ARGUMENTS

## タスク

以下の手順でPRを作成してください：

1. **現在の状態を確認**: `git status` と `git diff` で変更内容を確認し、PRに含める変更を把握する。変更がない場合はユーザーに報告して終了する。

2. **目的（Why）の明確化**: このPRが必要な理由を明確にする。以下のいずれかの形式で言語化できるようにする：
   - 「（対象者）が（困っている状態）を解消するため」
   - 「（対象者）が（嬉しい状態）になるため」

   目的が明確でない場合は、必ずユーザーに質問して確認を取ること。PRのdescriptionに目的として記載する。

3. **ブランチ決定**:
   - 現在のブランチが `main` の場合: 変更内容に基づいて適切なブランチ名を自分で決定し、新しいブランチを作成してチェックアウトする（例: `feature/add-spending-view`, `fix/sankey-node-click`, `chore/update-data`）
   - 既にフィーチャーブランチにいる場合: 変更内容がブランチ名と合致していればそのまま使用する

4. **品質チェック**: ソースコード（`.ts`、`.tsx`ファイル）への変更がある場合のみ実行する。ドキュメントや設定ファイルのみの変更の場合はスキップ可。
   - `npm run lint`
   - `npx tsc --noEmit`（TypeScript型チェック）
   エラーがあれば修正してから次に進む。

5. **コミット**: 変更内容を確認し、適切なコミットメッセージでコミットする。コミットメッセージは以下の形式を使用する：
   - `feat: 新機能の追加`
   - `fix: バグ修正`
   - `chore: ツール・設定の変更`
   - `docs: ドキュメントのみの変更`
   - `refactor: リファクタリング`

6. **コンフリクト確認**: `git fetch origin` して、mainとのマージ可能性を確認する。コンフリクトがある場合はユーザーに報告し、続行するか確認を取る。

7. **docs/tasks 索引の同期**: `git diff origin/main --name-only --diff-filter=A -- docs/tasks/` で新規追加された task doc を検出し、`docs/tasks/INDEX.md` に対応する行がなければ追記してコミットに含める（新しいものを上・30字前後の要約・固有名詞優先。索引の書式は INDEX.md 冒頭を参照）。手順6の fetch 後に実行すること（古いローカル main と比較すると追加分を見落とすため）。

8. **プッシュ**: リモートにプッシュする（`git push -u origin <branch-name>`）

9. **PR作成**: PRは**必ずdraft（下書き）として作成する**。`--base main` を指定する。（CodeRabbitAIのRateLimit対策。ready for review への切り替えはユーザーが任意のタイミングで行う）作成手段は環境によって異なるが、**手段に関わらずdraftを保証すること**：
   - **デスクトップ版（`gh` CLIが使える場合）**: `gh pr create --draft`
   - **Web版（GitHub MCPツールしか使えない場合）**: `mcp__github__create_pull_request` を呼び、**`draft: true` を明示的に指定する**（省略すると通常PRとして作成され、CodeRabbitAIのレビューが即座に走ってしまうため注意）

   PR本文には以下を含める：
   - 変更の目的（Why）
   - 変更内容の概要
   - テスト方法（`npm run dev` で動作確認する手順など）

10. **完了報告**: 作成したPRのURLを報告する。

## 注意事項

- `main` ブランチへの直接pushは禁止。
- データファイル（`public/data/rs2024-structured.json.gz`）を含む場合は、PRを出す前にユーザーに確認を取る。
