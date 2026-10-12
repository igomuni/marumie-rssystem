# 総表 H1 structural hierarchy preregistration（FY2024）

指示書: `docs/chats/20261011_1820_総表CSV化/20261011_2108_Orca_H1_Structural_Hierarchy_Preregistration_GT_Review_Package.md`（ローカル、git 管理外）。前提: v0（#419）、P0 と Post-P0 research decision（#420、`20261011_1900_Budget_Request_Total_Table_Semantic_Hierarchy_P0_Failure_Isolation.md`）。

**状態: `PENDING_HUMAN_GT_REVIEW`（round 2 完了、人によるレビュー待ち）。** GT は凍結していない。resolver は実装していない。round 1 の注釈者 B が確認しきれずに AMBIGUOUS を出したため、作業手段だけを改訂して A2/B2 で再注釈した（§12）。判定基準・標本・入力は変えていない。round 2 は一致113・不一致33で、両者とも RESOLVED なのに親や範囲が違う単位が17件あった（§12.7）。

## 1. 仮説（H1）

> FY2024 概算要求総表において、各 table block の CONTEXT を structural root evidence とし、row order を基本順序、TOTAL の scope closure と extracted 7-cell amount relationships を structural constraints として組み合わせることで、page-local indentation や code width 単独に依存せず、HIER / CODE3 / DETAIL 間の parent-child relation を deterministic に復元できる。source evidence から一意に決定できない relation は AMBIGUOUS として残す。

意味ラベル（所管・特別会計・勘定・組織・項・目・要求経費）の仮説ではない。意味ラベルは H2 で扱う。

## 2. ノードと関係の契約

| ノード | status | 親候補 |
|---|---|---|
| CONTEXT（1ブロックに1つ。ID `context:<source_file>:<table_block_id>`） | `NO_PARENT` | なし |
| HIER / CODE3 / DETAIL | `RESOLVED` / `AMBIGUOUS` / `NO_PARENT` / `NOT_APPLICABLE` | 同じブロック内で、対象行より前の CONTEXT・HIER・CODE3・DETAIL |
| TOTAL | `NOT_APPLICABLE` | なし。閉じる範囲を制約の証拠として使う |

- 親は子より前に出現するノードに限り、ブロックをまたがない。
- DETAIL → CODE3（DETAIL の下に CODE3 が続く構造）は対象に含める。ただし `目` などの意味ラベルは付けない。
- HIER / CODE3 / DETAIL に `NO_PARENT` を付けるには、CONTEXT を親にできないことを示す source の証拠が必要とする。

## 3. 制約（この順に候補を絞る。証拠の強さの順ではない）

| ID | 制約 |
|---|---|
| C0 | 同じブロック・同じ CONTEXT の範囲内 |
| C1 | 親は対象行より前（後の行は親にならない） |
| C2 | TOTAL で閉じた範囲をまたいで親候補を引き継がない（範囲の確定は C3 による） |
| C3 | TOTAL の範囲は、次がすべて成り立つ候補だけを閉じた範囲の候補とする: ①同じ CONTEXT・ブロック ②行の順序で連続 ③TOTAL 直前の構造上の候補範囲 ④既知の TOTAL・ブロック境界と矛盾しない ⑤**直接の子の候補だけ**の7セルの合計が TOTAL と一致。複数の範囲が満たせば AMBIGUOUS。単一の子で同額であることは、それだけでは証拠にしない |
| C4 | 合計は直接の子だけ。`DETAIL └ CODE3` の場合、上位の親の合計に DETAIL とその子の CODE3 を同時に加えない |
| C5 | 親子のまとまりは行の順序上の連続を基本とする。ページ境界は階層の境界とみなさない |
| C6 | 行の書式（HIER / CODE3 / DETAIL）は証拠に使ってよい。ただし、コード幅だけで役割を決めず、特定の書式の組を「必ず親子」とハードコードしない |
| C7 | 字下げ・生の列位置は補助証拠だけに使う。単独で親を決めず、ページをまたいで比較しない |

否定条件（Post-P0 で凍結済み）: 字下げだけでは親を決めない。コード幅だけでは意味上の役割を決めない。金額の一致だけでは親を決めない。

## 4. 曖昧さの扱い

- **RESOLVED**: すべての硬い制約を当てた後、親候補がちょうど1つに絞られる場合だけ。
- **AMBIGUOUS**: 次のいずれかに当たる場合。
  - 候補が複数残る。
  - C3 を満たす範囲が複数ある。
  - 金額で区別できない（全0の行や、単一の子で同額の場合）。
  - 証拠が衝突し、P0 に裏付けのある決定的な決め手がない。
- **禁止する決め手**: 次のいずれも、それ単独では候補を1つに絞る理由にしない。
  - 字下げが浅い方を選ぶ
  - コード幅が広い（または狭い）方を選ぶ
  - 最も近い行を選ぶ
  - 金額が一致する方を選ぶ
  - 府省別にハードコードした意味上の規則

