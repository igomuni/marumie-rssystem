# 概算要求PDF page header blank / title ordering source-schema inventory — protocol（Phase A 全件走査の前に固定）

page header label segment inventory（branch `research/budget-request-page-header-label-segments`、`8d6e682`）の後続。問いは 1 つだけ: 現行 projection で `observed_blank` となった page に label-shaped text は source 上存在するか。存在する場合、それは 3 桁 code 行などとの文書順関係で current projection から落ちているのか。新しい title extractor は実装せず、current projection rule も変更しない。blank page へ前後 page の label を補完・carry-forward しない。label の意味は解釈しない。manual contract・layout 境界・existing hierarchy kind・MOF は Phase A に使わない。

## 0. 分類（3 つの可能性）
`PROJECTION_ARTIFACT_DOMINANT`（blank page の多くに label-shaped text が存在するが現行 cut-off の後ろ）／`SOURCE_BLANK_DOMINANT`（source 上も label-shaped text が無い）／`MULTIPLE_SOURCE_SCHEMA_VARIANTS`（単一原因で説明できない）。D2 を改善できそうかは decision rule に入れない。

## 1. 開示（既知 evidence）
前回の観測: x=38 の 3 桁 code 行が mext / mhlw の manual range 外で各 450 件、すべて `observed_blank` page 上（前回 Commit C の artifact）。current projection は「最初の code 行より前の先頭 logical row」を title とする（前回 protocol §1）。本研究の仮説（page 番号が 3 桁以上の page で、page 番号と label が同じ logical row に入り、その row の先頭 token が 3 桁数字のため code 行と判定される）は、実データの row 構造を見る前の推測であり、検証対象。

## 2. Phase A — source-only inventory
### upstream
前回 Phase A と同じ code path（pdf.js text → SourceToken → TableGeometry → LogicalRow）を PDF ごとに 1 回 open して read-only で再実行（production は変更しない）。rotate ≠ 0 の page は `unavailable_rotate90`、他の例外は `other_unavailable`、PDF が無い・hash 不一致は `unavailable_upstream`（推測しない）。
前回 projection（`header-label-projection.json` `9ff3b970…c402e5`）を同じ code path で再現し、全 page の status（observed_nonblank 6,195・observed_blank 2,950）が一致しなければ STOP。

### row 単位の evidence（全て source のみ）
- 各 logical row: index・非空白 token 列（visual order）・refs（logicalRowIndex・physicalRowIndexes・tokenIndexes）・x（先頭 token の xMin）・y（row の bbox.yMin）・raw（token の rawText を空白 1 つで連結）・normalized（NFKC → 空白と数字を除去。前回と同じ）・lexical shape（前回と同じ: normalized が `^([^()]+)\(([^()]+)\)$` なら `prefix(inner)`、prefix / inner の長さ）。
- code-shaped row: 先頭の非空白 token が `^\d{3}$`（後続 token の有無を問わない。x の値は条件にしない）。前回の `plain3` / `plain3_only` と同じ判定。意味（項など）は付けない。
- label-shaped row: page の上端帯（row の bbox.yMin < page 高さ × 0.2）にあり、normalized が `prefix(inner)` 形の row。上端帯の幅 0.2 は、本文の名称行（括弧を含む行）を拾わないための固定値で、実データを見る前に決めた。
- title-like row（`label_shape_unrecognized` 用）: 上端帯にあり、label-shaped でも code-shaped でもなく、数字以外の文字を含む row。
- 同じ row が code-shaped かつ label-shaped でありうる（例: 先頭が 3 桁のページ番号で、後ろに label が続く row）。この場合は `label_and_code_same_row`。

