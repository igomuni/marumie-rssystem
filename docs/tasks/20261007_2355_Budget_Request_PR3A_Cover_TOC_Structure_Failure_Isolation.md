# 概算要求 PR-3A — Cover + TOC Structure Failure Isolation

observation / failure isolation のみ。**Cover parser・TOC parser・visual GT freeze・preregistration は未着手**。parser accuracy は評価していない。

## Pre-flight

main `c531abab`。#385 は squash merge のため head `0c7ef4f` は ancestor でないが、tests / scripts / docs/tasks の差分が空（content equivalent）。Raw Text digest `7c6d2dce…c4052` 一致。frozen builder を再実行して Page Classification digest `39464fc7…` 一致・conformance mismatch 0。working tree clean、historical v0–v3 artifact・data/download 無変更。

## Target population（machine inventory、`structure-inventory.json`）

- COVER routed 69（DIRECT 69）、TOC routed 82（DIRECT 55 = explicit-title start、INHERITED 27 = continuation）。classifier 出力と一致。
- COVER を持つ physical PDF 59、TOC を持つ PDF 55。duplicate key 0、hash 不一致 0。
- 1 PDF あたり TOC run は常に 1（55 PDF）。run 長: 1 page 40・2 page 10・3 page 2・4/5/7 page 各 1。continuation の run 先頭からの距離は 1〜6（1:15・2:5・3:3・4:2・5:1・6:1）。
- COVER 複数の PDF は 1 つ（cao `r06/pdf/0.pdf`、11 cover + 同 PDF は TOC page 0）。cover はあるが TOC が routing されない PDF が 4（cao 0.pdf・cao f1.pdf・cas r6_01・cas r6_16）。TOC があって cover が無い PDF は 0。
- TOC start は cover の 2 page 後が 45 PDF、1 page 後が 10 PDF（cover→blank→TOC の並びが多い）。TOC run 内に NO_TEXT を挟む run は 0。COVER/TOC page で隣接 page が UNRESOLVED / NO_TEXT のもの 94。
- account（manifest metadata）: COVER は general 40・special 29。header 先頭 code の桁数は 2 桁 40・4 桁 29 で一致（意味は解釈しない）。cover の staffing 参照 text あり 25。
- private-use 文字は TOC 3 page のみ（COVER 0）。non-breaking hyphen（U+2011）は TOC 82 page 全て。

## Development sample（DEVELOPMENT_EXPLORATION）

seed `budget-request-cover-toc-structure-dev-exploration-20261007`、stratum ごとに `sha256("{seed}|{stratum}|{path}|{page}")` 昇順の先頭 2。stratum は machine feature のみ（cover: account・multi-cover PDF・split-PDF logical document・publisher と jurisdiction metadata が異なる・staffing 参照あり/なし・非 leader 行が多い／TOC: explicit start・continuation・1 page run・multi-page run・短い/長い continuation 距離・高/低 line 数・multi-column suspected・wrapped-name suspected・private-use）。33 page（COVER 14・TOC 19）。**全 33 page の Raw Text（先頭 12〜14 行）を確認、render まで見たのは 4 page**（ledger の `inspection` に記録）。explored-page ledger: `development-explored-pages.json`。これらの page は後続 GT・frozen evaluation の候補から除外すること。

stratum 設計上の注意: multi-column の初期条件（header に「ページ」が 2 つ）は **全 TOC 82 page が該当し判別力ゼロ**だった。分布から「同一行に page 参照が 2 つ並ぶ行 ≥17」に置き換えた（label は見ていない）。machine observation として全 82 page で header の「ページ」token が 2 個あるが、82/82 の視覚確認はしていない（下記 TOC observations の区分を参照）。

## Cover observations

- header 行: `<code> <name>`。code は 2 桁（「所管」付き name）と 4 桁（「特別会計」付き name、括弧書きの府省・勘定付きがある）。name は文字間に空白が入る（letter-spaced: `内 閣 府 所 管`）形と詰まった形が混在。括弧書き（例: `（環境省）`）は特会 cover にあるものとないもの（reconstruction は無し）が混在。
- 参照ブロック: `1.` 総表、`2.` 明細表、`（組織）code name` または `（会計）code name`、`3.` 定員表（あるものだけ）。各行は leader dots と末尾 printed page 参照。
- multiline: `（組織）022 科学技術・イノベーション` + 次行 `推進事務局`（leader dots と page 参照は 1 行目のみ）、`国立障害者リハビリテーシ` + `ョンセンター`（語の途中で改行）。1 行目だけでは name が欠ける。
- printed page 参照は **cover bundle 内ローカル**（cao の 11 cover は各々 1・3 から始まる）。physical page 番号とは別。
- 複数 cover bundle: 1 PDF 内で cover の度に name・参照が変わり、printed page が restart する。bundle 境界は cover page の位置でしか観測できない。

### Cover failure taxonomy（観測から）

SPACED_LETTER_NAME（文字間空白）、MULTILINE_NAME（折返し・語途中分断あり）、MULTI_COVER_BUNDLE（printed page が restart）、PRINTED_PAGE_REF_BUNDLE_LOCAL、HEADER_PARENTHETICAL_OPTIONAL、OPTIONAL_STAFFING_REFERENCE、SINGLE_LINE_STABLE（上記を持たない多数派）。

## TOC observations

