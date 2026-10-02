# DocumentHierarchy v1 他省庁 Generalization 実験計画（pre-observation contract）

frozen v1（MHLW PoC、PR #363、merge commit `e5f2b7f`）を、ルール・係数を変えずに他省庁へ当てる out-of-sample 実験の契約。**v1 を直して再採点しない。失敗は主要な成果として記録する。** このコミットは、v1 を他省庁PDFに一度も実行する前に固定する。

## v1 freeze の宣言

- schema: `budget-request-document-hierarchy-poc/v1`。推論 `observeDocumentHierarchy()`（`lib/budget-request-document-hierarchy.ts`）、`indentClusterGapFactor=0.25`、`minClusterSupport=2`、heading shape（先頭3桁+後続 / 要求番号+`NN-NN`）、xクラスタの作り方、levelの定義、文書順stack、`resolved_by_indent_sequence / level_gap / unresolved` の意味は一切変更しない。SourceToken / TableGeometry / LogicalRow、MHLW GT・既存テストも変更しない。
- 入力層は SourceToken → TableGeometry → LogicalRow のみ。凍結層（SpatialRegion 以降）・GT・コード値/省庁名の lookup は使わない。
- 変更してよいのは、他PDF・ページ範囲を渡す薄い experiment runner と、評価側（evaluator）だけ。評価側の追加（summary の照合モード）は下記に事前に書く。

## 対象文書の選定（実PDFの構造を確認した上で）

| 区分 | 文書 | 構造（観察） |
| --- | --- | --- |
| MHLWに比較的近い | METI `https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf`（106頁） | 1つのPDFに 表紙・目次（物理p3–4）・総表（p5–8）・明細（p9–106）。組織5・項32・要求50。目次は（組織）/（項）/要求番号+コード+頁の同じ体裁 |
| MHLWと明らかに異なる | MEXT 分割配布: 目次 `…000031817_01.pdf`（6頁）、総表 `…_02.pdf`（8頁）、明細 `…_03.pdf`（1,339頁） | 目次・総表・明細が**別PDF**。組織4・項69・要求113。明細は物理=印字頁−8（METIは+4、MHLWは+8） |

選定理由: 実PDFを取得済みで、目次・総表・明細の3構造が確認でき、MHLWの比較対象としてレイアウト（単一文書 / 分割配布、規模 106頁 / 1,339頁）が異なる。他省庁（courts・cas 等）は今回は対象にしない（まず2文書で failure mode を観測）。

## 入力ページ範囲（ページ範囲を決める観察と、親子関係の注入は分離）

範囲は各PDFの目次の頁数と、ページ上端の印字ページ・書式の文字列（例: `経（本） 5`）で決めた**走査範囲の指定**で、親子情報を含まない。

| id | 文書 | view | 物理ページ | 理由 |
| --- | --- | --- | --- | --- |
| `meti-summary` | METI | summary | 5–8 | 総表（印字1–4）。5組織の総表行を含む |
| `meti-detail` | METI | detail | 9–106 | 明細（印字5–102）。5組織を全て含む（root見出し5件） |
| `mext-summary` | MEXT `_02` | summary | 1–8 | 総表（印字1–8）。4組織を含む |
| `mext-detail` | MEXT `_03` | detail | 1045–1339 | 組織030 文化庁（印字1053）と040 スポーツ庁（印字1268）〜文書末。メモリ・時間を抑えつつ root 見出し2件（`minClusterSupport=2` を満たす最小）を確保。組織010・020（物理1–1044）は走査しない |
| `meti-detail-narrow` | METI | detail | 66–81 | 組織035（経済産業局、印字62–77）のみ。root見出し1件の狭い範囲（single-organization感度） |
| `mext-detail-narrow` | MEXT `_03` | detail | 1045–1259 | 組織030のみ（040は物理1260から）。root見出し1件の狭い範囲 |

contamination（開示）: 範囲決定のために目次と各PDFの先頭付近・組織境界ページのヘッダ文字列を目視した。v1 の出力・見出し候補・親子結果はこれらの文書では一度も見ていない。METI 物理p9 と MEXT `_03` 物理p876 は過去のPoC（SourceToken〜PageTemplate）のGolden Sampleとして観察済み（METI p9 は今回の範囲に含まれる。MEXT p876 は範囲外）。MHLWの p1555 等も既知。development / holdout は置かない（v1 を調整しないので、全て out-of-sample の test。組織別の内訳は結果に出す）。

## 評価GT（評価専用。実装・v1実行の前に固定）

