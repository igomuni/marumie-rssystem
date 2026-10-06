# P1 reconciliation 条件付き exact rate の measurement correction

2026-10-06。PR #372 の review で見つかった測定の誤りの記録。original の 7 commit・preregistration・frozen result・Result doc は書き換えない（誤った値が保存されたこと自体も研究履歴）。matcher の規則・分類・PDF 抽出・frozen population は変更していない。

補正値は `tests/fixtures/budget-request-mof-reconciliation/2024/p1-measurement-correction.json`（`scripts/pipeline-v2/evaluate-budget-request-p1-measurement-correction.ts`・helper `lib/budget-request-mof-reconciliation-measurement.ts`）。

## 1. 定義と bug

P1 preregistration §7 は request の条件付き exact rate を「親が exact_unique の request のうち exact_unique の割合」と定義している。`evaluate-budget-request-mof-reconciliation.ts` は、request **自身**の classification が `parent_unresolved` / `name_unavailable` / `out_of_scope` でない集合を「親が解決した request」の代わりに使った（`parentExact` と `conditional`、および `parentExactUnique` の出力）。

matcher の判定順は out_of_scope → name_unavailable → parent_unresolved → candidate（§6）。このため request 自身が `name_unavailable` だが親の項が MOF `exact_unique` の record は、request の最終 classification だけでは親の状態を表せず、denominator から落ちた（root cause をコードで確認）。

## 2. 再計算（frozen artifact から独立に。親は parentItem.ref → item の照合結果で判定）

| 指標 | original（報告値） | 補正値（§7 の定義） |
|---|---:|---:|
| request total | 123 | 123 |
| 親の項が exact_unique の request（`parentExactUnique`） | 59 | 68 |
| その内 request exact_unique（numerator） | 56 | 56 |
| 条件付き exact rate | 94.9%（56/59） | 82.4%（56/68） |

補正値 68 の内訳は request 自身が exact_unique 56・no_exact_match 3・name_unavailable 9。`name_unavailable` の request 32 件の内、親の項が exact_unique のものは 9 件。親が exact_unique でない request は 55 件（parent_unresolved 32・name_unavailable 23）。original の 59（exact_unique 56・no_exact_match 3）は補正後 68 の部分集合。

## 3. full-corpus への影響

full-corpus の `reconciliation-result.json` の同じ指標（一般会計の request。`cond` が request 自身の classification を proxy にしている）にも同じ bug があった。

| 指標 | original | 補正値 |
|---|---:|---:|
| 親の項が exact_unique の request | 101 | 115 |
| その内 request exact_unique | 98 | 98 |
| 条件付き exact rate | 97.0%（98/101） | 85.2%（98/115） |

115 の内訳は exact_unique 98・no_exact_match 3・name_unavailable 14。original の full-corpus artifact・Result doc は上書きしない。

downstream の記述（補正が必要な箇所）:

- `20261005_0611_…_P1_Result.md`: 表の `94.9%`、結論の「親が解決した request で 94.9%」。
- `20261005_0701_…_Full_Corpus_Baseline_Result.md`: 事項の `97.0%（98/101）`、「P1 の 56/59 とは denominator が違う」、「P1（項97.7%・事項94.9%）と同程度（項97.5%・事項97.0%）」。補正後は P1 82.4%・full-corpus 85.2% で、両者の差は小さい。ただし full-corpus の 115 は一般会計の request 2,993 件の 3.8% にすぎず、P1 は評価用に選んだ 11 run の sample のため、代表性は仮定しない。
- `evaluate-budget-request-corpus-baseline-reconciliation.ts` は P1 の `conditionalExactRateGivenResolvedParent` を `comparisonWithP1` に読み込んでいる（artifact に 0.949… が残っている）。

項（item）の rate（P1 97.7%・full-corpus 97.5%）は stage 1 の指標で、この bug の影響を受けない。

## 4. Decision

- P1: `GO_TO_NEXT_DESIGN` は preregistration §9 の classified share と top diagnostic category share で決まり、conditional rate は gate ではない。frozen records から `decide()` を再実行し、original と同じ `GO_TO_NEXT_DESIGN` になることを確認した。**変更なし**。
- full-corpus: `GO_TO_FAILURE_PRIORITIZATION` は「失敗 PDF が 25% 以上」または「一般会計で比較可能な request が 30 件未満」で決まり、conditional rate は gate ではない。ただし 2 つ目の入力（101）も同じ proxy で数えられていた。補正値は 115（≥ 101 > 30）で、閾値の判定は変わらず、再計算した decision も同じ。**変更なし**。

## 5. 文書の不備

P1 Result の Frozen input で `p1-pdf-population.json` の SHA-256 が空欄（`` ``）になっている。authoritative な frozen hash は `evaluate-budget-request-mof-reconciliation.ts` の `POPULATION_SHA` で、実ファイルの SHA-256 は `f726c81b203eb22398cb7fd4c051bd059f40fea6e018a2a78a9e4babdfbd94b6` と一致を確認した。original doc は書き換えない。

## 6. 保存したもの・していないもの

- 追加: 補正 artifact・helper・helper の test・本 doc。
- 不変: original の 7 commit、P1 / full-corpus の preregistration・frozen artifact・Result doc、matcher。

## 7. Claim boundary

確定したのは measurement / reporting の補正まで。PDF 抽出の品質、request と MOF の意味的な対応、名称差の原因、hierarchy の改善方法、full-corpus の一般 recall については何も主張しない。
