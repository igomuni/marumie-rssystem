# FY2027 corpus に経産省・公取委・内閣官房の 10 PDF を追加

FY2027（令和9年度）の PDF corpus が 122 PDF から 132 PDF（5,353 頁）になった。経産省 7 本（ブラウザ取得）、公取委 1 本、内閣官房 2 本を足し、plain text から CSV までを作り直した。厚労省の歳出 4 本は取得できたが文字層がなく、corpus に入れていない。

## 追加した PDF

| 所管 | PDF | 頁 | 取得 |
|---|---|---:|---|
| 経済産業省 | `meti.go.jp/main/yosangaisan/fy2027/pdf/{ippan,eneju,eneden,enegen,enesen,tokkyo,fukko}_o.pdf` | 87・16・25・7・8・16・8 | Codex のブラウザ（スクリプトからは 403）。ページに載る歳出 7 本すべて。ページ表示のサイズと一致 |
| 公正取引委員会 | `jftc.go.jp/soshiki/kyotsukoukai/yosan/yosankessan/r9/r9sandanhyou.pdf` | 56 | curl。財務省の一覧が指す掲載ページ `r9.html` にあったが、以前の候補選別で落ちていた（原因は未調査） |
| 内閣官房 | `cas.go.jp/jp/yosan/pdf/r9_01.pdf`・`r9_16.pdf`（復興特会） | 6・2 | curl。rs-vis も持つ。掲載ページのリンクから漏れていた |

- 取得経路が違うため、経産省の 7 本は rs-vis とのバイト照合（rs-vis に記録がない）ができない。先頭 `%PDF-` と本文の「令和９年度歳出概算要求書」だけ確認した。
- 経産省の取得記録は `docs/inventory/budget-request-sources/fy2027-meti-browser-retrieved.csv`。

## 作り直した成果物

- 凍結記録 `pdf-corpus-freeze.json`（132 targets。一般 97・特別 33・不明 2）、plain text の manifest、頁分類、表紙・目次の構造 inventory、表紙・TOC・総表・明細表の CSV（FY2027 のみ）。
- 明細表: 論理行 41,530 → 43,668、未解決 4,858、境が見つからない頁 0、検算の不一致 0。新しい 10 PDF のうち、明細表の頁があるのは 経産省 7 本と公取委（内閣官房の 2 本は表紙・総表だけ）。
- MOF の予算書がないため、突合は行っていない。

## 未取得（令和9年度）

- 厚生労働省: 歳出 4 本（`mhlw.go.jp/wp/yosan/yosan/27syokan/dl/05-{1,2,3,4}b-01.pdf`、1732・761・28・45 頁）は取得できたが、文字層がない（描画パス型）。corpus に入れていない。
- 防災庁: 歳出概算要求書の PDF が見当たらない（掲載ページに法案資料のみ）。
