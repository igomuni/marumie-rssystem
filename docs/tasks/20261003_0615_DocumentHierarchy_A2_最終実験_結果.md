# DocumentHierarchy A2 最終実験 結果

DocumentHierarchy の最後の探索実験。事前登録済みの A2 をそのまま実装・評価し、結果にかかわらず探索を閉じる（A3 は作らない）。この文書は段階的に書いた（development checkpoint → holdout GT → holdout 初実行 → 最終）。

## 1. preregistration reference

- 文書: `docs/tasks/20261003_0557_DocumentHierarchy_A2_実験計画.md`、封印した holdout 候補: `tests/fixtures/budget-request-document-hierarchy/2024/a2-holdout-candidates.json`。
- commit: `f8ce677`（`docs: DocumentHierarchy A2の事前登録…`）。以降、A2 の rule・閾値・成功条件・stop は変更していない。
- branch lineage: `origin/main`（`09f5fef`）→ `research/budget-request-document-hierarchy-v2-failure-isolation`（`9a972e8`）→ `research/budget-request-document-hierarchy-v2b-holdout-a2-prereg`（`f8ce677`、設計メモ `a44621d`）→ 本 branch `research/budget-request-document-hierarchy-a2-final-experiment`。いずれも main 未 merge・PR なし。

## 2. frozen primary rule（事前登録どおり）

`headerCollisionHandling = 'page-edge-domain'`。見出し候補行を hierarchy placement から除外するのは、**次の3つが全て成立するときだけ**:

1. **(D)** ページ端の行（当該ページの最も上、または下端が最も下の論理行）。
2. **(N)** 頁番号の正準な10進表記（`0|[1-9][0-9]*`。先頭0なし）と**完全一致**する数字だけのtoken。頁番号のオフセットは、各ページの最上/最下行の正準な10進表記の数字だけの token の（値−物理ページ）の多数決（過半数のページ。ページ数3未満は評価不能）。
3. **(Y)** その行の yMin クラスタ（許容差=TableGeometry の行クラスタリング許容差）が過半数のページに行を持つ（ページ数3未満は評価不能）。

使う数値は「過半数（>50%）」「ページ数3以上」「既存の行クラスタリング許容差」「正準な10進表記」だけで、新しい閾値はない。除外した行は削除せず、`hierarchyEligibility: 'excluded'`・`exclusionEvidence`・`hierarchyResolutionContext`・sourcePage・sourceRowRefs・sourceTokenRefs・x を残す。禁止（AND→OR、閾値変更、先頭0の扱い変更、ページ端帯の変更、省庁・文字列・コードの例外）は守った。

## 3. 実装（コミット1 = `77b01da`）

v2 モジュール（`budget-request-document-hierarchy-v2.ts`）に新しい option 値として追加（v1・v2-A・v2-B は変更なし。旧 artifact 60個と決定が一致）。variant: `v1` / `v2-A`（STOP・比較用）/ `v2-A2` / `v2-B`（凍結）/ `v2-B-A2` / `v2-B-obs`（B + 観測のみ）。`observe-only` は同じ evidence を観測として残すだけで除外しない（hierarchy の判断は off と同じ）。FieldResolver への引き継ぎ用に、`headerCollisionObservation`（mode・offset・evidence を持つ node・除外 node・`edgeContexts`）と node ごとの `hierarchyResolutionContext` を追加（観測と decision を分離）。

## 4. development 結果（事前登録の基準を機械判定。主は posthoc 照合、事前固定の照合も同値）

### Header-positive

| 文書 | variant | exact | false | unresolved | not found | ancestor | depth | matched | excluded | GT内excluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| METI detail | v1 | 80/82 | 0/82 | 2/82 | 0/82 | 78/82 | 0/87 | 87/87 | 0 | 0 |
| | v2-A（STOP） | 82/82 | 0/82 | 0/82 | 0/82 | 82/82 | 87/87 | 87/87 | 2 | 0 |
| | **v2-A2** | **82/82** | 0/82 | 0/82 | 0/82 | 82/82 | **87/87** | 87/87 | **2** | **0** |
| 環境省 detail | v1 | 58/81 | 0/81 | 23/81 | 0/81 | 36/81 | 0/84 | 84/84 | 0 | 0 |
| | v2-A（STOP） | 81/81 | 0/81 | 0/81 | 0/81 | 81/81 | 84/84 | 84/84 | 45 | 0 |
| | **v2-A2** | **81/81** | 0/81 | 0/81 | 0/81 | 81/81 | **84/84** | 84/84 | **45** | **0** |

A2 の除外行は v2-A と同じ集合（METI 2行 = p104 `100`・p106 `102`、環境省 45行）。予測 P1 は成立。

