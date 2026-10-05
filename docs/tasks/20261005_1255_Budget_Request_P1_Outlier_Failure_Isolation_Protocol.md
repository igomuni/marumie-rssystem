# 概算要求PDF P1 geometry outlier 2 row の failure isolation — protocol と population freeze（個別 page の inspection の前に固定）

label-shaped predicate ambiguity isolation（branch `research/budget-request-label-shaped-predicate-ambiguity-isolation`、`f196d9d`）の後続。P1（projected candidate）2,532 row のうち dominant geometry から外れる 2 row だけを対象にする failure isolation で、predicate refinement ではない。問い: この 2 row は、通常の P1 とは異なる geometry を持つ genuine な page-header candidate か、current / alternative projection が本文・表内 row を P1 として採用した結果か、source evidence だけでは判定不能か。top / x / width の閾値・predicate・alternative projection・production は変更しない。P1 は human GT ではなく、P2 を誤検出と仮定しない。MOF・manual hierarchy contract を oracle にしない。文字列の意味だけで「header っぽい」「本文っぽい」と分類しない。

## 1. Frozen dependencies
universe `candidate-universe.json.gz`（内容 SHA-256 `ee0b2580…d35f`、gz `429ad6c0…b776`）・`comparison-decision.json`（`fd90b142…ccda`）・`representative-examples.json`（`cf54c79f…56d9`）。再確認する値: P1 = 2,532、P2 = 1,786、ambiguous page = 1,123。件数・hash が一致しなければ STOP。

## 2. Outlier population（frozen selection rule）
手で選ばない。universe の P1 のうち、最頻の `topBin`（同数なら辞書順で小さい値）を機械的に求め、それと異なる `topBin` の row を `P1_GEOMETRY_OUTLIER` とする。dominant row 数と outlier 数は期待値（2,530 / 2）を事前の STOP 条件とするだけで、population の定義には hard-code しない。outlier が 2 row でなければ STOP。
個別 inspection 用 control: outlier ごとに、(1) 同一 PDF 内の P1 dominant row の candidate id の辞書順先頭、(2) なければ P1 dominant の candidate id の辞書順先頭。aggregate control は P1 dominant 全件。control の id は inspection 前に `population-freeze.json` に freeze する。
開示: 前研究の representative examples（topBin 0.08 / 0.14 の overlap 例）で、outlier 候補の raw の一部を既に見ている（意味での分類はしていない）。individual page の inspection（render・罫線・隣接 page）は本 protocol の freeze 後に開始する。

## 3. Phase A — source-only evidence packet（visual inspection の前）
各 outlier と control について保存: identity / provenance（candidate id・localPath・page・logicalRowIndex・token index・raw・normalized・page 幅・高さ・rotate）、geometry（row の top / bottom / 高さ・minX / maxX / 幅・first / last token x・topBin / maxXBin / lastTokenXBin / widthBin、前研究の row-local feature 一式）、projection context（first code row index・relativePosition・deltaToFirstCode・codeShapedRowBefore・candidate が first code row 自身か・前後の label-shaped candidate。row-local predicate evidence とは分離する診断用）、page-local structure（candidate 前後 ±10 logical rows。各 row の index・raw・code / request / label-shaped flag・token refs・x / y・current projection に含まれるか）、drawing / table structure（既存の rule-line primitive: page の long な垂直線・水平線と、candidate 近傍の horizontal / vertical rule。見えない罫線は補完しない）、adjacent-page context（同一 PDF の p−1・p・p+1 の先頭 logical rows・current / alternative projected title・label-shaped candidate・page 幾何。隣接 page から label を補完しない）。

## 4. Phase A — source-only classification（固定規則。visual inspection の前に決める）
table frame = その page の long な垂直 rule（長さが page 高さの 0.5 倍以上の merged vertical rule。`budget-request-rule-line-anchor.ts`）の y 範囲 [`frameTop` = 最小の yMin, `frameBottom` = 最大の yMax] と x 範囲 [`frameLeft`, `frameRight`]。candidate の bbox（row の yMin / yMax / xMin / xMax）について、許容 0.5pt で:
- `SOURCE_HEADER_POSITION_SUPPORTED`: frame が存在し、candidate の yMax ≤ frameTop + 0.5（table frame より上側に独立して配置されている）。
- `SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED`: frame が存在し、candidate が frame の x・y 範囲の内側（yMin ≥ frameTop − 0.5 かつ yMax ≤ frameBottom + 0.5 かつ xMin ≥ frameLeft − 0.5 かつ xMax ≤ frameRight + 0.5）。
- `SOURCE_POSITION_AMBIGUOUS`: 上記以外（frame が無い、frame を跨ぐ、など）。
禁止: 「P1 だから header」「first code row だから body」・raw text の意味・manual contract・MOF。根拠（frame の座標と candidate の bbox）を row ごとに列挙する。ordering・adjacent page・first code 関係は分類に使わず、比較の補助 evidence として保存するのみ。

## 5. Phase B — visual inspection gate
`SOURCE_POSITION_AMBIGUOUS` が 1 件でもあれば、その outlier の original PDF の該当 page を実際に render（`pdftoppm`）して視覚確認する。source で分類できた row も confirmation として確認してよいが、source と visual の判定を混ぜない。問い: (1) candidate text は page 上端の header 領域に独立して表示されているか、(2) 表の罫線・列・本文 row の内部に表示されているか、(3) candidate と main table / body の間に視覚的な境界があるか、(4) 前後 page の header と同じ視覚的位置・役割に見えるか（補助。前後 page から文字列を補完しない）。visual classification: `VISUAL_HEADER_POSITION_SUPPORTED` / `VISUAL_BODY_OR_TABLE_POSITION_SUPPORTED` / `VISUAL_AMBIGUOUS`。見えない文字・境界・罫線を推測しない。抽出 text だけを visual evidence としない。

## 6. Control comparison（最低限）
top position・x extent・幅・first code との関係・table / rule との関係・前後の row・隣接 page の title 構造・source-only 分類・visual 分類。違いが page-header / body-table placement の違いとして説明できるかを見る。

## 7. Decision（事前登録）
2 outlier それぞれの最終分類（visual を実施した場合は visual を優先し、source と矛盾する場合は理由を記録して STOP 判断）に基づく。
- D1 `P1_OUTLIERS_BODY_TABLE_SUPPORTED`: 2/2 が body / table position（source または visual）。
- D2 `P1_OUTLIERS_HEADER_SUPPORTED`: 2/2 が header position。
- D3 `P1_OUTLIERS_MIXED`: 1 件が header、1 件が body / table。
- D4 `P1_OUTLIERS_UNRESOLVED`: 1 件以上が最終的に ambiguous。
結果を見て threshold（`topBin == 0.02`・y・width・x・rule-line offset など）を「この 2 件を落とせる値」として採用しない。D1 でも predicate refinement は次 phase で改めて preregister する。新 predicate の精度は主張しない。

## 8. Commit 順序・STOP
Commit A（本書・selection script・population freeze）→ B（source-only evidence packet と分類）→ C（visual inspection と decision、必要な場合）→ D（result・INDEX・integrity test）。protocol freeze 前に outlier page を個別 inspection しない。STOP: frozen hash 不一致・P1 ≠ 2,532・dominant ≠ 2,530・outlier ≠ 2・provenance 欠落・original PDF が特定できない・source と visual が矛盾して説明できない・production diff・test failure・想定外の working tree 変更。
