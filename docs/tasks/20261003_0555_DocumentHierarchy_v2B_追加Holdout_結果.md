# DocumentHierarchy v2-B 追加 Holdout 結果

**分類: `B-HOLDOUT-PASS`／B の最終 evidence label: `CONFIRMED-WITH-SCOPE`**（規則Bは変更していない）。B は「single-organization solver」ではなく、**singleton root + 十分な支持を持つ indentation staircase に対する安全な placement rule** として、適用範囲つきで確認された。

## branch lineage

`origin/main`（`09f5fef`、#364 merge）→ `research/budget-request-document-hierarchy-v2-failure-isolation`（`be472f4` 計画 → `d755a7d` v2実装 → `9a972e8` 結果。main 未merge・PR なし）→ 本branch `research/budget-request-document-hierarchy-v2b-holdout-a2-prereg`（`f78c518` MLIT のGT → `557f215` 診断・分類 → 結果）。

## 対象と GT（B 実行前にコミット）

- 国土交通省 東日本大震災復興特別会計 `https://www.mlit.go.jp/page/content/001630395.pdf`（FY2024、10頁、15,546 bytes、manifest 登録済み）。組織は復興庁の1つだけ。構造: 目次 物理p3、総表 p5–6、明細 p7–10（印字頁3–6、物理=印字頁+4）。
- GT `mlit-fukko-toc-hierarchy-gt.json`: 目次（物理p3、poppler。左右の列に分けて機械的に転記）から 1組織/8項/12要求（21ノード）。独立チェック: 要求番号が1–12で連続、印字頁が単調、全項に要求あり。曖昧なものは入れていない。**v2-B 実行前にコミット（`f78c518`）**。このコミットの時点で観測していたのは目次とページ上端の印字文字列だけで、インデントクラスタ・x/y・見出し候補・v1/v2 出力は未観測。
- B規則（`singletonRootPlacement=lattice-supported`: 根側の支持1クラスタを、右隣の placed クラスタ run 3つ以上・1段分の差のときだけ置く）は変更していない。分類の定義（PASS / OUT-OF-SCOPE / NOT-APPLICABLE / FAIL）は実行前にコードとテストで固定（`557f215`）。

## staircase diagnostics（なぜ発火したか）

`latticeDiagnostics` を追加（判断過程の観測のみ。**60 artifact で決定が不変**であることを確認してから MLIT を実行）。

| 項目 | MLIT 復興特会 detail |
| --- | --- |
| 基準フォントサイズ / 許容差 | 6.944pt / 1.736pt（0.25×） |
| indent clusters（x・支持・level・根拠） | 65.569（n=1, L1, `lattice_supported`）／72.470（8, L2）／79.372（12, L3）／86.274（9, L4）／93.176（2, L5）／728.161（1, 未配置） |
| singleton-root candidate | 65.569（支持1。placed クラスタの左側） |
| staircase（右隣の placed run） | 4クラスタ（72.470–93.176）。required run length = 3、observed = 4 |
| 隣接差 | 6.902 / 6.902 / 6.902（正規化 0.994 em）。中央値 step = 6.902 |
| 根と run の差 | 6.901（正規化 0.994）。|差−step| ≤ 許容差 → 1段分 |
| placement decision | `placed`（理由 `one_step_left_of_regular_staircase`）。2回目の判断は候補なしで終了 |
| 規則Bの発火 | **yes（activated）** |

## 指標（同一PDF・GT・照合。主は posthoc 照合、事前固定の照合も同値）

| variant | exact | false | unresolved | not found | ancestor | depth | matched | B発火 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | 12/20 | 0/20 | 8/20 | 0/20 | 0/20 | **0/21** | 21/21 | — |
| v2-B | **20/20** | 0/20 | **0/20** | 0/20 | **20/20** | **21/21** | 21/21 | yes |

根（組織）は level 1 に置かれ、v1 で全体に1段ずれていた level（item が level 1、…）が戻った。false parent は 0 のまま。通常 range（regression 6実験）は v2-B で v1 と完全一致（再評価で確認）。scope classification: **B-HOLDOUT-PASS**（適用条件成立・B発火・根が正しく placed・parent/depth改善・false parent +0・regression 0）。

## 同じ文書での v2-A の観測（B の判定には使わない。A2 設計の開発側の根拠）

v2-A（STOP）は MLIT でも**本文の見出し行を1行除外**した（物理p9、コード `005`。`vertical_repetition` + `page_number_sequence`。`005` を数値化して p9−4=5 と一致。GTノードではない）。農水省復興特会の誤除外と同じ原因（頁番号の証拠をページ端以外の行に適用し、先頭の0を許す数値比較をした）。MLIT は B の holdout であって A2 の holdout ではない。この観測は A2 の開発側の negative として開示して使う。

## 決定性

65 artifact（13実験×5variant）と評価JSONを2回生成し、バイト一致。

## 限界・適用範囲

- B の発火には、根の右に規則的な階段（placed クラスタ run 3つ以上）が要る。本件は階段が4クラスタあり、発火した。階段が少ない小文書では発火しないことがあり得る（その場合は OUT-OF-SCOPE。規則は緩めない）。
- 「single-organization PDFs are solved」とは書かない。確認できたのは、(MHLW・METI・MEXT の narrow 3件) + 農水省復興特会 + MLIT 復興特会（計5件）で、規則Bが適用条件を満たしたとき安全に根を置けたこと。
- 実PDFで「ヘッダ衝突がある single-organization 文書」での B の挙動は未検証（B の根側条件のため、ヘッダの根レベルが左にあると B 単独は効かない。合成テストのみ）。
- MLIT 復興特会の detail は4頁。規則Bの確認は1文書（追加holdout1件）で、母数は小さい。

## evidence label

**CONFIRMED-WITH-SCOPE**。次の探索（A2）が B に与える影響はない。B+A2 の統合評価は、A2 単独が新規 holdout を通過した後の別実験。