## 5. GT の単位と標本

### 5.1 単位

- **関係の GT（主）**: 構造上の対象ノード1つにつき1単位。項目は `source_file, table_block_id, target_row_index, target_row_type, gt_status, gt_parent_ref, evidence_notes`。
- **TOTAL の範囲の GT（副）**: 項目は `source_file, table_block_id, total_row_index, total_type, gt_scope_status (RESOLVED|AMBIGUOUS), gt_direct_child_row_indices, evidence_notes`。
- **CONTEXT の根の監査**: 主 precision の分母には入れない。

### 5.2 重複ブロック

- 主 GT の sampling frame では、block fingerprint が同じブロックを1つにまとめる。
  - fingerprint は、CONTEXT の文字列と全行の `row_type, request_no_raw, code_raw, name_compact, detail_page_raw, 7セル` の SHA-256 とする（source・ページ・行番号は含めない）。
  - 正規ブロックは `(source_file, table_block_id)` の辞書順で最初のものとし、手作業では選ばない。
- 実測: 69ブロックのうち重複は2組で、正規ブロックは67。

| 正規ブロック（残す方） | 除外した重複 | 行数 |
|---|---|---|
| `env.go.jp__content__000157012#b1` | `meti…eneju_o#b1` | 40 |
| `env.go.jp__content__000157013#b1` | `meti…eneden_o#b1` | 30 |

- 運用上の指標（全件を実行したときの status 件数・coverage）は69ブロック全件で数え、重複も両方含める。source で重み付けした precision は、必要な場合に副指標として併記する。

### 5.3 層（互いに排他。上から順に、最初に当てはまった層だけに所属する）

| 層 | 定義（P0 survey のフィールドで機械的に判定） | 母集団 | 標本 |
|---|---|---|---|
| S1 DETAIL_CHILD_CODE3 | P0 で DETAIL の下に CODE3 の内訳があると判定された DETAIL（`isDetailWithCode3Breakdown`）について、その直後から `next_type_prefix_sum_end_row_index` までの範囲にある CODE3 | 54 | 12 |
| S2 PAGE_CARRY | P0 の `PAGE_HEAD_PARENT_ON_EARLIER_PAGE` に当たる行 | 57 | 12 |
| S3 NESTED_CODE3 | CODE3 のうち `code3_page_level >= 2` のもの | 467 | 18 |
| S4 HIER | HIER | 65 | 12 |
| S5 ALL_ZERO | 7セルがすべて0 | 147 | 12 |
| S6 SINGLE_CHILD_DEGENERATION | 直前の非 TOTAL 行と7セルが同じ（親子が同額になる縮退の候補） | 752 | 12 |
| S7 SIMPLE_CODE3_DETAIL | DETAIL のうち、P0 の曖昧さフラグがなく、Rule A／B の候補が一致し、Rule A の親が同じページの CODE3 であるもの | 349 | 24 |
| S8 OTHER_COMMON | 上記のどれにも当たらない HIER / CODE3 / DETAIL | 1,431 | 12 |
| T 組織計 / 所管計 / 会計計 | TOTAL を種類別に分けたもの | 83 / 29 / 27 | 8 / 8 / 8 |
| CONTEXT_ROOT | 正規ブロックの CONTEXT | 67 | 8 |

- 合計は、関係114単位・TOTAL 24単位・CONTEXT 8単位で、50ブロックにまたがる。母集団が足りない層があっても、欠員を他の層から補わない。
- 既知の縮退2件は組織計の層に強制的に含めた（T1-001 mlit #461、T1-002 soumu #86）。どちらも、そのページで2段目の CODE3 と同額の組織計である。
- S1〜S8 の判定に Rule A／B を使っているのは、標本の枠を作るためだけである。親を決める根拠にはしない。

### 5.4 決定的な選び方

- 乱数は使わない。
- 各層で、キー `<stratum>|<source_file>|<table_block_id>|<target_row_index>` の SHA-256 を辞書順の昇順に並べ、先頭から N 件を選ぶ。CONTEXT は row_index を `0` とする。
- 組織計では、強制的に含める2件を先頭に置き、残りをハッシュ順で埋める。
- sample manifest は `review/sample-manifest.csv` で、SHA-256 は `f324854ee932728a1edee33dd4972cf1fe4be3fd1694db655443cbfc6296f8aa`。
- 2回生成して `prepare-manifest.json` が一致した。

## 6. 独立した注釈と人によるレビュー

- **A と B**:
  - 同じ標本単位と証拠のパッケージ（`annotation-input/`）を受け取る2つの独立した worker とする。
  - 相手の注釈、resolver（存在しない）、層の名前、P0 の候補規則や曖昧さフラグは見せない。
