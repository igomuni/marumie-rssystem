# 概算要求PDF P1 geometry outlier 2 row の failure isolation — 結果

protocol: `20261005_1255_Budget_Request_P1_Outlier_Failure_Isolation_Protocol.md`（Commit A `6a88f3e`、doc SHA-256 `446bdfc4…a7ac`）。source-only の evidence packet と分類は Commit B `57b0ebc`（visual inspection の前）、visual inspection と decision は Commit C `8f19f42`、本結果は Commit D。predicate・alternative projection・threshold・production は変更していない。結果を見て閾値を調整していない。P1 は human GT ではなく、P2 を誤検出と仮定していない。MOF・manual hierarchy contract を oracle にしていない。

**Decision: `P1_OUTLIERS_BODY_TABLE_SUPPORTED`（D1）。** 2 outlier row はいずれも、source geometry でも実ページの視覚確認でも、表の枠の内側の本文 row だった。

## Pre-flight / frozen dependencies
branch `research/budget-request-p1-outlier-failure-isolation`、親 `f196d9d`、origin/main `38e5080`（chain は未 merge）。frozen 入力（universe 内容 `ee0b2580…`／gz `429ad6c0…`・comparison `fd90b142…`・examples `cf54c79f…`）の hash を script が照合。再確認: P1 = 2,532、P2 = 1,786、ambiguous page = 1,123、P1 の dominant topBin `0.02` = 2,530。working tree は未追跡 `.DS_Store` 2 件のみ。

## Outlier selection（機械的）
P1 の最頻 `topBin`（0.02）と異なる topBin の row = 2 row（hard-code せず、期待値と一致することを STOP 条件にした）:
1. `2023_fukkochougaisansaisyutsu.pdf` page 66、logical row 4、tokens は `population-freeze.json`。raw `015 国民健康保険助成費（社 会福祉費）`、bbox x 86.3–183.4・y 55.6–69.4。
2. `r6gaisan-yokyusyo-250905.pdf` page 18、logical row 6。raw `016 増 員 要 求 に 伴 う 経 費 （新規増員）`、bbox x 72.5–514.5・y 90.3–97.2。
control（inspection 前に freeze）: 2 outlier の PDF に P1 dominant row が無いため、規則の (2) により P1 dominant の id 辞書順先頭 `cms_caa205_230914_03.pdf` page 104 row 0（raw `100 内（消）`）。aggregate control は P1 dominant 2,530 row。

## Source-only evidence と分類（visual inspection の前）
table frame = page の long な垂直 rule の範囲（両 page とも x 31.06–797.18、y 27.775–555.498）。
| row | candidate の bbox | 分類 | 根拠 |
|---|---|---|---|
| outlier 1（fukko p66） | y 55.6–69.4・x 86.3–183.4 | `SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED` | frame の内側（frameTop 27.775 の下、frameBottom の上） |
| outlier 2（sangiin p18） | y 90.3–97.2・x 72.5–514.5 | `SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED` | frame の内側 |
| control（caa p104 row 0） | y 20.8–27.8・x 38–83 | `SOURCE_HEADER_POSITION_SUPPORTED` | yMax 27.8 ≤ frameTop 27.775 + 0.5 |
分類に first code row・P1 であること・raw text の意味は使っていない。source-only で ambiguous は 0 件。

## Visual evidence（`pdftoppm` 100 dpi で実ページを render して確認）
- outlier 1: page 上端の表の外側には数字 `60` のみ。candidate は列見出し（要求番号・事項・前年度予算額…）の下、表本体の「事項」列に `015` の番号とともに、他の本文 row（`005`・`06081-…`・`020` など）と並んで表示されている。candidate と本体の間に視覚的境界はない。→ `VISUAL_BODY_OR_TABLE_POSITION_SUPPORTED`。
- outlier 2: 上端は数字 `14` のみ。candidate は表の「事項」列の、`95012-…` の row と `001` の row に挟まれた本文 row。→ `VISUAL_BODY_OR_TABLE_POSITION_SUPPORTED`。
- control: 文字列 `100 内（消）` が page 左上の表の枠の外側に独立して表示され、表の上端の罫線が境界。→ `VISUAL_HEADER_POSITION_SUPPORTED`。
source と visual の判定は一致し、矛盾はない。画像は commit しない（再生成コマンドは `visual-evidence.json`）。

## Control comparison
| axis | outlier | control |
|---|---|---|
| top position | y 55.6 / 90.3（表の内側） | y 20.8（frame の上） |
| x extent | 86.3–183.4 / 72.5–514.5 | 38–83 |
| width | 97 / 442 pt | 45 pt |
| first code relation | same_as_first_code（row 4 / 6） | same_as_first_code（row 0） |
| table / rule relation | frame の内側。直上の水平 rule は y 48.606 | frame の上側。直下の水平 rule は y 27.775 |
| preceding rows | 列見出し行（`番号 予 算 額…`）/ `95012-…` の本文 row | なし |
| following rows | `005 …`（code row）/ `行政職給料表（一）…` | 列見出しの行 |
| adjacent-page title structure | 前後 page の先頭は数字のみ（`59`・`61` / `13`・`15`）、current projection は blank → alternative が first code row を採用 | 前後 page は `内（消） 99`・`内（消） 101` で current projection が nonblank |
| source-only classification | body / table | header |
| visual classification | body / table | header |

## Interpretation（Fact / Observation を超えない範囲）
- Fact: 2 outlier は表の枠の内側の本文 row で、alternative projection が current projection の blank（page の最上部に数字のみ）の後、最初の code row（本文 row）を frozen label-shaped predicate で label-shaped と判定して採用した結果。
- Observation: dominant P1 2,530 row との geometry の差は page-header / body-table placement の違いとして説明できる（上端の枠の外 vs 表の内側）。first code row との関係（same_as_first_code）は outlier と control で同じで、分離に使えない。
- Interpretation: P1 の「全件維持」を predicate refinement の制約にする根拠はない。dominant P1 2,530 と outlier 2 を分けるのは placement（table frame との関係）の違いで、次 phase で preregister する根拠になる。
- Unresolved: 新しい predicate の精度・header label の semantic correctness・P2 側の本文行との関係の全体。

## Limitations
2 row のみの failure isolation で、一般化しない。table frame の定義（long な垂直 rule の範囲）は本 phase の分類のために事前に固定した規則で、他の layout では frame が取れない page がある。visual inspection は 1 page ずつの人間可読な確認で、GT ではない。rotate=90 は対象外。

## 次 phase の可否
predicate refinement の preregistration へ進める根拠は得られた（placement を table frame との関係で記述する案を含め、閾値は新たな preregistration で事前に固定し、この 2 件に合わせて選ばない）。production は変更しない。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 133 files / 1,491 tests pass（population = 2・candidate id の重複 0・provenance 欠落 0 の integrity test を含む）。packet・decision の再生成で artifact 不変（packet `de126ad5…`、decision `459b2175…`）。`scripts/pipeline-v2/lib` は新規ファイルの追加のみで production diff は 0。commit: A `6a88f3e`、B `57b0ebc`、C `8f19f42`、D（本結果）。

今回は P1 geometry outlier 2 row の failure isolation のみで、P1 は human GT ではなく、P2 を誤検出と仮定しておらず、MOF / manual contract を oracle にせず、predicate / production title extractor を変更せず、結果を見て閾値を調整していない。
