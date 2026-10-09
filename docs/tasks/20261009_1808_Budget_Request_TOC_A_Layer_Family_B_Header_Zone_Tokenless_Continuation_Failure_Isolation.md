# FY2024 概算要求 TOC A 層 — Family B（header zone の tokenless text）corpus-level failure isolation（census のみ）

census: `tests/fixtures/budget-request-toc-header-tokenless-failure-isolation/2024/census.json`（生成 `scripts/pipeline-v2/analyze-budget-request-toc-header-tokenless.ts`、helper `lib/budget-request-toc-header-tokenless.ts`・test 同名 `.test.ts`）。

## 1. Objective

H2 / H7 で確認された「header zone にある row-start token なしの text が whole-line TITLE_OR_HEADING として扱われ fragment 候補にならない」機構に関連し得る raw-text / parser-state pattern は 82 page corpus でどの程度存在するか。**機械的な観測のみ。** candidate が continuation か・owner・title / column heading・右 column 帰属・attach すべきか、は推測しない。parser / H1 / evaluator / GT / preregistration は変更していない。

## 2. Source boundary / no visual inference

- PDF は開かず、再抽出・OCR・screenshot・Web は使っていない。入力は既存 raw-text の `nonEmptyLines`（今回の実行契約で、HelloOrcaWorld に無い場合に限り read-only 使用を明示許可された既存 artifact）。
- 検証（census 実行ごとに）: committed manifest `tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json` の `artifactSha256` と実 artifact の SHA-256 を **使用した 55 artifact 全て**で照合、82 page の `textSha256`（full-corpus-status.json）と raw page の `textSha256` / `sha256(text)` を照合 → **不一致 0**。使用 artifact の sha256 一覧は census.json `input.verifiedArtifactSha256`。
- 82 page の母集団・partition・page state は `tests/fixtures/budget-request-toc-full-corpus-status/2024/full-corpus-status.json` を基準にした。H1 を再実行し、page state / E / abstention reason / fragmentsAttached / H1 trigger・negativeControl 行集合が **全 82 page で full-corpus-status.json と一致**（不一致は STOP する実装）。
- 右 text 本文は fixture に保存せず、(lineIndex, charStart, 文字数, sha256) のみ。旧 workspace の絶対パスは §14 のみ。

## 3. Mechanism reconstruction（コードで再確認）

FACT:

| 項目 | 場所 |
|---|---|
| header zone = 最初の `rowStartsLine`（行頭が request / marker / OTHER_CODE）行の直前まで、無ければ全行 | `budget-request-toc-row-assembly.ts:85-88, 141-142`、`-h1.ts:85-88, 141-142` |
| header zone 内は無条件に whole-line `TITLE_OR_HEADING` / `UNSPLIT`（title は barrier） | #393 `:205-210` |
| H1 が足したのは H1-BEGIN/END（`-h1.ts:206-225`）のみ。split page かつ E 以右が row-start token で始まり conflict / crossing なしなら LEFT=TITLE + RIGHT=classify | `-h1.ts:206-225` |
| 非 trigger の header 行は whole-line TITLE のまま | `-h1.ts:226-230` |
| tokenless 行は header zone では classify / attach に到達しない | classify `:158-187`、attach `:189-196` は body 行（`i >= headerEnd`、`:232-256`）からのみ呼ばれる |
| trigger / negativeControl | `budget-request-toc-h1-formal-evaluation.ts:21-47` `h1TriggerCensus`（T1: `ASSEMBLED_SPLIT && edge!=null`、T2: H1 出力の TITLE_OR_HEADING（UNSPLIT\|LEFT）行、E 以右 trim 非空、`startsRowToken(right)` かつ conflict/crossing なし→trigger、`startsRowToken` かつ conflict/crossing→どちらにも入れない、`startsRowToken` 偽→negativeControl） |
| 既存 `KNOWN_TOKENLESS_FRAGMENT_RELEVANT` | `budget-request-toc-full-corpus-status.ts:54`: `triggerLines.length>0 && negativeControlLines.some(l => l > Math.min(...triggerLines))` |

既存 flag の限界（FACT）: (a) trigger のない page では常に不成立、(b) 最初の trigger 以前の行は対象外、(c) 非 SPLIT / abstained page は `h1TriggerCensus` の T1 が空を返すため同種の行が **未計上**（E が未確定）。

## 4. H2 / 訂正後 H7 anchors（census 全体より前に検証）

