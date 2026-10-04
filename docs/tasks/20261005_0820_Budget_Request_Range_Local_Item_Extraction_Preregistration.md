# 概算要求PDF range-local 座標ベース「項」抽出仮説 — 事前登録

layout inventory（branch `research/budget-request-layout-hierarchy-source-inventory`、`302fa96`）の後続。評価する仮説は 1 つだけ: 明細表の contiguous range ごとに request 行の x を基準化すれば、3 桁 code 行の相対座標から「項」を再現性高く抽出できる。candidate は正式な項 GT ではなく、MOF 784 項は PDF 側の正解母数ではない。production は変更しない。full-corpus の新しい candidate 件数・MOF overlap は、実装の freeze（Commit B）後の評価（Commit C）まで見ない。

## 0. 凍結する依存（実行時に hash を照合。不一致なら STOP）

corpus manifest `4a2a10ec…dde7a`、baseline extraction `89b28cbe…069f`・reconciliation `2f14d15c…2904`、hierarchy isolation の transition `b5283cdf…acd`・off-diagnostic `9b0a9273…2ea`、前回 candidate lib `fd51578a…c892`・candidate-count `35ffc096…d508`、layout inventory の summary `67808613…3266`・page inventory `fb74ca44…441b`、P1 matcher `da08b377…c19a`。既知値の再現を評価 script が検査: production item 97（一般会計 81）、比較可能 79・exact_unique 77、前回 candidate rows 929（一般会計 641）、layout inventory evaluable 73 PDF / 8,586 page。

## 1. 前回 detector の凍結値（source: `budget-request-item-candidate.ts` と前回 preregistration §3。指示書の要約と一致）

- 入力: hierarchy=null の row-local 出力（baseline の null 区間はそのまま、8 PDF の hierarchy 区間は hierarchy-isolation の OFF 出力）。
- 基準 `refX`: request 行（recordKind=request の code x を 0.01pt に丸めた値）の最頻値（同数なら小さい x）。request 行が 5 件未満なら基準なし。
- 候補: recordKind=unclassified、code が `^\d{3}$`、`|codeX - (refX - 6.9)| ≤ 1.0`。名称は resolved のときだけ値を使い、そうでない候補は ambiguous（名称なし）。key = `code|normalizeKey(name.raw)`（NFKC + 空白除去。P1 と同じ）。within-document unique = 同一 PDF 内の distinct key、duplicate = key を持つ候補行 − unique。
- 差: request 行の基準 x を PDF 全体で 1 つ決める点。

## 2. 唯一の変更: PDF-global request x → range-local request x

候補条件（lexical・相対 x 6.9pt・許容 1.0pt・名称の扱い・key・duplicate）は §1 のまま。変わるのは `refX` を決める request 行の集合だけ（PDF 全体 → 凍結済み layout range 内）。

### 明細表 range の mapping（結果を見る前に固定。layout inventory の signature のみを使う）

layout range（`layout-summary.json` の `perPdf[].ranges`、変更しない）のうち、signature の header 成分が設定されている（`H:-` でない＝見出し由来の column layout が観測された）range を detail-table range とする。`H:-` の range は preface / non-detail range（`outside_detail_range`。候補を数えない）。signature のない page・range に属さない page は候補を数えない。

### range-local の基準 x

各 detail-table range の [from, to]（吸収された gapPages を含む）にある page の request 行だけから決める。

- request 行が 5 件未満 → `range_request_x_unavailable`（fail-closed。隣接 range の値で補完しない）。
- request 行 x（0.1pt の histogram）の全てが最頻値から 0.5pt 以内（layout inventory で凍結した dominant の定義）でない → `range_multimodal`（ambiguous。候補を数えない）。
- それ以外 → `evaluable_detail_range`。`refX` = §1 の最頻値。

PDF 単位の status は layout inventory の coverage を引き継ぐ（`unavailable_rotate90`・`insufficient_layout_evidence`・`other`）。

## 3. candidate status

`candidate_name_resolved` / `candidate_name_unavailable` / `range_request_x_unavailable` / `range_multimodal` / `outside_detail_range` / `upstream_unavailable`（rotate90・upstream・other の PDF）。

## 4. Control evaluation（実装 freeze の前に確認。regression / mechanism check）

hierarchy 契約のある 8 PDF の hierarchy 区間で、range-local detector の候補を hierarchy ON（baseline）の recordKind と anchor で突き合わせる。出す値: 既存 item（97）・recovered・missed・候補総数・候補だが既存 item でない（known organization＝ON で organization、ON unclassified、その他）・duplicate / unjoinable・PDF 別。`organization` は known false-positive-like として別計数し、`unclassified` は誤検出と断定しない。これは前回 offset の較正に使った population であり、97/97 の再現は独立な検証ではない。