- **Machine observation（全 82 page）**: header 中の「ページ」token が 2 個（82/82）。同一 Raw Text line 上に 2 つの末尾 page 番号候補を持つ line が 1 本以上ある page が 81/82。そのうち 17 本以上ある page が 42/82（multi-column-suspected stratum の pool）。
- **Development visual observation（render 確認した TOC 3 page のみ: env 000157012 p3、maff 230901-6 p4、mext p4）**: 3 page とも左右 2 段の枠を確認。Raw Text では左右 column の row が同一 line に並ぶ例を確認（env・mext）。maff p4 は右段が空で、左段のみ Raw Text に現れる。他の TOC page の layout は Raw Text 上の特徴からの推測であり、視覚確認はしていない。
- **Interpretation / hypothesis（未検証）**: corpus 全体が同系の two-column layout である可能性が高い。その場合、Raw Text の行順は左右 column が interleave し、読み順（左段を下まで→右段）とは一致しない。右段が空の page も他にある可能性がある。82/82 の確認は PR-3C の failure isolation の課題。
- 行の種類: `（組織）/（会計）/（所管）/（勘定）/（項）` + code + name、request-number 付きの `NN code name` 行、`令和６年度歳出概算要求額総表/明細表/概算要求定員表` の参照行。末尾が printed page 参照。
- name の折返し: 次行に深いインデントだけで続き、page 参照を持たない。2 段の page では折返し行が左右どちらの段かが Raw Text 上は列位置でしか分からず、他段の row と同一行に混ざる。
- page 参照が数字のみとは限らない: 特会の勘定ごとに `エ 9` のように prefix token が付く。
- 先頭行に TOC 自身の printed page 番号。title は start page のみ。continuation page は title なしで header（要求番号・区分・ページ）から始まり、**所属 組織/項 の文脈は page 上に無い**（先頭 row が前 page の `（項）` 配下）。
- private-use 文字（U+E5E3）が name の中に出る（「補○金」の 1 字が PUA 化している。3 page で同一 code point。元の字は render 未確認で、補完しない）。non-breaking hyphen（U+2011）が code の区切りに全 page で使われる。
- 最終行に `令和６年度概算要求定員表 <ref>`（定員表参照）が出る page がある（TOC の最終 page）。

### TOC failure taxonomy（観測から）

TWO_COLUMN_INTERLEAVED_LINES（render 確認した 3 page で観測。corpus 全体は仮説）、WRAPPED_NAME_NO_REF、WRAPPED_NAME_IN_ONE_COLUMN_MIXED_WITH_OTHER_COLUMN、PRINTED_PAGE_REF_WITH_PREFIX_TOKEN、CONTINUATION_WITHOUT_TITLE_NEEDS_PRIOR_CONTEXT、PRIVATE_USE_CHARACTER_IN_NAME、NON_BREAKING_HYPHEN_IN_CODE、ONE_COLUMN_CONTENT_IN_TWO_COLUMN_FRAME（render 確認 1 page）、STAFFING_REFERENCE_ROW。単純な 1 行 regex が失敗する理由は、interleave・折返し・continuation の文脈欠落・prefix 付き参照・PUA 混入の 5 つ。

## Source-observation schema の含意（freeze しない提案）

`LogicalDocument → PhysicalFile[] → PageObservation[] → CoverObservation / TocObservation`。各 observation は filePath・fileSha256・physicalPage・textSha256・rawText（行単位）を保持し、bbox は null（現状取れない）。publisherAuthority・budgetJurisdiction・organization・account・printedPageRefRaw・physicalPage は別 field。printedPageRefRaw は文字列のまま保持し、cover bundle ごとに scope を持たせる。TOC は line を左右 column に分けた column-aware line（列位置を保持）を中間表現にする案が必要（render 確認した page では Raw Text の行順が読み順と一致しないため、行順を前提にしない）。name は「折返し行を含む raw line の列」として保持し、結合は後段の別層で行う。same-name・same-code・same-page-reference を同一 entity とみなす relation は作らない。

## 未解決

- two-column の左右境界を Raw Text の列位置だけで安全に決められるか（インデントと layout 幅のばらつき。render との突合が 4 page のみ）。
- 折返し行がどの row に属するかを 2 段 page で決める根拠（列位置以外の証拠が無い）。
- continuation page の hierarchy 文脈（前 page の state）を parser の入力としてどう渡すか。
- cover bundle の printed page を physical page に対応づける根拠（今回は対応づけていない）。
- TOC が無い cover 4 PDF（cao bundle 等）の扱い。
- multiline name の語途中分断（`リハビリテーシ`+`ョン`）を連結する規則を持つべきか。

## Safety observations

OCR・Route C・MOF・manifest role の section semantics・外部辞書は不使用。code の意味（府省・会計の展開）は解釈していない。名称の欠落部分の補完・page 参照の physical 変換はしていない。

## Judgment

**SPLIT_REQUIRED**。Cover は source-observation unit（cover page + 参照ブロック）が明確で layout の分散も小さく、PR-3B Cover Structure preregistration が可能。TOC は two-column interleave・折返し・continuation 文脈欠落・prefix 付き参照・PUA が重なり、row 境界と reading order に曖昧さが大きい。Cover と同一の preregistration / parser unit にまとめるべきでなく、TOC は column-aware な中間表現の failure isolation（render との突合を増やす）を先に行う想定（PR-3B Cover / PR-3C TOC）。次工程は開始しない。

parser implementation・GT freeze・preregistration: すべて NOT STARTED。