観測の出典は `tests/fixtures/budget-request-toc-human-review-failure-isolation/2024/observations.json`（H7 は `postReviewHumanCorrection` の訂正後の最終観測のみ。初回「req23 のみ」は使用していない）。H2 と H7 の machine outcome は同一と仮定せず、個別に照合した。

| | H2（maff 230901-2 p3） | 訂正後 H7（mof 2024ippan_2 p2） |
|---|---|---|
| human 観測（observations.json） | continuation req18 / req19 / req23 | continuation req18・req23 |
| 再計算: page state / E | ASSEMBLED_SPLIT / 55（observations と一致） | ASSEMBLED_SPLIT / 55（一致） |
| 再計算: H1 trigger 行 | 7, 9 | 7 |
| 再計算: candidate 行（lineIndex） | 0, 2, 4, 10 | 0, 2, 5, 8 |
| human 関連行 | line 10（observations の UNSPLIT title「に必要な経費」と右 text sha 一致、left 空白）= AFTER_TRIGGER + KNOWN_FLAG_MATCH、whole-line TITLE | line 8（同上）= AFTER_TRIGGER + KNOWN_FLAG_MATCH、whole-line TITLE |
| 再計算: machine fragment attach | 2 件（req19 ← line 15、req23 ← line 32）。observations と完全一致（owner・lineIndex・charStart/End・text）。line 10 への attach なし | 1 件（owner req18 line 61 ← line 62）。observations と完全一致。line 8 への attach なし |
| 両 page とも human-review-queue の KNOWN 対象 | 是 | 是 |

不一致なし。anchor は機械 pattern が実在することの確認であり、「line 10 / line 8 が continuation である」ことは human observation（既存記録）に依拠する。他 page の candidate には適用しない。

## 5. Census の定義（実行前に固定。結果を見た後で調整していない）

コード先頭コメントと同一。

- header zone 行数 = 最初の `rowStartsLine` 行の位置（`nonEmptyLines` 配列 index）。parser の述語は非 export のため exported source 定数から同一の述語を再実装し、**E 確定・UNSPLIT の 79 page で H1 出力の TITLE_OR_HEADING（UNSPLIT\|LEFT）行の distinct lineIndex 数と一致することを census 内で強制**（不一致は STOP）。abstained 3 page は出力 row が空のため再実装の値のみ。
- E 未確定（UNSPLIT 44 + ABSTAINED 3 = 47 page）は `E_UNDEFINED`。candidate 集計の外に置き header zone 行数のみ記録。H2 / H7 は SPLIT page。
- candidate = SPLIT page の header zone 内、E 以右 trim 非空、`startsRowToken` 偽の行（= negativeControlLines と同一集合）。
- 一次分類（排他）: `HEADER_TOKENLESS_AFTER_TRIGGER`（行 lineIndex > 最初の trigger）/ `HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT`（それ以外 = trigger なし page、または最初の trigger 以前）。
- flags（非排他）: `KNOWN_FLAG_MATCH`（既存 flag を満たす page の AFTER 行）/ `PAGE_REF_TOKENLESS`（parser の FRAGMENT_WITH_PAGE_REF と同じ末尾 page ref 述語 `\s+PAGEREF\s*$` を trim 右 text に適用。同等性は test で `assembleTocPageH1` の挙動と照合）/ `OTHER_HEADER_TOKENLESS`（上記いずれでもない residual）。
- candidate 行ごとの機械特徴: lineIndex・charStart・E との差・右 text 文字数・sha256・左が空白のみか・headerEnd までの行距離・直前 / 直後の trigger までの行距離（配列 index 差）。意味づけなし。
- mechanically attachable fragment count: parser を変更せず再実装もしないと導出できないため `NOT_DERIVED`（§11）。header zone 行は構造上 classify / attach に到達しない（§3）。

## 6. Corpus census（82 page）

FACT:

