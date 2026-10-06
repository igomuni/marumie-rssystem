# 概算要求PDF 罫線 anchor（T1）の preregistration — anchor 定義・feasibility gate・sparse protocol

protocol（`20261005_0839_…_Inventory_Protocol.md`）と development inventory（Commit B `f2cc98a`）・thin-anchor development（Commit B2 `d658bce`）の後に、sparse range を見る前に固定する。development の結果は既に閲覧済み（以下の gate は development 結果を見た後に設定している。sparse range の結果は見ていない）。

## 1. development で分かったこと（Fact。artifact: `rule-line-development-summary.json` `810b55f9…9de7`、`rule-line-thin-anchor-development.json` `a45951b5…7e86`）

- 32 development range・7,561 page はすべて 842×595・rotate 0。primitive は vector（垂直線 69,486・水平線 34,543・矩形・曲線）で、raster 化された罫線は見ていない。線幅は 0.333（表の罫線）と 1（page 枠）の 2 種のみ。座標は 0.001pt 精度の浮動小数。
- 候補 V1..V4（long rule の左から k 番目）は、page 枠（線幅 1、x=31.1）が描かれない page で 1 つずれるため不安定（V2 は x=50.0 が 6,203 page、203.6 が 1,299 page）。
- 追加候補 T1 = long rule（page 高さの 0.5 倍以上）のうち thin（全線幅 < 0.5）な最も左の vertical rule。page 単位で 7,550 page が unique で x=50.0、11 page が unavailable（3 range）。range-local anchor（range 内の unique な page の x の最頻値）は 32/32 range で available、x はすべて 50.0。
- 全 development page の罫線は同一テンプレートで x が同じ（anchor は絶対座標 50.0 と一致する）。request 行・既存 item の code x の anchor 相対値: request は 15.5（layout 66）/ 29.3（layout 79）、既存 item 97 件は 8.6 / 22.4。特別会計にも layout 66 の range がある（会計種別は layout を決めない）。CFA の organization 7 件の offset は 8.6 で、同じ range の item の offset と同じ。
- Observation: anchor は決定的に取れるが、anchor 相対値だけでは「layout 66 の項」と「layout 79 の明細行（22.4）」・組織（8.6）を区別できない。layout（66 / 79）は request 行の x でしか決まらない（rule は同一）。

## 2. 凍結する anchor 定義（T1）

- primitive: pdf.js operator list の stroke の垂直線分を `budget-request-drawing-primitives.ts` で page 座標（左上原点）に直し、`budget-request-rule-line-anchor.ts` の canonicalization（x を 0.01pt、y 区間の隙間 0.01pt 以内でまとめる）で merged vertical rule にする。
- long rule: 長さ ≥ page 高さ × 0.5。thin: 観測した全線幅 < 0.5。page-anchor T1 = thin な long rule の最も左の x（同 x に離れた rule が複数なら ambiguous、thin な long rule が無ければ unavailable）。
- range-anchor: range 内で T1 が unique の page の x の最頻値（同数なら小さい x）。unique な page が 0 → unavailable（fail-closed。隣接 range で補完しない）。page の T1 が range-anchor と 0.1pt 丸めで一致しない page は disagreeing として計数。
- 相対座標: `codeX − rangeAnchorX`（0.1pt 丸め）。normalized 座標・複数変換の組み合わせは使わない。見えない線は生成しない。

## 3. feasibility gate（数値。sparse の結果を見る前に固定。以後変更しない）

| gate | 定義 | 閾値 |
|---|---|---|
| F1 | development 32 range のうち range-anchor が available な数 | ≥ 31 |
| F2 | control の既存 item 97 のうち range-anchor に接続できる数 | = 97 |
| F3 | development page のうち page-anchor が range-anchor と一致する割合 | ≥ 0.99 |
| F4 | control の既存 item の offset（0.1pt）の distinct 数と、development range の request 行の offset の distinct 数 | どちらも ≤ 2 |
| F5 | control の 3 桁 plain code 行（`^\d{3}$`、range anchor 基準）のうち、既存 item の offset クラスタに入る行における非 item 行（organization・detail_line・unclassified）の割合 | ≤ 0.05 |
| F6 | sparse（`range_request_x_unavailable` の 38 range）のうち range-anchor が available な数 | ≥ 36 |

F5 は development の control データだけで決まるため、sparse を見る前に結果が分かっている（上記 §1 の observation から満たさない見込みであることは既知）。これは gate を恣意的に設定した結果ではなく、semantic な区別に必要な条件を明示したもの。

判定規則（上から順）: ① frozen 入力の hash 不一致・sparse 再計算の不一致 → `INCONCLUSIVE`。② F1・F2・F3 のいずれかが偽 → `RULE_LINE_SOURCE_INSUFFICIENT`。③ F1〜F6 がすべて真 → `RULE_LINE_ANCHOR_FEASIBLE`。④ それ以外（F1〜F3 が真で F4〜F6 のいずれかが偽）→ `RULE_LINE_PRESENT_BUT_SEMANTICALLY_INSUFFICIENT`。

## 4. sparse evaluation protocol（freeze 後）

直前研究で `range_request_x_unavailable` となった detail range（38 range・35 PDF）について、page-anchor・range-anchor（available / unavailable、unique page 数、x、disagreeing page）と、その range 内の request 行（1〜4 件）の anchor 相対値を diagnostic として出す。item 候補は数えない（frozen rule は request 行で layout を決め、request 5 件未満条件は緩和しない。anchor 相対値だけでは layout が決まらないことは §1 の observation）。MOF は使わない。anchor・offset・tolerance・gate は結果を見ても変更しない。

## 5. 主張の上限

罫線が再現可能な座標系 primitive として存在するか、deterministic な anchor を構成できるか、request 件数に依存しない item detector の基礎 evidence になり得るかまで。「罫線が存在する」「deterministic anchor が作れる」「項候補に使える」「項である」を混同しない。正しい項の全件抽出、MOF 784 との一致、DocumentHierarchy が不要、organization と item の完全分離、事項の親子付け、FY2024 以外への一般化は主張しない。
