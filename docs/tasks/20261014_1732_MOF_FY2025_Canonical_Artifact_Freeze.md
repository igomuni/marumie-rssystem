# MOF FY2025 canonical jikou artifact の凍結

状態: 凍結済み。結論: **STOP 条件に当たらず、FY2025 canonical artifact を凍結した**（1,287件、SHA-256 `9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38`）。手順と STOP 条件は実行前の commit `d4552a6` で固定した。X anchor の候補数・一致率は計算していない。明細表 pipeline の FY2025 適用は別 Task。

前提: #456（adapter を FY2024 で V2 と同値と確認し凍結、GO）。#455（FY2025 PDF corpus の凍結）。ChatGPT レビュー（ユーザー経由）で、この段階を artifact の凍結だけに分けることが決まった。

## 手順と STOP 条件（実行前に固定）
- 入力: `public/data/mof-jikou-2025.json.gz` SHA-256 `634a4166e84590dd1320691519f6a2bc4b5212d613c5fdbce1cb6a382ba686a5`。adapter `scripts/research/mof-v1-jikou-adapter.py` SHA-256 `ea08c9c546d325171f1f3a9fb2241821eb37ddf89eb8e6271f9883d0c2f0e00b`。どちらも実行前に照合する。adapter のコードは変えない。
- 実行: `python3 -I scripts/research/mof-v1-jikou-adapter.py emit 2025 <out>` を、別々の出力先に2回実行する。
- 記録: レコード数と出力の SHA-256。出力は `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl`（git 管理外）に置き、凍結値として本 doc に書く。
- **STOP:** 入力 hash の不一致 / 0件 / missing・null field（adapter が STOP を出す）/ 2回の出力の bytes が違う（非決定的）/ FY2025 にしか要らない処理が必要になる。どの場合も、adapter を直さずに研究判断に戻る。
- 記述として載せるのは件数と hash だけ（P0 doc で V1 metadata から既に分かっている 1,287 件との照合を含む）。値の分布や X anchor に関わる集計は出さない。

## 結果
- 実行前の照合: adapter `ea08c9c5…`、V1 FY2025 gz `634a4166…` とも凍結値と一致。adapter は変更なし。
- `emit 2025` を2回、別の出力先に実行した。どちらも exit 0 で、adapter の STOP（missing・null field）は出なかった。
- 2回の出力はバイト単位で同一（`cmp` 一致）。
- レコード数: 1,287。V1 metadata の `202511001` の count（1,287。P0 doc の値）と一致。
- 出力 SHA-256: `9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38`
- 置き場所: `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl`（git 管理外。この worktree に置いた）。V1 gz と adapter があれば `emit 2025` で再現でき、上の SHA-256 で照合できる。
- FY2025 にしか要らない処理は、何も必要にならなかった。

## 次（別 Task、ユーザーの GO が要る）
- FY2024 の primitive pipeline（plain text → 明細表 CSV）を、FY2025 の 131 PDF corpus（#455）にコードを変えずに適用する。FY2025 に固有の parser 変更が必要になったら、その場で直さずに STOP する。
- その後に X anchor validation（#452 の規則を変えない）。
