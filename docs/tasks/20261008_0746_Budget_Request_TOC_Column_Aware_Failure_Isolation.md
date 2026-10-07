# 概算要求 TOC Structure — Column-Aware Failure Isolation

observation / failure isolation のみ。**TOC parser・preregistration・frozen GT は未着手**。Cover・Page Classification・Raw Text は変更していない。

## Pre-flight

main `66554e6d`、#388 は squash merge（head `88f6bea` と main の tests/scripts/docs 差分なし）。Raw Text digest `7c6d2dce…c4052`・Page Classification digest `39464fc7…` 一致（frozen builder 再実行、conformance mismatch 0）。TOC 82 = DIRECT 55 + INHERITED 27、55 PDF。PR-3A explored TOC 19、render 済み 3（env `000157012` p3・maff `230901-6` p4・mext `_01` p4）。

## Machine observations（82 page 全件、Raw Text のみ。`machine-inventory.json`）

- 55 PDF・29 publisher。PUA のある page 3（U+E5E3 のみ）。prefix page 参照の machine 候補 15 page（うち 1 page は視覚で偽陽性）。折返し候補（行末が数字でない行を持つ）67 page（広い heuristic）。（組織）50 page・（会計）27 page・（勘定）15 page。前 page が同一 PDF の TOC である page 27。
- 同一行に 2 つの末尾 page 番号候補を持つ行がある page は 81/82（PR-3A の指標）。**この指標は左 column の request-number（`1    01‑95 …  3` の先頭の `1`）と page 番号の組を数えてしまい、two-column の指標として混線している**（visual で右 column が空の page 01・05・10・12 のうち page 01 も該当）。
- 補助分析 `column-boundary-evidence.json`（visual 観察後の post-hoc、観測量のみ）: 「左 row の page 参照の後ろに右 row（request-number row または `（marker）` row）が始まる行」を持つ page は **38/82**。render 確認した 10 page では右 column 空 4 page ↔ 該当 0、右 column 使用 6 page ↔ 該当あり、と一致（記述的な照合）。
- 右 row の開始 column は page 内で 2 値（request-number row と、インデントのある `（marker）` row）、page 間では 20 種類以上。header 行の 2 つ目の `要求` token は 10 page で header が複数行に分かれて欠落し、右 row の開始との差は 1〜11 で一定しない。**固定 column index・header token だけでは境界を決められない**。

## Development visual sample（DEVELOPMENT_EXPLORATION）

seed `budget-request-toc-column-failure-isolation-dev-20261008`。inventory を見た後に rule（stratum と最小集合への pruning）を文章化・fixture 化してから render。PR-3A render 済み 3 page は新規 sample の denominator から除外。stratum: DIRECT・INHERITED・直前 page が TOC・右 row 開始 line 数が多い/少ない/0・折返し候補・prefix 候補・PUA（全 3 page を含める）・（組織）/（会計）/（勘定）・request-number row が多い/少ない・publisher 多様性。**12 page（DIRECT 9・INHERITED 3、8 publisher）**。うち render まで確認 10 page、Raw Text のみ確認 2 page（mof 地震再保険 p2・mof 財政融資資金 p2。ledger の `renderViewed=false`）。explored ledger: `development-explored-pages.json`（後続 GT 候補から除外すること）。

## Visual observations（render 10 page。他の 3 page は PR-3A で render 済み）

