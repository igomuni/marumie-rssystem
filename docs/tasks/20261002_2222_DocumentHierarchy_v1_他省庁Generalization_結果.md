# DocumentHierarchy v1 他省庁 Generalization 結果

**全体結論: `PARTIAL`**（事前固定の基準・事前固定の照合。4つの省庁×viewのうち SUCCESS は1つ）。v1 は変更していない。事後に追加した診断用の照合（`posthoc`）でも `PARTIAL`（SUCCESS 3 + PARTIAL 1）。

| 省庁 × view | 事前固定の判定（判定に使う） | 事後診断（判定に使わない） | 分類 |
| --- | --- | --- | --- |
| METI summary（物理p5–8） | FAIL（照合の限界で見つからない34/87） | SUCCESS | A |
| METI detail（物理p9–106） | FAIL（false parent 19は組織の照合不能が原因） | PARTIAL（edge 80/82 だが level が1段ずれ depth 0/87） | **B** |
| MEXT summary（`_02` p1–8） | FAIL（見つからない80/186） | SUCCESS | A |
| MEXT detail（`_03` p1045–1339） | **SUCCESS** | SUCCESS | A |

## 対象・freeze・GT・contamination

- 対象: METI `ippan_o.pdf`（MHLWに比較的近い。1文書で目次・総表・明細）、MEXT 分割配布（目次 `_01`・総表 `_02`・明細 `_03`。MHLWと明らかに異なる）。範囲・選定理由は実験計画（`…_他省庁Generalization_実験計画.md`、コミット `ae86ae5`）に v1 実行前に固定。
- freeze した v1: schema `budget-request-document-hierarchy-poc/v1`、PR #363 merge commit `e5f2b7f`、`indentClusterGapFactor=0.25`、`minClusterSupport=2`。**推論ライブラリ（`budget-request-document-hierarchy.ts`）の差分は空**。MHLWの既存テスト・評価は不変（MHLW の評価を再実行して 15/15・20/20 のまま）。
- GT: 各PDFの目次を poppler の `pdftotext -layout`（pdf.jsとは独立）で左右の列に分けて機械的に転記。独立チェック: 要求番号が1からNまで連続、印字開始頁が単調非減少、全ての項に要求が1件以上。METI 5組織/32項/50要求（87ノード）、MEXT 4組織/69項/113要求（186ノード、明細範囲の48ノードを明細viewで採点）。v1実行前にコミット済みで、実行後に変更していない。変換スクリプトは scratch でコミットしていない（fixtureが成果物）。目視確認は抜き取りのみ。
- contamination（開示）: 範囲決定のため目次と先頭付近・組織境界のヘッダ文字列を目視した。v1 の結果は見ていない。METI 物理p9 と MEXT `_03` 物理p876 は過去のPoCのGolden Sample（METI p9 は範囲内）。development/holdout は置かず、全て out-of-sample。

## 結果（x/N。判定の母数は範囲内のGTエッジ）

事前固定の照合（summary はモードB=形・コード+名称前方一致。モードA=頁数列は下記）:

| 実験 | exact parent | false | unresolved | not found | ancestor | depth | nodes matched |
| --- | --- | --- | --- | --- | --- | --- | --- |
| meti-summary | 34/82 (41.5%) | 14/82 | 0/82 | 34/82 | 19/82 | 52/87 | 52/87 |
| meti-detail | 61/82 (74.4%) | 19/82 | 2/82 | 0/82 | 25/82 | 0/87 | 86/87 |
| mext-summary | 62/182 (34.1%) | 40/182 | 0/182 | 80/182 | 36/182 | 105/186 | 105/186 |
| mext-detail | 46/46 (100%) | 0/46 | 0/46 | 0/46 | 46/46 | 48/48 | 48/48 |

summary のモードA（MHLWと同じ頁数列の照合）は METI で 0/87 matched（BLOCKED）、MEXT で 52/186 matched（BLOCKED）。v1 の `printedPageRefCandidate` は4桁だけのtokenに限るため、METI・MEXT の1–3桁の頁数が取れない（MHLW固有の仮定）。

事後診断の照合（結果を見た後に追加した評価側の補助。名称比較を「最初の数字の手前まで」に限り完全一致優先、同じ形・コード・名称のGTが複数のときは文書順の序数で対応づけ）:

| 実験 | exact parent | false | unresolved | not found | ancestor | depth | nodes matched |
| --- | --- | --- | --- | --- | --- | --- | --- |
| meti-summary | 82/82 | 0/82 | 0/82 | 0/82 | 82/82 | 87/87 | 87/87 |
| meti-detail | 80/82 (97.6%) | 0/82 | 2/82 | 0/82 | 78/82 | **0/87** | 87/87 |
| mext-summary | 182/182 | 0/182 | 0/182 | 0/182 | 182/182 | 186/186 | 186/186 |
| mext-detail | 46/46 | 0/46 | 0/46 | 0/46 | 46/46 | 48/48 | 48/48 |

**読み方**: 事前固定の FAIL（summary の2つと METI detail）の大半は、v1 の推論ではなく**評価側の照合の限界**による（折返しで途中までしか印字されない名称、組織名で始まる項名、同一コード・同名の項）。ただし事後診断は結果を見て追加したものなので判定には使わない。序数の対応づけはGTの文書順に依存するため、nodes matched を厳密な独立確認と読まず、ノード数がlevel別にGTと完全一致している（METI 5/32/50、MEXT 4/69/113）ことと合わせて読む。METI detail の level のずれ（depth 0/87）は評価の問題ではなく、v1 の推論側の失敗（下記）。

## indent cluster 観測

- summary: METI・MEXT とも x=62.1 / 65.6 / 69.0（MHLWと同一の格子）。placed、level別 node 数は 5/32/50 と 4/69/113 で、GTの組織・項・要求の数と一致。unplaced 0。
- detail（METI）: 51.765（組織5）/ 58.66（項32）/ 65.57（要求50）/ 72.47（目205）/ 79.37（子目100）と、**37.982（n=2）が最初のクラスタとして加わる**。MHLW と同じ格子に、余分な根が1つ。
- detail（MEXT 030・040）: 51.765（2）/ 58.67（19）/ 65.57（27）/ 72.47（55）/ 79.37（106）。右側の備考欄に x=514–601 の6クラスタ（level 6–11）。主階段の件数 2/19/27 はGTと一致。MHLWと同じ明細の格子で、**分割配布でも明細・総表それぞれの階段は変わらない**。

## GT外 heading candidate（事前固定の照合は照合の限界で多く見えるため、事後診断の件数で報告。判定には使わない）

| 実験 | GT外 | 内訳 |
| --- | --- | --- |
| meti-summary / mext-summary | 0 / 0 | すべてGT内に対応（事前固定の照合では 35 / 81） |
| meti-detail | 307 | level 5: 205・level 6: 100（左側本文の目・子目。left_body 305）＋ **level 1: 2（page header/footer band。「100 経（中）」「102 経（中）」）** |
| mext-detail | 192 | 左側本文（level 4–5）161、右側備考・計算表（level 6–11）29、unplaced 2（右側） |
| meti-detail-narrow | 30 | left_body 30 |
| mext-detail-narrow | 108 | left_body 100、右側 8 |

x帯・ページ上下端（上8%・下6%）による記述的な分類で、判定には使っていない。表内部の行は左側本文に含まれる（分離できていない）。

## single-organization sensitivity（直さない）

| 範囲 | 通常範囲 | 狭い範囲（根見出し1件） |
| --- | --- | --- |
| METI 組織035（p66–81） | 同組織のedge 4/4 exact、ancestor 4/4 | exact 2/4、**unresolved 2/4**、ancestor 0/4、depth 0/5。根のクラスタ（x=51.765）が n=1 で unplaced、項が level 1、要求が level 2 になる |
| MEXT 組織030（p1045–1259） | 31/31 exact、depth 32/32 | exact 17/31、**unresolved 14/31**、ancestor 0/31、depth 0/32。根（n=1）が unplaced で項が level 1、要求が level 2 |

**MHLWと同じ failure が再現**した（再現する）。false parent は出ない。v1 の既知の制約として確認。

## cross-page behavior

| 実験 | 親が別ページの resolved edge | 最大 logicalRowsBetween | 最大 pagesBetween |
| --- | --- | --- | --- |
| meti-summary | 12 | 58 | 1 |
| meti-detail | 208 | 1,884 | 54 |
| mext-summary | 52 | 157 | 4 |
| mext-detail | 156 | 6,758 | 214 |

document-order stack がページ・数千行を越えて親を保持する挙動は METI・MEXT でも成立した（MHLW 最大4,044行）。

## Failure examples と MHLW との相違

