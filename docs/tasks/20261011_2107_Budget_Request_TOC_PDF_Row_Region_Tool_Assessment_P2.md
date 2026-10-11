# TOC PDF Row / Region P2: PDF text・geometry ツールとページ性質の評価

凍結済み候補 50件（15 PDF・17 physical page）だけを対象にした事前評価。ジオメトリ観測・Layer B/C 推定・再利用 parser は行っていない。

## 結論

- 17ページすべてに native text layer がある（OCR 不要）。15 PDF の SHA-256 は凍結 manifest と全件一致。
- 全ページが A4 横（842×595pt）、`/Rotate` 0、CropBox = MediaBox、UserUnit 1。座標補正は不要。
- 既存の `scripts/pipeline-v2/lib/budget-request-pdf-page.ts`（pdfjs-dist）が bbox・baseline 元値を返すため、新規実装なしで使える。poppler `-bbox-layout` とは 0.001pt 以内で一致。
- テキスト照合は「長い断片は一意、短い断片は一意でない」。断片全体（page ref・継続行を含む）の一意性はテキストだけでは確立できず、候補ごとの停止/継続判断が必要。

## ツールとバージョン

| ツール | 版 | 結果 |
|---|---|---|
| poppler `pdftotext` / `pdfinfo` | 26.09.0 | `-layout` の page text が raw-text manifest の `raw_text_page_sha256` と 17/17 一致。`-bbox-layout` は word 単位 bbox（baseline なし） |
| pdfjs-dist（既存 lib 経由） | 5.4.296（package.json 固定） | text item 単位。transform と width を返す。CJK は `cmaps/` で復号できる |
| pdf-parse | 2.4.5 | getText はページ文字列のみで bbox なし（lib のコメントどおり）。使わない |
| pdfminer.six | 20260107 | 不適。CJK を復号できず ASCII のみ（`230901-2.pdf` p3 で 567 char のうち日本語なし）。MS-Gothic/Mincho の Type0 フォントが原因 |
| pypdf | 6.19.0 | ページ box・Rotate・UserUnit の確認にのみ使用 |

pdfminer.six と pypdf は Python 環境の既存インストールで、repo の依存ではない。

## ページ性質（17ページ）

- MediaBox = CropBox = [0,0,842,595]、Rotate 0、UserUnit 1.0 は全件同じ。
- 暗号化フラグは 2 PDF（`2024tousi_2.pdf`、`2023_fukkochougaisansaisyutsu.pdf`）。抽出は poppler・pdfjs とも可能で、pdfminer は「text extraction 禁止」警告を出すが続行する。
- producer は List Creator / JUST PDF 4 / Adobe Acrobat など。フォントは FUJ-Minchotai / MS-Gothic / MS-Mincho 系 Type0 埋め込み。

## 座標・bbox・baseline の規約

- pdfjs（既存 lib）: 原点は左上、x 右が正、y 下が正、単位 pt。bbox は em box（pdf.js の font ascent/descent による近似でインク範囲ではない）。baseline は `transform=[a,b,c,d,e,f]` の (e,f)（PDF user space、原点左下）。左上原点の baseline y = 595 − f。
- poppler `-bbox-layout`: 同じ左上原点・pt。word 単位、baseline 値なし。
- 同一 token の比較（`ippankaikei.pdf` p2「065」）: pdfjs yMin 354.130 / poppler 354.1295、xMin 96.628 / 96.628。baseline 595 − 234.906 = 360.094 は yMin〜yMax（354.13〜361.07）の内側。
- 粒度: pdfjs item 中央値 2〜3 文字・最大 35 文字、poppler は word 単位。どちらも文字単位 bbox ではない。hasEOL は content stream 上の改行で、意味的な行ではない。

## テキストの同一性

- 17ページで pdfjs と poppler の非空白文字の多重集合が一致する。差は U+2011（poppler）と U+002D（pdfjs、normalization 無効でもこの字が出る）の置換のみ（ページあたり 4〜52 字）。照合時は両側で正規化して扱う必要がある。
- 凍結 inventory の 100 断片は、`source_ranges_utf16` で pdftotext `-layout` の行を切り出すと断片と 100/100 完全一致する。つまり断片は現在の poppler 出力から再現できる。

## 断片照合の一意性（pdfjs item 連結 vs 断片セグメント）

2 個以上の空白で断片を区切った 185 セグメントを、ページ内の pdfjs item を content stream 順に連結した文字列（空白除去・ハイフン正規化後）で数えた。

| セグメント長 | 件数 | 一意 | 複数一致 | 不一致 |
|---|---|---|---|---|
| 8字以上 | 61 | 57 | 4 | 0 |
| 3〜7字 | 32 | 0 | 32 | 0 |
| 1〜2字 | 92 | 15 | 77 | 0 |
| 合計 | 185 | 72 | 113 | 0 |

- 各候補の最長セグメントは 50/50 で一意に一致する。
- 全セグメントが一意な候補は 0/50。全候補が「経費」「費」「入」やページ参照番号のような短い継続断片を含む。例: 同一ページに同じ page ref「34」が 2 行ある。
- 凍結契約（非一意なら当該候補の geometry 収集を停止）を字義どおり適用すると、全 50 件が停止対象になる。契約の適用単位（最長セグメントで一意なら足りるか、断片全体か）は coordinator 判断が必要。
- poppler の layout 行番号と pdfjs/poppler の y クラスタは 1:1 でない（例: 60 行に対し y 62 通り）。行番号から bbox を決定的に引く規則は未確立で、定めると parser 実装になるため行っていない。

## 未了・注意

- 本評価は text 一意性と page 性質のみ。row/region の関係観測、Layer B/C は未着手。
- スクリプトは scratchpad の使い捨てで、repo には追加していない（再現手順は上表のツール・条件のとおり）。
- pdfminer の CJK 復号失敗は原因を深掘りしていない（cmap 不足の可能性）。