- **使ってよい証拠**: raw text、ページ境界、CONTEXT、v0 の論理行と行の順序、行の書式、7セル、TOTAL 行。
- **使ってはいけない証拠**: Web、PDF の目視、MOF・RS などの外部知識、意味ラベルからの推測、計算による値の補完。
- raw text で一意に決まらない単位は AMBIGUOUS とする（PDF で救済しない）。
- **一致の定義**:
  - 関係: status が同じで、RESOLVED の場合は parent_ref も同じ。
  - TOTAL: scope_status が同じで、RESOLVED の場合は直接の子の集合も同じ。
  - 一致した単位は `CONSENSUS_CANDIDATE` と呼び、まだ GT ではない。
- **人によるレビューの方針**（GT を凍結する前に行う）:
  - 不一致の単位は100%レビューする。
  - 一致した単位は、層ごと（TOTAL の種類ごとを含む）に `AUDIT|<sample_id>` の SHA-256 の昇順で `ceil(n/4)` 件を監査する。
  - CONTEXT の8件は全件レビューする。
  - 監査で consensus candidate の誤りが1件でも見つかった層は、その層の全単位をレビューする（escalation）。
- **GT を凍結する条件**:
  - 必要なレビューがすべて終わっている。
  - 不一致がすべて裁定されている。
  - escalation が終わっている。
  - 最終 GT ファイルとその SHA-256 を生成している。
  - この文書に最終 GT の SHA-256 と sample manifest の SHA-256 を記録している。
- これらが終わるまで、**GT は凍結されていない**。

## 7. held-out の規律

- 凍結後、H1 を実装する worker には、最終 GT・人のレビュー結果・不一致の裁定を見せない。
- 見せてよいのは、この preregistration、sample manifest、P0 の事実。
- 実装を凍結した後、Coordinator が1回だけ評価する。
- 評価を見てから規則を直した場合、その実行は post-hoc / development の結果として扱い、held-out の結果を書き換えない。

## 8. 評価指標

- **resolved_precision（主）**: 重複を除いた関係の GT 上で、正しい RESOLVED ÷ すべての RESOLVED 予測。
  - 「正しい」とは、GT の status が RESOLVED で、かつ parent_ref が一致すること。
  - GT が AMBIGUOUS / NO_PARENT の単位に RESOLVED を出した場合は誤りとする。
  - AMBIGUOUS の予測は分母に入れない。
- **resolved_coverage**: RESOLVED の予測 ÷ 対象の関係単位（HIER / CODE3 / DETAIL の標本）。
- **ambiguity_rate**: AMBIGUOUS の予測 ÷ 対象の関係単位。
- **constraint_violation_rate**: 69ブロック全件の運用上の実行で、違反のある RESOLVED の構造判定 ÷ RESOLVED の構造判定。違反には次を含める。
  - ブロックをまたぐ親
  - 後の行を親にする
  - 閉じた範囲をまたぐ
  - 循環
  - RESOLVED の範囲で直接の子の合計と矛盾する
  - 親を複数割り当てる
- **TOTAL の範囲の正確さ**: TOTAL の GT 24単位で評価する。RESOLVED の範囲は、直接の子の集合が完全に一致することを求める。
- **status の混同行列**: GT の status と予測の status の行列を必ず報告する（主指標ではない）。

## 9. GO / STOP（H1 の1回だけの評価で判定する）

**GO**: 次をすべて満たす。

1. resolved_precision が100%
2. constraint_violation_rate が0
3. TOTAL の範囲の GT で、誤った RESOLVED が0
4. resolved_coverage が60%以上
5. 標本のある各層で、誤った RESOLVED が0
6. 実装後に GT を見て規則を変えていない

**STOP**: 次のいずれかに当たる。

- precision が100%未満
- 制約違反が1件以上
- TOTAL の範囲の誤った RESOLVED が1件以上
- coverage が60%未満（utility failure）
- held-out の漏れ
- preregistration または GT のハッシュの不一致
- 評価後に規則を変えないと成功しない

AMBIGUOUS が多いこと自体は precision の失敗ではない。否定的な結果も保存する。

## 10. 実行と成果物

```bash
npx tsx scripts/pipeline-v2/prepare-budget-request-total-table-h1-gt.ts prepare   # 標本と注釈用パッケージ
npx tsx scripts/pipeline-v2/prepare-budget-request-total-table-h1-gt.ts compare   # A/B の比較と人によるレビュー用パッケージ
```