### Negative

| 文書 | variant | exact | false | unresolved | not found | depth | matched | excluded | GT内excluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 農水省復興特会 | v1 | 27/35 | 0/35 | 8/35 | 0/35 | 0/36 | 36/36 | 0 | 0 |
| | v2-A（STOP） | 26/35 | 0/35 | 8/35 | **1/35** | 0/36 | 35/36 | 1 | **1** |
| | **v2-A2** | 27/35 | 0/35 | 8/35 | 0/35 | 0/36 | 36/36 | **0** | **0** |
| MLIT復興特会 | v1 | 12/20 | 0/20 | 8/20 | 0/20 | 0/21 | 21/21 | 0 | 0 |
| | v2-A（STOP） | 12/20 | 0/20 | 8/20 | 0/20 | 0/21 | 21/21 | 1（本文行 `005`） | 0 |
| | **v2-A2** | 12/20 | 0/20 | 8/20 | 0/20 | 0/21 | 21/21 | **0** | 0 |

A2 は v2-A が誤除外した要求 `56-65`（農水省）と本文行 `005`（MLIT）を除外しない（v1 と完全一致）。予測 P2 は成立。

### Regression（A2 == v1。両照合）

MHLW summary・detail、METI summary、MEXT summary・detail、METI detail p9–103: 全て v1 と一致（除外 0、false parent の増加なし）。予測 P3 は成立。B の development（METI 035・MEXT 030・MHLW 070 narrow）でも A2 は v1 と同じ（参考）。`v2-B-obs` は `v2-B` と全指標で一致（観測のみは decision を変えない）。

## 5. development checkpoint: **GO**

事前登録の基準（positive の除外行・指標が v2-A と一致、negative の誤除外 0、regression の v1 一致、GT hierarchy node の誤除外 0、false parent の増加 0）が全て PASS（17チェック）。`tests/fixtures/budget-request-document-hierarchy/2024/a2-development-result.json` に結果を記録。artifact（13実験×6 variant = 78）と評価 JSON を2回生成してバイト一致。

### rule unchanged declaration と A2 implementation freeze

A2 の rule・閾値は事前登録（`f8ce677`）から変更していない。exact option values: `{ headerCollisionHandling: 'page-edge-domain', singletonRootPlacement: 'off' }`（B との統合は `{…'page-edge-domain', 'lattice-supported'}`）。閾値: majority >50%・最小ページ数 3・y帯の許容差=行クラスタリング許容差・正準な10進表記 `0|[1-9][0-9]*`。**このチェックポイントのコミットを「A2 implementation freeze commit」とする**（本文書と `a2-development-result.json` を含む。以降 A2 の rule を変更しない）。holdout（防衛省・こども家庭庁）は、この時点で未観測。

## 6. holdout GT construction

- 対象: 封印していた strict holdout の防衛省 一般会計（`https://www.mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf`、540頁）とこども家庭庁 一般会計（`https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/585bb95a/20230907_policies_budget_04.pdf`、147頁）。予備（公取委・警察庁）は使っていない（primary は両方取得でき、GTも構築できた）。
- 方法: 各文書の目次（防衛省 物理p3–4、こども家庭庁 p3）を poppler の `pdftotext -layout`（pdf.js とは独立）で左右の列に分けて機械的に転記。独立チェック: 要求番号が1からNまで連続、印字開始頁が単調、全ての項に要求あり。防衛省: 3組織/29項/67要求（99ノード）、こども家庭庁: 1組織/13項/24要求（38ノード）。明細の範囲は物理p9–540（防衛省）・p7–147（こども家庭庁）で、先頭と末尾のページ上端の印字から決めた（物理=印字頁+4）。GT構築時に開いたのは目次と先頭・末尾の印字ラベルだけで、A2・v1・v2 の出力・見出し候補・クラスタは**一度も見ていない**。
- GT は A2 implementation freeze の**後**に作成（strict holdout の条件を満たす）。

## 7. commit 順序（rule freeze → GT freeze → first holdout run）

| 段階 | commit |
| --- | --- |
| preregistration | `f8ce677` |
| A2 実装 + 単体/development テスト | `77b01da` |
| development checkpoint + **A2 implementation freeze** | `093fea7` |
| holdout GT（**GT freeze**） | `ca75180` |
| holdout の範囲・分類・A2判定・統合確認の基準をコード化（出力なし） | `40f2e02` |
| **first holdout run** + 評価 + 結果（本コミット） | 次の commit（`git log` の `holdout first run`） |

