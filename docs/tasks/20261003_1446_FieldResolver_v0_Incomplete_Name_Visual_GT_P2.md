# FieldResolver v0 — incomplete-name guard: Visual GT（P2）

事前登録（`20261003_1321_…_Preregistration.md`、補遺 `…_Supplement.md`）を変更せず、凍結済みの 43 unit について、原本 PDF の視覚だけで名称の完全性ラベルを作り、GT を凍結する。guard の評価・実装はしない。

## 結論

**P2 DONE（43/43 unit をラベル化）。** complete 16・incomplete 27・unclear 0。GT は `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/visual-gt.json`。

## 1. 手順

- 入力は `gt-worklist.json`（unit の位置〈ページ・record の code・logical row の y 範囲〉のみ）。`sample.json`（層・baseline の名称）、FieldResolver の出力、guard の predicate、Treatment の出力は**使っていない**。標本の層は作業中に見直していない。
- 各 unit について、原本 PDF の該当ページを `pdftoppm`（150 dpi、x 0〜510pt、y は anchor の −30〜+75pt）で描画した画像を見て、record の code、名称の各行、直下の行を確認した。見えない文字の補完・Web 検索・過去の報告の転記はしていない。
- ラベルは 1321 §10 の契約どおり: `complete_on_current_logical_row`（名称の全行が当該 logical row の y 範囲 `anchorYPt` の内に収まり、直下に続きが無い）／`incomplete_continues_below`（名称の行が y 範囲の下に続く）／`unclear`（今回は 0）。名称は視覚で読めた行だけを `visualNameLines` に記録し、行数と `linesWithinAnchorRow` からラベルが決まるようにした（整合はテストで固定）。全角・半角・文字間の空白は正規化していない。
- 開示: 作業者は標本の設計者でもあり、環境省 p75 の 3 unit が既知の failure であることは会話から知っている。ラベルは各 unit の PDF 画像だけで付けたが、完全な盲検ではない。独立した人間のレビューは**未実施（`humanReview: pending`）**。

## 2. 結果

| ラベル | 件数 |
|---|---:|
| complete_on_current_logical_row | 16 |
| incomplete_continues_below | 27 |
| unclear | 0 |

- 視覚確認できなかった unit: なし。locator（ページ・code・y）が曖昧で対象行を特定できなかった unit: なし（同一ページに同じ code が複数ある場合も、y 範囲で 1 つに決まった）。
- 注記: unit `meti-detail-9-106:38:15`（code `005`）の logical row は 3 行分の高さ（名称は 2 行で、残りは備考側）。名称は 2 行で完結なので complete。Unicode が視覚で決められない名称（`ＥＢＰＭ`・`ＮＰ`）は `reviewNote` に記録した。
- GT schema 上の問題: なし（1321 の label 契約をそのまま使った）。

## 3. 環境の保全（SHA-256、開始前と終了時で一致）

凍結済みの sample（`sample.json`、43 unit、21,605 bytes）は `bffdbd3229c64179df1888ea97cd066a885c2ebaa890bfc10853348d1df90807` のまま。作業リスト `6836588b…ca7b1`、`baseline-artifacts.json` `79a08299…2e98e`、1321 本文 `914027e3…9317b`、補遺 `c2df62f0…c957a`、`budget-request-field-resolver.ts` `bad13049…44c1`、`budget-request-logical-row.ts` `6b4bf396…0326`、選定ツール `40e891a1…e636`。いずれも変更していない（P2 の commit に含まれる変更は下記の新規ファイルのみ）。

## 4. 追加したもの

- `tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/visual-gt.json`（GT の fixture）
- `scripts/pipeline-v2/lib/budget-request-incomplete-name-guard-visual-gt.test.ts`（GT の整合: 作業リストと 1 対 1、ラベルと行数の整合、層・baseline の名称を含まない）
- 本 report と INDEX の 1 行
- 新しい helper: なし。

## 5. P3 に進める状態か（P2 の完了条件の充足だけに基づく）

frozen 43 unit を全件処理、全 unit に契約のラベル、PDF の視覚のみで付与、fixture は機械可読、report あり、sample の identity は開始前後で一致、preregistration・P1 fixture・baseline・FieldResolver・LogicalRow は未変更、guard 未実装、評価未実施 → **P2 の完了条件はすべて満たす**。P3（guard の実装）は別指示・別 commit。P3 の結果は予測しない。人間レビューが後で値を変えても、凍結した GT は置き換えず、差分として別記する。