- 入力: 凍結した zip（SHA-256 `268f1020…e533`）。実行時に、82 / 69 / 3,531 / P0 の曖昧ケース 1,286 と一致することを検査する。v0 の `output-manifest.json` の SHA-256 は `b8f23dca28767361b5c6d22f0d42ee5c95d5ce66e8d2001fcfb73887b4bc5c1f`。P0 の survey の出力ハッシュは #420 の記録と一致した。
- 出力先は `data/work/budget-request-total-table-h1-gt/2024/` で、git 管理外。
  - `annotation-input/`: 注釈者に渡す証拠。`units.csv` と、ブロックごとの `rows.csv`・`raw.txt`（50ブロック分）、`annotation-guide.md`。
  - `annotation-a/`・`annotation-b/`: 注釈者 A・B の出力。
  - `review/`: 人によるレビュー用パッケージ。
    - `sample-manifest.csv`
    - `duplicate-groups.csv`
    - `sampling-summary.json`
    - `relation-annotation-{a,b}.csv`
    - `total-scope-annotation-{a,b}.csv`
    - `consensus-candidates.csv`
    - `disagreements.csv`
    - `human-review.csv`（`human_*` の欄は空のまま）
    - `review-guide.md`
    - `comparison-summary.json`
    - `package-manifest.json`

## 11. A/B の結果（GT ではない）

| | 関係（RELATION＋CONTEXT 122） | TOTAL の範囲（24） |
|---|---|---|
| A | RESOLVED 95・AMBIGUOUS 19・NO_PARENT 8 | RESOLVED 2・AMBIGUOUS 22 |
| B | RESOLVED 58・AMBIGUOUS 56・NO_PARENT 8 | AMBIGUOUS 24 |

- **一致**: 146単位のうち105。内訳は RESOLVED 57、AMBIGUOUS 40、NO_PARENT 8（CONTEXT 8件はすべて一致）。
- **不一致**: 41単位。40件は「A が RESOLVED、B が AMBIGUOUS」、1件は「A が AMBIGUOUS、B が RESOLVED」。両者とも RESOLVED なのに親や範囲が違う単位は**0件**だった。
- **層ごとの不一致**:

| 層 | 不一致 |
|---|---|
| S1 | 4/12 |
| S2 | 8/12 |
| S3 | 7/18 |
| S4 | 2/12 |
| S5 | 1/12 |
| S6 | 3/12 |
| S7 | 7/24 |
| S8 | 7/12 |
| 組織計 | 0/8 |
| 所管計 | 2/8 |
| 会計計 | 0/8 |

- **B の AMBIGUOUS 56件の理由**（B の notes から分類）:
  - 確認しきれなかったもの 31件。B は途中で総当たりの探索を打ち切っており、「候補を検証しきれていない」と書いている。不一致41件のうち30件はこれに当たる。
  - 単一の子で同額のもの 13件。
  - 全0のもの 12件。
- **B の AMBIGUOUS は「候補が複数残ることを確認した」という意味とは限らない。** 人がレビューするときは、上の分類を区別して扱う。
  - 一致した AMBIGUOUS のうち、B の理由が「確認しきれなかった」ものは R2-008 の1件だけ。A の理由は、子の合計が親と合わないことだった。
- **TOTAL の範囲**: A はほぼすべてを、B はすべてを AMBIGUOUS とした。直前の1行が TOTAL と同額になるため、範囲がその1行か、その子たちかを区別できない、という判断である。
- **意味ラベル**: 注釈の入力にも出力にも意味ラベルは使っていない。
- **人によるレビューが必要な単位**: 77件（不一致41、一致した単位の監査28、CONTEXT 8）。escalation は、監査の結果が出てから判定する。

| ファイル | SHA-256 |
|---|---|
| `sample-manifest.csv` | `f324854ee932728a1edee33dd4972cf1fe4be3fd1694db655443cbfc6296f8aa` |
| `relation-annotation-a.csv` | `2c023a2f34c8fe4da302e80dac85042d5ec50f92b43fffd560e09ff953962c0b` |
| `relation-annotation-b.csv` | `a0a19a7164072a75ee4a9878458aacc380f4a1aafa0c2f3d26674dc85418fcf5` |
| `total-scope-annotation-a.csv` | `275aeaa370799734dbabdb042521bba82a5bcf280ab1901ca17403edc304f6b5` |
| `total-scope-annotation-b.csv` | `23e4986952ee16b221af6204390b4d4acab6b5b107983f4a3d3b7d6ed378d495` |
| `package-manifest.json` | `2e76c85e04c4c2c957d235708dbd3858852c130a8a1bfb814cdebd133cd49589` |

compare を2回実行し、`package-manifest.json` が一致した。最終 GT の SHA-256 は、人によるレビューが終わってから記入する（未記入）。

## 12. 注釈手順の改訂（round 2）

注釈の実行前に記録する（2026-10-12）。round 1 の結果（§11）を Coordinator が見たうえでの改訂だが、**変えるのは作業手段だけで、判定基準は変えない。** ユーザーと合意済み。

### 12.1 理由（round 1 の観測）