順序は崩れていない。`40f2e02` 以降に変えたのは、`--final` 段階（B only の記述的な確認）の追加と、ランナーの既定 variant から `v2-B-A2` を外したことだけで、規則・実験定義・分類・判定のコード（`budget-request-document-hierarchy-v2.ts`・`…-a2-experiments.ts`・`…-a2-eval-config.ts`）は `40f2e02` から差分なし。

### 実行上の事故の開示

再生成の際、ランナーの既定 variant に `v2-B-A2` と `v2-A` が含まれていたため、holdout で `v2-B-A2`・`v2-A` の artifact を作ってしまった（A2 = STOP のときは B+A2 の統合確認を実行しない、という指示に反する）。**評価も参照もしていない**。該当 artifact（`v2-B-A2` は development 分も含む）は削除し、ランナーの既定から `v2-B-A2` を外した（`--variants=` で明示したときだけ実行）。development 段階で `v2-B-A2` を実行した際にランナーが出力した構造の要約（見出し数・edge の status 件数）は目にしたが、GT との照合は行っていない。

## 8. holdout first-run results（A2 only。同一照合 posthoc で v1 と比較）

| metric | 防衛省 v1 | 防衛省 A2 | こども家庭庁 v1 | こども家庭庁 A2 |
| --- | ---: | ---: | ---: | ---: |
| exact parent | 34/96 | **96/96** | 20/37 | 24/37 |
| false parent | 0/96 | 0/96 | **6/37** | 0/37 |
| unresolved | 62/96 | **0/96** | 11/37 | 13/37 |
| not found | 0/96 | 0/96 | 0/37 | 0/37 |
| ancestor exact | 5/96 | **96/96** | 0/37 | 0/37 |
| depth exact | **0/99** | **99/99** | 37/38 | **0/38** |
| matched nodes | 99/99 | 99/99 | 38/38 | 38/38 |
| excluded candidates | 0 | 219 | 0 | 22 |
| GT nodes excluded | 0 | **0** | 0 | **0** |
| level_gap（edge） | 218 | 0 | 30 | 12 |
| 未配置クラスタ/node | 0 | 0 | 3 | 3 |

事前固定の照合も同値。actual header collision present? **両文書とも yes**（防衛省で219行、こども家庭庁で22行がヘッダとして除外された）。A2 activated? **両方 yes**。provenance: 除外した行は全て node として残り、3種の evidence・sourceRowRefs・sourceTokenRefs・`hierarchyResolutionContext` を保持（`provenanceOk = true`）。

## 9. informative / non-informative classification

- **防衛省: INFORMATIVE**（v1 の depth exact が 0/99 < 90%）→ **PASS**: A2 の depth 99/99（≥90%）、false parent の増加 0、GT hierarchy node の誤除外 0、exact は v1 以上、除外された219行は全て3つの evidence を満たす。
- **こども家庭庁: NON-INFORMATIVE**（v1 の depth exact が 37/38 ≥ 90%）→ **NON-INFORMATIVE-FAIL**: 事前登録の基準では、v1 が壊れていない holdout で A2 は v1 と同じ指標でなければならない。A2 は exact を 20→24/37、false parent を 6→0/37 に改善した一方、**depth exact を 37/38 → 0/38 に下げた**（hierarchy metrics の非後退の違反）。

## 10. A2 judgment: **STOP**

事前登録（指示書 §15）の基準を機械的に適用: development = GO、holdout = {INFORMATIVE-PASS, NON-INFORMATIVE-FAIL}、よって **STOP**（非 informative な holdout で A2 が preregistered success criteria を満たさない）。規則・閾値は変更していない（A3 は作らない）。

### 結果の読み方（観察。判定は変えない）

- A2 の除外の判断自体は、両 holdout で正しかった（GTノードの除外 0、除外された241行は全て3種の evidence を満たす本物のページヘッダ）。false parent は両文書で 0 または減少した。
- depth の後退（こども家庭庁）の原因は、**この文書が組織1つだけ**で、根のクラスタ（x=51.8）が支持1のため未配置のまま（規則Bの対象。A2 単独では B を有効にしていない）という既知の single-organization の失敗にある。v1 では22行のヘッダが偽の level 1 を作り、**偶然**項を level 2（正しい値）に押し上げていた。A2 がヘッダを除外すると、その偶然が消えて、根が未配置のままなので項が level 1 になった。
- v1 の false parent 6/37 は、ヘッダ行（level 1）を親とした項（level 2）が隣接のため `resolved` になったもの（B only の最終構成でも同じ）。
- B+A2 の統合確認は、指示書 §17 に従い**実行していない**。この観察から、B+A2 では depth が回復する可能性があるが、それは今回の判定には使わない。
