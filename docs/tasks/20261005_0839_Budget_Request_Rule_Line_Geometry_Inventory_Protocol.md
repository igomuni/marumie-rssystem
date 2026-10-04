# 概算要求PDF 罫線 geometry / 項 anchor feasibility inventory — mechanism inventory と development protocol

range-local 座標ベース項抽出（branch `research/budget-request-range-local-item-extraction`、`3699709`）の後続。評価するのは「描画 geometry（罫線・表境界）を page / range-local な座標系の primitive として使えば、request 行の件数に依存せずに項・request の相対位置を表現できるか」だけ。production の item detector・DocumentHierarchy・FieldResolver・recordKind は変更しない。Library for primitives, RS for semantics: 描画 primitive は source、「罫線から何 pt が項か」は RS 側の semantic rule。

## A. 現行 pipeline の geometry mechanism（read-only、コード根拠）

- Fact: リポジトリ内に `getOperatorList` / `constructPath` / `OPS` の使用はない（`scripts` `app` `lib` を検索）。取得層（`budget-request-pdf-page.ts`）は `page.getTextContent({ disableNormalization: true })` で text item を読み、page メタ（`view`・`rotate`）を使うだけ。
- Fact: SourceToken は text item の bbox / transform / rawText / フォント情報。TableGeometry は SourceToken だけから行クラスタ・列帯を観測する（冒頭コメント: 入力は SourceToken、罫線文字 `│` 等の token は行には含めるが列帯観測からは除外）。つまり現在の「geometry」は文字配置のみで、描画された線・矩形は使っていない。
- Fact: layout inventory の column header geometry は見出し token（text）の x から作っている（描画線ではない）。range-local detector は request 行の code token の x を基準にする（text のみ）。
- 結論: 現行 pipeline は罫線（描画 primitive）を使っていない。研究用に pdf.js の operator list を別途観測する（既存依存 `pdfjs-dist` 5.4.296。新しい PDF library は追加しない）。

## B. 観測できた primitive の形式（development 前の 1 page 確認。開示）

anchor 規則を決める前に、pdf.js の operator list の形式確認として `ippan_o.pdf` page 30 の primitive だけを閲覧した（この段階で anchor の選択・閾値の決定は行っていない）。page は 842×595（回転なし）、`constructPath` は `[paintOp, [Float32Array pathData(moveTo=0,lineTo=1,curveTo=2,quadraticCurveTo=3,closePath=4 の列)], minMax]`、`setLineWidth`・`transform`・`save`/`restore` が別 operator。描画は vector で、raster 化された罫線は見ていない。観測された primitive の種類は、水平線・垂直線（stroke、線幅 0.333 / 1）、曲線（page 番号枠の角丸）で、同一座標が 0.001pt 精度の浮動小数。

## C. Primitive の source-faithful 表現と canonicalization

- raw primitive（`lib/budget-request-drawing-primitives.ts`）: `operatorIndex` / `pathIndex` / `kind`（line・rect・curve）/ `paint`（stroke・fill・fill_stroke・none・other）/ `lineWidth`（setLineWidth の現在値）/ 端点または矩形の対角（page 座標、左上原点・y 下向き、現在の変換行列を `transform` `save` `restore` で追跡して適用、0.001pt に丸め）/ `orientation`（vertical・horizontal・oblique・area）/ 長さ。clip・見えない線の生成・補完・OCR は行わない。
- canonicalization（比較用。raw は残す）: 垂直線は、x（0.01pt に丸め）が同じで y 区間が重なる・接する（隙間 0.01pt 以内）stroke の線分を 1 本の「merged vertical rule」にまとめる（`x`・`yMin`・`yMax`・観測した線幅の集合）。水平線も同様に merged horizontal rule。fill の矩形（線として描かれた細い矩形）は raw に残すが merged rule には含めない（stroke のみ）。

## D. Development population

anchor の探索・定義は、直前研究で `evaluable_detail_range` だった 32 range（`full-evaluation.json` `421dbf8b…519d`）と、その range の request 行・hierarchy 契約 8 PDF の既存 item 97 / organization / detail_line / unclassified に限る。MOF は anchor の発見・選択・閾値に使わない。sparse（`range_request_x_unavailable` 38 range）は、anchor 規則の freeze 前には調整に使わず、結果も見ない。

## E. 先に固定する観測項目（development inventory。anchor は選ばずに候補を列挙）

1. 各 development page の primitive 件数（kind・paint・orientation）、線幅の分布、page サイズ・rotate。
2. merged vertical rule の x の分布（range 単位・PDF 単位・会計別・layout variant 別）と、各 rule の y 区間。
3. 候補 anchor（request に依存しない定義だけ。有限集合として事前に固定）: `long rule` = 長さ（yMax−yMin）が page 高さの 0.5 倍以上の merged vertical rule。`V1..V4` = page の long rule を x の小さい方から数えた k 番目（k=1..4）。ordinal の定義は page 内の観測だけを使う。
4. 各候補 Vk について: 観測できる range / page の割合、page 内での unique / ambiguous / unavailable（k 番目が存在しない・同 x の long rule が複数ある等）、range 内・page 間の x の安定性（distinct 値・クラスタ（0.1pt）・min / max / median / spread）。
5. 相対座標 diagnostic（control の既存 item 97・request 行・known organization・detail_line・unclassified）: `itemCodeX − Vk.x` と `requestCodeX − Vk.x`（page ごとに、その page の Vk を使う）。現行基準 `itemCodeX − requestRefX`（−6.9pt ±1.0pt）は再現確認のみ。normalized（÷table 幅）は diagnostic のみで、複数変換を組み合わせて detector を作らない。
6. CFA の organization 7 件の offset が item と同じか別か、geometry だけでは区別不能か（区別不能なら `semantic_boundary_required`）。`001630395.pdf` と mixed-layout PDF の挙動。

## F. 判定規則・feasibility gate の扱い

数値 gate（「大部分」「狭い」）は、development の primitive の座標精度（0.001pt 浮動小数、重複表現）を確認した後、sparse range を見る前に、別の preregistration（Commit C）に明記して freeze する。development で viable anchor が得られなければ sparse には進まず終了する。結果の分類: `RULE_LINE_ANCHOR_FEASIBLE` / `RULE_LINE_PRESENT_BUT_SEMANTICALLY_INSUFFICIENT` / `RULE_LINE_SOURCE_INSUFFICIENT` / `INCONCLUSIVE`。

## G. 順序・禁止

Commit A（本書）→ B（research-only 計測・development inventory）→ C（anchor 定義・gate・sparse protocol の preregistration、viable anchor がある場合のみ）→ D（sparse held-out、実施する場合）→ E（result freeze）。production の item detector・DocumentHierarchy・FieldResolver・recordKind、range-local detector の frozen rule、request 5 件未満条件の緩和、rotate=90、fuzzy、MOF による anchor / threshold の探索、raster / OCR による罫線の補完、見えない線の推測、PR 作成は行わない。claim boundary: 罫線の存在・deterministic な anchor の構成可否・項候補に使える可能性・項であること、を混同しない。