- A と B は、同じ起動プロンプトで起動した。どちらも Claude Opus 5.5 の通常サブエージェントだった。
- A は約14分で終わり、スクリプトは書いていない。
- B は約84分かかり、Coordinator が打ち切らせた。B は、親子の割り当てを総当たりして金額の加算を照合するソルバを書いては止めることを、少なくとも5回繰り返していた。
- 起動プロンプトには計算手段と作業量の上限がなかった。そのため、一意性を列挙で証明する戦略が許されていた。
- その結果、B の「確認しきれなかった」AMBIGUOUS が31件出た。不一致41件のうち30件がこれに由来し、A/B の比較が判断の違いを表していない。

### 12.2 変えないもの

- 仮説、制約 C0〜C7、status の定義、評価指標、GO/STOP 基準（§1〜§9）
- 標本（`sample-manifest.csv` SHA-256 `f324854e…f8aa`）と、`annotation-input/`（`annotation-guide.md` を含む）。prepare は再実行しない。
- 一致の定義、監査（`ceil(n/4)`）、escalation、GT の凍結条件（§6）
- 使ってよい証拠と、使ってはいけない証拠

### 12.3 変えるもの

- **注釈者の作り直し:** A と B の両方を、新しい注釈者 A2 と B2 で作り直す。
  - round 1 の注釈と review package は `review-r1/` に記録として残す（`package-manifest.json` SHA-256 `2e76c85e…9589`）。GT の候補には使わない。
- **起動方法:**
  - Orca Orchestration の `worker-start` で、Orca の既定エージェントである Codex を2体起動する。
  - 置き場所は Coordinator の worktree（`--worktree current`）とする。
  - 2体には、同じ Task 仕様を与える（§12.4。注釈者 ID だけが違う）。
  - round 1 で使った通常サブエージェントは使わない。
- **注釈の手段の制約（Task 仕様に追加）:**
  - 割り当てや部分集合を総当たりで探すスクリプトを書かない。スクリプトは、決めた候補集合の7セルを検算するときだけ使う。
  - RESOLVED にする根拠は、行順・CONTEXT・TOTAL・書式から局所的に述べる。
  - AMBIGUOUS の notes の先頭に、`MULTI:`（候補が複数残る）か `NONDISC:`（全0・単一の子で同額など、金額が非判別的）を付ける。
  - 「確認しきれない」は出さず、全単位を判定し終える。
  - 作業量の目安は、ツール呼び出し約100回、1スクリプト30秒まで。
- **比較:**
  - `compare --annotators=a2,b2` で、人によるレビュー用パッケージを `review/` に作る。
  - `stability --pairs=a:a2,b:b2` は診断としてだけ出す。GT の入力にもレビューの入力にもしない。
  - round 1 は Claude、round 2 は Codex で、手順も違う。そのため、この診断ではモデルの差と手順の差を分離できない。
- **時間管理:**
  - 40分を超えても、片方だけを打ち切らない。Coordinator が両方の状態を確認し、ユーザーに報告する。

### 12.4 Task 仕様（A2/B2 共通。`<X>` は `a2` または `b2`）

```text
You are independent annotator <X> for a research ground-truth (GT) labeling task. Work alone.

Working directory: the current Orca worktree (repository root).

## Isolation (strict)
- READ ONLY files under data/work/budget-request-total-table-h1-gt/2024/annotation-input/.
- WRITE ONLY under data/work/budget-request-total-table-h1-gt/2024/annotation-<X>/ (create it; helper scripts go in annotation-<X>/work/).
- Do NOT read anything else: not other annotation-*/ directories, not review/ or review-r1/, not repository code/docs/tests,
  not docs/chats, not git history, not the web, not PDFs. Do not use external budget knowledge or memory about
  Japanese budget structure. Do not decide from semantic labels (e.g. "this must be a 項/組織/目").
- Run Python with `python3 -I` if you use Python.

## Task
1. Read annotation-input/annotation-guide.md first and follow it exactly (Japanese).
2. annotation-input/units.csv lists 146 units (RELATION, CONTEXT_ROOT, TOTAL_SCOPE). For each unit, open its block files
   (blocks/<block>.rows.csv and blocks/<block>.raw.txt) and decide using only the allowed evidence.
   - RELATION: the direct structural parent of the target row (`context` or `row:<row_index>`), or AMBIGUOUS etc.
   - CONTEXT_ROOT: NO_PARENT if the CONTEXT line is the block root, else AMBIGUOUS with a note.
   - TOTAL_SCOPE: RESOLVED with the exact set of DIRECT children whose 7 amount cells sum to the TOTAL row, or AMBIGUOUS.
3. Mark RESOLVED only when the evidence leaves exactly one candidate. Equal amounts alone, all-zero rows, single-child
   equal amounts, indentation alone, or code width alone are NOT sufficient.

## Method constraints (round 2)
- Do NOT write scripts that enumerate or search over parent assignments or child subsets (no brute force, no DFS/solver).
  Scripts are allowed only to check the arithmetic of a candidate set you have already chosen by reading the rows.
- Justify each RESOLVED locally from row order, CONTEXT, TOTAL rows and line format. If you cannot state why exactly one
  candidate remains, mark AMBIGUOUS.
- Every AMBIGUOUS note must start with `MULTI:` (more than one candidate remains) or `NONDISC:` (amounts are
  non-discriminating, e.g. all-zero or single child with equal amount), followed by one short sentence.
- Never output "not verified" / "could not check". Decide every unit.
- Budget: about 100 tool calls in total; any single script must finish within 30 seconds.

## Output
Write exactly two CSV files (UTF-8, header exactly as given, one row per unit, every sample_id exactly once, quote fields
containing commas; `;` separates multiple evidence codes and child indices):
- annotation-<X>/relation-annotation-<X>.csv — header `sample_id,status,parent_ref,evidence_codes,notes`
  — all RELATION and CONTEXT_ROOT units (122 rows).
- annotation-<X>/total-scope-annotation-<X>.csv — header `sample_id,scope_status,direct_child_row_indices,evidence_codes,notes`
  — all TOTAL_SCOPE units (24 rows).

## Done
Report via worker_done: counts per status, counts per scope_status, number of tool calls used, and the sample_ids you
found difficult. Do not otherwise summarize the data.
```

