# 概算要求PDF organization / root 境界の source evidence inventory — 結果

protocol: `20261005_0913_Budget_Request_Organization_Root_Source_Evidence_Protocol.md`（Commit A `82f4cd4`、doc SHA-256 `ec3a51db…fd71`）。inventory は Commit B `98245e8`。事前登録した軸・規則は結果を見た後に変更していない（post-hoc の観測は protocol の外として明示）。production code は無変更。MOF は使っていない。existing ON kind は GT ではなく、organization 7 を「正解の organization」とは呼ばない。

**判定: `CONTRACT_DEPENDENCY_REMAINS`（D4）。** Axis A = `LAYOUT_BOUNDARY_ONLY`、Axis B = `INSUFFICIENT_EVIDENCE`。

## Pre-flight
branch `research/budget-request-organization-root-source-evidence`、親 `bf4e3a8`、origin/main `38e5080`（chain は未 merge）。frozen 入力（semantic-boundary population・evaluation、layout summary、paired manifest、protocol）の hash を script が照合。working tree は未追跡 `.DS_Store` 2 件のみ。

## Existing mechanism recap
既存 hierarchy は、3 桁 code 行の x-level（range 内クラスタ順位）と文書順 stack で kind を決め、root（range 内で浅い見出しが先行しない行）を organization にする。activation range は `A2_EXPERIMENTS` の手書き定数。

## Population
887 を再現（item 97・detail_line 613・unclassified 170・organization 7）。organization 7 はすべて cfa（`20230907_policies_budget_04.pdf`）。8 PDF の契約範囲の境界周辺は、既定で ±1 page、mext / mhlw は ±10 page の窓（protocol で固定）、row 文脈は ±20 logical rows を観測（上流は研究用に pdf.js text → logical row を再実行。artifact は locator 付きの compact 表現のみ）。

## Activation boundary（RQ1）

- Fact: AR1（契約の [a, b] を含む layout range の [from, to]）は 8 PDF 中 6 PDF で再現。mext（契約 1045-1339、layout range 1-1339）と mhlw（契約 1555-1700、layout range 21-1723）は再現しない。AR2（layout range 内で request 行を含む最初と最後の page）は 4 PDF で再現し、8 PDF すべては満たさない。→ 事前登録の規則で Axis A = `LAYOUT_BOUNDARY_ONLY`（手書き範囲の一部は layout からは再現できない）。
- Observation（事前登録の AR4）: page title の正規化文字列は 8 PDF すべてで契約の開始 page で変わるが、窓内の変化率が高く（mext 11/20・mhlw 17/20 の隣接 page 対）、境界に特異的ではない。boundary_correlated_only。
- Observation（post-hoc exploratory、protocol の軸の外。candidate_for_next_preregistration）: page の最初の title 行に「文字（文字）」形の label が印字されている（例: mext は page 1043 まで `文（所）`、page 1044 は title が空、page 1045 から `文（文）`。mhlw は 1554 の `厚（障）` → 1555 の `厚（地）`、1700 の `厚（労）` → 1701 の `厚（中）`）。mhlw では label が契約の開始・終了の両方で変わり、窓内の他の隣接 page 対ではほぼ変わらない（20 対中 1）。mext の開始は空 title の page（1044）を挟んで label が変わり、終了 1339 は文書の最終 page。mext の契約範囲の中でも label は変わる（例: 1329 以降は `文（ス）`）ので、label の変化が契約の境界を決めるとは言えない。意味（label が組織の略称か等）の解釈はしておらず（`semantic_human_interpretation` に当たるため）、同じ development population 上の観測であり検証済みではない。

## mext / mhlw（重点）
- mext: layout range 1-1339（見出しあり・request x 66）、契約 1045-1339。開始 1045 の直前（1044）は title が空で、page 1043 まで label `文（所）`、1045 から `文（文）`。code 行の最浅 x は範囲内 51.8（range 内最浅の root）、range 外には x=38 の 3 桁 code 行（名称なし・page 92 以降偶数 page ほか）が 450 件あり、契約範囲の最浅より浅い（意味は解釈していない）。終了は文書の最終 page（layout range の終端と同じ）。
- mhlw: layout range 21-1723、契約 1555-1700。開始 1555 は page header の label が `厚（障）` → `厚（地）`、終了 1700 は `厚（労）` → 1701 `厚（中）` で、いずれも label の変化と一致。page 1554 の末尾は request 行（04-06）と日時の footer、1555 の先頭は label と column header 行。range 外の x=38 の 3 桁 code 行は 450 件。
- source evidence だけで境界を再現できる生成規則は、事前登録の候補（AR1・AR2）には無い。post-hoc の label 変化は mhlw の両端と一致するが、mext の範囲内でも label が変わるため、規則としては未確定。これは重要な negative result: layout が同じ range の内部に手書き境界がある理由は、事前登録した evidence だけでは説明できない。

## Root semantics（RQ2・RQ3）

organization 7 と item 97 の non_circular feature 13（code 桁数・名称 resolved・名称 status/reason・layout variant・request 基準 offset の帯・名称が page title に含まれる・同名の他行・page 先頭の code 行・直前 / 直後の code 行の class・次の request までの code 行数・直前 plain3 との x 増減・自分より前に浅い plain3 行が PDF 内にあるか）で、organization 7 の値が item 97 の値の集合の部分集合でないものは無し（すべて shared_with_item。disjoint なものは 0）。circular な feature（既存 ON kind・直前の heading kind までの行数）も disjoint なものは無し。「次の code 行が request」は organization 7/7 だが item 97 でも 85/97。

