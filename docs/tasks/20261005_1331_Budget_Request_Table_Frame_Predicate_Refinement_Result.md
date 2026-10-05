# 概算要求PDF table-frame relation による header predicate refinement — frozen evaluation の結果

preregistration: `20261005_1330_Budget_Request_Table_Frame_Predicate_Refinement_Preregistration.md`（Commit A `585d0d4`、doc SHA-256 `edc182c8…3216`）。implementation freeze は Commit B `11e3474`（eligibility helper `b43eab8b…fdf2`、初回 script `09844c90…80a8`）。measurement bug の修正 `012d018`（script `e834e6d8…c150b`）、frozen evaluation は Commit C `0eea845`、本結果は Commit D。classifier（`frameOf` / `classifyPosition`）・数値 gate・population・rule は結果を見て変更していない。production は無変更。P1 / P2 は human GT ではなく、P2 を誤検出と仮定していない。MOF・manual contract は使っていない。

**Decision: `TABLE_FRAME_REFINEMENT_SUPPORTED`（D1、規則 3）。** 事前登録した全 gate を満たした。ただし P2 の structural separation（0.804、gate 0.80）と coverage（0.917、gate 0.90）は gate に近い。

## Measurement bug の開示（rule 変更ではない）
implementation freeze の script による最初の run は、不採用（reject）にした page の refined 出力を raw = null として current projection と比較した。current projection は blank page でも raw（ページ番号のみの `60` 等）を持つので、不採用の 2 page を「current から変化した」と数え、regression = 2、G5 不通過で `TABLE_FRAME_REFINEMENT_NOT_SUPPORTED` と出た。これは measurement / aggregation の bug で、classifier・gate は不変。不採用の page は current projection の出力のままとして修正し（`012d018`）、再実行した。初回の出力は `first-run-with-measurement-bug.json` に保存している（relation の件数・retention・P2 share・coverage は初回と修正後で同じ）。評価は「full frozen population に一度だけ適用」の方針で、修正後の run が freeze された評価（再実行で artifact 不変）。

## Pre-flight / dependency integrity
branch `research/budget-request-table-frame-predicate-refinement`、親 `4f1bcf2`、origin/main `38e5080`（chain は未 merge）。frozen 入力（universe・comparison・P1 outlier の population / packet / decision / visual・alternative projection の artifact / primary / population・table-frame classifier・rule-line 実装・preregistration）の hash を script が照合。再現: universe 14,675・P1 2,532・P2 1,786・P3 534・P4 5,572・P5 4,251・ambiguous page 1,123・P1 dominant 2,530・outlier 2・target 2,537 page・recovered 2,532・unresolved 5・evaluable 9,145。working tree は未追跡 `.DS_Store` 2 件のみ。

## 再利用した table-frame rule
`budget-request-p1-outlier.ts` の `frameOf`（long な垂直 rule の範囲、許容 0.5pt）と `classifyPosition`（header: yMax ≤ frameTop + 0.5／body/table: bbox が frame の内側／それ以外 ambiguous）を変更せずに使用（refactor なし）。outlier 2 + control の再現 test は直前研究の分類と一致（outlier → body/table、control → header）。

## Frame availability（14,675 candidate）
frame あり 14,651、frame unavailable 24、header / body/table と分類できた（classification_available）13,455、ambiguous（frame を跨ぐ・外にはみ出す）1,196。P1 は 2,531 が frame あり・1 が unavailable、P2 は全件 frame あり・350 が ambiguous、P3 は 405 が分類可（127 ambiguous・2 unavailable）、P4 は 5,348 が分類可（220 ambiguous・4 unavailable）、P5 は 3,735 が分類可（499 ambiguous・17 unavailable）。

## P1〜P5 relation matrix
| population | header | body/table | ambiguous | unavailable |
|---|---:|---:|---:|---:|
| P1 dominant（2,530） | 2,529 | 0 | 0 | 1 |
| P1 outlier（2） | 0 | 2 | 0 | 0 |
| P2（1,786） | 0 | 1,436 | 350 | 0 |
| P3（534） | 0 | 405 | 127 | 2 |
| P4（5,572） | 3,578 | 1,770 | 220 | 4 |
| P5（4,251） | 2,131 | 1,604 | 499 | 17 |
| 全体（14,675） | 8,238 | 5,217 | 1,196 | 24 |

