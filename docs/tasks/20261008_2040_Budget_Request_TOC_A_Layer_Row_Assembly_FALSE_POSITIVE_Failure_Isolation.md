# FY2024 概算要求 TOC A 層 row assembly — FALSE_POSITIVE Failure Isolation

成果物: `tests/fixtures/budget-request-toc-row-assembly-false-positive-failure-isolation/2024/`（`observations.json` 観測 table / `failure-families.json` family 化と causal status）。生成: `scripts/pipeline-v2/analyze-budget-request-toc-row-assembly-false-positive.ts`（保存済み artifact の読み取りのみ。parser は import も実行もしない）。

**#396 の `STOP_SAFETY` は再判定しない。** 本 unit は post-evaluation の failure isolation のみ。parser・GT・preregistration・amendment・evaluator・threshold は変更しておらず、held-out parser の再実行・fix simulation・visual inspection・追加の仮説検証は行っていない。判定 = `READY_FOR_FALSE_POSITIVE_HYPOTHESIS_FORMATION`（次 unit で仮説形成してよい、のみ。parser fix GO ではない）。

## 結果

- severe 10 件（5 page）は全て observation table に 1 回ずつ表現（evidence ID `FP-01`〜`FP-10`、欠落 0・重複 0）。
- **family は 1 つ**: `HEADER_ZONE_WHOLE_LINE_CONTAINS_RIGHT_COLUMN_ROW_START`（10 件 / 5 page）。件数合計 = 10。
  - 観測定義: right band E が解決された（ASSEMBLED_SPLIT）page で、最初の row-start 行より前の raw line（page 内の「総表」行と「明細表」行）が、E 以右に右 column の row-start token を含み、whole-line の TITLE_OR_HEADING（UNSPLIT・row-start token なし）1 unit として出力された。token は E 以右で boundary crossing はなく、同一行の左側は GT の PLAIN_ROW。
  - 内訳（同一機構内の観測属性。独立 family ではない）: token が request 番号 7 / marker 3、header 行の順が 1 行目 5 / 2 行目 5。1 unit あたり severe 1、1 page あたり 2。
  - counterexample: E が解決された他の 4 page（severe 0）では、header zone 内で E 以右に内容を持つ行は page title / 列見出しのみで GT の row token を含まない。
  - 付随観測（severe 件数には含まれない）: 同じ機構で右 column の wrapped fragment 行（token なし）が header zone の whole-line に取り込まれた例が 1 件（`230901-2.pdf` p3 line 10）。
- **causal status: `MECHANISTICALLY_EXPLAINED` 10 / `HYPOTHESIZED_CAUSE` 0 / `UNRESOLVED` 0。** #391 の header zone rule（最初の row-start 行の直前まで・分割せず whole-line を TITLE_OR_HEADING として保持）と #393 の実装どおりの出力で、行頭が「令和…」の行は row-start でないため header zone が延びる。実装の逸脱ではなく preregistered な挙動の帰結。
- **evaluator predicate check**: 10 件とも E 以右の GT 右 row の token が数字境界つきで含まれ、同一 raw line の左側が GT の PLAIN_ROW。複数の GT visual row が 1 parser unit の sourceRawSlice に含まれており、物理的な統合と整合する。predicate-only（文字列の偶然一致）の疑いは 0 件。
- **visual inspection: 未実施**（保存済み artifact だけで family 判定が一意にできたため）。

## 限界

- 左 PLAIN_ROW と右 row が視覚上も同一 baseline かは未確認（family 判定には不要）。
- 右 column がなぜ左より上から始まるか（layout 上の理由）は仮説の対象で、本 unit では扱っていない。
- 同一 agent が GT を作成している。

## 次の research question

右 band E が解決された page で、header zone の行（最初の row-start 行より前）が右 column の row-start token を含むかどうかを、**preregistered primitive（E・row-start token pattern）だけから**区別できるか。別 unit で仮説形成する（one change at a time → preregistration → development-only 検証 →必要なら新 held-out 設計）。