| evidence | organization 7 | item 97 | status |
|---|---|---|---|
| nameInPageTitle | false 7 | false 97 | shared_with_item |
| sameNameOtherRows | 0:6, 1:1 | 0:82, 1:14, 2+:1 | shared_with_item |
| firstCodeRowOnPage | true 1 | true 29 | shared_with_item |
| nextCodeRowClass | request 7 | request 85 / other numeric 12 | shared_with_item |
| xStepFromPrevPlain3 | same 6, prev_shallower 1 | same 73, deeper 12, shallower 12 | shared_with_item |
| shallowerPlain3BeforeInPdf | true 7 | true 97 | shared_with_item |
| requestRelativeBand (−6.9) | true 7 | true 97 | shared_with_item |
| root basis（既存の親候補なし） | root 7 | child_of_root 97 | contract_derived |

shallower evidence: cfa の手書き範囲の外に、範囲内の最浅 root より 0.5pt 以上浅い 3 桁 plain code 行は 0 件（`ROOT_EQUALS_RANGE_ROOT_ONLY` の条件を満たさない）。したがって Axis B = `INSUFFICIENT_EVIDENCE`。

## cfa organization 7（development observation、一般化しない）
7 件はすべて code x 58.67、anchor offset 8.6、request 基準 offset −6.9（item と同じ）、次の code 行は request。名称は例えば `こども家庭庁共通費`（code 001）、`母子保健衛生対策費`（015）、`保育対策費`（025）、`こども安全対策費`（045、同名の他行 1）、`児童虐待防止等対策費`（055）など。page title の行には、最初の detail page（page 7）にだけ `19 内閣府所管（こども家庭庁）`、各 page の先頭 title 行に `内（こ）` が印字されているが、organization 7 の名称が page title に含まれることはない。既存 hierarchy で root になった直接の理由は、cfa の hierarchy 入力（page 7-147）に x がより浅い見出し行が無く、これらが範囲内で最浅のクラスタ（rank 1）の行になったことで、名称・辞書は使われていない。名称の意味（これらが項に当たるか組織に当たるか）を人間が読んで判断することは `semantic_human_interpretation` にあたり、今回は行っていない。item 97 側で organization 7 だけの feature は見つからなかった（7/7 vs 0/97 の完全分離は無い）。

## Evidence matrix（機械可読は `evidenceMatrix`）
| evidence | source | organization/root での観測 | item・境界との関係 | deterministic | contract independent | status |
|---|---|---|---|---|---|---|
| layout range（AR1） | layout inventory | — | 契約境界と 6/8 一致 | はい | はい | `boundary`: 一致 6 / 不一致 2（mext・mhlw） |
| request を含む page（AR2） | row-local request 行 | — | 契約境界と 4/8 一致 | はい | はい | insufficient_evidence |
| page title 正規化文字列の変化（AR4） | 研究用に再抽出した title 行 | — | 開始で 8/8 変化、窓内の変化率が高い | はい | はい | boundary_correlated_only |
| page header の label（post-hoc） | title 行の `文字（文字）` | — | mhlw の両端と一致、mext は範囲内でも変化 | はい | はい | promising_candidate（未検証、意味は未解釈） |
| organization / item の row-local feature 13 | records・title | 全て item と共有 | — | はい | はい | shared_with_item |
| 既存の root basis | FieldResolver | root 7 | child_of_root 97 | はい | いいえ（range-root 定義） | contract_derived |
| 範囲外の浅い行 | 全 PDF の plain3 行 | cfa は 0 | mext・mhlw は x=38 の行が 450 | はい | はい | not_observed（cfa）／意味未解釈（mext・mhlw） |

## Axis と判定
- Axis A: `LAYOUT_BOUNDARY_ONLY`。
- Axis B: `INSUFFICIENT_EVIDENCE`。
- Overall: `CONTRACT_DEPENDENCY_REMAINS`（Axis A が candidate でなく、Axis B も candidate でない）。

## 否定的な evidence
mext / mhlw の手書き境界は、事前登録した source evidence では再現できない。organization 7 と item 97 を分ける non_circular な feature は無い。cfa の organization は range 内の最浅行として定義されただけで、range 外に浅い行は無い。post-hoc の page header label は唯一の新しい手がかりだが、mext の範囲内でも変化し、意味は未解釈。

## Limitations
development population と同じデータでの観測で検証済みではない／existing ON kind は GT ではない／organization 7 は cfa の 1 PDF に偏る／mext・mhlw の窓は ±10 page で、境界の全 page を見ていない／title 行の抽出は研究用の上流再実行（保存済み artifact に無かった）／label の意味は解釈していない／rotate=90・sparse range は対象外。

## 次に進む候補（開始しない）
`ACTIVATION_BOUNDARY_UNRESOLVED` でも `ROOT_SEMANTICS_UNRESOLVED` でもなく D4 のため、不足している evidence class を 1 つだけ選ぶ: page header の label（`文字（文字）`）が、契約境界・organization/root の境界と構造的に対応するかを、全 page の title 行を対象に事前登録して検証する inventory（意味解釈は別扱い）。production 変更・generator は開始しない。

## 検証
tsc エラー 0・lint エラー 0・vitest 126 files / 1,466 tests pass。script の再実行で artifact は不変（`f5defd32…a9d0`）。frozen artifact は変更していない。

今回は source evidence inventory であり、production DocumentHierarchy / FieldResolver / recordKind / item detector は変更していない。MOF を教師として使用していない。candidate rule が見つかった場合も同一 development population 上の観測であり、検証済み精度とは扱わない。
