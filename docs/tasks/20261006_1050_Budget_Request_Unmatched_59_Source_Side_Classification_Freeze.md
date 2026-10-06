# MOF 未一致 59 項の source-side classification freeze

Written for: 本研究チェーンの次フェーズ判断者。

前回の独立 audit（read-only、`fa93360` 時点）のレビューを反映し、59 項の総表レベル分類を新規 artifact として freeze した（既存 fixture は変更していない）。成果物: `tests/fixtures/budget-request-unmatched-59-source-side/2024/`（`unmatched-59-source-side-classification.jsonl.gz`・`unmatched-59-source-side-summary.json`）、`scripts/pipeline-v2/run-budget-request-unmatched59-source-side-freeze.ts`、視覚転記 `scripts/pipeline-v2/lib/budget-request-visual-transcription.ts`。

## 1. レビューによる訂正

- 前回 audit の Q1 の「22 項」は **21 項**（F0 15 + F7 1 + F2 5）が正しい。日本学術会議 081 の確認前の内訳は、machine-readable な総表 / 目次で MOF exact 名なし 21、drawing-path のため blocked だが目視で exact 項名が実在 37、日本学術会議 081（source coverage unresolved）1。
- 「725 / 784 は『読める総表から取れる項は全部取れている』状態に近い」という Interpretation は本 freeze では使わない。許容する表現は、**未一致 59 項について確認した範囲では、machine-readable な令和６年度一般会計概算要求の総表・目次に MOF exact 項名が存在するにもかかわらず現行 extractor が取り逃している項は確認されなかった**、まで。extractor 全体の recall や 725 件側の問題の有無は意味せず、725 / 784 を単純な extractor recall と呼ばない（分母 784 は MOF 当初予算側の項集合で、概算要求側 source universe と同一であることは証明されていない）。

## 2. 日本学術会議 081（`MOF 内閣府 / 日本学術会議 / 081 日本学術会議`）

- 公式 index `https://www.cao.go.jp/yosan/soshiki/r06/yosangaisan_r6.html`（WebFetch で 2026-10-06 に確認。tool の抽出結果であり HTML 原文の保存ではない。Bash からの curl は許可されなかったため独立取得は未実施）: page は「令和６年度歳出概算要求書」で、一般会計の「表紙及び総表」は相対 link `pdf/0.pdf`（取得原本 `data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf` の canonical URL と一致）。「日本学術会議」の行には「**事項要求**」と表示され、PDF の link が無い（直前は国際平和協力本部 `pdf/48.pdf`、直後は官民人材交流センター `pdf/49.pdf`）。「事項要求」の説明文は page 上に無い。（同じ page への 1 回目の取得では link の base URL が異なる要約が返ったため、相対 link を解決した 2 回目の抽出を採用した。）
- 取得原本の一般会計総表 `0.pdf`（25 page、SHA-256 `315909085871656c…23b33`）全 page を pdftotext で確認し、「学術会議」を含む文字列は存在しない。
- 判定: Axis A = `NOT_EXACT_IN_GENERAL_SUMMARY`、specialTreatment = `事項要求`（source 明記の Fact）。causeStatus = `UNRESOLVED`（事項要求から当初予算の項「081 日本学術会議」になった経緯は同 source が説明していない）。

## 3. 59 項の最終 source-side classification（source evidence から再集計した実測）

| classification | 件数 | 内訳 |
|---|---:|---|
| `SUMMARY_REPRESENTATION_BLOCKED`（目視で exact 項名の実在を確認済み） | 37 | 法務省 35・金融庁 2 |
| `NOT_EXACT_IN_GENERAL_SUMMARY` | 22 | F0 16・F7 1・F2 5 |
| `SUMMARY_SOURCE_COVERAGE_UNRESOLVED` | 0 | — |
| `EXACT_IN_GENERAL_SUMMARY` / `OTHER` | 0 | — |
| 計 | 59 | |

- 37 項は「machine-readable な総表に存在しない」のではなく、**PDF の目次に MOF exact 項名が視覚的に実在するが通常の text extraction では読めない**。
- 22 項は「MOF 項が令和 6 年度概算要求時点に存在しなかった」とは断定しない。Fact は、**確認した令和 6 年度一般会計概算要求の総表・目次に、MOF exact 項名として掲載されていない**まで。原因はすべて `UNRESOLVED`。
- 経産省 088 は、一般会計の目次・総表の項名が長い名称「石油石炭税財源燃料安定供給対策及エネルギー需給構造高度化対策費エネルギー対策特別会計へ繰入」（の一部として MOF 名が含まれる）であり exact entry ではない。同名の項は同所管の特別会計 PDF（`eneju_o.pdf`）にある。文科省の 5 項は目次（`_01.pdf`）・総表（`_02.pdf`）に exact 名なし（前回の独立確認も `SOURCE_FULL_NAME_ABSENT`）。

## 4. F1 の視覚確認（row 単位の page）

法務省 `001402818.pdf`（SHA-256 `bd5ce9c5…cf8c`）の目次 35 項は、p3（25 項）と p4（10 項）を row ごとに記録した（p3 の 25 項 = 法務本省 13・法務総合研究所 3・検察庁 3・矯正官署 4・更生保護官署 2、p4 の 10 項 = 法務局 4・出入国在留管理庁 3・公安審査委員会 1・公安調査庁 2）。金融庁 `6youkyuu-2/01.pdf`（SHA-256 `9803cfd8…cb9b`）の目次 2 項は p2。各 row に、PDF 上で見えた項 code・項名・目次のページ表記を保存した（視覚転記は MOF 一覧から作っていない。「日本司法支援センター運営費」の長音符号は、視覚上 U+30FC と漢数字の一を区別できないため notes に記録した）。

## 5. validation

row 数 59・duplicate identity 0・分類合計 59、再実行で byte 一致、production code と `data/download/` の変更なし。
