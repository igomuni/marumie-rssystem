# FieldResolver v0 H1 P3 Visual GT freeze

2026-10-03。H1 scope-completion audit の P3。frozen worklist 38 unit を、事前登録済みの visual-only 規則で分類し、評価前に freeze した。**P4 評価・GO/STOP/INCONCLUSIVE 判定・既存 27 件との結合評価は行っていない。**

- worklist: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-scope-completion-worklist.json`（38 unit、SHA-256 `fa9a3abe…7028c`、freeze commit `caefc62`）
- 事前登録 commit `4ad66c4`、補遺 commit `2e7656e`（ラベル定義は変更していない）
- GT artifact: `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-scope-completion-visual-gt.json`（38/38 unit、SHA-256 `3cb9eb9a5825ba3739a560e17940f224633c62890243a846d0cc89920a1318b9`）
- 原本: `data/download/` のローカル取得原本 4 本（maff・meti・mlit・mod）。manifest の canonicalUrl と 1 対 1 に特定でき、SHA-256 は artifact に記録。原本は変更していない。
- 方法: `pdftoppm` 170 dpi の単純切り出しを目視。worklist の locator で対象位置を探し、アンカー行の範囲（anchorYPt）を左余白の枠で示した。画像処理・OCR・extracted text は使っていない。
- blind: baseline name・guard 出力・predicate・reasonCode・既存 visual-gt の個別ラベル・unit 別 machine output は参照していない（guard-fire reason / machine output に対して blind。38 件が guard 発火母集団であること自体は既知）。blind violation なし。locator failure なし。
- 判定の運用: ラベルは「アンカー行の直下に、同一名称として続く文字列が視覚的に確認できるか」で付けた。名称欄の同一セル内の続き行は、行頭に code・金額が無く次 record の code にも属さないことを視覚構造で確認した。推測が必要な unit に `unclear` を付ける運用だった。
- review status: `humanReview: pending`（AI による視覚判定のみ。独立した人間レビュー未実施）。
- integrity test: `budget-request-incomplete-name-guard-h1-visual-gt.test.ts`（38 件の set equality・ラベル種別・重複なし。ラベル件数は集計しない）。

次: P4（機械的な H1 判定）は別指示で行う。
