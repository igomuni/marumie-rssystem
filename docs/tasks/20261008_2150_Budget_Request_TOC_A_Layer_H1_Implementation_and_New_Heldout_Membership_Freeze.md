# FY2024 概算要求 TOC A 層 — H1 Implementation Freeze + 新 held-out Membership Freeze

成果物: `tests/fixtures/budget-request-toc-row-assembly-header-zone-right-row-h1/2024/` の `implementation-freeze-manifest.json`（`H1_IMPLEMENTATION_FROZEN`）/ `new-heldout-membership.json` / `new-heldout-membership-freeze-manifest.json`（`NEW_HELDOUT_MEMBERSHIP_FROZEN`）。

**固定のみ。** H1 のコード変更なし、新 held-out への H1 実行・trigger census・raw text / PDF / render の閲覧・visual GT・目視・評価はいずれも 0。judgment = `READY_FOR_NEW_HELDOUT_VISUAL_GT_FREEZE`（次 unit で新 25 page の visual GT freeze を始めてよい、のみ。H1 の安全性・有効性・formal evaluation の GO ではない）。

## A. H1 implementation freeze

- H1 source `scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts` sha256 `ea6af6de…78343`（#399 から不変）、entry point `assembleTocPageH1`。#393 source `f3b726f8…636dd`、H1 prereg `0c3a377b…1b27` も不変。
- development result `69bf5611…14670`・synthetic `a7ea9e41…cc167`・differential `66023941…95fa`、関連 test・script の hash、#391 / #395 / #396 / #397 の dependency hash、runtime（node / vitest / typescript / tsx）を manifest に固定。development judgment = `READY_FOR_H1_DEVELOPMENT_FREEZE_AND_NEW_HELDOUT_GT`（trigger 19 行 / 10 page、falsification 0）。held-out 実行は #396 の 1 回のみ。

## B. 新 held-out membership

`NEW_HELDOUT = TOC_82 − DEVELOPMENT_34 − FIRST_HELDOUT_23`（#398 で preregister した「残り全件」）。

| 項目 | 値 |
|---|---|
| total / development / first held-out / new | 82 / 34 / 23 / **25** |
| overlap（dev–first / dev–new / first–new） | 0 / 0 / 0 |
| union / missing / duplicate role | 82 / 0 / 0 |
| DIRECT / INHERITED（導出後の記録のみ） | 22 / 3 |
| membership digest | `06c2e68d7ac178e7e0561d16976c47936ab9d52b59d91710cab145fa8822ab28` |
| membership file sha256 | `7c238b9b…38d06` |

- **導出**: 集合差のみ。sampling なし。trigger 有無・publisher 比率・positive/negative 比率で選んでいない。導出 script と lib は `fs` / `path` / `crypto` のみを import し、raw text・parser・PDF・render・H1 に依存しない（テストで import 一覧と禁止 identifier を機械検証）。再導出は決定的（同一 digest）。
- **使った field**: `localPdfPath` / `physicalPage` / `classifierSource` / explored 判定の identity のみ（whitelist）。82 page の identity 一覧として #390 の candidate-inventory を読むが、同 file にある機械 feature は whitelist 投影の時点で捨てており、使用・出力・観測をしていない。
- positive-trigger の有無は調べていない（#398 のとおり、GT freeze 後の formal evaluation まで未知。0 なら `H1_UNVALIDATED`）。DIRECT 22 / INHERITED 3 の偏りは descriptive な記録で、membership は変更しない。

## 引き継ぎ（次 unit）

H1 implementation freeze manifest / 25-page membership file と digest / derivation method / contamination = none / 新 held-out への H1 実行 = 0 / 目視 = 0 / GT rows authored = 0。次 unit で初めて新 25 page 全件を visual-only annotation の対象にする。H1 の実行はその後。

## 限界

新 held-out は #396 の held-out と同じ publisher の別 page を含み得るため独立性は限定的。GT は同一 agent が作る。`UNRESOLVED_ACCEPTANCE_THRESHOLD` は未決のまま。