1. **ページヘッダの見出し形状への衝突（METI detail）**: 偶数頁のヘッダ「`100 経（中）`」（印字頁100 + 組織略称）が形A（先頭3桁+後続）に一致。物理p104・p106 の2行が x=37.98 に同じ段を作り、支持2で placed となって level 1 になる。→ ①組織・項・要求が level 2/3/4 になり depth 0/87（体系的なずれ）。②level 1 のヘッダが stack で本来の組織060（level 2）を押し出し、その後の項 063（p105）・080（p106）の親が `level_gap`（→ ancestor 5/9）。false parent にはならない。MHLWは頁番号が4桁（x が違う）でこの衝突が起きなかった。
2. **頁数列の候補は4桁限定**: METI・MEXT の総表の頁数は1–3桁が多く取れない（モードAが BLOCKED）。MHLW固有の仮定。
3. 照合の限界（評価側）: 事前固定の照合では METI detail の組織 010 が項 010（名称が組織名で始まる）と曖昧になり、子の項19件が false parent と記録された（実際はGT外判定の誤り）。
4. 総表の名称が折返しで途中までしか印字されない、MEXT で同コード・同名の項（`060 初等中等教育振興費` が本省とスポーツ庁）がある。

違わなかった点: 見出し形状（3桁 / 要求番号+NN-NN）、x階段の格子（総表 62.1/65.6/69.0、明細 51.8/58.7/65.6/72.5/79.4）、ページをまたぐ stack の成立は、METI・MEXT でも同じ。

## stop condition の該当

- **METI detail は該当**: 「single-support 以外で level が体系的にずれる」（ページヘッダによる余分な根レベル）。v1 の failure として止め、v2 は実装していない。
- METI summary・MEXT summary・MEXT detail は該当なし。false parent が構造的に発生した省庁・view もない（事後診断で false 0）。GT を見ないと直せない規則・コード/名称の lookup も、v1 の推論側では必要にならなかった。

## v2 candidate（仮説。コードは変更しない）

1. **Observed failure**: ページヘッダが見出し形状に一致して根レベルを作る。Evidence: METI p104・p106 の `100 / 102 経（中）`、level 1 のクラスタ n=2、depth 0/87、組織060 の押し出しで項 063・080 が level_gap。Likely violated v1 assumption: 先頭3桁のtokenは見出し（コード）だけ。Possible v2 direction: ページ上下端の行・ヘッダ位置の行を見出し候補から外す、またはlevelを「根の支持」ではなく連続する階段の隣接で置く。Risk of overfitting: METIの3桁頁番号1例に合わせた除外になりやすい。Additional sample needed: 1,000頁未満の他省庁（3桁頁番号）、ヘッダ位置が違うPDF。
2. **Observed failure**: single-organization で根が unplaced → level ずれ（MHLW・METI・MEXT で再現）。Possible v2 direction: `minClusterSupport` を根にも一律に適用する代わりに、等間隔の階段の連続性（1em刻み）から根を置く。Risk: 階段が等間隔でない文書で偽の根を作る。Additional sample: 組織が1つしかない小さな省庁の文書。
3. **Observed limitation**: 頁数列の候補が4桁限定。Possible v2 direction: 数字桁数ではなく頁数列の x 帯（総表で繰り返す右端の列）から取る。Risk: 総表の列構成に依存。Additional sample: 頁数列がない総表。

## 次に追加すべきサンプル

1. 1,000頁未満で3桁頁番号を持つ他省庁（ヘッダ衝突の再現確認）。2. 組織が1つの小規模な文書（single-organization の実例）。3. 目次・総表の体裁が違う文書（courts・cas など）。4. 分割配布の別例（MEXT 以外）。

## 検証・成果物

- 実験計画・GTのコミット `ae86ae5`（v1実行前）。runner `extract-budget-request-document-hierarchy-generalization.ts`、評価 `evaluate-budget-request-document-hierarchy-generalization.ts`、評価lib `budget-request-document-hierarchy-eval.ts`（`nameOnly`/`ordinalTiebreak`/`verdictOf` を追加。既定の挙動は不変）、テスト `budget-request-document-hierarchy-generalization.test.ts`、GT fixture `tests/fixtures/budget-request-document-hierarchy/2024/{meti,mext}-toc-hierarchy-gt.json`。出力は `data/work/budget-request-document-hierarchy/2024/generalization-v1/`（6つの推論artifactと `evaluation-v1.json`。2回生成して7ファイルがバイト一致）。