## P1 dominant 2,530
header position として 2,529 を維持（retention 0.9996、gate ≥ 0.98）。残り 1 row は frame unavailable（`r6sandanhyou.pdf` page 140、`136 内（取）`。page に long な垂直 rule がない）で fail-closed。

## P1 outlier 2
2/2 が body/table（gate 通過）。

## P2 1,786
1,436 row（0.804、gate ≥ 0.80）が body/table、350 row が ambiguous（frame の x 範囲を超えて右にはみ出す row など。例: x 469.3–799.2 の行が frameRight 797.18 + 0.5 を超える）。header と分類された P2 row は 0。ambiguous の原因の全体分解は今回は行っていない。

## Primary 2,537 page の refined result
accepted 2,529 / rejected_body_or_table 2 / rejected_unavailable 1 / rejected_ambiguous 0 / unresolved_existing_mechanism 5 / mismatch 0 / source fidelity violation 0 / provenance missing 0。

## Regression
current nonblank 6,195 page の変化 0・non-target（C3 / C4 / C5）の変化 0・current projection の変化（採用ページ以外）0・provenance loss 0・補完した source text 0。

## Determinism / provenance
再実行で artifact の hash が一致（evaluation `9100df13…bb9dd`、relations `cfce15fe…6936b`）。accepted candidate の identity・page output も一致（in-process の 2 回の走査と別 run の比較）。candidate id は一意、provenance の欠落 0。

## Gates
| gate | 値 | D1 の閾値 | 結果 |
|---|---:|---|---|
| G1 P1 dominant retention | 0.9996 | ≥ 0.98 | 通過 |
| G2 outlier 除外 | 2/2 | 2/2 | 通過 |
| G3 P2 body/table share | 0.804 | ≥ 0.80 | 通過（gate に近い） |
| G4 coverage | 0.917 | ≥ 0.90 | 通過（gate に近い） |
| G5 regression / fidelity / provenance / determinism / classifier 再現 | すべて 0 / 通過 | 0 | 通過 |

## Interpretation（Fact / Observation の範囲）
- Fact: frozen classifier は full population に適用でき、P1 dominant の 99.96% を header position に残し、outlier 2/2 を body/table に分け、current nonblank と non-target を変えなかった。
- Observation: P2 の 80.4% が body/table position で、header position と分類された P2 row は無い（残りは ambiguous 350）。P3 は header 0。header と分類される candidate は P1 dominant・P4・P5 に限られる。
- Interpretation: page header は table frame より上側にあるという source-only の構造が、frozen full population で再現可能な refinement rule になる。ambiguity の一部は body/table candidate に由来する可能性がある。ただし P2 share と coverage は gate の近傍で、ambiguous 1,196 row（frame の外にはみ出す・跨ぐ）が残る。
- 主張しない: header semantic correctness・P1 が正解・P2 が誤検出・precision / recall・DocumentHierarchy の correctness・item extraction accuracy・MOF reconciliation の改善・hierarchy recovery count・他年度・他様式への一般化。

## Limitations
table frame の定義（long な垂直 rule の範囲）に依存し、rule のない page（24 row）は fail-closed。ambiguous 1,196 row（frame を跨ぐ・外にはみ出す row）は今回の規則では分離できない。P2 share と coverage の閾値は事前に固定した保守的な値で、余裕は小さい。visual inspection は primary oracle ではない。rotate=90 は対象外。

## 次の研究判断（開始しない）
frozen evaluation を独立した研究成果として確定した。production には入れない。次の候補: ambiguous 1,196 row の構造分解（frame の外にはみ出す row の扱い）の preregistration、または refined alternative projection での segment・structural gate（G4）の再評価。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 134 files / 1,496 tests pass。`scripts/pipeline-v2/lib` は新規ファイルの追加のみで production diff は 0。commit: A `585d0d4`、B `11e3474`、bug fix `012d018`、C `0eea845`、D（本結果）。

今回は直前研究の table-frame relation を alternative projection の eligibility condition として 1 つだけ追加する predicate refinement の frozen evaluation であり、production title extractor / DocumentHierarchy / FieldResolver / recordKind / item detector は変更していない。
