---
name: sync-rs-vis
description: rs-visリポジトリへmarumie-rssystemの最新開発成果を反映する。「rs-visに反映」「リリースリポジトリに同期」「sync-rs-vis」と言われたときに使用する。
compatibility: Requires git, rsync, npm, gh CLI. Set MARUMIE_RS_ROOT (path to marumie-rssystem) and RS_VIS_ROOT (path to rs-vis) before execution, or confirm paths interactively.
allowed-tools: Bash(git:*) Bash(gh:*) Bash(rsync:*) Bash(cp:*) Bash(npm:*) Bash(find:*) Bash(ls:*)
---

## 概要

marumie-rssystem（開発元）の変更を rs-vis（リリース先）に反映する。`docs/` は対象外。

## 前提

- `MARUMIE_RS_ROOT`（marumie-rssystem のパス）と `RS_VIS_ROOT`（rs-vis のパス）を確認する。未設定の場合はユーザーに確認する。
- marumie-rssystem が `main` ブランチにいること。そうでない場合はユーザーに報告して終了する。

## 手順

### 1. 前回反映コミットの特定

`${MARUMIE_RS_ROOT}/docs/tasks/` 内の最新の `*rs-vis反映対応案.md` を確認し、「次回反映時の起点」コミットハッシュを取得する。取得できない場合はユーザーに確認する。

### 2. 差分確認

起点コミットから HEAD までの変更ファイルを表示し、ユーザーに確認を取る（`docs/` 除外）:

```bash
git -C "${MARUMIE_RS_ROOT}" diff --name-only <起点コミット> HEAD \
  | grep -v '^docs/' | sort
```

変更がない場合はユーザーに報告して終了する。

### 3. rs-vis にブランチを作成

```bash
git -C "${RS_VIS_ROOT}" checkout main
git -C "${RS_VIS_ROOT}" pull origin main
git -C "${RS_VIS_ROOT}" checkout -b sync/$(TZ=Asia/Tokyo date +%Y%m%d)
```

### 4. ソースコードのコピー

```bash
rsync -av \
  --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='docs' --exclude='public/data/*.json' \
  --exclude='data/' --exclude='README.md' --exclude='walkthrough.md' \
  "${MARUMIE_RS_ROOT}/" \
  "${RS_VIS_ROOT}/"
```

### 5. データファイルのコピー

差分に含まれる `public/data/*.gz` を個別にコピーする:

```bash
cp "${MARUMIE_RS_ROOT}/public/data/<file>.gz" \
   "${RS_VIS_ROOT}/public/data/"
```

### 6. ビルド確認

```bash
cd "${RS_VIS_ROOT}" && npm install && npm run build
```

ビルドが失敗した場合は原因を調査してユーザーに報告する。成功するまで次に進まない。

### 7. コミット

```text
feat: marumie-rssystem の最新状態を反映（YYYY-MM-DD時点）

<起点コミット>〜<今回のHEAD>の変更を反映。docs/ は対象外。

- 変更の概要を箇条書き
```

### 8. プッシュ・PR作成

```bash
git -C "${RS_VIS_ROOT}" push -u origin sync/$(TZ=Asia/Tokyo date +%Y%m%d)
gh -C "${RS_VIS_ROOT}" pr create --base main \
  --title "sync: marumie-rssystem 反映（YYYY-MM-DD）" --body "..."
```

### 9. ドキュメント更新

`${MARUMIE_RS_ROOT}/docs/tasks/YYYYMMDD_HHMM_rs-vis反映対応案.md` を新規作成し、以下を記録する:

- 今回の反映範囲（起点〜HEAD）
- 変更ファイル一覧
- 次回反映時の起点コマンド

### 10. 完了報告

PR URL・反映内容サマリー・次回起点コミットを報告する。

## 注意事項

- `README.md` は rsync から除外する（rs-vis 側の公開向け記述を保持するため）。
- `.next/` は rsync 除外済み。ビルド時に rs-vis 側で再生成される。
- ビルド後は差分に含まれるページの動作確認を推奨する。
