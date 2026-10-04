# 概算要求PDF full-corpus layout / hierarchy source inventory — 事前登録（protocol・development・判定規則）

item candidate count（branch `research/budget-request-pdf-item-candidate-count`、`1412eef`）の後続。source / schema inventory であり精度改善 phase ではない。DocumentHierarchy generator・FieldResolver・recordKind・candidate rule・rotate=90・MOF matcher は変更しない。82 PDF 全体の variant 集計は、本書を commit するまで計算・閲覧しない（development の 14 PDF のみ閲覧済み）。

## 0. 依存・weak population の既知 evidence

baseline（82 PDF / 9,899 pages、一般 50・特別 32、成功 74・rotate=90 の 8 PDF）、hierarchy ON/OFF（item 97→0）、candidate-count（`candidate-count.json` `35ffc096…d508`、基準 x=55.22 の hierarchy 契約なし 26 PDF、基準 x を決められなかった 23 PDF、`001630395.pdf` の mixed-layout）を既知として使う。inventory script は各 frozen artifact の hash を実行時に照合する。weak population の同定にだけ candidate-count artifact を参照し、分類には使わない。MOF は layout classification に使わない（既知背景値としても結果文書で引用するのみ）。

## A. Mechanism inventory（read-only）

### Fact（コード・artifact）

- row-local な観測値は FieldResolver を hierarchy=null で実行した出力（baseline の records と同じ。hierarchy 区間の row-local 値は ON/OFF で同一、isolation で確認済み）: 行頭 token の code と x（`rowLocal.code.evidence.bboxUnion.xMin`）、request 番号の有無、名称。見出し由来の column layout（`pageDiagnostics[].columnLayout`: 前年度・要求額・差額の x 範囲、`regions.name` の右端、basis）。page サイズ・rotate は pdf.js の page メタ（text 抽出はしない。読むだけ）。
- 既存 DocumentHierarchy v2-B の入力は SourceToken / TableGeometry / LogicalRow のみ（`budget-request-document-hierarchy-v2.ts` の冒頭: 評価 GT・コード値・省庁名・固定 pt 値・凍結層は使わない）。根拠は文書内 x の indent クラスタ（document-local な階段）、page 端の header/footer 型の行の除外（page_edge_row・vertical_repetition・page_number_sequence の 2 種以上）、lattice-supported な根の配置。node は `sourcePage` / `sourceRowRefs` / `sourceTokenRefs` を保存する。
- hierarchy を適用する page 範囲は、`A2_EXPERIMENTS`（`budget-request-document-hierarchy-a2-experiments.ts`）に事前登録として手で書かれた定数（PDF ごとの view と page 範囲）。範囲を PDF から自動導出するコードはない。baseline runner はそのうち view=detail で最広の範囲を契約とした。
- 3 桁 code は FieldResolver の行頭 token の観測で、hierarchy が無いと item / organization / plain code の明細行が区別されない（isolation で測定済み）。

### Interpretation（inventory で検証するもの）

- 項・組織の判別は x の indent に依存するため、indent の基準になる layout（request 行の x、見出しの列位置）が PDF 内・PDF 間でどう変わるかが前提になる。hierarchy の適用 page 範囲を自動に定めるには、layout の contiguous range と contract の範囲が対応するかを確かめる必要がある。

## B. Inventory protocol（凍結）

- observation unit: PDF / page / logical row（page 番号を保持）。row-local の観測値は raw のまま保存し、意味付けと混ぜない。
- code lexical class（recordKind の分岐に依存しない形で定義）: `plain3`（`^\d{3}$`）、`request_like`（行頭の request 番号を観測した行の `NN-NN`）、`hyphen_other`（request 番号なしのハイフン code）、`other_numeric`、`non_code`。3 桁=項とはしない。
- page summary: lexical class 別の行数、request_like 行の x と plain3 行の x の histogram（0.1pt 単位）、request x の evidence（`none` / `dominant`＝全 request x が最頻値から 0.5pt 以内 / `multimodal`）、見出し geometry（前年度・要求額・差額の列の左端、名称右端、basis）、page 幅・高さ・rotate。
- signature（page 単位、凍結）: header 成分 = 見出し由来の column layout がある page の `w<幅>|p<前年度x>|r<要求額x>|d<差額x>`（各 1pt に丸める。無ければ未設定）、request 成分 = dominant の代表 x を 1pt に丸めた値（multimodal は `multi`、request 行が無ければ未設定）。両成分が未設定の page は signature なし。
- contiguous range: page と range は、両方で設定されている成分が全て等しいとき互換。互換なら range に加え、range の未設定成分を埋める。signature が変わる所を transition とする。signature のない page は、前後が同じ range に属するなら gapPages として吸収し、range が変わる所では transition の間の未割当 page とする。絶対 x の閾値は上記の丸め（1pt）と 0.5pt のみ。結果を見て調整しない。
- PDF status: `single_layout_like`（range の signature が 1 種）/ `mixed_layout_like`（2 種以上）/ `insufficient_evidence`（signature のある page が 0）。「項がある／ない」ではない。coverage は `inventory_evaluable` / `unavailable_rotate90` / `unavailable_upstream` / `insufficient_layout_evidence` / `other`。
- 既存 hierarchy 契約との対応: contract の page 範囲 [a, b] について、a が range の先頭 page かつ b が range の末尾 page なら境界一致（range に属さない page は不一致）。

