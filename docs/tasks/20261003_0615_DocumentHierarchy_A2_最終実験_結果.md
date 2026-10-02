# DocumentHierarchy A2 最終実験 結果

DocumentHierarchy の最後の探索実験。事前登録済みの A2 をそのまま実装・評価し、結果にかかわらず探索を閉じる（A3 は作らない）。この文書は段階的に書く（development checkpoint → holdout GT → holdout 初実行 → 最終）。**現在: development checkpoint（A2 implementation freeze）まで。**

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
