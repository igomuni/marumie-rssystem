# 概算要求 PR-1 — Raw Text Corpus / Raw Text Contract

## Purpose

FY2024 概算要求 PDF の page 単位 Raw Text を再現可能に生成し、後続の Page Classification（PR-2）が依存できる source-observation layer の入力 contract を freeze する。

## Scope / Non-goals

- Scope: manifest の physical PDF すべて → `pdftotext -layout` → page ごとの raw text・non-empty lines・hash・status・provenance。
- Non-goals（実装していない）: page type 分類、項・事項・hierarchy、金額 semantics、MOF 照合、OCR / Route C、fuzzy matching、UI。

## Input evidence

- Source of truth: `scripts/pipeline-v2/lib/fy2024-budget-request-manifest.ts`（型 `budget-request-manifest.ts`）。base = origin/main `663847f`。
- 同等の Raw Text 生成物は main に無かった（既存は pdf.js の token 抽出で、plain text の page record ではない）。
- 実測: 62 logical documents / 82 physical PDFs / 9,899 pages。探索時の値と一致。

## Raw Text contract（`lib/budget-request-raw-text.ts`）

- page は physical page の 1-based 番号。印刷ページ番号は扱わない。
- `text` は抽出器の返却を無加工で保持（正規化・trim・行結合なし）。`textSha256` = UTF-8 の sha256。
- `nonEmptyLines` は text からの決定的な派生値。`"\n"` で分割、行は無加工、non-whitespace（JS `/\S/`）を含む行のみ。`lineIndex` は 0-based。
- page status: `EXTRACTED`（non-whitespace ≥ 1 文字）/ `EMPTY`。EMPTY は「configured method で取得できなかった」という観測で、原因の分類はしない。
- document status: `EXTRACTED` / `EMPTY`（全 page が EMPTY。page record は pageCount 件作る）/ `FAILED`（page record は作らない）。
- page 数が pdfinfo と合わない、または出力が form feed で終わらない場合は page boundary を保持できないとして FAILED にする（推測で補正しない）。

## Extraction provenance

`pdftotext -layout -enc UTF-8 <pdf> -`（poppler 26.09.0、pdfinfo 26.09.0、darwin-arm64）。全 82 PDF に同一適用。`-enc UTF-8` は locale 依存を避けるための明示で、探索時（指定なし）と出力は同一だった（総文字数が一致）。

## Artifact / storage

| 物 | 場所 | Git |
|---|---|---|
| 全 page の PageRawText（jsonl、82 files、~99MB） | `data/work/budget-request-raw-text/2024/pages/` | 管理外（generator で再生成） |
| frozen input + 文書別 hash + page 単位 text hash（~0.75MB） | `tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json` | 管理 |
| 代表 6 page の raw text | `.../representative-pages.json` | 管理 |

全文を Git に入れない根拠: 全文は text 38.6M 文字で既存 fixture 群（約 13MB）を大きく超える。page 単位 hash で再生成物の一致を検証できる。generator: `scripts/pipeline-v2/build-budget-request-raw-text.ts`。

## Frozen input record

- base commit: `663847fda868d8558084482e03a45b1f8a18f4ed`
- manifest sha256: `fy2024-budget-request-manifest.ts` = `26d1975d…caa3`、`budget-request-manifest.ts` = `92426262…f478`
- corpus digest sha256: `7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052`（各文書の `localPdfPath pdfSha256 artifactSha256` を manifest 列挙順に連結）
- 文書別 PDF sha256・artifact sha256・page text sha256 は `raw-text-manifest.json`。

## Validation（実測）

- manifest の 82 PDF すべてを attempt、82 件が record 化（FAILED 0）。
- PDF page 数 = page record 数（9,899）。page boundary 不一致 0。
- 同一環境で 2 回生成し corpus digest が一致（決定的）。
- 生成の前後で source PDF の sha256 が不変（処理中の変更があれば throw する）。
- `npm test` 1519 passed、`tsc --noEmit` / lint エラーなし。fixture 整合テストは data/download に依存しない。

## Measured counts

| | |
|---|---|
| EXTRACTED / EMPTY / FAILED（文書） | 80 / 2 / 0 |
| 文字数 / non-whitespace 文字数 | 38,643,980 / 7,291,560 |
| EMPTY 文書 | moj `001402818.pdf`（737 p）、fsa `6youkyuu-2/01.pdf`（77 p） |
| EXTRACTED 文書内の EMPTY page | 117 |

探索時の `62 / 82 / 9,899 / 80 EXTRACTED / 2 EMPTY` と一致。EMPTY の 2 文書も既知と同一。

## Limitations

- text が無い page は「PDF に文字が無い」ことを意味しない（drawing-path 文字、特殊 encoding 等）。
- reading order・glyph mapping は抽出器依存。poppler の version / platform が変わると hash が変わり得る（provenance に記録済み）。
- 931 の EMPTY page の内訳（EMPTY 2 文書 814 p + 他 117 p）の意味は未分類。

## GO / STOP

**GO**。manifest target を漏れなく attempt、page boundary 保持、provenance 追跡可能、raw と semantics 分離、決定的、source PDF 不変、tests pass。

## Next step

PR-2 Page Classification v0 の preregistration / GT freeze。入力は本 fixture の frozen input と page text hash。