| 項目 | 値 |
|---|---|
| page 総数 / partition | 82 = dev34 / first-heldout23 / new-heldout25 |
| page state | SPLIT 35 / UNSPLIT 44 / ABSTAINED 3（E 確定 35、E_UNDEFINED 47） |
| header zone 行数（合計 463） | E 確定 185 行 / E_UNDEFINED 278 行 |
| H1 trigger | 39 行 / 20 page |
| negativeControl（= candidate） | **91 行 / 35 page**（35 page は SPLIT 全件）。うち trigger 0 かつ neg>0 が 15 page |
| 既存 KNOWN flag | **2 page**（maff 230901-2 p3、mof 2024ippan_2 p2）= human-review-queue.json と page 集合一致。再計算値は full-corpus-status.json のものと全て一致 |
| 現行 fragment attach（全 82 page 合計） | 55（full-corpus-status と一致） |
| candidate 行数 / page | 1 行:6、2 行:4、3 行:23、4 行:2（候補なし E 確定 page は 0） |
| candidate の左側が空白のみ | 27 / 91 行 |
| PAGE_REF_TOKENLESS | 0 行 / 0 page |
| OTHER_HEADER_TOKENLESS | 0 行（定義上の residual。0 であることを確認） |
| 全 candidate が H1 出力で whole-line UNSPLIT TITLE_OR_HEADING | 91 / 91（強制 check） |

一次分類:

| 分類 | 行 | page |
|---|---|---|
| HEADER_TOKENLESS_AFTER_TRIGGER | 2 | 2 |
| HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT | **89** | **35** |
| 　うち trigger なし page | 31 | 15 |
| 　うち最初の trigger 以前の行（trigger あり page） | 58 | 20 |
| KNOWN_FLAG_MATCH | 2 | 2 |

AFTER_TRIGGER と既存 flag の差: **なし**（AFTER を持つが flag なしの page 0、flag ありだが AFTER なしの page 0。条件が同一であることを確認）。`WITHOUT_TRIGGER_CONTEXT` は既存 flag の定義上の外側の母集団として数えたのみで、その行が何であるかは判定していない。

## 7. Partition breakdown

| partition | page | SPLIT / UNSPLIT / ABST | candidate 行 / page | AFTER 行 | WITHOUT 行（trigger なし page / 最初の trigger 以前） | 既存 flag page | trigger 行 / page |
|---|---|---|---|---|---|---|---|
| DEVELOPMENT_EXPLORED | 34 | 20 / 13 / 1 | 50 / 20 | 1 | 49（21 / 28） | 1 | 19 / 10 |
| FIRST_HELDOUT_POSTHOC | 23 | 9 / 12 / 2 | 25 / 9 | 1 | 24（9 / 15） | 1 | 10 / 5 |
| NEW_HELDOUT_POSTHOC | 25 | 6 / 19 / 0 | 16 / 6 | 0 | 16（1 / 15） | 0 | 10 / 5 |
| 計 | 82 | 35 / 44 / 3 | 91 / 35 | 2 | 89（31 / 58） | 2 | 39 / 20 |

単一の成功率にはしていない。

## 8. Candidate / control population（§15 controls、page 単位）

候補を持つ 35 page（全て SPLIT）を、現行 fragment attachment（page 内に 1 件以上）等で別々に数える。attach は page 全体の 1 件以上であり、candidate 行に対する attach ではない。

| control | page |
|---|---|
| candidate あり + current fragment attachment あり | 20 |
| candidate あり + attachment なし | 15 |
| candidate あり + page ref | 0 |
| candidate あり + H1 trigger あり | 20 |
| candidate あり + H1 trigger なし | 15 |
| candidate なし（E 確定） | 0 |
| candidate なし（E_UNDEFINED） | 47（うち attachment あり 6） |

page 単位 diagnostic key（CAND/NOCAND・FLAG・TRIG・PREF・ATT の組み合わせ。意味づけなし）:

| key | page |
|---|---|
| CAND\|FLAG\|TRIG\|NOPREF\|ATT | 2（H2・H7） |
| CAND\|NOFLAG\|TRIG\|NOPREF\|ATT | 10 |
| CAND\|NOFLAG\|TRIG\|NOPREF\|NOATT | 8 |
| CAND\|NOFLAG\|NOTRIG\|NOPREF\|ATT | 8 |
| CAND\|NOFLAG\|NOTRIG\|NOPREF\|NOATT | 7 |
| NOCAND\|NOFLAG\|NOTRIG\|NOPREF\|ATT | 6 |
| NOCAND\|NOFLAG\|NOTRIG\|NOPREF\|NOATT | 41 |

mechanical pattern があっても現行 parser が問題なく処理している可能性のある control population（trigger あり・candidate あり・attach あり 等）を消していない。H2 / H7 以外の candidate は candidate に留め、continuation とは推測しない。

candidate 35 page の一覧（pdf#page）は census.json `candidatePages`、page ごとの header zone 行数・trigger 数・candidate 特徴は `pages[]` を参照。

