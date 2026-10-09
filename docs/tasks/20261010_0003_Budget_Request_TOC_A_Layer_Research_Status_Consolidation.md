# TOC A層 Research Status Consolidation（#389〜#409）

新しい研究・集計・再計算・仮説を含まない、committed task docs / fixtures の状態整理。出典略記: 「#N doc」= 該当 PR の task doc、「fx」= `tests/fixtures/budget-request-toc-*/2024/` 配下の JSON。

## 1. 目的と位置づけ

- #389〜#409 で積み上がった FY2024 TOC A層（column segmentation・physical row assembly・wrapped fragment ownership）研究の**現在地を固定**する。formal evidence・post-hoc evidence・known limitation を分離したまま並べる。
- 本書は production-ready certification でも parser correctness proof でも TOC 完全 coverage の証明でもない。
- 中心の decision question: **「A1/A2/B/C に追加研究コストを払うべきか、現在の A 層を明示的な limitation 付きで freeze して次の研究層へ進める状態か」**。本書は判断せず材料を整理する（§11 は比較のみ）。
- 本書の proposed priority・proposed consolidated state は本書上の記述的提案であり、研究判断ではない。

## 2. Evidence sources

### 2.1 PR → commit → task doc

doc 名は `docs/tasks/` 直下。commit は `origin/main` 上の SHA（#407 は §2.2 参照）。

| PR | commit | task doc |
|---|---|---|
| #389 | b0a1f6518b62ab6988e960654405146847ef6915 | 20261008_0746_Budget_Request_TOC_Column_Aware_Failure_Isolation.md |
| #390 | 5a02b54cb0f1363df85617af361c2cc2b234d0ba | 20261008_0900_Budget_Request_TOC_Physical_Row_Minimal_Failure_Isolation.md |
| #391 | be6753b2a99310cf9ad9f42c150c00d2d37395de | 20261008_1150_Budget_Request_TOC_A_Layer_Row_Assembly_Preregistration.md |
| #392 | 6e9a4fb584abc33013956bb093a82564a6821793 | 20261008_1503_Budget_Request_TOC_A_Layer_Row_Assembly_Visual_GT_Freeze.md |
| #393 | e0f3470de11d2916cc64c83fe461f7acb6a084b3 | 20261008_1810_Budget_Request_TOC_A_Layer_Row_Assembly_Parser_Implementation.md |
| #394 | ec89af9f7de6e84dde5420a3a9c41da750a36d86 | 20261008_1837_Budget_Request_TOC_A_Layer_Row_Assembly_Evaluation_Protocol_Clarification.md |
| #395 | 8d41f9a58863b08063c2036e3fea681cd8f16a24 | 20261008_1931_Budget_Request_TOC_A_Layer_Row_Assembly_Evaluation_Protocol_Amendment.md |
| #396 | 9a776abfab646d15767367392c37b66106873181 | 20261008_1952_Budget_Request_TOC_A_Layer_Row_Assembly_One_Shot_Frozen_Evaluation.md |
| #397 | c3d8f25d99924532a7864c01544013c9aa367638 | 20261008_2040_Budget_Request_TOC_A_Layer_Row_Assembly_FALSE_POSITIVE_Failure_Isolation.md |
| #398 | d6f992d0a67a68e03112b7085670fc0ee0e568d4 | 20261008_2023_Budget_Request_TOC_A_Layer_Header_Zone_Right_Row_H1_Preregistration.md |
| #399 | 1dab76b5aa5fae3453744936491ac2e4864f978f | 20261008_2150_Budget_Request_TOC_A_Layer_Header_Zone_Right_Row_H1_Development.md |
| #400 | ec3906e01db815628bcece04eccd8ba05fc429bd | 20261008_2150_Budget_Request_TOC_A_Layer_H1_Implementation_and_New_Heldout_Membership_Freeze.md |
| #401 | 6c361b94cff8bb419404b79f718b4e39cf68ded6 | 20261009_0626_Budget_Request_TOC_A_Layer_H1_New_Heldout_Visual_GT_Freeze.md |
| #402 | a59f6e2571d2297e2855e0b2418cd328175a3a78 | 20261009_0748_Budget_Request_TOC_A_Layer_H1_One_Shot_Formal_Frozen_Evaluation.md |
| #403 | 79871b90d0456ee477573d02dc3e8e09fa1a84eb | 20261009_0900_Budget_Request_TOC_A_Layer_Full_Corpus_Status_Assessment.md |
| #404 | cb0f50de3d334cb4ae8a294192c2977d9b880c41 | 20261009_1130_Budget_Request_TOC_A_Layer_Human_Review_Failure_Isolation.md |
| #405 | 40b54acf831cb76d4384b626c474116943ec90f5 | 20261009_1528_Budget_Request_TOC_A_Layer_A2_Right_Band_Evidence_Failure_Isolation.md |
| #406 | e251fe6e43a75abb94b25102c0b547b93ea2ceab | 20261009_1808_Budget_Request_TOC_A_Layer_Family_B_Header_Zone_Tokenless_Continuation_Failure_Isolation.md |
| #407 | 7728d36fcfd90851cc428044f97725694a4a8c44（squash） | 20261009_1852_Budget_Request_TOC_A_Layer_Family_B_Header_Zone_Tokenless_Visual_Failure_Isolation.md |
| #408 | e9018831b391da94a6cbdbacc6af70ad38001cb1（通常 merge commit） | 20261009_1906_Budget_Request_TOC_A_Layer_Family_B_Independent_Positive_Discovery_Visual_Review.md |
| #409 | 653cf2029ffc974bb5df1f3e5b9009fc654d81bf（squash） | 20261009_2315_Budget_Request_TOC_A_Layer_Family_C_Evaluator_Ambiguity_Failure_Isolation.md |

