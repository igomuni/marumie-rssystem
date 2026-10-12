# ワークスペースルール

## ファイル操作の制約

- **`docs/プロンプトログ*.ignore.md`**: ユーザーの作業ログ。修正・編集・変更は禁止。読み取りも**ユーザーが明示的に指示した場合のみ**とし、その場合も Grep で該当箇所を特定してから offset/limit 付きで部分読みする（1本最大249KBあり、全文 Read 禁止。settings.json の deny でも拒否される）。
- **回答の出力先**: 設計・調査・分析などの回答を出力する場合は `docs/tasks/YYYYMMDD_HHMM_{タイトル}.md` に保存すること（日時は `TZ=Asia/Tokyo date +%Y%m%d_%H%M` で取得）。**タイトル直後に1〜2行の要約（状態・結論）を書く**（索引の代わりにこの行で中身を判別する）。`docs/tasks/INDEX.md` は 2026-10-12 で更新停止（並行ブランチのコンフリクト源のため）。task doc 作成時に追記しない。索引の整備が必要なときは独立したタスクとして行う。
- **task doc の長さは中身に合わせる**: 必要な実質だけを書き、水増しの節・重複するまとめ・定型の前置きを足さない。
- **コード・`docs/*.md` から `docs/tasks/*.md` を参照しない**: task doc は rs-vis へ展開されず、archive 移動でパスも変わるため、展開先でリンクが切れる。恒久的な仕様・制約・設計判断は `docs/*.md` のガイドに書き、コードはそこを指す。task doc を参照してよいのは `.claude/` 配下と他の task doc のみ。
- **データファイル（`public/data/*.json`・`data/`）を Read で開かない**: 展開後 96MB 級があり1回で数万トークンになる。中身の確認・集計は `/data-query` スキルの作法（dev API / jq / gunzip -c / sqlite3）で行う。settings.json の deny でも拒否される。`data/download/` は生データ形式（zip/csv/pdf/xml/json/gz/xlsx/xls）だけ deny で、人手向け指示書（`_MANUAL_DOWNLOAD.md` 等）のような小さいテキストは読める。`data/result/`・`data/cache/`・`data/houjin.db*` は全面 deny のまま。

## 役割分担（研究タスク）

- **Orca Coordinator が計画から PR までを担う**: ユーザーと対話する Claude セッションが Orca Coordinator である。ユーザーと相談して研究計画・指示書を作り、Task に分解し、Orca Orchestration で Worker に dispatch・監督し、PR を作成するところまで進める。Worker の起動に通常の Agent やサブエージェントへ暗黙に fallback しない。
- **研究上の最終判断はユーザーが持つ**: 仮説、preregistration、GT・fixture の凍結、acceptance criteria、GO/STOP は、Coordinator が案を出し、ユーザーの合意を得てから確定する。結果を見た後で preregistration や GT を書き換えない。
- **ChatGPT は PR のレビュアー**: PR を read-only でレビューする。Claude は自分の成果を研究上で最終承認しない。レビュー結果は、ユーザーが確定して渡したものだけを修正指示として扱う。
- **PR の説明と最終報告は、ユーザーがそのまま ChatGPT へ渡せる形にする**: 実行したこと、検証結果、branch・commit・PR、frozen hash、未解決事項・想定外を隠さず含める。

## 探索の規律（トークン節約）

- **過去の検討を探すときはファイル名で絞ってから冒頭だけ読む**: `ls docs/tasks | rg <語>` や `rg -l <語> docs/tasks` で候補を絞り、`head` で冒頭の要約を見て対象を特定してから本文を読む（複数本を全文読みしない）。2026-10-12 以前の文書は凍結済みの `docs/tasks/INDEX.md` も使える。`docs/tasks/archive/` は `.ignore` で検索対象外（GitHub には残る）。役目を終えた文書を探すときだけパスを直接指定して検索する。
- API 仕様の正典は `docs/api-guide.md`、エージェント探索の作法は `docs/agent-playbook.md`。目的に合う方だけを読む（毎回両方読む必要はない）。
- **委譲の基準**: 多ファイル横断の広域調査など、独立して並列化できる大きめの調査だけ Explore サブエージェントに委譲し、本会話には結論だけ持ち帰る。数回のツール呼び出しで自分で終わる作業は委譲しない。自分の作業の検証・再確認のためにサブエージェントを使わない。1体で足りるなら1体に留め、起動数を増やさない。既に文脈がある作業のためのコールドスタート（再読込コスト）は避ける。

## Markdown 記法ルール（CodeRabbit/markdownlint 対応）

- **コードフェンスには必ず言語タグを付ける**（markdownlint MD040）。内容に応じて選ぶ:
  - JSON 例 → ` ```json `
  - シェル/コマンド → ` ```bash `
  - HTTP リクエストや URL 一覧、図・擬似コード・プレーンな箇条 → ` ```text `
  - TypeScript/JS → ` ```ts ` / ` ```tsx `
- 言語が曖昧なブロックは ` ```text ` を既定とする（MD040 を満たせれば可）。`docs/tasks/*.md` も CodeRabbit のレビュー対象なので例外なく適用する。

## 出力の既定

簡潔に。実況は最小限。書き物は必要な実質だけ。