### 12.5 1回目の結果: STOP（2026-10-12）

Run `run_97915207aade` で、§12.4 の仕様を使って Codex（gpt-6-luna、effort medium）を2体起動した（`--worktree current`）。2体とも約1分で終わり、どちらの出力も1単位ずつの判定になっていなかった。GT の候補には使わず、compare も実行していない。

| | A2 | B2 |
|---|---|---|
| 報告 | `failed` | `succeeded` |
| 内容 | 入力を読んだ後、CONTEXT 以外の全単位を機械的に AMBIGUOUS で埋めた。「個別に判定していない」と報告した | 「直前にある、決まった型の行を親とする」規則をスクリプトで全単位に一括適用し、110件を RESOLVED にした。AMBIGUOUS の notes には、後から機械的に `MULTI:` を付けた |
| ツール呼び出し | 8 | 10（報告は5） |

- B2 の規則は、行の型（コード桁数に由来する）で親を決めている。ガイドと §12.4 の「スクリプトは検算にだけ使う」に反する。
- **観測された要因:**
  - 2体とも、50ブロックを1回の出力で読もうとし、出力が切り捨てられていた（例: 26,208 トークン中の一部だけが表示された）。
  - Codex の基本指示は、まとめて処理する方向に寄っている（「行動を優先」「独立した読み取りは1回にまとめる」）。
  - リポジトリに AGENTS.md がなく、研究規律は Task 仕様からしか届かない。
  - §12.4 は、ラベルをプログラムで生成することを明示的には禁じていなかった。ツール呼び出しの目安（約100回）も、146単位を1つずつ判定するには少なかった。
- 出力は `annotation-a2-attempt1/`・`annotation-b2-attempt1/` に退避した。

| ファイル | SHA-256 |
|---|---|
| `annotation-a2-attempt1/relation-annotation-a2.csv` | `50a2cd0143e1b4fcc01c763cd17ff8dec4c0da5ed8248278aad0ef7193879bfa` |
| `annotation-a2-attempt1/total-scope-annotation-a2.csv` | `a48df2fab423d06b2cb08696287f388b186bd632f8dde8455b087aff676d96a0` |
| `annotation-b2-attempt1/relation-annotation-b2.csv` | `8700e96747b706faea758fa1190fbf5e8d075fcb13315f00ef967333701fdbf5` |
| `annotation-b2-attempt1/total-scope-annotation-b2.csv` | `4372ff670a034f59ac655560c34797d534d694dabcfeefeb5337fb30f08e0412` |

### 12.6 2回目の Task 仕様（A2/B2 共通。§12.4 を置き換える）

§12.2 の「変えないもの」は維持する。判定基準は変えず、作業の進め方だけを次のように改める。

- 1単位ずつ判定させ、判定ログ（`work/decisions.md`）を先に書かせる。CSV は、そのログを整形して作る。
- 状態・親・範囲をデータから計算するコードを禁止する。禁止する理由（この GT は規則ベースの resolver を評価するためのもの）も仕様に書く。
- ブロックは小さな範囲に分けて読ませ、出力の切り捨てを検知したら読み直させる。
- notes に、根拠とした row_index を必ず書かせる。
- ツール呼び出し回数の目安は外し、速さは目標ではないと明記する。
- 起動時に `--model gpt-6-luna --effort high` を指定する。

