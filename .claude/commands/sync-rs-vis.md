---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(rsync:*), Bash(cp:*), Bash(npm:*), Bash(find:*), Bash(ls:*)
description: rs-visリポジトリへ最新の開発成果を反映する
---

## 現在の状況

- marumie-rssystem ブランチ: !`git branch --show-current`
- marumie-rssystem 最新コミット: !`git log --oneline -3`
- rs-vis 最新コミット: !`git -C /Users/igomuni/MyGitHub/rs-vis log --oneline -5`

## タスク

以下の手順で rs-vis に最新状態を反映してください：

1. **前提確認**: marumie-rssystem が `main` ブランチにいることを確認する。そうでない場合はユーザーに報告して終了する。

2. **前回反映コミットの特定**: `docs/tasks/` 内の最新の `rs-vis反映対応案.md` を確認し、「次回反映時の起点」コミットハッシュを取得する。取得できない場合はユーザーに確認する。

3. **差分確認**: 起点コミットから HEAD までの変更ファイルを表示する（`docs/` 除外）:
   ```bash
   git diff --name-only <起点コミット> HEAD | grep -v '^docs/' | sort
   ```
   変更がない場合はユーザーに報告して終了する。ユーザーに差分を提示し、反映してよいか確認を取る。

4. **rs-vis にブランチ作成**:
   ```bash
   cd /Users/igomuni/MyGitHub/rs-vis
   git checkout main
   git pull origin main
   git checkout -b sync/$(TZ=Asia/Tokyo date +%Y%m%d)
   ```

5. **ソースコードのコピー**:
   ```bash
   rsync -av --exclude='.git' --exclude='node_modules' --exclude='.next' \
     --exclude='docs' --exclude='public/data/*.json' \
     --exclude='data/' --exclude='README.md' --exclude='walkthrough.md' \
     /Users/igomuni/MyGitHub/marumie-rssystem/ \
     /Users/igomuni/MyGitHub/rs-vis/
   ```

6. **データファイルのコピー**: 差分に含まれる `public/data/*.gz` を個別にコピーする:
   ```bash
   cp /Users/igomuni/MyGitHub/marumie-rssystem/public/data/<file>.gz \
      /Users/igomuni/MyGitHub/rs-vis/public/data/
   ```

7. **ビルド確認**:
   ```bash
   cd /Users/igomuni/MyGitHub/rs-vis && npm install && npm run build
   ```
   ビルドが失敗した場合は原因を調査してユーザーに報告する。成功するまで次に進まない。

8. **コミット**: 変更内容のサマリーをコミットメッセージに含める:
   ```
   feat: marumie-rssystem の最新状態を反映（YYYY-MM-DD時点）

   <前回起点コミット>〜<今回起点コミット>の変更を反映。docs/ は対象外。

   - 変更の概要を箇条書き
   ```

9. **プッシュ・PR作成**:
   ```bash
   git push -u origin sync/$(TZ=Asia/Tokyo date +%Y%m%d)
   gh pr create --base main --title "sync: marumie-rssystem 反映（YYYY-MM-DD）" --body "..."
   ```

10. **ドキュメント更新**: marumie-rssystem の `docs/tasks/` に新しい反映対応案ドキュメント（`YYYYMMDD_HHMM_rs-vis反映対応案.md`）を作成し、今回の起点コミット・変更ファイル・次回起点コミットを記録する。

11. **完了報告**: PR URLと今回の反映内容サマリー、次回起点コミットを報告する。

## 注意事項

- `README.md` は rsync から除外する（rs-vis 側の公開向け記述を保持するため）。
- `.next/` は rsync 除外済み。ビルド時に rs-vis 側で再生成される。
- ビルド後は差分に含まれるページの動作確認を推奨する。