## 5. 評価 population・paired comparison・weak population

- full-corpus: 82 PDF（detail range 単位）。coverage は PDF 数・page 数・range 数で報告（evaluable_detail_range / range_request_x_unavailable / range_multimodal / outside_detail_range / insufficient_layout_evidence / unavailable_rotate90 / other）。
- candidate counts: 全会計・一般会計・特別会計で、候補行・名称あり・名称なし・within-document unique・duplicate・候補を持つ PDF 数・range 数。
- 前回 detector との paired 比較: 前回の候補（`candidate-count.json` の `candidates`、row provenance = localPath/page/logicalRowIndex）と row 単位で old only / both / new only。前回基準なし（no_reference）の PDF の行は `old_not_evaluable` として new only と区別する。前回との比較: evaluable PDF・range・候補行・一般会計候補・名称あり・候補 0 の PDF。
- weak population: A（hierarchy 契約なし・前回基準 x 55.22 の 26 PDF）、B（前回基準 x なし 23 PDF）、C（`001630395.pdf`）。それぞれ detail range の status と候補を出す。「回復」は前回との paired difference としてのみ言う。

## 6. MOF exact-only diagnostic（detector freeze 後、Commit C で初めて実行）

一般会計の candidate（名称あり）の名称を、MOF V2 FY2024 一般会計 当初予算の section 名と、P1 / 前回診断と同じ `normalizeKey` で exact 照合のみ（組織情報は使わない名称単独）。分類: `exact_unique` / `exact_ambiguous` / `no_exact_match` / `name_unavailable`。fuzzy・部分一致・code/金額/省庁による救済・MOF 一致による候補の増減や threshold 調整は行わない。正式な precision / recall ではない。正式な reconciliation（77 / 79）とは別表にし、P1 matcher は変更しない。

## 7. 判定規則（機械的。数値は既存結果を踏まえて評価前に固定。結果を見た後に変更しない）

数値 threshold は、前回 evidence（control 97 件・前回 MOF 名称 overlap 約 97%・control の organization 混入 7/158＝4.4%）を踏まえて今回設定した値であり、独立に導出したものではない。

量: `rec` = control で既存 item 97 件のうち候補に入った数、`ov` = 一般会計の名称あり候補のうち `exact_unique` + `exact_ambiguous` の割合、`con` = control の候補のうち known organization の割合、`wk` = 弱点 population の改善（`001630395.pdf` が前回 0 件→今回 1 件以上、かつ x≈55.22 の 26 PDF のうち今回 1 件以上の候補を持つ PDF 数が前回（0）を上回る）、`fc` = fail-closed（evaluable_detail_range でない range・outside_detail_range・upstream_unavailable の page に候補が 0 件）、`det` = 全評価の再生成が決定的で frozen hash が一致。

1. `INCONCLUSIVE`: `det` が偽、または control で unjoinable / duplicate がある、または evaluable_detail_range が 0。
2. `RANGE_LOCALIZATION_INSUFFICIENT`: `wk` が偽。
3. `RANGE_LOCAL_COORDINATE_ITEM_EXTRACTION_SUPPORTED`: `rec = 97` かつ `ov ≥ 0.90` かつ `con ≤ 0.05` かつ `fc` が真。
4. `COORDINATE_SIGNAL_STRONG_BUT_CLASSIFICATION_INCOMPLETE`: `rec = 97` かつ `ov ≥ 0.90` かつ `con > 0.05`。
5. 上記以外 → `RANGE_LOCALIZATION_INSUFFICIENT`。

## 8. 主張の上限

「frozen detail-range と range-local geometry で、hierarchy に依存せず item-shaped row を決定的に抽出でき、その population が既存 item control および MOF exact-name diagnostic と整合する」まで。coordinate candidate=正しい項、MOF 784=母数、exact overlap=precision、不一致=抽出誤り、座標だけで hierarchy 全体を構築できる、事項の親子付け、production ready は主張しない。

## 9. 順序・禁止

Commit A（本書）→ B（range-local detector 実装・unit test・評価 script・control 評価。実装 hash を記録。full-corpus の集計と MOF 診断は見ない）→ C（full-corpus 凍結評価・paired・weak・MOF 診断）→ D（result freeze）。source inspection は実施する場合 post-hoc と明記し、detector の修正に使わない（今回は予定しない）。production の DocumentHierarchy・FieldResolver・recordKind・normalized output・MOF matcher の変更、layout inventory / 前回 candidate の書き換え、offset・tolerance の調整、MOF による候補の増減、fuzzy、金額による救済、rotate90 対応、PR 作成は行わない。