```text
You are independent annotator <X> for a research ground-truth (GT) labeling task. Work alone and carefully.
Speed is not a goal: this task is expected to take 30-90 minutes of careful reading. Do not shortcut it.

## Why this matters
These labels become ground truth for evaluating a future rule-based parent resolver. If you derive labels by
applying a rule (for example "parent = the nearest preceding row of type X") to many units, the GT just copies
a resolver and becomes worthless. Each label must be your own judgment of that unit's evidence.

## Isolation (strict)
- Working directory: the current Orca worktree (repository root).
- READ ONLY files under data/work/budget-request-total-table-h1-gt/2024/annotation-input/.
- WRITE ONLY under data/work/budget-request-total-table-h1-gt/2024/annotation-<X>/ (create it; scratch files go in
  annotation-<X>/work/).
- Do NOT read anything else: not other annotation-* directories (including *-attempt1), not review/ or review-r1/,
  not repository code/docs/tests, not docs/chats, not git history, not the web, not PDFs. Do not use external budget
  knowledge or memory about Japanese budget structure. Do not decide from semantic labels (e.g. "this must be a 項").
- Do not spawn sub-agents. Run Python with `python3 -I` if you use Python.

## Read the evidence properly
1. Read annotation-input/annotation-guide.md in full first (Japanese) and follow it exactly.
2. Read annotation-input/units.csv (146 units).
3. Work block by block. For each block, read its rows.csv and the relevant part of its raw.txt in small pieces
   (at most about 80 lines per read, e.g. `sed -n '120,200p' <file>`). Never print several blocks at once.
   If any tool output says it was truncated, re-read that part in smaller pieces before deciding anything.

## Decide each unit yourself
For every unit, in order:
- RELATION: identify the target row, list the candidate parent rows (earlier rows in the same block: HIER / CODE3 /
  DETAIL, or `context`), and eliminate candidates using the allowed evidence (row order, CONTEXT, TOTAL rows and their
  scope, line format, the 7 amount cells, page boundaries). RESOLVED only if exactly one candidate survives.
- CONTEXT_ROOT: NO_PARENT if the CONTEXT line is the block root, else AMBIGUOUS.
- TOTAL_SCOPE: RESOLVED only if exactly one set of DIRECT children sums (all 7 cells) to the TOTAL row and the
  evidence excludes the alternatives; otherwise AMBIGUOUS.
Rules from the guide still apply: equal amounts alone, all-zero rows, single-child equal amounts, indentation alone,
row type or code width alone are NOT sufficient.

Before writing any CSV, append one entry per unit to annotation-<X>/work/decisions.md:
  `<sample_id> | candidates: <row_index list or context> | decision: <status> <parent_ref or child list> | why: <one sentence citing row_index evidence>`

## Hard prohibitions
- Do NOT write code that computes a status, a parent or a scope from the row data, and do NOT apply any rule in bulk.
  Allowed scripts: displaying a line range of a file, summing the 7 amount cells of a candidate set you have already
  chosen, and finally converting your written decisions.md into the two CSV files. Each script must finish within
  30 seconds.
- Do NOT fill units with placeholder labels. If you cannot finish every unit, stop, keep decisions.md, do not write
  the CSVs, and report --outcome failed listing the units done.

## Output
After decisions.md covers all 146 units, write exactly two CSV files (UTF-8, header exactly as given, one row per
unit, every sample_id exactly once, quote fields containing commas; `;` separates multiple evidence codes and child
indices):
- annotation-<X>/relation-annotation-<X>.csv — header `sample_id,status,parent_ref,evidence_codes,notes`
  — all RELATION and CONTEXT_ROOT units (122 rows).
- annotation-<X>/total-scope-annotation-<X>.csv — header `sample_id,scope_status,direct_child_row_indices,evidence_codes,notes`
  — all TOTAL_SCOPE units (24 rows).
Notes: one short sentence citing the row_index evidence. Every AMBIGUOUS note starts with `MULTI:` followed by the
remaining candidate row_indexes, or `NONDISC:` followed by the non-discriminating fact (all-zero, single child with
equal amount, ...). Never write "not verified" / "could not check".

## Done
Report via worker_done: counts per status, counts per scope_status, and the sample_ids you found difficult.
Do not otherwise summarize the data.
```

### 12.7 2回目の結果（GT ではない）

Run `run_97915207aade` で、§12.6 の仕様を使って Codex（gpt-6-luna、effort high）を2体起動した（`--worktree current`、09:37 JST に開始）。

| | A2 | B2 |
|---|---|---|
| 所要時間 | 約28分 | 約16分 |
| ツール呼び出し | 257 | 164 |
| 関係（122） | RESOLVED 109・AMBIGUOUS 5・NO_PARENT 8 | RESOLVED 108・AMBIGUOUS 6・NO_PARENT 8 |
| TOTAL の範囲（24） | RESOLVED 11・AMBIGUOUS 13 | RESOLVED 22・AMBIGUOUS 2 |