### 2.2 履歴の違い（事実）

- **#408**: 通常 merge。`9eff9e0`（freeze）→ `2a46dfc`（review 記録）→ `c6e7ea7`（P1/P2 定義の転記訂正）が main の ancestor として保存されている（`git merge-base --is-ancestor` で確認）。
- **#407**: squash merge のため、freeze commit `218cf34`・観察 commit `a393493` は **main の ancestor ではない**。両 commit は branch `research/budget-request-toc-header-tokenless-visual-failure-isolation`（local / origin）に保存。#408 doc §2 は「main の tree は a393493 と同一。branch 保存による代替をユーザーが明示的に受け入れた」と記録している。

### 2.3 参照した fixture

`budget-request-toc-{row-assembly, row-assembly-parser, row-assembly-evaluation, row-assembly-false-positive-failure-isolation, row-assembly-header-zone-right-row-h1, h1-formal-evaluation, full-corpus-status, human-review-failure-isolation, a2-right-band-evidence-failure-isolation, header-tokenless-failure-isolation, header-tokenless-visual-failure-isolation, header-tokenless-positive-discovery, evaluator-ambiguity-failure-isolation}`。値は jq / sha256sum の読み取りのみで確認し、再計算はしていない。

## 3. Research timeline

evidence 区分は各 doc の記述に従う。formal は **#396 と #402 のみ**。

| # | 段階 | PR | research question | outcome / status（原文） | 区分 | formal |
|---|---|---|---|---|---|---|
| 1 | initial failure isolation | #389, #390 | TOC の column 構造・折返し・continuation がどの failure 族を作るか（#389）／A層最小の column boundary・fragment ownership・circled number（#390） | #389 `SPLIT_REQUIRED`／#390 `READY_FOR_TOC_ROW_ASSEMBLY_PREREG` | development | 否 |
| 2 | row assembly preregistration | #391 | A層 row assembly の rule・評価 protocol の事前固定 | `PREREGISTERED_FROZEN` / `READY_FOR_TOC_ROW_ASSEMBLY_GT_FREEZE` | 評価なし（held-out は候補 membership のみ） | 否 |
| 3 | first held-out GT / parser / evaluation | #392, #393, #394, #395, #396 | 23 page の visual GT 凍結（#392）→ parser 実装（#393）→ 評価 contract 明確化（#394）→ amendment（#395）→ one-shot 評価（#396） | #392 `GT_FROZEN` / #393 `IMPLEMENTATION_FROZEN`, `READY_FOR_TOC_ROW_ASSEMBLY_FROZEN_EVALUATION` / #394 `STOP_PROTOCOL_AMENDMENT_REQUIRED` / #395 `EVALUATION_PROTOCOL_AMENDMENT_FROZEN` / **#396 `STOP_SAFETY`** | #392 held-out GT、#393 development 34 の descriptive のみ、#394・#395 評価なし、**#396 held-out（first-heldout23）** | **#396 のみ formal** |
| 4 | severe failure isolation | #397 | #396 の severe 10 件は単一機構か | `READY_FOR_FALSE_POSITIVE_HYPOTHESIS_FORMATION`（family 1 つ） | post-hoc | 否 |
| 5 | H1 preregistration | #398 | header zone 行の E 以右が row-start token で始まる場合のみ分割 | `H1_PREREGISTERED_FROZEN` / `READY_FOR_HEADER_ZONE_RIGHT_ROW_H1_DEVELOPMENT_IMPLEMENTATION` | freeze のみ | 否 |
| 6 | H1 development | #399 | H1 を development 34 page + synthetic 15 case で実装・検証 | `READY_FOR_H1_DEVELOPMENT_FREEZE_AND_NEW_HELDOUT_GT` | development（visual GT なし、機械 oracle のみ） | 否 |
| 7 | new held-out freeze / GT | #400, #401 | 新 held-out 25 page の membership（#400）と visual GT（#401）を凍結 | #400 `H1_IMPLEMENTATION_FROZEN` / `NEW_HELDOUT_MEMBERSHIP_FROZEN`, `READY_FOR_NEW_HELDOUT_VISUAL_GT_FREEZE` / #401 `NEW_HELDOUT_VISUAL_GT_FROZEN`, `READY_FOR_H1_ONE_SHOT_FROZEN_EVALUATION` | held-out の freeze（評価なし） | 否 |
| 8 | one-shot H1 evaluation | #402 | H1 を new-heldout25 に一回限り実行 | **`SAFETY_PASS_COVERAGE_REPORTED`** | **held-out（new-heldout25）** | **#402 のみ formal** |
| 9 | full-corpus assessment | #403 | 現行 A層（H1 込み）が 82 page で何を観測できるか | `POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT` / `READY_FOR_HUMAN_FAILURE_ISOLATION_REVIEW` | post-hoc | 否 |
| 10 | human failure isolation | #404 | human review 7 page（H1〜H7）と raw/parser/評価の対応付け | 各 H の mechanism status（`MECHANISTICALLY_EXPLAINED` 等）。H7 は post-review correction あり | post-hoc | 否 |
| 11 | Family A2 isolation | #405 | H5 型（right-only raw line の request token が evidence から除外）は corpus でどの程度か | census のみ。`SOURCE_DEVIATION_ACCEPTABLE_WITH_DISCLOSURE`（source-boundary 逸脱の事後判定） | post-hoc census | 否 |
| 12 | Family B isolation / visual discovery | #406, #407, #408 | header zone tokenless text の census（#406）→ 視覚切り分け 12 件（#407）→ independent positive discovery 20 件（#408） | #406 census のみ／#407 最終位置づけは選択せず（Outcome A/B/C の整理）／**#408 Outcome P0** | post-hoc / exploratory（GT ではない） | 否 |
| 13 | Family C evaluator isolation | #409 | duplicate marker identity による評価側 ambiguity の corpus-level census | census のみ（C0・C1 が支持、C2 は不支持、最終 outcome は選択せず） | post-hoc | 否 |

