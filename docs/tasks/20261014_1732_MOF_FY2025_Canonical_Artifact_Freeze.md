# MOF FY2025 canonical jikou artifact の凍結

状態: 手順（実行前に下の「手順と STOP 条件」を commit で固定し、結果はその後に追記する）。X anchor の候補数・一致率は計算しない。明細表 pipeline の FY2025 適用は別 Task。

前提: #456（adapter を FY2024 で V2 と同値と確認し凍結、GO）。#455（FY2025 PDF corpus の凍結）。ChatGPT レビュー（ユーザー経由）で、この段階を artifact の凍結だけに分けることが決まった。

## 手順と STOP 条件（実行前に固定）
- 入力: `public/data/mof-jikou-2025.json.gz` SHA-256 `634a4166e84590dd1320691519f6a2bc4b5212d613c5fdbce1cb6a382ba686a5`。adapter `scripts/research/mof-v1-jikou-adapter.py` SHA-256 `ea08c9c546d325171f1f3a9fb2241821eb37ddf89eb8e6271f9883d0c2f0e00b`。どちらも実行前に照合する。adapter のコードは変えない。
- 実行: `python3 -I scripts/research/mof-v1-jikou-adapter.py emit 2025 <out>` を、別々の出力先に2回実行する。
- 記録: レコード数と出力の SHA-256。出力は `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl`（git 管理外）に置き、凍結値として本 doc に書く。
- **STOP:** 入力 hash の不一致 / 0件 / missing・null field（adapter が STOP を出す）/ 2回の出力の bytes が違う（非決定的）/ FY2025 にしか要らない処理が必要になる。どの場合も、adapter を直さずに研究判断に戻る。
- 記述として載せるのは件数と hash だけ（P0 doc で V1 metadata から既に分かっている 1,287 件との照合を含む）。値の分布や X anchor に関わる集計は出さない。