## C. Development population と findings（`development-inventory.json`、SHA-256 `817ade1a…af91f`）

選択規則（結果を見る前に固定）: hierarchy 契約あり 8 PDF（`001630395.pdf` を含む）+ weak A（hierarchy 契約なし・基準 x=55.22 の 26 PDF）の localPath 辞書順で先頭 3 + weak B（基準 x を決められなかった 23 PDF）の同 3。計 14 PDF（`development-inventory.json`）。

development で分かったこと（protocol を freeze する前の変更として記録）:
- 当初の signature は header 成分のみだった。この版では 14 PDF すべて（`001630395.pdf` を含む）が `single_layout_like` となり、request x の mode が変わる既知の mixed-layout を表現できなかった（trivial に壊れている）。そこで header 成分に request x 成分を加えた現在の signature に変更してから freeze する。
- 14 PDF の見出し geometry は同一のテンプレート（A4 横 842pt、`p207|r259|d414`）で、PDF 間の違いは行の x（request x が一般会計 66 / 特別会計 79）と、見出しのない前置きの表（request x が 55 / 69 / 76 など）に現れる。
- `001630395.pdf`: page 3（request x 55）、page 5（76）、page 7〜10（見出しあり、79）の 3 range。
- hierarchy 契約 8 PDF のうち 6 PDF は契約範囲が range の境界と一致。mext・mhlw は契約範囲（1045-1339 / 1555-1700）が、より広い 1 つの range（1-1339 / 21-1723）の部分範囲。

## D. 全件実行・集計（freeze 後。`inventory-budget-request-layouts.ts --phase=full`）

- 82 PDF 全体（rotate=90 の 8 PDF は page メタのみを記録し `unavailable_rotate90`）。page 単位 inventory、PDF 単位 summary、range、transition、variant（signature）表（PDF 数・assigned page 数・range 数・一般/特別）、省庁別（manifest の metadata のみ）。
- weak A（request x=55.22 の 26 PDF）: signature / range 分布、plain3 行の x と request x の相対 histogram、evidence の十分性。candidate count は新規則で再計算しない。
- weak B（基準 x を決められなかった 23 PDF）を、互いに排他な次の category に分類（上から順）: `no_request_rows_no_plain3`（request_like 0 かつ plain3 0）、`no_request_rows_plain3_present`、`few_requests_single_layout`（request_like が 1 以上 5 未満かつ single_layout_like）、`few_requests_mixed_or_insufficient_layout`。upstream の行分類が不足しているかは inventory では区別できないと明記する。
- `001630395.pdf` の page 単位の geometry と transition（development の再現）。
- 既存 hierarchy 契約: 8 PDF の contract id・範囲・A2 の全 entry・境界一致、コード上の根拠（A の Fact）。hierarchy source candidate matrix（request x / 3 桁 code x / 見出し geometry / page 範囲 / 名称 など）は採用決定せず、observed coverage（evaluable pages 基準）・決定性・layout 依存・ambiguity を記述する。

## E. 判定規則（機械的。件数同士の比較のみ。結果を見た後に条件・閾値を足さない）

量: `E` = inventory_evaluable と insufficient_layout_evidence の PDF 数、`U` = unavailable（rotate90・upstream）の PDF 数、`M` = request x が multimodal の page 数、`D` = dominant の page 数、`C` = 契約 PDF 数（8）、`A` = 契約範囲が range の境界と一致（start と end の両方）する PDF 数。

1. `INCONCLUSIVE`: development 確認（development artifact が freeze 値と一致・full 実行の range と一致・`001630395.pdf` が 2 range 以上）が成立しない、または `U ≥ E`。
2. `LAYOUT_VARIANTS_AMBIGUOUS`: `M > D`（同じ page に異なる request x が混在する page の方が多い）。
3. `LAYOUT_DETERMINISTIC_BUT_HIERARCHY_SOURCE_INCOMPLETE`: `A < C`（既存の契約範囲のすべてを、page geometry の range 境界から再現できるとは言えない）。
4. `LAYOUT_VARIANTS_DETERMINISTIC`: 上記以外。

報告のみ（判定に使わない）: header signature ごとの request x クラスタ数（header geometry だけで行の geometry が決まるか）。layout variant が分かったことは正しい hierarchy を生成できることを意味しない。

## F. 順序・禁止

Commit A（本書・lib・tests・development artifact・実行 script を凍結）→ B（全件 inventory）→ C（result freeze）。production の hierarchy generator 実装、既存 hierarchy 契約・FieldResolver・recordKind・candidate rule・MOF matcher の変更、candidate 929 / 835 等の書き換え、人手 GT、PR 作成は行わない。