### 依存・amend・時刻の記録（doc に記録がある範囲）

- #395 は #394 の `STOP_PROTOCOL_AMENDMENT_REQUIRED` を受けた amendment。#391 原本は不変で、`gtProtocol.alignment` の前半のみを上書き（#395 doc）。
- #396 は #393（旧 parser）＋#395 amendment の評価。#397 は #396 の保存済み artifact のみを入力とし、#396 を再判定しない。
- #398 の doc ファイル名時刻（2023）は #397（2040）より前だが、内容は #397 の単一 family を前提とする（記録のみ。doc に矛盾の指摘なし）。
- #400 は #399 の H1 を固定し、#398 の「残り全件」を 25 = 82 − 34 − 23 で実体化。#402 は #401 の GT に依存。
- #404 は #403 の保存出力を前提にする（#404 doc は #403 未 merge 時点で #403 branch を土台にしたと記載）。#405・#406 は #403 の 82 page・partition を基準母集団にする。
- #408 は #407 の amend ではなく後続の独立 discovery（母集団から #407 の行を除外）。#409 は #392/#401（GT）、#396/#402（formal）、#403、#404 を入力に使うが変更しない。

## 4. Formal evidence

formal は #396 と #402 の 2 本。**population も parser も異なり、paired comparison ではない**。

| 項目 | #396 | #402 |
|---|---|---|
| population | first-heldout23（DIRECT 14 / INHERITED 9） | new-heldout25（DIRECT 22 / INHERITED 3） |
| parser | 旧 parser（#393） | H1（`assembleTocPageH1`） |
| finalJudgment（fx 原文） | `STOP_SAFETY` | `SAFETY_PASS_COVERAGE_REPORTED` |
| page state | SPLIT 9 / UNSPLIT 12 / PAGE_ABSTAINED 2（`RIGHT_EVIDENCE_INSUFFICIENT`） | SPLIT 6 / UNSPLIT 19 / PAGE_ABSTAINED 0 |
| GT comparable / parser comparable / matched | 802 / 717 / 717 | 560 / 560 / 560 |
| row: CORRECT / INCORRECT / ABSTAINED / UNRESOLVED | 717 / 10 / 75 / 0 | 560 / 0 / 0 / 0 |
| severe 合計 | **10（5 page）**。全て `FALSE_POSITIVE_ROW_ASSEMBLY`（reason=MERGE, unitKind=TITLE_OR_HEADING）。WRONG_COLUMN / WRONG_FRAGMENT / PROVENANCE は 0 | **0** |
| fragment | GT 17: correct 15 / unresolved 3（`AMBIGUOUS_OWNER_GROUP`） | GT 3: correct 3 |
| blocking unresolved | 3（2 page） | 0 |
| provenance 検査 | unit 837 / fragment 16 / 不一致 0 | unit 720 / fragment 3 / 不一致 0 |
| H1 trigger | — | 10 行 / 5 page（REQUEST 6 / MARKER 4 / OTHER_CODE 0）、negative-control 16 行 |
| protocol | formalExecutionCount=1、retry 0、compliant=true | 同左 |

- #396 の severe 5 page: maff 230901-2 p3、mhlw 05-3b-01 p3、mlit 001630995 p3、mofa 100546568 p3、npa ippankaikei p2。**negative formal result として保存**。parser 修正・再実行はしていない。
- #402 の trigger 5 page: maff 230901-4 p3、maff 230901-6 p3、mhlw 05-1b-01 p3、mhlw 05-2b-01 p3、mlit 001630393 p3。

### #402 の意味の境界（原典の表現）

- 意味は「この frozen 新 held-out 25 page で severe error は観測されず、positive trigger が存在した」のみ。**production GO・B層 GO・parser の正しさの証明ではない**。
- 禁止される読み: 「#396 の 10 → 0」という単純比較（doc は paired comparison ではないと明記。trigger 行数がどちらも 10 であることにも意味づけしない）。
- 限定: `UNRESOLVED_ACCEPTANCE_THRESHOLD`（coverage 1.0 は報告のみ）／same-agent GT／25 page は小さく汎化を主張しない／#396 と同じ publisher の別 page を含み得る（#400・#401・#402 の記述）／**UNSPLIT 19 page は GT 右 blank の page-level NOT_COMPARABLE で、H1 が作用する positive trigger は 5 page に限られる**。

### 照合結果

上記の全数値を `evaluation-result.json` / `formal-evaluation-result.json` / 各 task doc と照合し一致を確認した（食い違い 0）。fixture sha256: #396 result `fcb1e40c…5d66`、#396 parser output `d95abb76…b6f6b`、#402 result `7b024a25…2283`、#402 H1 output `64f344ff…f366`（各 doc 記載と一致）。

## 5. Full corpus state（#403 post-hoc。formal ではない）

82 page = development 34 / first-heldout 23 / new-heldout 25（overlap 0）。first/new の値は `POSTHOC_REEXECUTION` で、#396・#402 の formal 結果とは別物（H1 を first23 にも適用した再実行）。値は `full-corpus-status.json` から jq で再確認。

