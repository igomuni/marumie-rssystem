# 8.6pt 項候補の全 corpus 抽出（rotate=90 を含む）— Result

Written for: 本研究チェーンの次フェーズ判断者。

## 最重要結果

**MOF 一般会計 784 項のうち、名称 exact で 661 項（84.3%）が 8.6 ± 3.0pt candidate に存在した**（distinct 正規化名称では 627 / 750）。前回（rotate=90 を評価不能として除外）は 632 項で、rotate 正規化により +29 項。

## 要点

1. 全 82 PDF を実際に対象にできたか: 82 PDF すべてを処理した。評価できたのは 80 PDF。残り 2 PDF は rotate が原因ではなく**テキストを取得できない**ため評価不能（下記）。
2. rotate=90 PDF の座標正規化評価: 実施した。前回 `unavailable_rotate90` だった 8 PDF のうち 6 PDF（`2024ippan_2`・`2024gaitame_2`・`2024jisinn_2`・`2024tousi_2`・`2024zaiyuu_2`・`r6sandanhyou`）は、rotate 90 の page（計 18 page）を表示向きに正規化し、残りの rotate 0 の page と合わせて評価できた。この 6 PDF の candidate は計 57 行（財務省 `2024ippan_2.pdf` の 32 行など）。ただし rotate 90 の page 自体に candidate は無く、candidate はすべて rotate 0 の page 上（rotate 90 の page の plain 3 桁 row は 7 行で、罫線が取れなかった）。
3. candidate 総数 973 行（一般会計 710・特別会計 263）。candidate がある PDF は 63。前回の 916 行（74 PDF）は再現済み。
4. MOF 名称 exact coverage: 661 / 784 MOF row（84.3%）、627 / 750 distinct 名称。exact になった candidate 行 677（name_exact_unique 612・name_exact_ambiguous 65。no_exact_name_match 25・name_unavailable 8）。exact を持つ PDF は 43。
5. 未一致 MOF 項: 123。
6. 未一致の所管別: 内閣府 66・法務省 35・文部科学省 8・財務省 3・国土交通省 3・厚生労働省 3・環境省 1・防衛省 1・農林水産省 1・経済産業省 1・外務省 1。全 123 件（所管・code・名称）は `phaseB-diagnostic.json` の `unmatchedMof`。
7. 評価不能 PDF（2）:
   - `data/download/moj.go.jp/content/001402818.pdf`（法務省、737 page、全 page rotate 90）: **テキスト層が無い**（全 737 page でテキストが 0。page 内容は塗りつぶしパスのみ）ため candidate を取れない。rotate 正規化の問題ではなく、OCR は使わない方針のため fail-closed。法務省の未一致 35 項はこれに対応する可能性が高い。
   - `data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_04.pdf`（文部科学省、6 page、全 page rotate 90）: テキストは 2,515 token あるが ASCII 数字の token が 0（フォントの Unicode 対応が無く文字が復号できない）ため plain 3 桁 code を取れない。
   - candidate 0 件の evaluated PDF（17）: `cms_caa205_230914_02`、cao `0.pdf`・`f1.pdf`・`f2.pdf`、cas `r6_01`・`r6_16`・`r6_17`、env `000157016`、fsa `01`、maff `230901-4`、meti `fukko_o`、mext `_01`・`_02`、mlit `001630395`、moj `001402819`、npa `hukkoutokubetukaikei`、reconstruction `2023_fukkochougaisansaisyutsu`（いずれも `data/download/` 下の PDF、path は `phaseA-summary.json` の `evaluatedPdfsWithoutCandidate`）。内閣府の未一致 66 項の対応先（cao `0.pdf` 等）は candidate 0 件。

## Fact（実施内容と検証）

- candidate rule・band・名称条項・罫線 linker・MOF 名称 only exact・normalization は前回と同一。変更は、rotate ≠ 0 の page を `page.getViewport` の表示向きへ座標正規化する research 経路（text item の transform を `F∘M∘T` に変換して既存 `toSourceTokens` へ、罫線の端点は表示座標へ変換）と、candidate ごとの rotate・raw row text（page の source token のうち縦中心が row bbox に入るものを x 昇順に連結）・filename の保存のみ。production code は変更していない。
- Phase A（freeze commit、source-only）: gate 全 PASS（duplicate 0・provenance loss 0・`ruleX < codeX`・nearest・前回 916 件の再現・rotate 0 page の tokens が production と一致）。再実行 byte 一致。初回実行は rotate 0 token 一致 gate が pdf.js の内部 fontName（`g_d2_f1` と `g_d3_f1` のようにセッションで変わる）で誤って fail した測定バグで、初回出力を `first-run-with-measurement-bug.summary.json` に保存し、rule・population・band・candidate 集合を変えずに独立 commit で修正した。
- Phase B: MOF 784 を再現。再実行 byte 一致。exact match の全 candidate（MOF 項・PDF path・page・rotate・candidate code / 名称・ruleX・codeX・deltaX・code 一致か）は `phaseB-exact-matches.jsonl.gz`。

## artifact

`tests/fixtures/budget-request-rule-8p6-rotate90/2024/`: `phaseA-universe.jsonl.gz`（pre-band universe 全行と candidate。rawRowText・rotate・rule provenance 付き）、`phaseA-summary.json`（coverage・status・PDF 別・candidate 0 件 / 評価不能 PDF）、`phaseB-diagnostic.json`、`phaseB-exact-matches.jsonl.gz`。

## 限界

テキスト層が無い、またはフォントが復号できない PDF（上記 2）は OCR を使わないため評価できない。名称 exact の ambiguous（65 candidate）は同名の MOF 項が複数あり行を同定できない。特別会計 PDF は MOF 一般会計と突合していない。MOF は PDF 側の GT ではない。この抽出と実測のみで終了し、別研究は開始しない。

## Validation

tsc 0 error、lint error 0、vitest（正規化・source scan 他）pass、Phase A / B の再実行で byte 一致、production code diff 0。
