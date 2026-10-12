# FY2024概算要求TOC — PDF-native CSV converter v0 結果

**Status: 実装完了（開発実装。P7 の正式研究ではなく、held-out・正解率の主張なし）。** 凍結済み 82 TOC ページ / 55 PDF のうち 2,864 項目を保守的に CSV 化し、116 件を理由付きで unresolved にした。意味の正しさは未検証。

仕様・使い方・限界は恒久ドキュメント `docs/budget-request-toc-pdf-native-csv.md` に書いた。ここは実行結果の記録のみ。

## 実装と境界

- base: `bd893051639d89c1bb2631a94391ede13765265d`。変更は新規ファイル（converter lib / runner / test / doc）と `package.json` の script 1行のみ。P2–P6 の凍結物、SourceToken / TableGeometry / LogicalRow / SpatialRegion、旧 TOC v0、Column Primitives / Minimal Assembly は無変更。
- 既存 API: `extractPageTokens`（SourceToken）、`clusterPhysicalRows`（TableGeometry、y のみ）。**列分離を先に行い、列ごとに行クラスタリング**する。LogicalRow / SpatialRegion は使わない。
- 旧 TOC v0 の `appendContinuation`（同じ側の直前項目へ無条件に連結）は採用しない。継続は結合せず保留（`HOLD_INCOMPLETE_TITLE` 等）。
- Raw Text は使わない。provenance は PDF SHA-256・物理ページ・pdf.js item index。

## 実行結果（82ページ・55 PDF）

| | |
|---|---|
| PDF SHA-256 の一致 | 55 / 55（inventory と一致。不一致なら停止する設計） |
| 列の根拠 | 82 / 82 ページ |
| item | 26,317 = 空白 12,859 + 見出し帯 1,835 + entry 11,327 + unresolved 296（重複・欠落なし。`token-ledger.csv`） |
| main CSV | 2,864 行（NUMBERED 1,563 / MARKER 1,151 / TITLE_PAGE 136 / CODE 14） |
| unresolved audit | 116 = UNOWNED_FRAGMENT 57 + HOLD_INCOMPLETE_TITLE 56 + PAGE_REF_WITHOUT_TITLE 2 + NO_PAGE_REF 1（27ページ・18 PDF） |
| 物理行（列ごと） | 左 1,956 / 右 1,024 |
| ページ参照 | 数字のみ 2,723、接頭辞つき 141（エ・電・原・国(国)・国。原文の綴り） |

再実行: 同じ入力・コードで 2 回生成し `diff -r` が完全一致（62 ファイル、全ファイルのハッシュ列の SHA-256 `2fae3226b609ddc14dfab33d657fc70106cc9a33d1b8f34b62d462eee62ec7e7`）。経過時間は成果物に含めない（約 3 秒）。

P6 との照合: P6 の 17 ページ・6,655 item について、`(PDF SHA-256, ページ, index)` ごとの text と transform がこの抽出で完全一致（不一致 0）。P6 ZIP の SHA-256 は `dc548b4135a79b9e00685f353177c9796bb9eea4a010184c066ee3f61f86df16`。

## 検証

- `npx vitest run scripts/pipeline-v2/lib/budget-request-toc-pdf-native-csv.test.ts`: 23 テスト通過。左右同高さの別 entry、重複番号、見出し/ノンブル棄却、接頭辞つきページ参照、列の根拠なし、継続保留、item identity（入力順を逆にしても同一）、全 item の会計、CSV エスケープ。**これはコードの動作確認で、実 PDF の意味的正しさの検証ではない。** テストで、保留行の断片 audit が存在しない entry ID を指すバグを1件発見・修正した。
- `npx tsc --noEmit` 通過。新規ファイルの ESLint（`ESLINT_USE_FLAT_CONFIG=false`）警告なし。`git diff --check` 通過。
- 実 PDF の目視（pdftoppm の画像と出力の突合）: MHLW `05-1b-01.pdf` p7（56 entry を画像の行と突合して一致。折り返しの `185 04-06 … 繰入れに必要な / 経費` は保留と断片に分かれた）、NDL `r06_budgetrequest.pdf` p2（ページ参照が行より 2pt 上にずれた行は、近くのタイトルと組にせず `PAGE_REF_WITHOUT_TITLE` + `NO_PAGE_REF`。`国 1` / `国(国)1` は原文のまま）、MOF `2024ippan_2.pdf` p2 の token 配置（左右2段組で同高さに別項目）。

