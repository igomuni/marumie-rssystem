# 概算要求 Page Classification v0 — Preregistration

classifier 未実装。本 doc と candidate fixture を visual GT 作成前に commit する。GT を見た後に本 doc の規則・seed・split・閾値を変更しない（変更が必要になった場合は STOP）。

## 1. Research question

PR-1 の Raw Text と Phase A の EMPTY-page observation だけを使い、FY2024 概算要求 PDF の physical page を安全に section/page form へ分類できるか。目的は後続の構造化・検索の page routing。項・事項・金額抽出と MOF 照合は対象外。

## 2. 入力（frozen）

- Raw Text corpus digest `7c6d2dce…c4052`（9,899 pages / 82 PDFs）。
- Phase A fixture: 117 internal EMPTY（VISUALLY_BLANK 116 / RASTER_OR_IMAGE_DOMINANT 1 / UNRESOLVED 0）。
- 母集団: Raw Text EXTRACTED（TEXT_OBSERVABLE）**8,968**、EMPTY 931（再計算で一致を確認）。

## 3. 軸の分離

観測軸 `PageObservationStatus` と意味軸 `SemanticPageType` を混ぜない。

| 観測 status | 対象 | semantic type |
|---|---|---|
| TEXT_OBSERVABLE | Raw Text EXTRACTED 8,968 | 分類対象 |
| NO_TEXT_VISUALLY_BLANK | Phase A VISUALLY_BLANK 116 | 付けない（OTHER ではない） |
| NO_TEXT_CONTENT_PRESENT | Phase A RASTER_OR_IMAGE_DOMINANT 1（MEXT p1044） | 付けない。前後から補完しない |
| NO_TEXT_UNRESOLVED | fully-EMPTY の MOJ 001402818（737p）・FSA 6youkyuu-2/01（77p）計 814 | 付けない。116 blank と同一視しない |

SemanticPageType（freeze）: `COVER / TOC / SUMMARY / DETAIL / STAFFING / PRIORITY_SUMMARY / PRIORITY_DETAIL / OTHER / UNRESOLVED`。`UNRESOLVED` は正常な安全出力。classification basis は `DIRECT / INHERITED / UNRESOLVED` として別に保持する。

## 4. DIRECT evidence rule（frozen matcher）

実装: `scripts/pipeline-v2/lib/budget-request-page-classification-direct.ts`。

- window: PR-1 `nonEmptyLines` の**先頭 5 行**（raw text は書き換えない）。
- title 行: 行内 whitespace（JS `/\s/`、全角空白を含む）をすべて除いた文字列が `令和` で始まり、かつ title literal で**終わる**行。NFKC・文字置換・fuzzy・辞書補完なし。目次の項目行（title の後ろに `・・・` と頁番号が続く）は行末が title でないため hit しない。
- precedence（specific → generic）: `重要政策推進枠要望額総表`=PRIORITY_SUMMARY → `重要政策推進枠要望額明細表`=PRIORITY_DETAIL → `概算要求額総表`=SUMMARY → `概算要求額明細表`=DETAIL → `概算要求定員表`=STAFFING → `目次`=TOC → `歳出概算要求書`=COVER。
- 先頭 5 行に**異なる family が複数**あれば CONFLICT → `UNRESOLVED`（推測で解決しない）。COVER title と jurisdiction header の併存は矛盾ではない。
- 根拠: 事前探索（classifier 実装前）で explicit title の start page が COVER 69 / TOC 55 / SUMMARY 69 / DETAIL 73 / STAFFING 44 / PRIORITY 各 1 と観測済み。上記 matcher の hit 数は全 family でこれと一致、CONFLICT 0。この探索は corpus 全体に及んでいるため、下記の評価集合を「歴史的に未観測の held-out」とは呼ばない。

## 5. INHERITED rule（hypothesis。v0 実装で使う規則）

DIRECT title の無い TEXT_OBSERVABLE page に限る。

- state の範囲は**physical PDF 内のみ**。PDF 境界・logical document 境界を越えて継承しない。
- 継承できる type: TOC / SUMMARY / DETAIL / STAFFING / PRIORITY_SUMMARY / PRIORITY_DETAIL。COVER・OTHER・UNRESOLVED は継承しない。
- blank bridge: Phase A VISUALLY_BLANK の 116 page は state を変えない（blank 自身に type は付けない）。
- reset: Phase A RASTER_OR_IMAGE_DOMINANT・fully-EMPTY MOJ/FSA・将来の `NO_TEXT_UNRESOLVED`・CONFLICT page では state を破棄し、橋渡ししない。
- 新しい DIRECT title が出た page から state を更新。look-ahead と、direct evidence に矛盾する補完はしない。
- `OTHER` は continuation fallback に使わない。direct-detect rule を持たないため v0 実装は `UNRESOLVED` を返してよい（OTHER の coverage を上げる post-hoc rule は追加しない）。

## 6. 評価集合の呼称と split

名称は `DEVELOPMENT` / `FROZEN_EVALUATION`。後者は「GT freeze 後、実装・tuning に使わない集合」の意味で、fresh held-out ではない。

