# 概算要求PDF full-corpus layout / hierarchy source inventory — 結果

事前登録: `20261005_0806_Budget_Request_Layout_Hierarchy_Source_Inventory_Preregistration.md`（Commit A `f1f238d`、doc SHA-256 `e724e582…f77fe`）。全件 inventory は Commit B `6dd5307`。規則・判定規則は結果を見た後に変更していない（実行時の集計コードの不具合 1 件を修正したのみ。下記）。production code は無変更（`scripts/pipeline-v2/lib` は新規ファイルの追加のみ）。

**判定: `LAYOUT_DETERMINISTIC_BUT_HIERARCHY_SOURCE_INCOMPLETE`（規則 3）。** layout 自体は少数の variant で page / range 単位に決定的に記述できたが、既存 hierarchy 契約の page 範囲を layout range の境界から再現できるのは 8 PDF 中 6 PDF だった。layout variant が分かったことは、正しい hierarchy を生成できることを意味しない。

## Coverage

| status | PDFs | pages |
|---|---:|---:|
| inventory_evaluable | 73 | 8,586 |
| unavailable_rotate90 | 8 | 1,236 |
| unavailable_upstream | 0 | 0 |
| insufficient_layout_evidence | 1 | 77 |
| other | 0 | 0 |

`insufficient_layout_evidence` の 1 PDF は金融庁 `01.pdf`（77 page、request_like 行も plain3 行も 0 で見出しもない）。rotate=90 の 8 PDF は page メタのみ記録し、修正していない。

## Layout variants（signature = 見出し geometry + request x）

evaluable 74 PDF の 8,663 page のうち signature を割り当てたのは 8,364 page、183 range、transition 110。PDF 単位は single_layout_like 24・mixed_layout_like 49（rangeが 1 / 3 / 4 / 5 / 6 の PDF が 24 / 42 / 4 / 1 / 2）。一般会計は single 19・mixed 26、特別会計は single 5・mixed 23。

| variant（header | request x） | PDFs | assigned pages | ranges | 一般 | 特別 |
|---|---:|---:|---:|---:|---:|
| 見出しあり（A4 横 842pt・p207/r259/d414）\| 66 | 57 | 7,983 | 57 | 41 | 16 |
| 見出しあり \| 79 | 10 | 150 | 10 | 0 | 10 |
| 見出しなし \| 69 | 42 | 135 | 42 | 27 | 15 |
| 見出しなし \| 55 | 47 | 58 | 50 | 26 | 21 |
| 見出しなし \| multi（1 page に複数の request x） | 10 | 17 | 13 | 7 | 3 |
| 見出しなし \| 76 | 8 | 15 | 8 | 0 | 8 |
| 見出しあり \| 76 | 2 | 4 | 2 | 0 | 2 |
| 見出しあり \| 69 | 1 | 2 | 1 | 1 | 0 |

意味（source evidence ベース）: 見出し geometry は全 PDF で同一のテンプレート 1 種（842pt、前年度 207・要求額 259・差額 414）。PDF 間の違いは行の x に現れ、request x は一般会計の明細表で 66、特別会計の明細表で 79。見出しのない前置きの表（概要・組織別など）の request x は 55 / 69 / 76。したがって header geometry だけでは行の geometry は決まらない（同じ header signature の中に request x が 2 クラスタ）。layout の適用単位は PDF 全体ではなく contiguous page range（前置きの表 → 明細表）。

## Mixed-layout PDFs と `001630395.pdf`

49 PDF が mixed（前置きの表の range と明細表の range に分かれる。mixed PDF の range 数は 3〜6）。`001630395.pdf`（特別会計）: page 3（request x 55、見出しなし）、page 5（76、見出しなし）、page 7〜10（見出しあり、79）の 3 range。page 1・2・4・6 は signature の根拠となる行がなく、page 10 は見出しだけで request 行がないが、見出し成分が互換なので page 7〜9 の range に入る。→ page 単位の signature だけでは足りず、contiguous range の補完が必要（`contiguous-range geometry required`）。前回 candidate rule が PDF 全体の request x の最頻値（55.22）を使って 0 件になったのは、前置きの表の request x が最頻値に選ばれたため、という source 上の説明と整合する。

## request x ≈ 55.22 の 26 PDF

26 PDF すべてが mixed_layout_like で、見出しなしの `R:55` の range（前置きの表）を持つ。21 PDF は見出しあり `R:66`、4 PDF は `R:79`、1 PDF は `R:76` の明細表 range も持つ。つまり別 layout の PDF ではなく、基準 x がたまたま前置きの表から取られた PDF である。candidate count は新規則で再計算していない。

## 基準 x を決められなかった 23 PDF（request 行 5 件未満）

| category | PDFs |
|---|---:|
| few_requests_single_layout（request 行 1〜4 件・layout は 1 range） | 18（内閣官房 15、内閣府 2 など。plain3 行は 2〜10 行） |
| few_requests_mixed_or_insufficient_layout | 4（消費者庁・宮内庁・農水省・裁判官訴追委員会） |
| no_request_rows_no_plain3（金融庁 `01.pdf`） | 1 |
| no_request_rows_plain3_present | 0 |