## 未解決・想定外

- 折り返しタイトルの続きを特定する独立の根拠はなく、56 件の entry を出していない（コードは `unresolved.csv` に候補つきで残る）。ここを埋めるには別の根拠が要る。
- NDL p2 のようなページ参照の高さずれ 3 件（`PAGE_REF_WITHOUT_TITLE` 2、`NO_PAGE_REF` 1）は取りこぼし。
- 想定外: 旧 Raw Text では見出し境界が 72/82 ページでしか取れなかったが、PDF-native では 82/82 ページで `要求`・`ページ` 見出しを検出できた（件数の観測であり、境界の正しさの主張ではない）。
- 生成物は Git 管理外。出力ハッシュ: `summary.json` `8363f571f796833d46572159297a9f907a1325222d44fca5d7b516b84d554fb7`、`output-hashes.json` `bca205bf202e2ea7c4f696d905a5291b097e6fe96215ab8164dbb9db20837d1f`、`unresolved.csv` `5548c51444187a3fbc812dde0804f31410d8ac509509f393889b25b8393e0123`、`token-ledger.csv` `0fb3291fb62e800acf2f722449df9681abb8a3a424aef4aa35e1c884eb84a36c`、`entry-provenance.csv` `6652458d61fb69c9dfa96a03496d593ea051bdb82b39cf34bbf3e719fda2c77a`。入力 inventory `d2b2311cb6cbcb0974816706be1126d07e2a062614ac5b7cefee62be2b5ebc2d`。
- 恒久アーカイブはコーディネーターが正本の `data/work/exports/` へコピーする（worker は正本に書かない）。ローカルの準備物: `data/work/exports/20261013_0804_FY2024_TOC_PDF_Native_CSV_v0.zip`（SHA-256 `d7c77c4eaaa05767b2980f160cdeb49d58cd45593edf213a1437ac2641f0f83b`、64 ファイル、CRC-32 は同名 `.zip.crc32.txt`、中身は `manifest.json` に SHA-256）。ZIP 自体は時刻を含むためバイト再現しない（中の各ファイルは再現する）。

## 追補: レビュー指摘2件の修正（FINAL）

- **境界をまたぐ token**: またぐ item と同じ高さ（行許容差）の左右の行を entry にせず `COLUMN_STRADDLE` にする。またぐ item の ledger は1回のまま。
- **折り返しの保留の拡張**: 構造行（`NO_PAGE_REF` / `NO_TITLE_TEXT`）の直後にページ付きの番号なし `TITLE_PAGE` 行がある場合（ページ参照が折り返しの最終行）は後ろの行を `HOLD_POSSIBLE_CONTINUATION_TAIL`。ページ付きの行の直後に番号のない `NO_PAGE_REF` / `NO_TITLE_TEXT` 行がある場合は前の行を `HOLD_INCOMPLETE_TITLE`。結合・所有判断はせず候補の行IDだけを残す。
- テスト 23 → 27（またぐ token の同高さ行、ページ参照が最終行、番号なしの構造風断片、番号付きの次行は保留しない）。tsc・ESLint・`git diff --check` 通過。
- 全82ページの件数は**変化なし**（main 2,864 / audit 116 / item 26,317 の内訳も同じ）。2回再生成で `diff -r` 一致。コードのハッシュが変わったので `summary.json` `68fbf4eed17fbba88103819797327bf979e9417e49421fe2c91fe70c52815901`、`output-hashes.json` `426b78364631451b9611a581dcaab37c560b94951a46cb24fed3b9c4bed0ce24`。
- FINAL アーカイブ: `data/work/exports/20261013_0808_FY2024_TOC_PDF_Native_CSV_v0_FINAL.zip`（SHA-256 `10fae8de1cc49513367757eb8b849a6cdaadd0f710a3a4da2a744520e6acf44c`、64 ファイル、CRC-32 は `.zip.crc32.txt`）。前のアーカイブ（`..._v0.zip`）は破棄してよい（上書きはしていない）。
