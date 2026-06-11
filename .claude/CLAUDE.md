# ワークスペースルール

## ファイル操作の制約

- **`docs/プロンプトログ.ignore.md`**: ユーザーの作業ログ。Agentは直接修正・編集・変更しないこと。内容の参照（読み取り）は可。
- **回答の出力先**: 設計・調査・分析などの回答を出力する場合は `docs/tasks/YYYYMMDD_HHMM_{タイトル}.md` に保存すること（日時は `TZ=Asia/Tokyo date +%Y%m%d_%H%M` で取得）。

## Markdown 記法ルール（CodeRabbit/markdownlint 対応）

- **コードフェンスには必ず言語タグを付ける**（markdownlint MD040）。内容に応じて選ぶ:
  - JSON 例 → ` ```json `
  - シェル/コマンド → ` ```bash `
  - HTTP リクエストや URL 一覧、図・擬似コード・プレーンな箇条 → ` ```text `
  - TypeScript/JS → ` ```ts ` / ` ```tsx `
- 言語が曖昧なブロックは ` ```text ` を既定とする（MD040 を満たせれば可）。`docs/tasks/*.md` も CodeRabbit のレビュー対象なので例外なく適用する。