| 項目 | 値 |
|---|---|
| page state | SPLIT 35 / UNSPLIT 44 / PAGE_ABSTAINED 3（全て `RIGHT_EVIDENCE_INSUFFICIENT`） |
| partition 別 SPLIT / UNSPLIT / ABSTAINED | dev 20 / 13 / 1、first 9 / 12 / 2、new 6 / 19 / 0 |
| right band | resolved 35 / unresolved 47（`unresolvedOrNoEvidence`） |
| H1 trigger | 39 行 / 20 page（REQUEST 25 / MARKER 14）。negative-control 91 行 |
| trigger 行 partition 別 | 19 / 10 / 10 |
| GT のある 48 page（first23 + new25）の descriptive 集計 | comparable 1362 / matched 1287、C/I/A/U = 1287 / 0 / 75 / 0、severe 0。ラベル `DESCRIPTIVE_AGGREGATE_ONLY_NOT_A_FORMAL_HELDOUT_RESULT` |
| development 34 page | GT なし（`GT_UNAVAILABLE`）。correct とは判定していない |
| human-review queue | 40 page（dev 22 / first 12 / new 6） |

- **「E 未定義 47」と「right band unresolved 47」の関係**（原典どおり）: #403 は UNSPLIT 44 + ABSTAINED 3 = 47 を right band の unresolved or no evidence とし、#406 は同じ 47 page を `E_UNDEFINED` と呼ぶ（#406 doc 「E 未確定（UNSPLIT 44 + ABSTAINED 3 = 47 page）」）。同一集合の別名。
- #403 は単一の「抽出率」にせず、観測可能性を A〜E に分割する。これは Family A1/A2/B/C/D とは別体系（#403 doc に A1/A2/B/C/D のラベルはない）。

## 6. Family 別状態

**ラベルの由来**: #404 は failure family を **F1〜F6** で記述し、A1/A2 の語を使わない（`grep` で 0 件）。A1/A2 の機械ラベル（`A1_LIKE_SPARSE` / `A2_LIKE_REJECTED_RIGHT_ONLY`）は #405 が付与した。F3 が Family B（#406 の対象）、F4 が Family C（#409 の対象）に対応するのは #405/#406/#409 の参照関係による。

| #404 の F | 内容 | anchor | mechanism status | 本書での対応 |
|---|---|---|---|---|
| F1 | 右 column の request-kind evidence が 1 件 → page abstain | H4, H6 | `MECHANISTICALLY_EXPLAINED` | A1 |
| F2 | right-only raw line の request token が evidence に数えられない | H5 | `MECHANISTICALLY_EXPLAINED` | A2 |
| F3 | header zone の tokenless continuation が whole-line TITLE に入る | H2 (req18), H7 (req23) | `MECHANISTICALLY_EXPLAINED`（#398 の既知の二次限界と同型） | B |
| F4 | duplicate marker key による評価側の判定不能 | H3 | `MECHANISTICALLY_EXPLAINED` | C |
| F5 | human と raw の食い違い | H7 | `RESOLVED`（§11 の訂正） | — |
| F6 | 目視と整合する正常観測 | H1, H3 の UNSPLIT | `OBSERVED` | — |

H7 は初回記録（req23 のみ）が撤回され、「少なくとも 2 件（req18 の 2 行目、req23）」に訂正された。原因は初回 human review の見落としで、PDF 側の ambiguity や raw representation loss ではない（#404 doc §11）。

### 6.1 Family A1（H4 / H6）

- **mechanism**: 右 column に request row が 1 件しかなく、accepted evidence 1 < `bandMinEvidence`(2) のため `PAGE_ABSTAINED`（`RIGHT_EVIDENCE_INSUFFICIENT`）。#404 は H4・H6 を min evidence=2 で説明できるとする。
- **現行の挙動**: 3 page が PAGE_ABSTAINED（H4 mhlw 05-2b-01 p4、H5、H6 mod gaisanyoukyu p4）。A1 の 2 page は H4・H6。
- **safety への影響**: abstain は #391 の定義で「failure ではなく安全な出力状態」。row を誤って出力する経路ではない。
- **anchor / evidence**: #404 H4（accepted 1、6:51）・H6（accepted 1、4:57）。#405 census で `A1_LIKE_SPARSE` 2 page（いずれも first-heldout post-hoc、accepted 1・right-only 候補 0）。#396 の PAGE_ABSTAINED 2 page も `RIGHT_EVIDENCE_INSUFFICIENT`。
- **用語境界（#405 §4.1）**: `A1_LIKE_SPARSE` は「PAGE_ABSTAINED ∧ accepted < 2 ∧ A2 pattern で説明されない」の analysis-only 機械分類で、visual sparsity を判定していない。accepted=0 の UNSPLIT 44 page は visual evidence がなく A1 と同一と判定できないため `NO_A2_PATTERN` に分類。
- **unresolved**: 原典に「A1 を low priority とする」明示判断はない。記録は #404（mechanism 説明済み）・#405（census 2 page）まで。優先度の記述は §9 の本書提案のみ。
- **current state**: mechanism は説明済み・abstain で安全側に倒れているが、**solved とは書かない**（検出漏れの page は abstain のまま残る）。

### 6.2 Family A2（H5）

