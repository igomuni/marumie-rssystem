# ワークスペースルール

## ファイル操作の制約

- **`docs/プロンプトログ*.ignore.md`**: ユーザーの作業ログ。修正・編集・変更は禁止。読み取りも**ユーザーが明示的に指示した場合のみ**とし、その場合も Grep で該当箇所を特定してから offset/limit 付きで部分読みする（1本最大249KBあり、全文 Read 禁止。settings.json の deny でも拒否される）。
- **回答の出力先**: 設計・調査・分析などの回答を出力する場合は `docs/tasks/YYYYMMDD_HHMM_{タイトル}.md` に保存すること（日時は `TZ=Asia/Tokyo date +%Y%m%d_%H%M` で取得）。**作成したら `docs/tasks/INDEX.md` に1行追記する**（新しいものを上に）。
- **データファイル（`public/data/*.json`・`data/`）を Read で開かない**: 展開後 96MB 級があり1回で数万トークンになる。中身の確認・集計は `/data-query` スキルの作法（dev API / jq / gunzip -c / sqlite3）で行う。settings.json の deny でも拒否される。

## 探索の規律（トークン節約）

- **過去の検討を探すときは `docs/tasks/INDEX.md` を先に読む**。対象を特定してから本文を読む（`ls` からの推測で複数本を全文読みしない）。
- API 仕様の正典は `docs/api-guide.md`、エージェント探索の作法は `docs/agent-playbook.md`。目的に合う方だけを読む（毎回両方読む必要はない）。
- 多ファイル横断の広域調査は Explore サブエージェントに委譲し、本会話には結論だけ持ち帰る。逆に、既に文脈がある作業のためにサブエージェントを新規起動しない（コールドスタートの再読込コストが掛かる）。

## Markdown 記法ルール（CodeRabbit/markdownlint 対応）

- **コードフェンスには必ず言語タグを付ける**（markdownlint MD040）。内容に応じて選ぶ:
  - JSON 例 → ` ```json `
  - シェル/コマンド → ` ```bash `
  - HTTP リクエストや URL 一覧、図・擬似コード・プレーンな箇条 → ` ```text `
  - TypeScript/JS → ` ```ts ` / ` ```tsx `
- 言語が曖昧なブロックは ` ```text ` を既定とする（MD040 を満たせれば可）。`docs/tasks/*.md` も CodeRabbit のレビュー対象なので例外なく適用する。
