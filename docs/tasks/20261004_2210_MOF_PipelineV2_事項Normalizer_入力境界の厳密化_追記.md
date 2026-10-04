# MOF 事項 normalizer — 入力境界の fail-closed 化（PR #371 レビュー対応・追記）

PR #371 のレビューで、production normalizer（`normalize-mof-jikou.ts`）が frozen source set の完全性を fail-closed に保証していないと指摘された（Medium）。**parser・preregistration・oracle・既存の GO artifact・設計書は変更していない。** 設計書の「scope は frozen source set に固定」という宣言を、実装の契約として満たすための追加 commit である。

## 指摘された穴

処理対象を menu の列挙集合だけから得ており、それが frozen source set の 328 件（target 94 + non-target 234）と完全一致するかを検査していなかった。このため menu から XML が 1 本消える・menu の解析結果が 0 件になる、といった場合でも、残った集合で検証が通れば正常終了で出力できた。`--source-set=` で任意の artifact を渡せるのに、その SHA-256 を pin していなかった。

## 修正

`lib/mof-jikou-source-boundary.ts`（純関数）を追加し、生成の開始前後で次を要求する。違反は例外で、出力しない。

1. source-set artifact の bytes の SHA-256 が frozen 値（\`62df90fb…afe3\`）と一致（改変・差し替えは失敗）
2. menu が列挙する XML 集合が、artifact の target + non-target と過不足なく一致（\`checkSourceSetCompleteness\` を再利用。0 件・欠落・余剰・重複・同数の差し替えはすべて失敗）。artifact 自体の件数（94 / 234）も検査
3. 生成後の population が target 94 / not_target 234 / 事項 1,256 であること

negative test: 0 件、non-target 1 本欠落、target 1 本欠落、余剰、同数差し替え、重複、source-set 改変（hash・件数）が失敗することを確認（7 件追加）。実コマンドでも、改変した source-set を渡すと失敗することを確認した。

## 結果

通常の \`pipeline:v2:normalize:mof-jikou\` は同一入力で再実行し、\`budget-jikou.jsonl\`・\`budget-jikou-manifest.json\` の SHA-256 が integration evaluation artifact の記録と一致（出力は不変）。既存の GO artifact（\`202411001-integration-evaluation.json\`）は書き換えていない。
