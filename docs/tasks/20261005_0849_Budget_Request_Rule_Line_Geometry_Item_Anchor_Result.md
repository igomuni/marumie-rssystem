# 概算要求PDF 罫線 geometry / 項 anchor feasibility — 結果

protocol `20261005_0839_…_Protocol.md`（Commit A `2cfb837`）→ development 計測（B `f2cc98a`、B2 `d658bce`）→ 事前登録（C `f7e2936`、doc SHA-256 `e81d7cf7…4da7`）→ sparse 評価（D `24f331f`）。gate・anchor 定義は sparse を見る前に固定し、変更していない。production code は無変更（`scripts/pipeline-v2/lib` は新規ファイルの追加のみ）。

**判定: `RULE_LINE_PRESENT_BUT_SEMANTICALLY_INSUFFICIENT`（規則 4）。** 罫線は再現可能な座標系 primitive として存在し、deterministic な anchor が取れるが、anchor 相対値だけでは項・organization・明細行を区別できない。

## Fact / Observation / Interpretation

### 現行 pipeline（Fact）
リポジトリに `getOperatorList` / `constructPath` の使用はない。取得層は `getTextContent` と page メタ（view・rotate）のみ。SourceToken / TableGeometry / layout inventory / range-local detector の geometry は文字配置（text の x・行・見出し token）で、描画された線は使っていない。罫線文字 `│` の token は列帯観測から除外している。

### 観測できた primitive（Fact）
pdf.js 5.4.296 の operator list（既存依存）から取得可能。development の 32 range・7,561 page（すべて 842×595・rotate 0）で、垂直線 69,486・水平線 34,543（stroke）・矩形 1,347・曲線 9,507 ほか。線幅は 0.333（表の罫線）と 1（page 枠）の 2 種のみで、座標は 0.001pt 精度。raster 化された罫線は見ていない。canonicalization: stroke の垂直線分を x（0.01pt）が同じで y 区間が接するものごとに merged vertical rule にまとめる。raw primitive（operator index・path index・線幅・変換後座標）は保持。

### anchor 候補（Observation）
- V1..V4（long rule の左から k 番目）は、page 枠（線幅 1、x=31.1）が描かれない page で 1 つずれ、不安定（V2: x=50.0 が 6,203 page、203.6 が 1,299 page）。
- T1（thin な long rule の最も左）: page 単位 7,550 / 7,561 が unique で x=50.0（11 page は unavailable、3 range）。range-local anchor は 32/32 range で available、x はすべて 50.0。罫線はテンプレート共通で、x が全 page 同じ。

### 相対座標（Observation、development control）
- 既存 item 97 / 97 を anchor に接続（F2）。offset は 8.6（layout 66、81 件）と 22.4（layout 79、16 件）の 2 クラスタ。development range の request 行は 15.5（layout 66）と 29.3（layout 79）の 2 クラスタ。会計種別は layout を決めない（特別会計にも layout 66 がある）。現行基準の再現: `itemCodeX − requestRefX` は item 97 件すべて −6.9（organization は −13.8 が 13、−6.9 が 7）。
- organization: CFA の 7 件の offset は 8.6 で、同じ range の item の offset と同じ → geometry では区別できない（`semantic_boundary_required`）。
- contamination（F5）: 3 桁 plain code 行のうち item の offset クラスタ（8.6 / 22.4）に入る 887 行のうち、非 item が 790 行（89%。detail_line 613、organization 7、unclassified 170）。layout 66 の明細行（offset 22.4）が layout 79 の項（offset 22.4）と重なり、layout の違い（request x でしか決まらない）が必要になる。
- `001630395.pdf`: range 7-10 の anchor は 50.0、request offset 29.3、item offset 22.4（layout 79）。前置き表の page 3・5 は detail range ではない。

### sparse range（`range_request_x_unavailable` の 38 range・35 PDF、gate F6）
38 / 38 range で anchor が available（x=50.0、page 単位 unique 583 / 600、disagreeing 17 page）。anchor 自体は request 件数に依存せず観測できる。range 内の request 行 82 件の offset は 15.5 が 68、29.3 が 10、他に 19.0（1）・25.9（3）。item 候補は数えていない（frozen rule は request 行で layout を決め、5 件未満条件は緩和しない）。

### Gate

| gate | 値 | 閾値 | 結果 |
|---|---|---|---|
| F1 development range の anchor | 32 / 32 | ≥ 31 | 通過 |
| F2 既存 item の接続 | 97 / 97 | = 97 | 通過 |
| F3 page の一致 | 7,550 / 7,561 | ≥ 0.99 | 通過 |
| F4 offset クラスタ | item 2・request 2 | ≤ 2 | 通過 |
| F5 contamination | 0.891 | ≤ 0.05 | **不通過** |
| F6 sparse の anchor | 38 / 38 | ≥ 36 | 通過 |

F5 は development の control データだけで決まり、事前登録の時点で結果は既知だった（§1 の observation）。

### Interpretation
- 「罫線が存在する」「deterministic な anchor が作れる」は source evidence で示せた。anchor は sparse range にも持ち出せる（F6）。
- ただし「項候補に使える」は不十分: anchor はテンプレート共通で絶対 x と同値のため、anchor 相対値は request x 基準より情報が増えない。layout（66 / 79）の判定に request 行が要り、項・organization・明細行は offset が重なる。「項である」とは言えない。
- 次に進める価値があるのは、request 件数に依存しない item detector の事前登録そのものではなく、layout を決める別 evidence（request 以外）と organization / 項の semantic boundary evidence の調査。

## MOF diagnostic
実施していない（anchor と detector が freeze されず、候補を作らなかったため）。

## Limitations
development は layout inventory の evaluable range（32）に限られ、request が 5 件以上ある range に偏る。rotate=90 の 8 PDF は対象外。罫線は FY2024 のこの帳票テンプレートに共通で、他年度・他テンプレートには一般化しない。F5 は plain3 行と control の ON kind に依存する（ON の unclassified は誤検出と断定していない）。

## 検証
tsc エラー 0・lint エラー 0・vitest 125 files / 1,463 tests pass。development inventory・thin-anchor・sparse・decision の再実行で artifact 不変（`810b55f9…`・`a45951b5…`・`b6e652c3…`、pages `806ab997…`）。frozen 入力 hash は script が実行時に照合。

今回は、FY2024 概算要求PDFの既存 frozen corpus で、表の drawing primitive から deterministic な rule-line anchor を構成できるか、またその anchor に対する item/request code の相対座標が request 件数に依存しない item-shaped row detector の基礎 evidence になり得るかを調べる研究である。production の item detector、DocumentHierarchy、FieldResolver、recordKind は変更していない。