- **column frame**: 10/10 が左右 2 つの枠を持つ。右 column が空: 4（01・05・10・12）。両 column に row: 6（02・03・04・06・07・11、うち 04 は左が長く右が短い非対称）。PR-3A の render 3 page と合わせても結論は同じ（全 13 page が 2 つの枠）。corpus 全体（82）の視覚確認は未実施。
- **same-line interleave**: 右 column を使う 6/6 page で、左右の row が同じ Raw Text 行に並ぶ。右 column が空の page では起きない。
- **RAW_TEXT_ORDER_MISMATCH**: 左右の行間隔が違う page（02・07）では、Raw Text の 1 行が visual の 1 row と対応せず、右 row が左 row の折返し行や空白行と同じ raw 行に載る。reading order（左 column を下まで→右 column）は Raw Text の行順からは得られず、column 分割が前提になる。
- **wrapped row ownership**: render 確認した折返し 4 page（02・03・07・11）では、折返し fragment の所属は **x 位置（左 column の name 開始位置か右 column の name 開始位置か）と直前の同 column row** で一意に決まった。language 上の自然さは使っていない。同一 raw 行に左右の折返しが同時に載る page は観測していない（観測外）。
- **prefix page 参照**: `エ`（特別会計の勘定ごと。両 column の page 参照欄に出る、raw `エ 9`）・`国`/`国(国)`（国立国会図書館。小さい字で数字の直前、raw `国 1` / `国(国)1` で括弧の後に空白なし）。raw の表現が複数形で、通常の数字のみの page 参照とは別の field 値。意味は解釈せず raw 値として保持可能。machine 候補の 1 page（mlit 復興 p3）は視覚上 prefix なし（偽陽性）。
- **PUA**（全 3 page を目視）: U+E5E3 が row name の 1 文字として出る（mof p2・soumu 2 page。他の PUA は無い）。構造 token・階層 marker・page 参照ではない。名称の文字 fidelity に影響する（visible glyph は印字された 1 文字で見えるが、変換表は作らない）。分類: **PUA_TEXT_FIDELITY_BLOCKING（structure は non-blocking）**。
- **circled request number**: 視覚上 `①`・`⑨①` のように丸囲みの request number があり、raw では丸が落ちて通常の数字になる（render 確認した 01・02・04・07）。丸囲みの意味は解釈しない。構造情報が Raw Text で失われている可能性があるが、row の識別には影響しない。

## Continuation / hierarchy

render 確認した INHERITED 3 page（02・04・06）: 全て **PREVIOUS_TOC_STATE_REQUIRED**（page 先頭の row が `（項）` で `（組織）` が page 上に無い／先頭が request-number row で `（項）` も無い）。PAGE_LOCAL_SUFFICIENT 0・AMBIGUOUS 0。**さらに 04・06 では右 column の先頭 row が request-number row で、その親 `（項）` は左 column の最後の row**（page 内の cross-column context）。前 page から carry すべき visible raw context は `（組織）`（および 04 では `（項）`）の marker・code・name。DIRECT page（9）は先頭から階層が始まり page-local で足りる。サンプルは 3 page のみで、INHERITED 27 全体への一般化は仮説。

## Failure taxonomy（render 10 page + raw 2 page の ledger 集計）

SAME_LINE_INTERLEAVE 6、RIGHT_COLUMN_EMPTY 4、WRAPPED_ROW_OWNERSHIP 4、CONTINUATION_CONTEXT_REQUIRED 3、PUA_PRESENT 3、PREFIX_PAGE_REFERENCE 2、RAW_TEXT_ORDER_MISMATCH 2、COLUMN_BOUNDARY_AMBIGUOUS 1（04: 左長・右短）、ROW_KIND_AMBIGUOUS 0（`（marker）` と request-number の row 種別は visible token で一意に判別できた）、OTHER: circled request number が raw で失われる・cross-column context・machine prefix 候補の偽陽性。解決済みとは扱わない。

## 判定: SPLIT_REQUIRED

TOC 全体を 1 つの preregistration にすると、独立した 2 つの仮説（column segmentation / row assembly と hierarchy state の carry）を同時に扱うことになる。依存順:

1. **TOC column segmentation + row assembly**（page-local）: 右 row の開始 column を page ごとの行 evidence から取り（固定値・header token 単独は不可）、左右 column に分け、折返し fragment を x 位置と同 column の直前 row に結びつけ、row を source observation（marker・code・name parts・raw page 参照）として出力。階層は解釈しない。PUA・prefix 参照・circled number は raw 値として保持。
2. **hierarchy state carry**（前 TOC page と左→右 column の context）: 1 の出力の上に、visible な `（組織）/（会計）/（勘定）/（項）` を carry する。1 の preregistration 後。

unresolved: 同一 raw 行に左右の折返しが同時に載る場合の ownership／右 column の空判定の rule 化（38/82 の観測量を rule にしてよいか）／INHERITED 27 全体での PREVIOUS_TOC_STATE_REQUIRED／circled request number の raw 欠落の影響／PUA を含む row name の fidelity の扱い（fixture の対象外 or abstain）／corpus 全体（82）の視覚確認。

## claim boundary

TOC parser が完成した・82 page を parse できる・two-column が 82/82・same-line interleave が 82/82・hierarchy を復元できる・FY2024 全 TOC が同じ layout・future FY・MOF 対応・printed→physical 変換は主張しない。`ページ` token 2 個 = two-column とは扱っていない。machine observation（82）・visual observation（render 10 + PR-3A 3）・hypothesis・interpretation を分けた。

parser implementation・preregistration・GT freeze・Cover/Page Classification/Raw Text の変更: NOT STARTED / なし。
