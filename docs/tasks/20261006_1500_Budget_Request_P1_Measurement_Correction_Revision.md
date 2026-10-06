# P1 measurement correction の訂正（correction of the correction）

2026-10-06。`0b4fd07` の correction（`20261006_1440_…_Measurement_Correction.md`・`p1-measurement-correction.json`）の一部を撤回・訂正する。original の 7 commit と `0b4fd07` は書き換えない。訂正値は `tests/fixtures/budget-request-mof-reconciliation/2024/p1-measurement-correction-v2.json`（`evaluate-budget-request-p1-measurement-correction-v2.ts`）。

## 1. 指標の整理

`parentExactUnique`（request 名の有無を問わず、親の項が MOF exact_unique）と `comparableRequests`（親が exact_unique かつ request 名があり、request 自身を照合できた件数）は別の指標。

| | P1 | full-corpus（一般会計） |
|---|---:|---:|
| `parentExactUnique` | 68 | 115 |
| `comparableRequests` | 59 | 101 |
| request exact_unique | 56 | 98 |
| 比較可能内の exact rate | 94.9%（56/59） | 97.0%（98/101） |
| P1 §7 の条件付き exact rate（exact ÷ `parentExactUnique`） | **82.4%（56/68）** | 定義なし |

## 2. 訂正の内容

- **P1**: 補正の対象は preregistered な条件付き exact rate のラベルと denominator の意味。original は 59（比較可能な request）を「親が exact_unique」の件数として `parentExactUnique` と呼び、94.9% を §7 の条件付き rate として報告した。94.9% は比較可能内の exact rate としては正しく、§7 の定義どおりの値は 82.4%（56/68）。
- **full-corpus**: `0b4fd07` の「同じ measurement bug があった」「97.0% → 85.2%」「gate 入力 101 → 115」を撤回する。full-corpus の preregistration に「親が exact の条件付き rate」の定義はなく、funnel・gate の「比較可能な request」（§7・§8）は名称あり＋親まで解決した 101 件。98/101 = 97.0% は正しく、original の記録のまま。98/115 = 85.2% は参考値で、評価指標ではない（artifact では `referenceOnly`、`preregisteredConditionalExactRate` は null）。
- 前版 artifact `p1-measurement-correction.json` は書き換えない（hash を v2 に記録）。前版の `fullCorpus.correctionRequired: true` と gate の `correctedParentExactUnique` は撤回対象。

## 3. Decision（不変）

- P1: `GO_TO_NEXT_DESIGN`（gate は classified share と top diagnostic share。conditional rate は gate ではない）。
- full-corpus: `GO_TO_FAILURE_PRIORITIZATION`。gate 入力は 101 ≥ 30（失敗 PDF 8 < 21）。re-computed も同じ。

## 4. 下流の記述

- P1 Result の `94.9%` は「親が解決した request での条件付き exact rate」ではなく、比較可能内の exact rate と読む（§7 の値は 82.4%）。
- full-corpus Result の `97.0%（98/101）`・「比較可能 97.0%」・「P1 と同程度」は original のまま有効。ただし対比するなら P1 の比較可能内 94.9% と full-corpus の 97.0%（どちらも比較可能内）で行う。

## 5. Claim boundary

measurement / reporting の訂正までで、抽出品質・request と MOF の意味的な対応・full-corpus の一般 recall について新しい主張はしない。
