# 概算要求 PR-2 Phase A — EXTRACTED 文書内 EMPTY 117 page の failure isolation

failure isolation のみ。classifier 未実装・preregistration 未作成・GT 未 freeze。page type は一切分類していない。

## 対象（frozen）

PR-1 fixture（corpus digest `7c6d2dce…c4052`、一致確認済み）から機械的に列挙: EXTRACTED 文書内の EMPTY page = **117**（47 physical PDFs / 46 logical documents）。PDF sha256 不一致 0。

## 観測方法

pdf.js 5.4.296（operator list・text content・annotation・rotate）、`pdffonts` / `pdfimages -list`（page 単位）、`pdftoppm -r 50 -gray` の画素統計（255 未満の画素率）。OCR・Route C は不使用。render 画像は作業者が一部のみ目視（下記）。

## 結果

| 区分 | page 数 | 根拠 |
|---|---|---|
| VISUALLY_BLANK | 116 | 50dpi render が全画素 255。うち 108 は content stream に showText op 1 個のみ（pdf.js text の non-whitespace 0 文字）、8 は描画 op 0 |
| RASTER_OR_IMAGE_DOMINANT | 1 | mext `…000031817_03.pdf` p1044/1339。image op 1・showText/font/text 0。page 全面の画像で、表・見出し・数値様文字・黒塗り矩形が目視で見える |
| UNRESOLVED | 0 | |

分布（context。page 自身の観測とは別）:

- 連続 EMPTY run は全て長さ 1（隣接 EMPTY なし）。
- 位置は中間 116 / 末尾 1（mext `…_01.pdf` p6/6）。先頭 0。
- **物理 page 番号は 117 件すべて偶数**。annotation 0、rotate 0。
- 47 PDF に分布（最大 5 page: 裁判所 R06saisyutsu）。PDF 別件数は fixture の `summary.perPdfEmptyPages`。

目視: 4 page（p1044 mext、moj `001402819` p2、caa `…_02` p2、courts p112）。他 113 page は画素統計のみ（目視していない）。目視した全白 page は画素統計と一致。

## 解釈の境界

- 116 page は「configured method で text が取れなかった」ことに加え、**render でも何も描画されない**ことが観測された。blank page であることは evidence されたが、それが何の page（余白・区切り等）かは分類していない。
- 1 page は text layer を持たない画像 page で、PR-1 の text では内容が見えない。representation-blocked とは呼んでいない。
- 偶数 page のみという偏りは観測であって、原因（両面印刷由来等）は未確認。
- 108 page の showText op 1 個の中身（空文字列等）は確認していない。

## Safety / validation

OCR 不使用・Route C 不使用・page type 推測なし。PR-1 frozen fixture 変更なし（git diff 空）、`data/download/` 不変（PDF hash 一致）。生成は 2 回実行で fixture が同一。`npm test` / tsc / lint パス。

## 成果物

- fixture: `tests/fixtures/budget-request-page-classification/2024/empty-page-failure-isolation.json`（`--freeze-fixture` 明示時のみ書く）
- script: `scripts/pipeline-v2/run-budget-request-empty-page-failure-isolation.ts`
- test: `scripts/pipeline-v2/lib/budget-request-empty-page-failure-isolation.test.ts`

## STOP

次の判断（931 EMPTY page の評価母集団の扱い、EMPTY を分類状態にするか、前 page 継承、direct evidence rule、N、vocabulary、split、GT freeze、GO/STOP 基準）は user / ChatGPT に返す。
