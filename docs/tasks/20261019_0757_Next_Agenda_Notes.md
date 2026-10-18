# 次に考えていること（メモ）

状態: 未着手・未決。ユーザーが 2026-10-19 の一区切りで挙げた 5 項目の記録。優先順位・順序・方針は決めていない。

## 1. 事項要求の検知ができるかの検証
- 概算要求書には、金額を持たない「事項要求」がある（例: 日本学術会議。FY2024・FY2025 は、内閣府の掲載ページに「事項要求」とだけ書かれ、要求書の PDF がない）。
- PDF に「事項要求」と書かれた項・事項を、機械的に検知できるかを確かめる。

## 2. 新しい `/mof-kou` の UI の検討
- `tests/fixtures/budget-request-csv`（概算要求の総表・明細表・TOC・表紙の CSV）と `tests/fixtures/mof-archive-csv`（MOF の予算書の項・目・事項の CSV）を土台にする。
- 現在の `/mof-kou`（URL 直打ち・予算書の項一覧）を、これらの CSV に基づいて作り直す案。

## 3. integrated-sankey の機能拡充
- 既存の統合サンキー（`feature/integrated-sankey-first-cut` など）に、機能を足す。具体的な内容は未定。

## 4. rs-vis の概算要求機能の確認
- リポジトリ `rs-vis` に、概算要求に関する機能があるかを確認する。この repo の成果（概算要求 CSV・MOF との突合）との関係を見る。

## 5. 新リポジトリへの移行
- 既存の機能と、新しい機能（概算要求・MOF 突合・統合サンキーなど）を分けるため、新しいリポジトリに移す。
- 範囲・移し方は未定。

## 参考（現在の状態）
- 概算要求 CSV と MOF 突合は FY2023〜FY2026 に対応し、main にマージ済み（`docs/mof-budget-request-match.md`）。
- 取得できていない PDF の一覧は `docs/inventory/budget-request-sources/missing-pdfs.csv`。FY2024 の金融庁（文字層なし）は保留。
