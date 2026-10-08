# FY2024 概算要求 TOC A 層 — Header-Zone Right-Row H1 Development-Only Implementation

実装: `scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts`（`assembleTocPageH1`）。結果: `tests/fixtures/budget-request-toc-row-assembly-header-zone-right-row-h1/2024/`（`development-synthetic.json` / `development-result.json` / `development-differential.json`）。

**development-only。** #398 の preregistration をそのまま実装し、explored development 34 page と synthetic のみで評価した。#396 の held-out 23 page と将来 held-out（残り page）には H1 を実行していない（trigger census・visual inspection・GT 作成・output preview も 0）。「#396 の 10 severe が直る」確認は行っていない。judgment = `READY_FOR_H1_DEVELOPMENT_FREEZE_AND_NEW_HELDOUT_GT`（H1 を実装でき、許可された development evidence で falsification されなかった。次に implementation freeze + 新 held-out membership / GT へ進める、のみ。H1 の安全性・有効性の GO ではない）。

## 実装

- #393 の frozen source は byte 不変（`f3b726f8…636dd`）。H1 は別 version の copy で、差は H1-BEGIN / H1-END で囲んだ 1 ブロックと関数名・先頭 comment のみ（テストで機械検証）。
- trigger（#398 のまま）: ASSEMBLED_SPLIT で E 解決済み／frozen header zone 内／`line[E:]` が frozen の row-start token pattern（REQUEST / MARKER / OTHER_CODE）で始まる／body と同じ boundary safety（BOUNDARY_CONFLICT_LINE でも BOUNDARY_CROSSING でもない）。literal・page・line index・GT 値の条件なし。
- 出力: LEFT = `line[0:E]` を TITLE_OR_HEADING（RESOLVED、column LEFT、provenance 保持）、RIGHT = `line[E:]` を body と同じ frozen classifier（新 row kind・新 abstention reason なし）。出力順は LEFT → RIGHT。H1 RIGHT unit は frozen fragment 規則どおり owner 候補になり得る（特例なし）。tokenless fragment の特例なし。

## synthetic（15 case）

positive 6（request / marker / OTHER_CODE / LEFT text / LEFT blank / RIGHT unit が fragment owner になる）、negative 9（page-title 右 text・列見出し右 text・tokenless・boundary conflict・boundary crossing・UNSPLIT・PAGE_ABSTAINED・header zone 外・E より左のみ）。全て期待どおり（trigger 判定、分割位置 E、non-trigger は #393 と出力完全一致、許可外差 0）。LEFT blank の case は行頭が row-start token になるため header zone ではなく（T2 を満たさず）frozen と同じ出力になる。

## development 34 page

| 項目 | 値 |
|---|---|
| trigger 行 / page | 19 / 10 |
| token 種別 | REQUEST 12 / MARKER 7 / OTHER_CODE 0 |
| negative-control 行（E 以右に text、token なし） | 50（whole-line のまま） |
| 期待 split / 実 split | 19 / 19（trigger 不一致 0） |
| false split / provenance mismatch / 無関係な出力変化 / page state 変化 | 0 / 0 / 0 / 0 |
| abstention の変化 | なし |
| declared downstream fragment-owner 効果 | 0 |
| baseline と出力が同一の page | 24（残り 10 page は trigger 行のみ変化） |

`DEV_SYNTHETIC_ONLY` ではない（development corpus に positive trigger がある）。ただし development に visual GT はなく、機械的な trigger / 差分 oracle のみ。falsification なし。

## 限界

- development の positive は機械 trigger のみで、視覚 GT による正しさは確認していない。有効性・安全性は新 held-out の formal evaluation まで主張しない。
- declared downstream effect（fragment owner）は development corpus で 0 件。synthetic でのみ確認した。
- tokenless fragment の既知限界は残る（H1 の対象外）。
- GT は同一 agent の作成。`UNRESOLVED_ACCEPTANCE_THRESHOLD` は未決のまま。

## 次

H1 source hash（`development-result.json` の `h1.sourceSha256`）を freeze したうえで、新 held-out（#396 の 23 と development 34 を除く残り）の machine-only selection と visual GT freeze へ。development 評価後の code 変更は禁止（必要なら別 revision / 別仮説）。