- **mechanism**: right-only raw line 上の request token（先頭 token でなく、直前に `\d{1,4}\s+` を伴わない形）が evidence 述語から除外される。H5（mlit 001630995 p6）は右列 request 約 30 件があるが accepted は 1 件のみで PAGE_ABSTAINED（#404 H5, #405）。
- **#405 census（82 page）**: `A2_LIKE_REJECTED_RIGHT_ONLY` **1**（H5 のみ）／`A2_PATTERN_BUT_CURRENTLY_RESOLVED` **16**（dev 12 / first 3 / new 1。全て `ASSEMBLED_SPLIT`、accepted 最小 3・最大 21）／`A1_LIKE_SPARSE` **2**／`NO_A2_PATTERN` **63**／`MIXED_OR_UNRESOLVED` 0。request token 1,612 = accepted 451 + rejected 1,161（line-start 1,017 / right-only 142 / nonFirstNotPreceded 2）。right-only 候補を持つ page 18。
- **事実（#405 §9）**: H5 と同じ組（right-only 先頭 token が rejected かつ accepted < 2）は 82 page 中 H5 の 1 page のみ。一方、right-only 先頭 token 自体は 18 page・142 件で、うち 16 page は accepted ≥ 2 で現行 SPLIT。
- **#405 の unresolved**: right-only candidate が実際に right column か・request row か／evidence に加えるべきか／16 control page の意味／accepted=0 の UNSPLIT 44 page に right-only 構造が無いことの意味。
- **source-boundary deviation の開示（#405 §13.1）**: HelloOrcaWorld に raw-text artifact が無く、旧 workspace の既存 artifact を read-only 参照。元の実行契約では STOP/escalation 対象だったが Coordinator は STOP せず採用。事後 Contract Compliance Review（raw-text artifact SHA-256 55/55・page-text 82/82 一致、PDF 再抽出なし、artifact mutation なし、census 再現 hash 一致）の判定は **`SOURCE_DEVIATION_ACCEPTABLE_WITH_DISCLOSURE`**。#405 は「契約逸脱そのものを遡及的に正当化・消去するものではない」と明記。
- **分類語義の開示（#405 §4.1）**: 実行契約の文面を literal に読むと `A1_LIKE_SPARSE`=46 / `NO_A2_PATTERN`=19 とも読めたが、実装・doc は 2 / 63 を採用し、差を doc が開示している。基礎観測値は不変。
- **hypothesis を freeze しなかった理由・blast-radius の懸念**: **原典に記述なし（UNRESOLVED）**。#405 は census のみで「新 hypothesis・preregistration・parser 変更はない」とだけ述べる。原典が示す事実は、同パターンの right-only 先頭 token が 16 の現行 SPLIT page にも存在すること（上記）まで。
- **「defer」判断**: A2 を defer するという判断の経緯は repo 文書にない（ChatGPT／ユーザー側の判断として扱い、repo 記録とは混ぜない）。
- **current state**: mechanism 説明済み・census 済み。**fixed ではない**（H5 は PAGE_ABSTAINED のまま）。

### 6.3 Family B（H2 / H7、header zone tokenless continuation）

- **mechanism**: header zone の行は構造上 classify / attach に到達しない（#406 doc: `attach` は `i >= headerEnd` の body 行のみ）。H1 は token で始まる右 segment のみ分割するため、token なしの右 column continuation は whole-line TITLE_OR_HEADING に吸収される（#398/#399 で `KNOWN_SECONDARY_LIMITATION_NOT_TARGETED`）。
- **安全性**: continuation が fragment として attach されず欠落する（現行 H1 の post-hoc 再実行で H2 の GT fragment incorrect 1＝req18 の `OMITTED_SILENTLY_FRAGMENT`。#403・#404）。誤った row を作る経路ではないが、omission の件数・影響は corpus では未測定。
- **anchor**: H2（maff 230901-2 p3、header line 10）、H7（mof 2024ippan_2 p2、header line 8。訂正後観測）。
- **#406 census**: SPLIT 35 / UNSPLIT 44 / ABSTAINED 3、E 確定 35 / E_UNDEFINED 47、header zone 463 行（E 確定 185 / E_UNDEFINED 278）。候補 **91 行 / 35 page**（全て SPLIT page）。既存 flag（`KNOWN_FLAG_MATCH`）を満たすのは 2 page・2 行（H2/H7）、`WITHOUT_TRIGGER_CONTEXT` 89 行 / 35 page。**機械条件では continuation と見出しを区別できない**（candidate は raw line の機械ラベルで、89 行が何であるかは未判定）。E_UNDEFINED 47 page の同種行は未計上。
- **#407（frozen sample visual）**: sample 12 = anchor 2 + control 10。visualRole: CONTINUATION 2（anchor のみ）/ COLUMN_HEADING 5 / OTHER 4（ページ番号様の単独数字）/ HEADER_OR_TITLE 1。AMBIGUOUS・UNREADABLE 0、confidence high 11 / medium 1（FB-11）。最終的な位置づけは選択せず（Outcome A/B/C を整理）。prevalence は推定できない（positive は既知 2 件のみ、controls は無作為でない）。manifest sha256 `d4afe815…ab01a`。
- **#408（independent positive discovery）**: eligible **79 行 / 33 page**（91 − H2 − H7 − #407 controls 10）、sample 20（diversity sampling、無作為でない）。COLUMN_HEADING 12 / HEADER_OR_TITLE 4 / OTHER 4、**CONTINUATION 0**、**Outcome P0**。manifest sha256 `18c745a1…60018`。#407 の positive 4 特徴を全て持つ新 sample は 0。
  - **P1/P2 の転記ミスと訂正**: 初版は P1/P2 の説明を実行契約と逆に記載（commit `c6e7ea7` で訂正）。実行契約は正しく、結果は P0 で P1/P2 は選択されていない。research decision・result への影響はない（#408 doc §10）。
  - P0 の含意（指示書の定義、#408 doc §10）: 「positive evidence remains H2/H7 only。Family B automation hypothesis は弱い。defer 候補。」
- **unresolved**: 79 行のうち 20 行をレビュー、**残り 59 行は未レビュー**。「0 件だから positive は存在しない」とは言えない。レビュー済み page（#407 の 12 + #408 の 20）は held-out 資格を失う。
- **state の由来（区別）**:
  - repo 原典: #408 doc §10 の「defer 候補」まで。
  - `FAMILY_B_DEFER_AFTER_P0_POSITIVE_DISCOVERY` という文字列は **`docs/` `scripts/` `tests/` のいずれにも存在しない**（grep 0 件）。ChatGPT／ユーザー側で固定された研究判断であり、本書は**この status 文書上の統合された state として記録する**（既存 task doc の結果は書き換えない）。