## 9. Validation

| # | 内容 | 結果 |
|---|---|---|
| 1 | helper unit / integrity test（合成行・committed fixture、data/work 不要）`budget-request-toc-header-tokenless.test.ts` | 10 passed |
| 2 | anchor H2 / 訂正後 H7 整合 | 一致（§4） |
| 3 | 82 page coverage | 82（重複なし） |
| 4 | partition | 34 / 23 / 25 = 82 |
| 5 | 内部整合 | 一次分類合計 = candidate 行（91）、WITHOUT 内訳合計 = 89、partition 合計 = 91、diagnostic key 合計 = 82、candidate = negativeControl = 91 |
| 6 | 既存 flag 照合 | 2 page、human-review-queue と page 集合一致 |
| 7 | deterministic | 同一入力 2 回実行で census.json の sha256 一致（`d2c3f9b0878614466a3f69034164c86f60050c4783633e31a4b7fbaf2ceda5e7`） |
| 8 | 既存関連 test（`vitest run scripts/pipeline-v2/lib/budget-request-toc`） | 24 file / 158 passed, 1 skipped |
| 9 | `npx tsc --noEmit` | error 0 |
| 10 | `npm run lint` | error 0（既存 warning のみ） |

## 10. FACT / MECHANISM / UNRESOLVED

FACT:

- header zone の tokenless な E 以右 text を持つ行（= H2 / H7 と同じ machine-observable pattern）が、82 page 中 **35 page（SPLIT 全件）・91 行**で観測された。うち既存 flag の条件を満たすのは 2 page・2 行（H2・H7）。
- 既存 flag の定義の外側（trigger なし、または最初の trigger 以前）に同じ machine pattern を持つ行が 89 行 / 35 page あった（trigger なし page は 15 page・31 行）。
- 91 行全てが H1 出力で whole-line TITLE_OR_HEADING（fragment 候補にならない）。page ref を持つ candidate はない。
- 未計上: E_UNDEFINED の 47 page（header zone 278 行）は E 未確定のため candidate の有無自体を定義できない。

MECHANISM:

- header zone 内の行は構造上 classify / attach に到達しない（§3）。したがって candidate 行は parser 状態として fragment になり得ない。これは構造の記述で、「attach すべき」という主張ではない。

## 11. UNRESOLVED

- candidate 91 行のうち H2 line 10 / 訂正後 H7 line 8 以外が何であるか（見出し・column heading・continuation 等）は未判定。多くが 3 行の header zone・trigger なしの page にある事実のみ。
- mechanically attachable fragment count: `NOT_DERIVED`（parser 変更または再実装なしに導出できない）。
- E_UNDEFINED 47 page の同種行は E 未確定のため測れていない。
- 現行 fragment attachment との per-line の対応（candidate 行が属する logical row の有無）は未導出。

## 12. Claim boundary

言えること: 「H2 / H7 と関連し得る machine-observable な header-zone tokenless pattern が 35 page・91 行で観測された（82 page 中、E 確定 35 page の全て）。うち既存 flag 条件を満たすのは 2 page・2 行」まで。言えないこと: candidate が continuation である、attach すべきである、既存 flag が見逃している失敗がある、91 行のうち 89 行が H2 / H7 と同種である。`WITHOUT_TRIGGER_CONTEXT` は既存 flag の定義上の外側の母集団として数えたのみ。

## 13. Next research question（仮説・改善案ではない）

E_UNDEFINED を含めて、header zone の tokenless text を、既存 GT / human observation のある page（GT 48 page 等）でどの程度 GT の fragment と対応づけられるか。candidate 行ごとの意味づけは別の判断（visual evidence）を要する。

## 14. 実行環境メモ

- raw-text は旧 workspace の既存 artifact を read-only 参照（`--raw-text-root` 指定。コピー・`data/work` 作成なし）。パス: `/Users/igomuni/MyGitHub/marumie-rssystem/data/work/budget-request-raw-text/2024`。
- 実行: `npx tsx scripts/pipeline-v2/analyze-budget-request-toc-header-tokenless.ts --raw-text-root <上記> --freeze-fixture tests/fixtures/budget-request-toc-header-tokenless-failure-isolation/2024`（`--anchors-only` で anchor のみ）。
- no hypothesis / no preregistration / no parser change / no GT・evaluator・frozen artifact change。#405 の helper は変更せず、loader の考え方を踏襲した（#405 のスクリプトはトップレベル実行のため import せず）。