- 作り方: 各文書の目次（印字された（組織）/（項）/要求行）を poppler の `pdftotext -layout`（pdf.js とは独立）で、ページを左右の列に切って読み、行の形で機械的に転記。名称は目次の最初の1行（折返しの続き行は結合しない）。
- 独立した整合チェック（v1 の出力とは無関係）: 要求番号が1からNまで連続、印字開始頁が文書順で単調非減少、全ての項に要求が1件以上。METI: 5組織・32項・50要求（87ノード）。MEXT: 4組織・69項・113要求（186ノード、うち明細範囲=印字1053以上が48ノード）。
- 出典: METI は物理p3–4、MEXT は `_01` の物理p3–5。fixture は `tests/fixtures/budget-request-document-hierarchy/2024/{meti,mext}-toc-hierarchy-gt.json`。GT作成後に v1 の結果を見て変更しない。曖昧なものは確定していない。
- 限界: 変換スクリプトは scratch でコミットしない。fixture が成果物。転記の目視確認は抽出行の抜き取りのみ。GTは目次由来で、目次を持たない文書はこの方法では評価できない。

## 評価方法（評価側。MHLWと同じ指標を x/N で）

指標: exact parent / false parent / unresolved / not found / ancestor exact / depth exact / nodes matched（x/N）、補助に precision/recall/F1。範囲内のGTノードだけが母数（MEXT detail は `inDetailRange`、narrow 範囲はその組織の部分木）。

照合（推論nodeとGTの対応づけ。評価側）:
- detail: 形（要求=要求番号+コード / それ以外=3桁）・コード列が一致し、物理ページ == 印字開始頁 + オフセット（METI +4、MEXT −8）。候補が2件以上のときだけ名称の前方一致で絞る（MHLWと同じ名称tiebreak）。
- summary・照合モードA（MHLWと同じ）: 形・コード一致 かつ v1の `printedPageRefCandidate`（4桁だけのtoken）== 印字開始頁。v1 の頁数列の候補は4桁限定のため、METI・MEXT の1–3桁の頁数は取れず、**このモードでは見つからない扱いが多数出ると予想**（v1のMHLW固有仮定の観測）。
- summary・照合モードB（今回追加する評価側の補助）: 形・コード（・要求番号）が一致する候補のうち、見出し行のtext parts連結とGT名称が前方一致の関係にあるもの。一意でなければ ambiguous（見つからない扱い）。GT名称は評価側だけで使い、推論には流れない。モードAとBの両方を報告し、判定には**モードB**を使う（モードAは仮定の観測として併記）。

## 判定基準（結果を見て変更しない）

省庁×view の判定（母数=範囲内のGTエッジ、matched は母数のGTノード）:

- `SUCCESS`: exact parent ≥ 90% かつ false parent ≤ 5% かつ depth exact ≥ 90%
- `PARTIAL`: SUCCESS ではないが exact parent ≥ 50% かつ false parent ≤ 10%
- `FAIL`: exact parent < 50% または false parent > 10%
- `EVALUATION BLOCKED`: nodes matched が母数の50%未満（照合できず評価不能）

全体: `GENERALIZES`=4つの省庁×view が全て SUCCESS / `PARTIAL`=SUCCESS が1つ以上あるが全部ではない / `FAILS`=SUCCESS が無い（かつ BLOCKED だけではない）/ `EVALUATION BLOCKED`=BLOCKED のviewにより結論を出せない。

加えて分類（A=v1と同型 / B=部分的に成立 / C=構造的に不成立）を観察に基づいて付ける（判定基準とは別）。

## 診断（v1の既存フィールドから算出。MHLWと同形式）

logicalRowCount / headingCandidateCount / placedCount / unplacedCount / indentClusters / nodeCountByLevel / edgeStatusCounts / GT内のnode match・exact・false・unresolved・not found・ancestor・depth / GT外heading candidate数と大まかな位置・種類 / ページを跨ぐ親の件数 / 最大 `logicalRowsBetween` / 最大 `pagesBetween`。出力は `data/work/budget-request-document-hierarchy/` のみ（`data/derived` へ昇格しない）。

## single-organization 感度（直さない）

`meti-detail-narrow`（組織035のみ）と `mext-detail-narrow`（組織030のみ）を v1 のまま実行し、通常範囲と比較する。root見出しが1件で `minClusterSupport=2` により unplaced → level が1段ずれる、が再現するか／再現しないか／別構造で評価不能かを記録する。

## stop conditions（該当したら、その省庁を「v1 failure / evaluation limitation」として止める。v2 は実装しない）

PDF自身から独立した階層GTを作れない／heading candidate の基本形がv1と根本的に異なる／x-indentがsemantic depthと対応しない／同一depthが安定したxクラスタを作らない／single-support以外でlevelが体系的にずれる／false parentが構造的に発生する／GTを見ないと直せない規則が必要／コード値・名称のlookupが必要。

## v2 candidate の記録

failure があれば結果文書に Observed failure / Evidence / Likely violated v1 assumption / Possible v2 direction / Risk of overfitting / Additional sample needed の形で記録する（仮説。コードは変更しない）。

## 今回やらないこと

v2実装、FieldResolver、最終SemanticRecord、`data/derived` への昇格、全省庁一括処理、UI、凍結層の復活、PR作成、merge。research repo は変更しない。