split は **publisherDomain 単位**: `sha256("{seed}|split|{publisherDomain}")` の先頭 8 hex を整数化し `% 100 < 70` なら DEVELOPMENT、そうでなければ FROZEN_EVALUATION。publisher の手動移動はしない。publisher が 1 つしかない class（PRIORITY_*、courts のみ）は片側評価しかできない limitation として記録する。

## 7. GT sampling（label より先に freeze）

seed: `budget-request-page-classification-v0-20261007`（reproducibility ID）。hash 順 = `sha256("{seed}|{tag}|{localPdfPath}|{physicalPage}")` 昇順。

- **A. DIRECT**: matcher が DIRECT を返す page。family ごとに候補 ≤12 なら全件、それ以上は hash 順（tag `A-{family}`）の先頭 12。PRIORITY_* は全件（各 1）。
- **B. CONTINUATION**: 継承可能 family の DIRECT start から、同一 PDF 内で次の page を順に辿り、TEXT_OBSERVABLE かつ DIRECT なし（NONE）の page を候補にする（Phase A VISUALLY_BLANK は skip、その他の EMPTY・DIRECT/CONFLICT page で打ち切り）。start からの距離 d（TEXT_OBSERVABLE page 数）を bucket `d1 / d2 / d3-5 / d6+` に分け、family×bucket ごとに hash 順（tag `B-{family}|{bucket}`）の先頭 3。
- **C. CORPUS_RANDOM**: A/B に含まれない TEXT_OBSERVABLE page から hash 順（tag `C`）で **64**。
- 同一 `(localPdfPath, physicalPage)` は 1 row。strata は複数保持する。

## 8. Metrics

- false resolved: GT `UNRESOLVED` に既知 semantic type を断定した件数。
- resolved precision: 既知 type の GT row のうち、`正しい resolved / 全 resolved`（UNRESOLVED prediction は分母に含めない）。
- coverage: `resolved prediction / classifiable GT row`（GT が既知 type の row）。
- exact accuracy（参考）: `pageType 一致 / GT row`。
- DEVELOPMENT と FROZEN_EVALUATION を分け、DIRECT / CONTINUATION / CORPUS_RANDOM の stratum 別にも報告する。

## 9. GO / GO-WITH-SCOPE / STOP（FROZEN_EVALUATION で判定）

- **GO**: false resolved 0 かつ resolved precision 100% かつ coverage ≥ 95%、かつ source/hash/test 違反 0。
- **GO-WITH-SCOPE**: false resolved 0 かつ precision 100% で coverage < 95%。coverage 不足は後から rule 追加で救済せず scope limitation として保存する。
- **STOP**: false resolved > 0 / precision < 100% / frozen input 不一致 / GT contamination / split contamination / source PDF hash 不一致 / GT 後に preregistration を変更する必要が生じた / 想定外の test failure。negative result も保存する。

## 10. Candidate freeze の実測（label 前）

fixture: `tests/fixtures/budget-request-page-classification/2024/page-classification-v0-candidates.json`、generator: `scripts/pipeline-v2/build-budget-request-page-classification-candidates.ts`（2 回実行で同一）。

- 候補 172 row: DIRECT 62 / CONTINUATION 46 / CORPUS_RANDOM 64、duplicate key 0、text hash 不一致 0。
- DEVELOPMENT 142 / FROZEN_EVALUATION 30、publisher overlap 0。
- DIRECT pool: COVER 69 / TOC 55 / SUMMARY 69 / DETAIL 73 / STAFFING 44 / PRIORITY_SUMMARY 1 / PRIORITY_DETAIL 1、CONFLICT 0。
- continuation pool は DETAIL d6+ が 7,927 と大半を占め、TOC・STAFFING・PRIORITY は数件規模。

## 11. 既知の limitation（label 前に記録。規則は変更しない）

- split を domain 単位の hash で決めた結果、FROZEN_EVALUATION は 30 row のみで、DIRECT は family あたり COVER 4・他は 1、CONTINUATION は STAFFING 1・SUMMARY 2・TOC 3、DETAIL・PRIORITY_* は 0。sampling（family 上限 12）を split より先に行う順序の帰結。FROZEN_EVALUATION での判定は統計的な力が弱い。規則を変えて補強する場合は新 version として別 preregistration にする。
- PRIORITY_SUMMARY / PRIORITY_DETAIL は courts のみで DEVELOPMENT 側。FROZEN_EVALUATION では評価できない。
- continuation 候補は INHERITED rule が state を与えるはずの page に偏る。rule の取りこぼしや誤継承は CORPUS_RANDOM でしか検出できない。
- seed は推奨値のまま。split の出方を見て変更しない。

## 12. 禁止事項

classifier 実装・評価、GT 後の matcher/N/inheritance/split/threshold 変更、OCR、Route C、MOF 利用、項・事項・金額抽出、manifest role を GT に使うこと、隣接 page からの GT 補完、PDF 境界を越えた継承、fully-EMPTY を blank 扱いすること、MEXT p1044 の補完、frozen fixture・`data/download/` の変更。