### 6.4 Family C（H3、duplicate marker identity による evaluator ambiguity）

- **mechanism**: #395 の identity は MARKER を (file, page, marker, code) とし、同一 page・同一 key の GT 件数 n と parser 件数 m を group で比較する。fragment の owner group が 1:1 でないとき `AMBIGUOUS_OWNER_GROUP`（UNRESOLVED）になる。H3（meti ippan_o p4）では marker `(項) 030` が duplicate で、1 fragment が owner 不定になった（accounting 上は GT 側・parser 側の 2 instance）。
- **#409 census（post-hoc。GT 48 page は post-hoc、dev34 は GT なし）**: 全 82 page で REQUEST units 1,519（unique 1,519、**衝突 0**）／MARKER units 1,106（unique 980）、duplicate key **82 件（全て MARKER、17 page）**、内訳は（項）81・（組織）1。GT 付き 48 page で 39 件（8 page）は全て BOTH（n=m≥2）。分類: `DUPLICATE_ONLY_NO_EVAL_EFFECT` **38**／`FRAGMENT_OWNER_AMBIGUITY` **1**（H3）／`NOT_EVALUABLE_NO_GT` **43**（dev34・9 page の parser-only。parser 側 fragment 関係 0/43）／ROW_MATCHING_AMBIGUITY・MULTIPLE_EFFECTS・UNRESOLVED_MECHANISM 0。
- **duplicate の存在と actual ambiguity の区別**: 82 件の duplicate のうち actual に評価不能になったのは H3 の fragment owner 1 件のみ。row matching・provenance・column/order で判定不能になった collision は 0。latent limitation（actual effect ではない）として、DUPLICATE_ONLY 38 件全てで order inversion 未評価・同一 key 内 merge 検出不能。
- **旧 parser（#396）**: 記録値は non-1:1 group 26 / 7 page、n=m 16、n1m0 merge 9、`AMBIGUOUS_OWNER_GROUP` 3 instance（ippan_o p4 の 2 件 + 230901-2 p3 の R|18）。230901-2 p3 は duplicate key でなく **merge（n=1, m=0）** による別機構で、現行 H1 では 1:1 に戻り first23 post-hoc には現れない。
- **方式と限界**: 完全再実行ではない（provenance 判定は RawPageLines を要するため）。evaluator を import し `evaluatePage` を **dummy raw（空 line）** で呼び、raw 非依存の groups / fragments / instances だけを使用。provenance 系結果は破棄＝**provenance は未評価**。#396 の旧 parser 出力は commit されておらず再計算せず記録値を引用。
- **#409 の outcome 整理**（最終選択はしない）: C0（H3 のみ／極少数）= 支持／C1（複数あるが大半は評価に影響しない）= 支持／C2（複数 page で actual ambiguity）= 現行 H1 では不支持／C3（parser output 自体の誤り）= census は D を判定しないため支持も否定もしない。INTERPRETATION は「evaluator-local に見える」まで。
- **unresolved**: dev34 の parser-only duplicate 43 件の評価影響／parser 側の誤り（D）の有無／S1-B 記録値との accounting 照合（未実施）。
- **state の由来（区別）**: `FAMILY_C_DEFER_EVALUATOR_NON_1_TO_1_OWNER_GROUP` は **本書上の proposed consolidated state** であり、確定した研究判断ではなく提案。repo 原典（#409 doc）は最終 outcome を選択していない。

## 7. D / safe-explained area（H1 等）

`perfect` や `proved safe` とは書かない。**観測された／凍結された evidence の範囲**のみを記述する。

- #402（formal）: new-heldout25 で severe 0、blocking unresolved 0、positive trigger 10 行 / 5 page が存在（条件: `SAFETY_PASS_COVERAGE_REPORTED`＝protocol 遵守かつ severe 0 かつ blocking unresolved 0）。
- #399（development）: 34 page の trigger 19 行 / 10 page で false split 0・provenance mismatch 0・page state 変化 0（機械 oracle のみ、visual GT なし）。
- #403（post-hoc, descriptive only）: GT のある 48 page の再実行で severe 0（formal ではない）。H1 trigger は全 82 page で 39 行 / 20 page、分割 39 で 1:1。
- 境界: 観測範囲外（UNSPLIT 44・PAGE_ABSTAINED 3 の page、development 34 の visual 正誤）への外挿はできない。safe-explained であることは「その範囲で観測された」以上を意味しない。

## 8. Known limitations

