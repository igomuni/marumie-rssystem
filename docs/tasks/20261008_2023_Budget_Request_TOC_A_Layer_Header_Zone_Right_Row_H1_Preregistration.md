# FY2024 概算要求 TOC A 層 — Header-Zone Right-Row 仮説 H1 Preregistration

正本: `tests/fixtures/budget-request-toc-row-assembly-header-zone-right-row-h1/2024/preregistration.json`（status `H1_PREREGISTERED_FROZEN`）。

**仮説の事前固定のみ。** parser 変更なし、development 評価なし、新しい held-out 実行なし（held-out parser 実行は #396 の 1 回のみ）。「#396 の 10 件が直る」ことの確認もしていない。judgment = `READY_FOR_HEADER_ZONE_RIGHT_ROW_H1_DEVELOPMENT_IMPLEMENTATION`（次 unit で development-only の実装を始めてよい、のみ。parser fix GO・safety GO・production GO ではない）。

## 動機（#397）

単一 family `HEADER_ZONE_WHOLE_LINE_CONTAINS_RIGHT_COLUMN_ROW_START`（10 件 / 5 page、MECHANISTICALLY_EXPLAINED）。frozen の header zone rule は「header zone の行は whole-line を TITLE_OR_HEADING として保持し分割しない」ため、E 以右に右 column の row-start token を持つ行が 1 unit に統合された。

## H1

right band E が frozen rule で解決済み（ASSEMBLED_SPLIT）の page では、header zone 内の行であっても、E 以右の segment が frozen な row-start token pattern で始まり、frozen の boundary safety を満たすなら、E で LEFT / RIGHT に分割する。**変えるのは「header zone の行は常に whole-line」の 1 点のみ**（header zone の終端定義は変えない）。

- **trigger（全て）**: ASSEMBLED_SPLIT で E 解決済み／header zone 内の行／E 以降の segment が REQUEST_TOKEN・MARKER_TOKEN・OTHER_CODE pattern のいずれかで始まる（body の右 segment と同じ判定）／BOUNDARY_CONFLICT_LINE でも BOUNDARY_CROSSING でもない／semantic inference を要しない。publisher・PDF・page・特定 token・「令和」・line index・GT 値は条件にしない。
- **non-trigger**: UNSPLIT / PAGE_ABSTAINED page、header zone 外、E 以右に text があっても row-start token がない行（negative control）、token なし wrapped fragment（既知の二次限界）、boundary safety を満たさない行（frozen の whole-line のまま）、E より左のみの行。
- **LEFT**: line[0:E] を、既存定義どおり header zone の内容として `TITLE_OR_HEADING`（column=LEFT、raw と provenance を保持）。位置のみによる既存定義で、page title か視覚行かの意味判定はしない。GT PLAIN_ROW への mapping はしない（評価上は #395 のとおり NOT_COMPARABLE）。LEFT は捨てない。
- **RIGHT**: frozen の row-start token grammar と分類（REQUEST_NUMBER_ROW / MARKER_ROW / OTHER_CODE）のみ。新 grammar・新 row kind・新 abstention reason なし。provenance は frozen model。
- **下流の差（宣言）**: H1 の RIGHT unit は body 行と同じ frozen fragment 規則で owner 候補になり得る（特例なし）。後続の header zone 行は従来どおり barrier。
- **実装境界**: #393 の source・freeze は変更せず別 version として実装し、trigger 行以外の出力が #393 と一致することを差分テストで確認する。

## 既知の二次限界

token を持たない右 column の wrapped fragment が header zone に吸収される事象（`230901-2.pdf` p3 line 10）は **H1 の対象外**（`KNOWN_SECONDARY_LIMITATION_NOT_TARGETED`）。特例は追加しない。

## population と将来の held-out

- development: 既存 explored / development 34 page + synthetic fixture のみ。
- #396 の 23 page: `POST_HOC_FAILURE_ANALYSIS_ONLY`。H1 の実装・debugging・development 評価・validation held-out への再利用、10 severe が直ったかの確認は禁止。
- 将来の held-out: #396 の 23 と development 34 を除いた残り（算術上 25 page。membership は後続 unit）。machine-only・deterministic、サンプリングせず残り全件、positive-trigger と negative-control の両方を含み、visual GT を formal evaluation 前に freeze。positive-trigger page が 0 なら `H1_UNVALIDATED`（pass にしない）。
- development 34 に trigger が無い場合の synthetic-only は自動 STOP にしないが、`DEV_SYNTHETIC_ONLY` と明記し、有効性・安全性の主張は新 held-out の結果にのみ基づく。

## 反証・metric・STOP

- 反証（safety regression / trigger 不足 / LEFT の曖昧さ）に該当すれば現 preregistration の failure として STOP し、trigger や LEFT 処理を後から調整しない。
- primary safety: false split、provenance mismatch、trigger 行以外の出力変化、page state の予期せぬ変化。primary target: trigger 件数と期待どおりの分割件数。secondary: abstention 変化、LEFT TITLE 件数、RIGHT row kind 分布、tokenless 限界の残存。#396 の severe 件数は development metric に使わない。
- threshold は `UNRESOLVED_ACCEPTANCE_THRESHOLD` のまま。

## 未解決

development 34 に trigger が実在するか（次 unit で機械確認）／新 held-out の membership と positive 件数／LEFT TITLE と GT PLAIN_ROW が NOT_COMPARABLE のままである限界／GT は同一 agent の作成。
