# MOF × 概算要求の突合 — NO_CANDIDATE の診断（記述）の契約

状態: 数える前に commit する。**記述のみ。突合の規則・出力は変えない。** 対象: 突合の M1（項）と M2（事項）で `NO_CANDIDATE`（名称が MOF と完全一致しない）になった行が、なぜ一致しなかったかを、固定した分類で数える。

## 分類（上から順に最初に当たったもの）
入力: `tests/fixtures/mof-budget-request-match/{2024,2025_teishutsu}/{m1-kou,m2-jikou}.csv`（`status = NO_CANDIDATE`）と、同じ版の MOF の `kou-*.csv`・`jikou-*.csv`。範囲（scope）は、M1 は出力の `request_scope`（一般＝`所管|組織`、特別＝`特別会計|勘定`）の MOF の項、M2 は `mof_kou_row` の項の MOF の事項。
診断用の正規化 `n`（突合には使わない）: NFKC のあと、空白・`（）()「」『』・、，,．.‑-` を除く。
1. `exact_elsewhere`: 空白を除いた完全一致の名称が、同じ種類（項／事項）の MOF の表の**別の範囲**にある（範囲の例を最大 3 つ記録）。
2. `variant_in_scope`: 範囲の中に、`n` が一致する名称がある（完全一致ではない）。
3. `prefix_in_scope`: 範囲の中に、`n` で一方が他方の接頭辞になる名称がある（短い方が 4 文字以上）。
4. `absent`: 上のどれにも当たらない。
`variant_in_scope`・`prefix_in_scope` は、最も近い MOF の名称を記録する。

## 出力
`docs/inventory/mof-budget-request-match/no-candidate-diagnosis.csv`（行ごとの分類）、`no-candidate-diagnosis.json`（版・層・分類ごとの件数）。`scripts/research/diagnose-mof-budget-request-no-candidate.py` を実行前に commit する。
