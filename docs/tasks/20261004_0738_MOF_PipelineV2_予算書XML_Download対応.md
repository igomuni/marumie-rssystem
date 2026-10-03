# MOF Pipeline V2 — 予算書XML fresh download 対応

2026-10-04。download 層のみの変更。XML の解析・事項抽出・normalized schema 変更・PDF×MOF 照合は行っていない。

## 経緯

P0（`20261004_0637_Budget_Request_MOF_Reconciliation_P0_Source_Schema_Inventory.md`）で、V2 の MOF データは CSV 由来の「項→目」で事項を持たないことを確認した。事項は予算書本体（XML 版／PDF 版）にある。

## 現行 downloader が XML を取らなかった直接原因

`scripts/pipeline-v2/download-mof-archive.ts` の `selectLinksToDownload` は「帳票ID 単位で csv があれば csv のみ、無ければ dlpdf のみ。html（`*Main.html`）と excel は常に除外」という format preference で、**XML 版のリンクは発見していたが、html として除外していた**（コード上のコメントは V1 が XML をキャッシュ済みだからとしていた）。

## 公式 archive の source role（令和6年度、`https://www.bb.mof.go.jp/archive/reiwa6.html`）

同一帳票 `202411001` に次の4リンクが載る。

| 表記 | URL | 資料 |
|---|---|---|
| 一般会計 当初予算【PDF版】（PDF／3719KB） | `/server/2024/dlpdf/DL202411001.pdf` | 予算書本体 |
| 一般会計 当初予算【XML版】 | `/server/2024/html/202411001Main.html` | 予算書本体（フレームセット。本文は `../xml/*.xml`） |
| …歳入予算明細書及び歳出予定経費要求書(科目別内訳)【Excel版】 | `/server/2024/excel/DL202411001.xlsx` | 科目別内訳 |
| …(科目別内訳)【CSV版】 | `/server/2024/csv/DL202411001.zip` | 科目別内訳 |

PDF／XML＝予算書本体、CSV／Excel＝科目別内訳であり、**別 source role**（公式の表記が支持する）。XML の URL は PDF URL から推測せず、アーカイブの【XML版】リンク → `{id}menu.html`（目次、EUC-JP）→ 目次が列挙する `../xml/*.xml` をたどって得た。

## 設計

- 選定ロジックを `scripts/pipeline-v2/lib/mof-archive-download.ts` へ切り出し（純関数・network なし・test あり）。`selectLinksToDownload`（CSV 優先・csv が無ければ dlpdf）は挙動を変えない。
- XML は別 role として `selectXmlDocumentLinks`（【XML版】表記の `*Main.html` のうち、**明示した帳票IDだけ**）で選ぶ。CSV と XML は排他ではなく共存する。
- CLI: `npm run pipeline:v2:download:mof -- 2024 --xml=202411001`（`--dry-run` で対象のみ表示）。`--xml` を付けない既定の取得対象は不変。`--xml` は年度1つのときだけ。
- 保存: `data/download/mof.go.jp/archive/2024/2024/{html,xml}/…`。HTTP 応答の byte 列を無加工で保存し、既存ファイルは上書きしない。404 は失敗として扱い（配信側は過剰アクセスを 404 で弾くため）、空ファイルを作らない。1秒間隔。
- 由来: 既存の MOF archive downloader に manifest は無かったため、`data/work/mof-xml-download/{year}/{id}.json` に URL・bytes・SHA-256・取得時刻・HTTP status・content-type・archive の表記を記録（原本ではないので data/download には置かない。`data/` は git 管理外）。

## 実取得（FY2024 一般会計 当初予算 `202411001`）

- 取得 URL: 各 `https://www.bb.mof.go.jp/server/2024/html/202411001Main.html`、`…/html/202411001menu.html`、`…/xml/{目次の328ファイル}`
- 本文 XML 328 件・合計 11,621,700 bytes、downloaded=328 / cached=0 / failed=0。既存の CSV・PDF 20 件は `cached`（変更なし）。
- `202411001Main.html` 995 bytes（SHA-256 `769a220c…913f`）、`202411001menu.html` 37,968 bytes（SHA-256 `19ccfb61…32dfc422`）。
- 例: `xml/202411001000265b.xml`（〔組織別事項別内訳〕）6,106 bytes、SHA-256 `b2796e4e…c787d`。全 XML の `shasum -a 256` 一覧の SHA-256 は `3ac74b4228b92fbccfa0efb10e23434485ad90004c9840d592032444ec3ac2ec`。provenance JSON の SHA-256 は `08c54089…33a7`。
- sanity: 328/328 が well-formed（`xmllint --noout`）、`<?xml` 始まり・encoding=Shift_JIS・HTML のエラーページなし。`202411001000265b.xml` に「事項」の語が見えることだけを確認（件数集計・解析はしていない）。
- V1 の XML cache・V1 の生成 JSON・V1 の抽出結果は入力に使っていない（V1 の cache 置き場 `data/download/mof_2024/xml/` はそもそも現存しない）。

## 変更していないもの・次工程

normalize ロジック、`MofBudgetItemRecord` と `subItem = 目` の意味、事項 schema、MOF hierarchy、PDF parser、FieldResolver、#368 の凍結 artifact は不変。事項の semantic layer・XML parser は次工程。過去の `20260919_1523_Pipeline_V2_downloadファイル一覧と重複分析.md`（dlpdf は同一内容とした記述）は当時の判断記録として変更しない。ただし本文の予算書【PDF版】は科目別内訳とは別資料であり、`docs/data-pipeline-v2.md` の該当記述は本変更で訂正した。
