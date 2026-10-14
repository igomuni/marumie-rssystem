# 別年度 validation 手順3–4 — FY2025 概算要求 PDF の取得と corpus 凍結

状態: 凍結（評価前）。結論: **FY2025 manifest の 131 target すべてを取得し、PDF の SHA-256 で凍結した**（131本・9,586頁、corpusDigest `520dd9c60683962ed8dce3ea45f2b2674b8c924aeabd0aa851bff6261f015127`）。text 抽出・明細表 CSV・X anchor の評価はまだ行っていない。

凍結物: `tests/fixtures/budget-request-pdf-corpus/2025/pdf-corpus-freeze.json`（baseCommit `ec89200`、manifest 関連3ファイルの hash、target ごとの URL・local path・bytes・SHA-256・頁数・取得経路）。

## 取得（手順3）

- `npx tsx scripts/pipeline-v2/download-budget-requests.ts 2025` を実行。結果は downloaded=123、manual-required=8、failed=0、playwright-required=0。コードは変更していない。
- manual-required の8本は公取委1・外務省1・経産省6（一般会計、エネルギー対策特会3勘定、特許、復興）。どれも scripted HTTP に 403（text/html）を返す。2026-10-14 時点で curl でも再確認した。
- 経緯: `codex exec` から Codex の browser で取得しようとしたが、非対話のためサイトのアクセス許可が拒否され、何も保存されなかった。その後、ユーザーが対話の Codex セッション（Codex Computer Use、実ブラウザ）で8本を所定の path に保存した。
- 取得後の確認: `--prepare-manual` の判定は VALID PDF=8 / MISSING=0 / INVALID=0。downloader を再実行すると cached=131。8本とも1頁目の目次に「令和７年度歳出概算要求額総表」がある。
- 限界: 人手で取得した8本は、サーバーが 403 を返すため、原本とバイト単位で同一かを照合できない。凍結 JSON では `acquisition: "manual"` として区別している。

## 凍結（手順4）

- 対象: `expandTargets(FY2025 manifest)` の列挙順で全 131 target。欠落はない。
- 記述統計（評価ではない）: 131本で、SHA-256 と local path の重複はない。publisher domain は28。1頁の PDF が15本あるが、いずれも cao.go.jp と cas.go.jp の組織別に分割された detail ファイル（7〜8KB）。
- corpusDigest の規則: `sha256("{localPdfPath} {pdfSha256}" を列挙順に改行連結)`。
- 生成には一時スクリプトを使った（repo には入れていない）。再検証は、各 PDF の `shasum -a 256` を JSON の値と突き合わせれば足りる。
- FY2024 の原本と凍結物には触れていない（local path は URL 由来で FY2024 と重ならない）。

## 次（P0 doc の手順5以降、未着手）

5. 凍結した corpus に、FY2024 と同じ pipeline（plain text → 明細表 CSV）をコードを変えずに適用する。
6. MOF の FY2025 事項データを hash で固定する。V1 の `mof-jikou-2025.json` を使うか、V2 化するかは別途決める。
7. X anchor validation。規則は #452 から変えない。