| 項目 | 内容 | 出典 |
|---|---|---|
| UNSPLIT 44 page | 右 column の evidence が無く行全体を保持（`NO_RIGHT_COLUMN_EVIDENCE`）。視覚上の右 column 有無は GT のある page のみ確認。右 evidence なし page の false-empty は #390 で視覚確認 6 page のみ | #403, #390 |
| PAGE_ABSTAINED 3 page | H4/H5/H6、全て `RIGHT_EVIDENCE_INSUFFICIENT`。abstain は安全な出力状態（#391） | #403, #404 |
| E 未定義 47 page | UNSPLIT 44 + ABSTAINED 3。header zone 278 行の同種行は未計上 | #403, #406 |
| right-band evidence の限界 | `bandMinEvidence=2`・`T=2` は未検証の preregistered choice（minEvidence は数値根拠なし）。evidence 述語は right-only 先頭 token を除外 | #391 §10, #405 |
| header-zone tokenless continuation（H2/H7） | H1 の対象外（`KNOWN_SECONDARY_LIMITATION_NOT_TARGETED`）。omission の corpus 規模は未測定 | #398, #404, #406 |
| Family B の未レビュー candidate | 91 行 − anchor 2 − control 10 = 79 行のうち 20 行をレビュー、**残り 59 行**は未レビュー。レビュー済み page は held-out 資格を失う | #407, #408 |
| evaluator の non-1:1 owner group | duplicate marker 等で fragment owner が UNRESOLVED になる。dev34 の 43 件は評価不能。provenance は #409 で未評価 | #395, #409 |
| development page に visual GT が無い | development 34 page は `GT_UNAVAILABLE` | #403 |
| same-agent GT | GT・parser・amendment が同一 agent。記憶としての GT 知識を排除できない。独立検証ではない | #391 §8, #392, #393, #402 |
| held-out の標本サイズ | first 23 / new 25 は小さく汎化を主張しない | #391 §8, #402 |
| publisher overlap | new-heldout25 は #396 の held-out と同じ publisher の別 page を含み得る（#400・#401・#402）。#396 自身には明示記述なし | #400〜#402 |
| acceptance threshold 未決 | coverage 下限・abstention 上限・分類許容は `UNRESOLVED_ACCEPTANCE_THRESHOLD` のまま。coverage 1.0 は報告のみ | #391, #402, #403 |
| A層は B層の semantics ではない | 階層 carry・INHERITED state 解決は未着手（#389 `SPLIT_REQUIRED`）。#402・#403 は「B層 GO ではない」と明記 | #389, #391 §2, #402, #403 |
| circled request number | raw で plain digit になり丸囲みの表現は失われる。復元・推測は A層の範囲外（`ROW_ASSEMBLY_NON_BLOCKING_FIDELITY_LOSS`） | #390, #392, #401 |
| PLAIN_ROW・評価手法 | PLAIN_ROW は NOT_COMPARABLE。PLAIN_ROW どうしの統合・分割は検出不能。duplicate group で個別行を特定できない。`WRONG_ROW_START_CLASSIFICATION` は独立計測不能 | #394, #395 |
| NOT_COVERED | 左右同時 wrapped fragment／marker-only 右 column／OTHER_CODE／tolerance 超の複数 cluster は held-out で未カバー | #391, #392 |
| PUA 文字 | `PUA_TEXT_FIDELITY_BLOCKING`（structure は non-blocking）。A層の範囲外 | #389 |
| production readiness | 確立していない。各 doc が GO ではないと明記 | #393, #395, #402, #403 |
| #403〜#406 の記述範囲 | same-agent GT・publisher overlap・circled number はこの 4 doc に記述なし（原典に記述なし、UNRESOLVED。上の各項は他 doc が出典） | — |

## 9. Research evidence matrix

proposed priority は**本書の記述的提案であり研究判断ではない**。HIGH を付けた行は無い（原典に production 要件の記述が無いため）。

| issue | family | observed | reproduced | formal held-out evidence | post-hoc only | safety impact | current mitigation | unresolved | proposed priority（本書提案） | reopen trigger |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | F1 | 是（H4, H6） | #405 census で 2 page 再現 | #396 に PAGE_ABSTAINED 2（`RIGHT_EVIDENCE_INSUFFICIENT`）。原因の対応付けは post-hoc | 原因説明は post-hoc | 低（abstain＝安全な出力状態。右 row は出力されない） | `bandMinEvidence=2` による page abstain | abstain page の下流 coverage への影響 | LOW（根拠: #404 で mechanism 説明済み、#391 が abstain を failure としない） | §10 |
| A2 | F2 | 是（H5 のみ） | #405 で H5 の 1/82 のみ | なし | 是 | 低〜中（H5 は abstain。除外述語の変更時の影響は原典に記述なし） | 現行 evidence 述語（変更なし） | right-only 候補の実体／16 control page の意味／44 page の意味 | MEDIUM（根拠: 述語除外が 18 page・142 件に及ぶが、現行 SPLIT page 16 は影響なし。HIGH にする原典根拠なし） | §10 |
| B | F3 | 是（H2, H7） | #406 で 2 page・2 行が flag 条件を満たす | なし（現行 H1 の first23 post-hoc 再実行で fragment incorrect 1＝H2 req18。#403・#404） | 是 | 中（continuation が omission になる。規模未測定） | H1 は token あり行のみ分割。既存 flag は 2 page | 未レビュー 59 行／E_UNDEFINED 47 page | DEFER（根拠: #408 P0、positive は H2/H7 のみ） | §10 |
| C | F4 | 是（H3） | #409 で H3 再現（`reproducesObservations404=true`） | #396 の fragment unresolved 3 は formal 内の accounting。現行 H1 の再計算は post-hoc | 是 | 低（actual 影響は評価側の 1 fragment のみ。parser 出力の誤りは未判定） | evaluator 規則（UNRESOLVED は pass をブロック） | dev34 の 43 件／D の有無／S1-B 照合 | DEFER（根拠: #409 の C0・C1 が支持、C2 は不支持） | §10 |
| D（H1 等 safe-explained） | — | 是 | #403 で #402 の出力と完全一致（new25） | #402（severe 0）。#396 は旧 parser で STOP_SAFETY | #403 の 48 page 再集計は descriptive | 観測範囲で severe 0 | frozen H1 | 閾値未決／標本小／same-agent GT | 該当なし（維持。追加研究の対象ではなく limitation の記載対象） | 新しい held-out での severe 発生 |

## 10. Reopen triggers

原典が明示する再開条件と、本書の提案を区別する。

**原典が明示するもの**

