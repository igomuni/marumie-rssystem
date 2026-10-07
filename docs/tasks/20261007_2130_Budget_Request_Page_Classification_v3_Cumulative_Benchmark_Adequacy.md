# 概算要求 Page Classification v3 — Cumulative Benchmark Adequacy

classifier 未実装・未評価。新規 GT なし。v0/v1/v2 の artifact と v3 preregistration（commit `baaa55a`）は変更していない。v0 classifier specification は変更なし。

## 判定（訂正済み）

```text
mechanical adequacy observation: PASS（core / DIRECT / CONTINUATION の threshold を機械的に充足）
preregistered evaluation status: INVALID / STOP
reason: cumulative result observed before preregistration freeze
open-set safety: NOT EVALUATED
```

**INVALID / STOP — preregistration freeze 前に cumulative result（dry-run）を観測したため。Mechanical adequacy criteria themselves were satisfied.**

当初この doc と PR は `ADEQUATE / STOP FOR REVIEW` と記載したが、レビューで訂正した。mapping・threshold を結果で変更していなくても、結果を見た後に preregistration を commit した以上、preregistration としての独立性は失われている。したがって「事前登録した threshold を未知の結果が満たした」証拠には使えない（特に STAFFING continuation = 5 は、5 件で通ることを確認してから preregistration した。threshold 自体は v2 から継承）。431 件の cumulative benchmark 自体は **post-hoc / descriptive benchmark** として保存する。v4 で同じ 431 件を再度 preregister しても、結果を既に知っているため独立性は回復しない。

この判定は fresh held-out の実証でもない。v0・v1・v2 の過去判定（INSUFFICIENT）を GO に読み替えない。

追加の手続き逸脱: PR #383 head `967bcd5` は squash merge のため main の ancestor ではなかった（tree/diff 同一は確認済みだが、指示では不一致時 STOP）。

## 手順上の開示

preregistration commit の前に、fixture を書かない dry-run を 1 回実行して結果を見た（preregistration doc §2 に記載済み）。mapping・threshold は実行前に固定し、その後変更していない。この判定は「結果を見る前に凍結した評価」ではない点を割り引いて読むこと。

## cumulative benchmark

- source rows: v0 172 / v1 89 / v2 170、unique 431、pairwise overlap 0、duplicate / ambiguous join 0、hash mismatch 0（Raw Text manifest・candidate/GT 双方）。
- original role: v0 DEVELOPMENT 142 / v0 FROZEN_EVALUATION 30 / v1 FROZEN_EVALUATION_V1 89 / v2 FROZEN_EVALUATION_V2 170。role は昇格・変更していない。
- GT family: COVER 32 / TOC 50 / SUMMARY 74 / DETAIL 231 / STAFFING 32 / PRIORITY_SUMMARY 1 / PRIORITY_DETAIL 11。OTHER・UNRESOLVED は 0。

## adequacy（threshold は v2 から不変）

| 項目 | 閾値 | 結果 |
|---|---|---|
| core 各 family | ≥10 | COVER 32・TOC 50・SUMMARY 74・DETAIL 231・STAFFING 32 → 充足 |
| DIRECT matched（machine family == GT） | core 各 ≥5 | COVER 32・TOC 28・SUMMARY 32・DETAIL 31・STAFFING 25 → 充足 |
| CONTINUATION matched（activeStateFamily == GT） | 各 ≥5 | TOC 19・SUMMARY 31・DETAIL 36・**STAFFING 5** → 充足（STAFFING はちょうど閾値） |

PRIORITY_*（rare form limitation・STOP 条件外・評価済みとは扱わない）: PRIORITY_SUMMARY は GT 1（direct matched 1、continuation 0）、PRIORITY_DETAIL は GT 11（direct matched 1、continuation matched 10）。

## 読むときの注意

- STAFFING continuation の 5 は、v2 の 1 と v0 の 4（v0 DEVELOPMENT 3・v0 FROZEN_EVALUATION 1）の合算。**v2 単独の INSUFFICIENT は、v0 の evidence を足して初めて解消した**。余裕はゼロで、1 row でも欠ければ INSUFFICIENT だった。
- TOC continuation の v1・v2 以外の割合、DETAIL・SUMMARY の evidence は v0 DEVELOPMENT を含む。DEVELOPMENT row は classifier 実装時の sanity check 用に既に見られている可能性があり、cumulative benchmark に含めた結果は「実装前に既知の evidence を含む benchmark」である。
- 全 431 row の GT と machine evidence の family 一致は DIRECT・CONTINUATION stratum で観測済みの事実であり、classifier の性能を意味しない。

## 次

431 件は development / regression benchmark（descriptive）として扱える。事前登録された一回評価の根拠としては使えない。classifier の実装・評価はこの PR では行わない。