### page primary class（排他的。上から順に最初に当たるもの）
1. `unavailable`（unavailable_*）。
2. `neither_label_nor_code`（label-shaped row も code-shaped row もない）。
3. `label_without_code`（label-shaped row があり code-shaped row がない）。
4. `code_without_label`（code-shaped row があり label-shaped row がない）。
5. `ordering_ambiguous`（最初の code-shaped row の前にも後ろにも、同じ row でない label-shaped row がある）。
6. `label_and_code_same_row`（最初の label-shaped row が最初の code-shaped row と同じ row）。
7. `label_before_code`（最初の label-shaped row が最初の code-shaped row より前で、前の label-shaped row は 1 つ）／`multiple_labels_before_code`（2 つ以上）。
8. `code_before_label`（最初の code-shaped row が最初の label-shaped row より前で、label-shaped row は 1 つ）／`multiple_labels_after_code`（2 つ以上）。
9. 上記に当たらない構造 → `other_observed_structure`。
flags（排他でない）: label が複数ある・code row が複数ある・current projection が title として扱った row が label-shaped か。

### 前回 observed_blank の blank reason（上から順）
`unavailable`（unavailable_*。前回 blank の定義では evaluable なので通常 0）→ `source_order_ambiguous`（class が ordering_ambiguous）→ `projection_cutoff_before_label`（label-shaped row が存在し、current projection がそれを title にしていない = blank）→ `label_shape_unrecognized`（label-shaped row はないが title-like row がある）→ `source_label_absent`（label-shaped row も title-like row もない）→ `other_observed_structure`。`projection_cutoff_before_label` の中を class（`label_and_code_same_row`・`code_before_label`・…）で内訳として出す。

### sequence inventory（前回 projection の state の連なり。補完しない）
PDF ごとに、label→blank→same label、label→blank→different label、blank→label、label→blank、連続 blank run の長さ、同じ normalized label の再出現距離（page 数）を数える。

### Phase A artifact
`page-ordering-inventory.json`: input hashes・rule version・page counts・page ごとの class・blank reason・evidence refs（label / code row の index・x・y・raw・normalized・tokenIndexes）・sequence statistics・決定的 digest・deterministic な代表例（`(class, localPath, page)` の辞書順で各 class の先頭 3 件）。Commit B で freeze し、それまで manual boundary との比較は実行しない。

## 3. Phase A の decision rule（全件走査の前に固定）
denominator = 前回 observed_blank の 2,950 page（blank reason）。
1. `INCONCLUSIVE`: 前回の 2,950 / 6,195 が再現しない、または `unavailable` + `source_order_ambiguous` + `other_observed_structure` が blank の 0.5 以上。
2. `PROJECTION_ARTIFACT_DOMINANT`: `projection_cutoff_before_label` が最大で、blank の 0.5 を超える。
3. `SOURCE_BLANK_DOMINANT`: `source_label_absent`（`label_shape_unrecognized` を含めない）が最大で、blank の 0.5 を超える。
4. `MULTIPLE_SOURCE_SCHEMA_VARIANTS`: 上記以外（最大カテゴリが過半数に届かない）。
「label-shaped text が code row より後ろにある」ことと「その label を page header として採用すべき」ことは別で、前者の観測は後者の claim ではない。

## 4. Phase B（Phase A の freeze 後）
current projection・label segment・layout range・manual contract 境界・mext / mhlw・semantic-boundary population との比較。最重要は、`label→blank→same label` を、blank page 自身の source label（補完ではない）の normalized が前後の label と一致するかで数えること。segment counterfactual は post-freeze diagnostic のみで、production rule としない。manual boundary への一致率で rule を選ばない。mext（1044 周辺）・mhlw（1554 / 1555・1700 / 1701）・x=38 の 450 件 × 2 の page-level blank reason を個別に確認する。

## 5. 禁止・STOP
blank への補完、label の意味解釈、x=38 行を項・組織と断定すること、manual contract に合わせた調整、MOF の使用、FieldResolver / DocumentHierarchy / production title extractor の変更、item 候補の再評価、sparse detector、rotate 対応、fuzzy は行わない。frozen hash 不一致、2,950 / 6,195 の不再現、raw PDF の hash 不一致、Phase A に manual / MOF / existing kind が混入、Phase A freeze 前に Phase B の結果を見た場合は STOP。
