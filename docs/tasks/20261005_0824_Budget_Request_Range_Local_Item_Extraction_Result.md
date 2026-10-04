# 概算要求PDF range-local 座標ベース「項」抽出 — 結果

事前登録: `20261005_0820_Budget_Request_Range_Local_Item_Extraction_Preregistration.md`（Commit A `776f2dc`、doc SHA-256 `fc3c82e6…c7a`）。実装 freeze は Commit B `f8e5cb5`（detector `7e5ed20f…4d14`・評価 script `d43ab510…5d06`、control のみ実行）、frozen evaluation は Commit C `7592b58`。判定規則・threshold・detector は結果を見た後に変更していない。production code は無変更（`scripts/pipeline-v2/lib` は新規ファイルの追加のみ）。

**判定: `RANGE_LOCAL_COORDINATE_ITEM_EXTRACTION_SUPPORTED`（規則 3）。** ただし下記のとおり、評価できる population は前回 detector より狭まっている。candidate は正式な項 GT ではなく、MOF 784 項は PDF 側の正解母数ではない。

## 仮説と唯一の変更

仮説: 明細表の contiguous range ごとに request 行の x を基準化すれば、3 桁 code 行の相対座標から項を抽出できる。変更は PDF-global request x → range-local request x のみ（候補条件 3 桁 plain・refX−6.9pt・±1.0pt・名称の扱い・key・duplicate は前回のまま）。detail range = layout range の signature の header 成分が設定されているもの（前 phase の range を変更していない）。range の request 行が 5 件未満 → `range_request_x_unavailable`、request x が 0.5pt を超えて割れる → `range_multimodal`（いずれも候補 0・fail-closed。隣接 range で補完しない）。

## Control（hierarchy 契約 8 PDF の hierarchy 区間。独立検証ではない）

| metric | value |
|---|---:|
| existing item | 97 |
| recovered | 97 |
| missed | 0 |
| candidate total | 158 |
| known organization | 7（4.4%） |
| ON unclassified | 54 |
| unjoinable / duplicate | 0 / 0 |

known organization 7 件はすべて cfa（既存 item 0。organization の x が項の位置に来る layout）。97/97 は前回 offset の較正に使った population での再現であり、独立な検証ではない。

## Full-corpus coverage

| range status | ranges | pages | PDFs（該当 range を持つ） |
|---|---:|---:|---:|
| evaluable_detail_range | 32 | 7,561 | 32 |
| range_request_x_unavailable | 38 | 600 | 35 |
| range_multimodal | 0 | 0 | 0 |
| outside_detail_range（見出しなしの前置き表） | 113 | 235 | 54 |

PDF 単位: evaluable detail range を持つ 32 PDF（7,840 page）、detail range はあるが全て request 行 5 件未満の 35 PDF（701 page）、detail range なし 6 PDF（45 page）、insufficient_layout_evidence 1 PDF（77 page）、unavailable_rotate90 8 PDF（1,236 page）。fail-closed 検査: evaluable でない range の候補は 0 件。

## Candidate counts

| account | candidate rows | name resolved | name unavailable | within-doc unique | duplicates | PDFs | ranges |
|---|---:|---:|---:|---:|---:|---:|---:|
| general | 634 | 627 | 7 | 620 | 7 | 13 | 13 |
| special | 300 | 300 | 0 | 287 | 13 | 19 | 19 |
| total | 934 | 927 | 7 | 907 | 20 | 32 | 32 |

契約なし PDF は 24 PDF・623 行、契約あり 8 PDF は 311 行（control 区間は 158 行）。

## 前回（PDF-global）detector との paired 比較

| | 前回 | range-local |
|---|---:|---:|
| evaluable PDF | 51 | 32（evaluable range 32） |
| candidate rows | 929 | 934 |
| 一般会計 candidate rows | 641 | 634 |
| name-resolved | 855 | 927 |
| candidate 0 の evaluable PDF | 27 | 0 |

行単位: both 862、new only 72（すべて前回も評価可能だった PDF 内）、old only 67、old_not_evaluable の PDF での new only 0。old only 67 は全て新 detector で見出しなし（preface）の range に属する行（復興庁 42、内閣府 11、農水省 `230901-4.pdf` 8 など。前回は PDF-global の基準で前置き表の行も候補にしていた）。

## 既知の weak population