- STOP_SAFETY（severe ≥ 1）は rule・tolerance を調整して再評価しない。別研究単位で再仮説化（#391 §9）。
- 変更が必要な場合は原本を残し、STOP/protocol deviation として記録し別研究単位で再 preregister（#391 §1）。
- GT 誤りは silent fix せず別 correction protocol（#392, #401）。
- positive-trigger page が 0 なら `H1_UNVALIDATED`（#398）。
- H1 の production 取込み・B層・他 FY 適用は別 unit の判断（#402）。
- 各 census の「next research question」（いずれも仮説ではない）: #405 §11（H5 以外の A2 候補が 1/82 のとき除外条件を corpus-level の要因として扱う価値があるか）、#406 §13、#408 §15（未レビュー 59 行に H2/H7 以外の continuation があるか）、#409 §12（fragment を持つ duplicate marker の共起頻度）。
- 「reopen trigger」という語を持つ記述は #403〜#409 に見当たらない。

**この統合文書での提案（原典に記載なし）**

| issue | 再開条件の方向性（研究再開の条件。実装案ではない） |
|---|---|
| Family B | 新しい独立した continuation positive が現れる／production corpus で silent omission が増える／新しい document family で同 mechanism が再発 |
| Family C | parser 変更後に non-1:1 owner group が増える／actual evaluator ambiguity が複数 page へ拡大／formal evaluation の pass/fail 判断を阻害する |
| A2 | A2-like unresolved page が増える／right-only evidence rejection が actual omission を複数発生させる／別研究から安全な discriminator が得られる |
| A1 | 本書の提案なし（LOW の維持）。PAGE_ABSTAINED page が増えた場合に再検討 |

## 11. Next-stage readiness

比較のみ。**どれを選ぶべきかは書かない**。

- R1: A2 を active target として続行
- R2: A層を limitations 付きで research freeze して次の層へ進む
- R3: A層の production acceptance criteria を先に設計する

| 観点 | R1 | R2 | R3 |
|---|---|---|---|
| expected information gain | #405 の未解決（right-only 候補の実体、16 control page の意味）に答えられる。ただし A2 型は census 上 82 page 中 1 page | 次層の研究が始まる。A層の未解決は limitation として残る | `UNRESOLVED_ACCEPTANCE_THRESHOLD` を解消する基準が得られる |
| research cost | 新 hypothesis・preregistration・新 GT／held-out が要る（既存 held-out 48 page は post-hoc で使用済み） | 低（本書の limitation を維持するのみ） | 中（閾値の根拠データの定義が要る。原典に根拠データの記述なし） |
| safety relevance | A2 は abstain 側の事象（H5）。現行 SPLIT 16 page への影響は原典に記述なし | 現行 safety evidence（#402）の範囲に留まる | 評価の pass/fail 判断を可能にする |
| prerequisite | A2 の discriminator の候補（原典に記述なし）と未使用 held-out | limitation 一覧の合意（§8） | 閾値の根拠データ。同一 agent GT の扱い |
| risk of overfitting / protocol churn | 高め: 18 page・142 件の観測を見た後の仮説で、使える held-out が残り少ない | 低 | 中: 既存結果を見て閾値を置く後付けの危険（#393 は後付け禁止） |

## 12. Claim boundary

- production claim なし。A層の正しさの証明ではない。
- post-hoc evidence（#397, #403〜#409）は formal ではない。formal は #396（`STOP_SAFETY`）と #402（`SAFETY_PASS_COVERAGE_REPORTED`）のみ。
- #402 は production GO・B層 GO・parser correctness の証明ではない。#396 との単純比較（「10→0」）はしない。
- Family B・C・A2 の defer／state のうち、repo 原典に無いものは ChatGPT／ユーザー側判断（B・A2）または本書の提案（C）であり、研究結果ではない。
- 本書は新しい仮説・preregistration・GT・parser／evaluator 変更・formal evaluation・再集計を含まない。

## 13. Unresolved

原典が説明していない点（本書は解釈しない）。

1. #391: risk strata の take 合計 6+4+2+3+2+2+3+3 = 25 と membership 23 page の関係（stratum 間の重複の有無が doc に明記なし）。
2. #396: fragment の provenance 検査 16 件と fragment GT 17 件の差の理由（doc・fx とも同値で説明なし）。
3. #396: row ABSTAINED 75 と abstention reason（`RIGHT_EVIDENCE_INSUFFICIENT` page 2）の行数対応が doc に記述なし。
4. #398: doc ファイル名時刻（2023）が #397（2040）より前。内容は #397 を前提とする（記録のみ）。
5. #409: 引用元の「17 duplicate n=m group」と記録上の n=m 16 の差（doc §8 が自身で n2m1 の 1 件を含む旨を指摘済み。出典側の表記差）。
6. #390 の H-A1/H-A2/H-A3 と後続 Family A1/A2 の対応: #390 doc に記述なし。#389〜#395 に A1/A2/B/C/D の語は出ない。
7. #397: fixture 本体（observations / failure-families）の sha256 を #397 doc 自体は記載しない（#400 の manifest に記録）。
8. #396 と #402 の research question は doc に明示文がない（protocolClaim のみ）。#399 も同様。
9. #409: S1-B との accounting 照合は未実施（doc 自身が未照合と記載）。tsc・lint・既存 test の結果は doc に数値なし（「PR 本文に記載」とのみ）。
10. #407: render 条件（dpi 等）の記録なし。
11. A2 を defer する判断の経緯、Family B state 文字列の出所、A2 の blast-radius 懸念: repo 原典に記述なし。
12. A1 を low priority とする明示判断: 原典に記述なし（§6.1）。
13. same-agent GT・publisher overlap・circled number: #403〜#406 に記述なし。

**`UNRESOLVED_CONFLICT`（原典同士・原典と fixture の食い違い）は検出されなかった。** 上記は「説明が無い点」であり矛盾ではない。