「23 PDF は別 layout」ではなく、request 行そのものが少ない小さな文書が大半で、geometry は 1 range に安定している。upstream の行分類が不足しているかは inventory では区別できない。

## 既存 hierarchy の source inventory

- Fact（コード）: hierarchy node・edge は SourceToken / TableGeometry / LogicalRow のみから決定的に導出される（indent クラスタ・page 端の行の除外・lattice）。コード値・省庁名・固定 pt 値・GT は使わない。node は source の page / row / token への参照を保存する。→ `deterministic_from_upstream`（provenance あり）。
- Fact: hierarchy を適用する page 範囲は `A2_EXPERIMENTS` に手で書かれた定数で、PDF から導出するコードはない。→ `manually_encoded`。node ごとの件数分類（baseline は hierarchy artifact を保存していない）は列挙していない。
- 契約範囲と layout range の境界: 8 PDF 中 6 PDF（cfa 7-147、env 21-193、maff-fukko 7-20、meti 9-106、mlit-fukko 7-10、mod 9-540）は契約範囲が明細表の range と一致。mext（1045-1339）と mhlw（1555-1700）は、より広い 1 つの range（1-1339 / 21-1723）の部分範囲で、境界は layout からは決まらない（契約が development のために狭めた範囲）。

## Hierarchy source candidate matrix（採用決定ではない。次の preregistration の検証候補）

| evidence | observed coverage（evaluable 8,663 page） | deterministic? | layout 依存 | ambiguity / 注意 |
|---|---|---|---|---|
| 見出し geometry（列の x） | 8,364 page（96.5%） | はい（pdf.js の header token） | 全 PDF 同一テンプレートのため variant を分けない | 明細表と前置きの表の区別（見出しの有無）には使える。行の indent は決められない |
| request x | 1,311 page で観測。dominant 1,294・multimodal 17 | はい | 明細表で一般 66 / 特別 79。前置きの表で 55 / 69 / 76 | 最頻値を PDF 全体に使うと混在で破綻（前回の弱点）。range 単位で使う必要 |
| 3 桁 plain code の x | 6,102 page（request と共存 1,199 page） | はい | request x との相対 offset は明細表で複数の段（項・組織・明細） | 3 桁=項ではない。段の意味は別 evidence が必要 |
| page 範囲の境界 | 契約 8 PDF 中 6 で range と一致 | range 化は決定的。契約範囲は手作業 | はい | mext・mhlw の契約範囲は layout 境界と無関係 |
| 見出し文字・組織名 | 今回は未観測（inventory の対象外） | — | — | 将来の候補 |

layout geometry（見出し + request x の range）だけで決まるのは「明細表か前置きの表か」「request の indent の基準」まで。組織・項の境界を構成する evidence（組織名・見出し文字など）は今回の観測の範囲外で、geometry だけで hierarchy を構成できるとは言えない。

## Fact / observation / interpretation

- Fact: 82 PDF のうち 74 PDF で page 単位の row-local geometry と contiguous range を決定的に記述でき（再実行で artifact 不変）、見出しテンプレートは 1 種、signature は 8 variant。rotate=90 の 8 PDF は未評価。
- Observation: layout の適用単位は PDF でなく range。一般会計の明細表は request x 66、特別会計は 79。弱点だった 26 PDF・23 PDF はそれぞれ mixed layout の基準 x の取り違えと request 行の少ない小文書で説明でき、別 layout ではない。契約範囲の境界は 6/8 のみ layout と一致。
- Interpretation: 次の DocumentHierarchy 設計では、layout range（明細表 range）を単位にする余地がある。ただし hierarchy の page 範囲をどう決めるかが未解決（手作業の契約と layout 境界が 2 PDF で食い違う）。item-shaped candidate は GT ではなく、MOF 784 項は PDF 側の正解母数ではない。今回 candidate count の改善値は作っておらず、hierarchy generator の精度も主張しない。

## 実行上の記録

最初の全件実行は variant 集計のコードが「page の signature で range を引く」実装になっており（range に補完された signature と一致しない page で）異常終了した。判定・規則・出力の定義は変えず、page が属する range の signature で集計するよう修正して再実行した（Commit B は修正後の実行）。

## Next step（開始しない）

(1) 明細表 range を単位にした DocumentHierarchy の生成規則の事前登録（page 範囲を layout range から導出する案と、手作業の契約範囲の差の検証）。(2) 組織・項の境界を構成する見出し文字・組織名などの evidence の inventory。(3) 基準 x を range 単位にした candidate count の再評価（別 phase。今回は行っていない）。

## 検証

tsc エラー 0・lint エラー 0・vitest 123 files / 1,452 tests pass。development・全件 inventory の再実行で artifact 不変（summary `67808613…3266`、page inventory `fb74ca44…441b`、development `817ade1a…af91f`）。frozen 入力（baseline・hierarchy isolation・candidate-count）の hash は script が実行時に照合。

今回は、FY2024 概算要求PDFの full corpus に存在する layout variant、PDF内 layout transition、および DocumentHierarchy を将来構成するために利用可能な source evidence を inventory する研究である。DocumentHierarchy generator、FieldResolver、recordKind、candidate rule、rotate対応、MOF matcher の production変更は行っていない。
