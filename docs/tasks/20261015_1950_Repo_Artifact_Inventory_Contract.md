# tests/fixtures と scripts の棚卸し — 数え方の契約

状態: 数える前に commit する。記述だけで、残す・消すの判定はしない（判定は、この表をユーザーが見て決める別の段階）。

- 対象: git 管理下の `tests/fixtures/<dir>/`（ディレクトリ単位）と `scripts/` 配下の `.ts .py .mjs .sh .js`（`*.test.*` を除く、file 単位）。
- 数える項目: 大きさ（bytes、script は行数）、最初・最後の commit 日、拡張子、`scripts` は同じ名前の `.test.*` の有無と `package.json` での言及。
- 参照元の数え方: 対象の名前（fixtures はディレクトリ名、scripts は file 名。`scripts/pipeline-v2/lib/` は `/名前'` `./名前'` の形の import）が本文に現れる file を、次の 4 種類に分けて数える。名前の一致で数えるため、短い一般語は過大に、動的に組み立てた名前は過小に数える（粗い数え方であることを前提に使う）。
  - `code_refs`: コード・設定（`tests/fixtures/`・`public/data/`・`docs/` を除く、テスト以外）
  - `test_refs`: `*.test.*`
  - `docs_md_refs`: `docs/*.md`・`.claude/`・`CLAUDE.md`・`README.md`（`docs/tasks/` を除く）
  - `task_doc_refs`: `docs/tasks/*.md`（参照元としては弱い。履歴の記録）
  - 自分自身（fixtures はそのディレクトリ内、scripts は自 file）は数えない。
- 出力: `docs/inventory/repo-artifacts/{fixtures.csv, scripts.csv, summary.json}`。`summary.json` に取得時の git HEAD を記録する。
- `scripts/research/inventory-repo-artifacts.py` を実行前に commit する。
