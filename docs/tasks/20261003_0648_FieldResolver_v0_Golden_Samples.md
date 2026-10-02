# FieldResolver v0 Golden Samples

Contract は `20261003_0648_FieldResolver_v0_Contract.md`。FieldResolver 本体は実装しない。Golden は評価専用で、FieldResolver の inference より先に固定する。この文書は段階的に書く（棚卸し・再利用判定 → 観測・coverage matrix → 検証・freeze）。**現在: 棚卸しと再利用判定まで（commit 1）。**

## 1. asset inventory（既存資産の棚卸し）

| asset | documents / pages | fields | visual human-confirmed? | source refs? | reusable for FieldResolver GT? |
| --- | --- | --- | --- | --- | --- |
| `tests/fixtures/budget-request-extraction/2024/golden-samples.json` | METI p9 / MHLW p1268・p1555 / MEXT p876（4 locator） | locator のみ（`groundTruthStatus: pending-human-review`） | — | canonicalUrl + 物理ページ | **locator として再利用**（値は無い） |
| `…/human-observations.json` | METI p9 / MHLW p1268・p1555（MEXT p876 は無し） | 6件: text 断片と位置（x, y）だけ | 過去に人間が目視・座標確認（ファイルの note より） | x, y（SourceToken bbox の xMin / yMin と同じ座標系） | **位置のアンカーとして部分的に再利用**（§2） |
| SourceToken / TableGeometry / LogicalRow の fixture・テスト | 合成データ + 実PDFの golden test（ローカル原本があれば実行） | 観測のみ（rawText・bbox・行構成）。値の正解ではない | — | あり（SourceToken.index 等） | **GT としては使えない**（出力の観測。入力として使う側） |
| hierarchy GT 8文書（`*-toc-hierarchy-gt*.json`） | MHLW・METI・MEXT・環境省・農水省復興特会・MLIT復興特会・防衛省・こども家庭庁 | 組織・項・要求の名称・コード・親・開始頁（目次由来） | 目次の機械転記（視覚確認ではない） | 目次ページ | **field GT には使えない**（金額・符号・blank を持たない）。hierarchy の入力状態の参考のみ |
| hierarchy artifacts（`data/work/…`、gitignore・再生成可能） | METI 9–106、MHLW 1555–1700、MEXT 1045–1339 ほか | `nodes[]`・`edges[]`・`hierarchyResolutionContext`・`headerCollisionObservation` | — | あり（sourceRowRefs・sourceTokenRefs） | **FieldResolver の入力**（GT ではない）。hierarchy-dependent field の入力状態の根拠 |
| extraction / semantic candidate の既存テスト | 合成・golden | 観測・候補（金額group・signObservation など） | — | あり | **GT としては使えない**（候補の観測。正解ではない） |
| docs に記録された人間視認値 | `docs/data-pipeline-v2.md` 等 | 手法・観測の記述（個別の金額の正解値は無い） | — | — | 再利用できる値は無い |

結論: **金額・符号・blank・備考・差額の Golden として使える既存資産は無い**。`human-observations.json` は、対象行の text の位置を示すアンカーとしてだけ部分的に使える。足りない分は、新規の視覚観測で作る（既存の extraction 出力や抽出テキストをコピーして正解にしない）。

## 2. `human-observations.json` の再利用判定

| observation | visual human-confirmed? | exact page? | exact target? | raw field value? | blank 区別? | sign 観測? | provenance は十分? | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| METI p9 `01-95`（x 65.569, y 131.93） | ○（過去に人間が目視・座標確認） | ○（物理p9） | ○（要求 `01-95` の行） | code の text のみ | ✗ | ✗ | 位置（x, y）のみ | **partial**: code・行のアンカーとして再利用 |
| METI p9 `経済産業本省一般行政`（x 89.726, y 131.93） | 同上 | ○ | ○ | name の先頭断片のみ（折返し名称の全体ではない） | ✗ | ✗ | 位置のみ | **partial**: name の行アンカー |
| METI p9 `（要求要旨）`（x 469.336, y 131.93） | 同上 | ○ | ○ | ラベルのみ（本文なし） | ✗ | ✗ | 位置のみ | **partial**: remark_text 候補の位置アンカー |
| MHLW p1268 `020`（x 58.667, y 111.099） | 同上 | ○ | ○（項 `020` の行） | code のみ | ✗ | ✗ | 位置のみ | **partial**: code・行のアンカー |
| MHLW p1555 `01-95`（x 65.569, y 423.567） | 同上 | ○ | ○（要求 186 の行） | code のみ | ✗ | ✗ | 位置のみ | **partial**: code・行のアンカー |
| MHLW p1555 `（要求要旨）`（x 469.336, y 451.342） | 同上 | ○ | ○ | ラベルのみ | ✗ | ✗ | 位置のみ | **partial**: remark_text 候補の位置アンカー |

- **金額GTとして十分か**: ✗（金額の値が1件も無い）。**符号GT**: ✗。**blank/null GT**: ✗。**備考GT**: ✗（ラベルの位置のみ）。
- **visual observation か extracted text 由来か**: ファイルの note によると「人間が過去にPDF原本で目視・座標確認した値」（visual + 座標）。ただし値は text 断片と位置だけで、field の値ではない。
- 使い方: Golden の `humanAnchors` として、位置（x, y）をそのまま参照・移植してよい（上の5〜6件）。それ以外の field（金額・符号・blank・差額・備考・MEXT p876 の全て）は、**新規の視覚観測**で作る。既存値から Golden を推測して埋めない。

## 3. 以降（commit 2・3 で追記）

selected documents/pages、why each sample exists、field coverage matrix、negative/boundary coverage、hierarchy-risk coverage、observation method、GT contamination boundary、freeze commit、known gaps。
