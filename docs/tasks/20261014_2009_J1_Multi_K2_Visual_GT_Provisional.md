# J1 複数 × K2 blind visual GT — annotation A/B・adjudication・provisional GT（凍結前）

状態: **provisional（未凍結）。評価はしていない。** A/B の annotation と、食い違った行の adjudication を経て、147件の provisional GT を作ったところで STOP した。次は ChatGPT の pre-freeze review。K2・MOF・parser・primary scope とは、何も照合していない。

事前登録: `docs/tasks/20261014_1902_J1_Multi_K2_Visual_GT_Preregistration.md`（Phase 0 commit `bfbdb00`）。

## Phase 0（annotation の前に commit）
- 指示書: 項のコードを「2桁または3桁 `NN[N]`」に直した。`annotation-instructions.md` SHA-256 `100fe50ba3b6e87bc7972c5499d14f64ebe14aa88d59ab2d98a850e491ac7684`。
- primary scope: `primary-scope.csv` SHA-256 `1194cb43b49bf5edf7aa2483c71bc821fd78d20bd8f866ab4961ff925a135301`。`primary_w5` は 102/147（immediate 54・anchor 48）で、期待どおり。annotator・adjudicator には渡していない。
- §5: GO = FAIL 0 かつ PASS / primary >= 0.95、STOP = FAIL >= 1、INCONCLUSIVE = それ以外。

## 実行（Orca Run `run_608f7fc06294`）
- 隔離: annotator ごとに、リポジトリ外のフォルダ（`gt-j1-multi-k2-2025/annotator-{a,b}`）を Orca の folder workspace として登録した。中身は指示書・`annotation-targets.csv`・`render-manifest.json`・PNG 461枚だけ。PNG は凍結 render からコピーし、全件の SHA-256 を manifest と照合した（不一致 0）。rerender はしていない。
- annotator A: Task `task_1d34fddbced6` / Dispatch `ctx_6403ee8dcd6c`。annotator B: `task_b4f934929091` / `ctx_bbd4043fbfbd`。どちらも Codex（gpt-6-luna、effort high）で、並列・独立に実行した。
- 実行中の質問: B が「147件を全部目視で続けるか」を（再送を含め2回）聞いてきたので、全件続けるよう答えた。頁が重なる target では観察を使い回してよいが、判定は1件ずつ行う、とも伝えた。A は「事項の下の `001`/`003` 行の扱い」を聞いてきたので、指示書の範囲で答えた（それらは細目で項ではない。項は上方にある。判断は紙面の構造で行い、一意でなければ AMBIGUOUS）。どちらの回答も、もう一方の annotator に同じ文面で送った。parser の情報は伝えていない。
- adjudicator: Task `task_29dc7df7b6da` / Dispatch `ctx_fe6cbe1e5b3a`（Codex、gpt-6-luna、effort high）。別の隔離フォルダに、食い違った102件の target 行・A/B のラベル・指示書・それらの窓の PNG 277枚（hash 照合済み）だけを置いた。
- 3体とも worker_done（succeeded）を受け取り、terminal を解放した（解放待ちの terminal は 0）。

## 結果（形式と件数だけ）

| | RESOLVED | AMBIGUOUS | UNREADABLE | NOT_IN_WINDOW |
|---|---:|---:|---:|---:|
| A | 43 | 8 | 0 | 96 |
| B | 92 | 34 | 0 | 21 |
| adjudication（102件） | 72 | 30 | 0 | 0 |
| **provisional（147件）** | **100** | **30** | **0** | **17** |

- 形式検証: A・B・adjudication とも、ヘッダ、target の集合、重複なし、先頭5列の一致、状態の値、RESOLVED のときだけ項コードと項名がある、をすべて満たした。
- A/B の exact な一致（状態が同じで、RESOLVED なら項コードと項名も同じ）: **45/147**（RESOLVED 28、NOT_IN_WINDOW 17）。食い違い 102（そのすべてを adjudication に回した）。
- 食い違いの内訳（A, B）: (NOT_IN_WINDOW, RESOLVED) 47、(NOT_IN_WINDOW, AMBIGUOUS) 32、(RESOLVED, RESOLVED でラベルが違う) 10、(AMBIGUOUS, RESOLVED) 7、(RESOLVED, NOT_IN_WINDOW) 3、(RESOLVED, AMBIGUOUS) 2、(AMBIGUOUS, NOT_IN_WINDOW) 1。
- 両方 RESOLVED でラベルが違う10件には、別の項を選んだもの（例: T035 の `062` と `067`）と、長い項名の写し方の違い（T105〜T107）がある。
- provisional GT: A/B が一致した45件はその共通ラベル、残りの102件は adjudication のラベル。`label_source` 列（`ab_agreement` / `adjudication`）を末尾に足した。

## pre-freeze review で見てほしい点（想定外を含む）
- **A/B の一致が低い（45/147）。** とくに NOT_IN_WINDOW の判断が大きく割れた（A は 96、B は 21）。A は「窓の中に金額の無い項の行が見えない」ものを広く NOT_IN_WINDOW にしていた。
- **adjudication は NOT_IN_WINDOW を1件も付けていない。** 食い違った102件のうち、A が NOT_IN_WINDOW とした79件も、すべて RESOLVED か AMBIGUOUS になった。
- 項名の写し方（長い名称の折り返し）が annotator によって揺れている。凍結前に、写し方の正規化を決めるか、そのまま凍結するかの判断が要る（評価は項名の exact 一致で行う契約）。
- provisional GT には `label_source` 列があり、9列の契約より1列多い。

## 凍結値（provisional。最終の凍結ではない）
- `gt-a.csv` `0662db7610e18c2fc984aa232fc41f13032f7dbe9071f82a1efd6984ee7bde6f`
- `gt-b.csv` `16d34224e0691273c98c3bdd7157a018ed4a4083a1b7c5c89d764c1102891701`
- `gt-adjudication.csv` `aab73c3293e933cc4dfbbd825633c3006f4eec1e20c03b436d2c3b13c1bff643`
- `gt-provisional.csv` `757bd8501c7015dab85fb6bd90dd3b9e615a2a1d52d42a30ffae5ebabe447de4`