- x≈55.22 の 26 PDF: 前回は候補を持つ PDF が 0。今回は 11 PDF・64 行で候補が出る（paired の差）。残り 15 PDF は detail range の request 行が 5 件未満（14）、または全 range が前置き（1）で、fail-closed のまま。
- 前回基準なしの 23 PDF: 今回も evaluable は 0（17 PDF は detail range の request 行 5 件未満のみ、他は前置きのみ・range 無し）。range-local 化では解消せず、request 行が少ない小さな文書という性質は変わらない。
- `001630395.pdf`: 前回 0 件 → 今回 8 件（detail range 7-10、refX 79.37、request 行 12）。前置きの page 3・5 は前置き表として対象外。

## MOF exact-only diagnostic（名称単独。precision / recall ではない）

一般会計の候補 634 行のうち名称あり 627。

| status | count |
|---|---:|
| exact_unique | 543 |
| exact_ambiguous | 63 |
| no_exact_match | 21 |
| name_unavailable | 7 |

exact overlap（unique + ambiguous）/ 名称あり = 606 / 627 = 96.7%。別表（混同しない）: 正式な reconciliation は hierarchy・組織付きの一般会計 item で 77 / 79 = 97.5%。前回の PDF-global detector の名称単独診断は 534 / 63 / 21（名称あり 618）。

## Known contamination / unresolved

- organization: control で候補の 4.4%（7/158、cfa のみ）。full-corpus では組織情報がなく計数できない（座標だけでは organization と項を分離できない layout が cfa に存在する）。
- unclassified: control の候補のうち 54（ON が unclassified とした行。誤検出とは断定しない。mod 28・env 18・cfa 6 など）。
- 名称なし 7（一般会計）。ambiguous geometry（multimodal range）は 0。
- source inspection（post-hoc）は実施していない。

## 判定の根拠（事前登録の規則）

det（再生成が決定的で frozen hash 一致）真、control の unjoinable/duplicate 0、evaluable range 32、wk（001630395 が 0→8、55.22 群の候補ありが 0→11 PDF）真、rec=97/97、ov=0.967≥0.90、con=0.044≤0.05、fc 真 → 規則 3。

## Fact / observation / interpretation

- Fact: range-local 化で `001630395.pdf` と x≈55.22 群の一部の失敗は機械的に解消し、control の既存 item は 97/97、MOF 名称単独 overlap は 96.7%。
- Observation: 候補総数はほぼ不変（934 vs 929）で、増えたのは名称ありの割合（855→927）。一方、評価可能な PDF は 51→32 に減った。detail range の request 行を 5 件以上とする条件のため、request 行が少ない 35 PDF の detail range は fail-closed になる（前回は PDF 全体の前置き表の request 行で基準を作っていた）。weak B の 23 PDF は評価できないまま。old only の 67 行は見出しのない前置き表の行で、新 detector の mapping では対象外。
- Interpretation: range-local の座標基準は、基準が取れる範囲では決定的で既存 item control・MOF 名称と整合する。ただし評価できる population が狭く、request 行が少ない文書には使えない。organization と項の分離は cfa のような layout で座標だけでは不十分。

主張の上限: frozen detail-range と range-local geometry を用いることで、hierarchy に依存せず item-shaped row を決定的に抽出でき、その population が既存 item control および MOF exact-name diagnostic と整合する。candidate=正しい項、MOF 784=母数、exact overlap=precision、不一致=抽出誤り、事項の親子付け、production ready は主張しない。

## Next step（開始しない）

(1) request 行が少ない 35 PDF の detail range（5 件未満条件）の扱いの設計（基準 x をどの evidence から安全に得るか）。(2) organization と項を分離する semantic boundary evidence の追加調査（cfa 型 layout）。(3) 事項の親子付けを含む range-local hierarchy の事前登録。production の `recordKind=item` 変更は行わない。

## 検証

tsc エラー 0・lint エラー 0・vitest 124 files / 1,458 tests pass。control・full・MOF 診断は再計算で artifact と一致（decide phase が検査）。frozen 入力 hash は script が実行時に照合。

今回は、FY2024 概算要求PDFの明細表 contiguous range 内で、request 行を基準にした相対座標から3桁 code row を「項」候補として抽出する仮説を frozen 条件で評価する研究である。MOF は implementation freeze 後の exact-only diagnostic にのみ使用し、candidate の生成・調整には使用していない。DocumentHierarchy、FieldResolver、recordKind、rotate対応、MOF matcher の production変更は行っていない。