**Coordinator による検証**（判定の妥当性は見ていない。仕様に従ったかだけを確認した）:

- 2体とも、`work/decisions.md` に146単位を重複なく書き、CSV の status・親と一致した。
- AMBIGUOUS には、すべて `MULTI:` か `NONDISC:` が付いていた。notes には、すべて row_index が入っていた。
- スクリプトは、表示と、判定ログを CSV に変換するものだけだった。ラベルを計算するコードは無かった。
- 実行したコマンドに、読み取りが禁止された場所（他の注釈、review、コード、git、Web）への参照は無かった。

**compare（`--annotators=a2,b2`）:**

- 146単位のうち一致は113、不一致は33。
- 人によるレビューが必要な単位は70件（不一致33、一致した単位の監査29、CONTEXT 8）。
- prepare と compare を2回実行し、`package-manifest.json` が一致した。

| 不一致の種類 | 件数 |
|---|---|
| 両者とも RESOLVED で、親や範囲が違う | **17** |
| 一方だけ RESOLVED（A2 が AMBIGUOUS、B2 が RESOLVED） | 13 |
| 一方だけ RESOLVED（A2 が RESOLVED、B2 が AMBIGUOUS） | 3 |

- **両者 RESOLVED で食い違った17件（round 1 は0件）:**
  - 関係12件: R2-008, R2-010, R3-005, R4-004, R5-002, R7-001, R7-002, R7-004, R7-015, R7-019, R8-009, R8-011。このうち9件は、一方がブロック先頭の上位行（row:1）を親とし、もう一方がより近い上位行（row:2 など）を親としている。入れ子になった上位行のどれを直接の親とするかの違いである。
  - TOTAL の範囲5件: T1-001, T1-005, T1-006, T1-007, T2-008。多くは、直前の同額の1行を範囲とするか、その子たちを範囲とするかの違い。round 1 では、A も B もこれを AMBIGUOUS としていた。
  - 少なくとも一方が、候補を1つに絞れない単位を RESOLVED にしている。人によるレビューで、すべて裁定する。
- **層ごとの不一致:**

| 層 | 不一致 |
|---|---|
| S1 | 0/12 |
| S2 | 2/12 |
| S3 | 3/18 |
| S4 | 1/12 |
| S5 | 2/12 |
| S6 | 0/12 |
| S7 | 5/24 |
| S8 | 2/12 |
| 組織計 | 8/8 |
| 所管計 | 8/8 |
| 会計計 | 2/8 |
| CONTEXT | 0/8 |

**診断（`stability`。GT にもレビューにも使わない。モデルの差と手順の差を分離できない）:**

| 組 | 一致 |
|---|---|
| A と A2 | 112/146 |
| B と B2 | 69/146 |
| A2 と B2 | 113/146 |

- B から B2 で、AMBIGUOUS から RESOLVED に変わった関係が52件あった。

**round 1 の package との関係:** round 1 の package は `review-r1/` に、そのままの形で残っている（`2e76c85e…9589`）。round 2 の `review/` を作る前に、round 1 由来の注釈者別ファイルは `review/` から取り除いた。prepare 由来の `sample-manifest.csv`・`duplicate-groups.csv`・`sampling-summary.json` は変えていない。

| ファイル | SHA-256 |
|---|---|
| `annotation-a2/relation-annotation-a2.csv` | `c18a19b908a450acca8c0a880598156a1011635dd7f30b003828446591b69f27` |
| `annotation-a2/total-scope-annotation-a2.csv` | `4162633b1c6132a225410950b9725eff9c8dfe19be671494ee78ef72d002d019` |
| `annotation-b2/relation-annotation-b2.csv` | `57da53ca9e435b5b2de3609be01cf2314622b89ebe0e22ac31150c563c8e0233` |
| `annotation-b2/total-scope-annotation-b2.csv` | `f8c25c10f170b9b91d11e1ac6c8c38a6d2280e430dc6d5d8cd649a7cbd12f49b` |
| `annotation-a2/work/decisions.md` | `06dff9111e76d94f67c3601ade3122417438219289d16087c1c6dbd44d68a4f7` |
| `annotation-b2/work/decisions.md` | `35f1529e39c58b003a52a126117890dfd68b6ce1dc19ec7296e292fd4b411075` |
| `review/package-manifest.json` | `9a4005102e8afdd662e579d905dcaf298d12f515d1044b03e7d175c2bd95a15e` |
| `review/stability.json` | `abfed56037ca78cca894246925efa0a1d0829bd8d1d5b497ad2f61f93dcaca00` |

**次:** `review/human-review.csv` の人によるレビュー（70件）。手引きは `review/review-guide.md`。監査の結果を見て escalation を判定し、すべて裁定したうえで GT を凍結する。
