# 概算要求PDF 項候補数の全コーパス確認 — 結果

事前登録: `20261005_0752_Budget_Request_PDF_Item_Candidate_Count_Preregistration.md`（Commit A `aba8b4c`、doc SHA-256 `e53be9e1…e49319`）。全件走査は Commit B `95f1d7a`。規則・判定規則は結果を見た後に変更していない。production code は無変更（`scripts/pipeline-v2/lib` は新規ファイルの追加のみ）。

**判定: `ITEM_POPULATION_HIDDEN_BY_HIERARCHY`（規則 4）。ただし下記の限界つき。** 候補は item-shaped row であり正式な項 GT ではない。MOF 784 を PDF 側の正解母数とは仮定しない。

## Scan coverage

| status | PDFs | pages |
|---|---:|---:|
| scannable | 74 | 8,663 |
| unscannable_rotate90 | 8 | 1,236 |
| unscannable_missing_upstream_artifact | 0 | 0 |
| unscannable_other | 0 | 0 |

scannable 74 のうち、request 行が 5 件未満で基準 x を決められない PDF が 23（`no_reference`。候補を数えていない）。候補を数えたのは 51 PDF（契約あり 8 + 契約なし 43）。

## Candidate counts（候補を数えた 51 PDF）

| account | PDFs | candidate rows | within-document unique | duplicate rows | ambiguous |
|---|---:|---:|---:|---:|---:|
| general | 28 | 641 | 611 | 7 | 23 |
| special | 23 | 288 | 224 | 13 | 51 |
| total | 51 | 929 | 835 | 20 | 74 |

| group | PDFs | rows | unique | duplicate | ambiguous |
|---|---:|---:|---:|---:|---:|
| hierarchy 契約あり（8 PDF、全ページ） | 8 | 311 | 295 | 2 | 14 |
| hierarchy 契約なし（74 PDF 中、基準 x あり） | 43 | 618 | 540 | 18 | 60 |

cross-document unique（参考値。組織を特定できないため semantic な項数ではない）: code+名称 key 800（うち複数 PDF に出現 29）、一般会計 611。

## MOF 比較（一般会計）

```text
MOF XML 当初予算 items:            784
PDF candidate rows:                641   (28 PDF)
PDF within-document unique:        611
現行 production item records:       81
candidate-count ratio to MOF:      0.82（rows）/ 0.78（unique）— 参考値
```

比率は recall / coverage ではない。予算段階が異なる、PDF 側の全項 GT がない、rotate=90 の 8 PDF と基準 x のない 23 PDF が未走査、code 体系が異なる、同名・統合・分割があり得る、のため。

## 判定の根拠（契約なし 74 PDF の scannable / 基準 x あり 43 PDF）

R=618 > 現行 item 97、U=540 > A=60 かつ D=18、候補を持つ publisher は 12（ただし候補を持つ PDF は 17、残り 26 PDF は候補 0）。development の一貫性（既存 item 97/97 が候補に入る）は成立。いずれも件数同士の比較で規則 4 に該当。

## Optional: MOF exact-name overlap（diagnostic only。組織なしの名称単独）

一般会計の候補 641 行のうち名称ありは 618。MOF の 784 section 名（正規化後の distinct 750）に対して unique exact 534・ambiguous exact 63・no exact 21。契約あり 8 PDF 289 行は 257 / 23 / 9、契約なし 329 行は 277 / 40 / 12。基準情報として baseline の正式照合は 77 / 79（97.5%、hierarchy・組織付き）。名称単独は同名項が別組織にあり得るため、正式な一致ではない。ただし、契約なし PDF の候補名の約 84%（277 / 329）が MOF の項名と一意に一致することは、候補が項名らしい行であることと整合する。

## Fact / observation / interpretation

- Fact: development（契約あり 8 PDF の hierarchy 区間）で候補 158、既存 item 97 は全て候補に入る。候補だが既存 item でないもの 61（ON で organization 7・unclassified 54）。x のオフセット 6.9pt は同 8 PDF から固定した定数のため、97/97 は規則の独立な検証ではない。
- Observation: 契約なし PDF のうち候補を数えた 43 PDF で 618 行。候補が出るのは 17 PDF（基準 x が 65.57 の 12、69.02 の 3、75.92 の 1、79.37 の 1）。基準 x が 55.22 の 26 PDF は候補 0（規則が較正した layout 65.57 / 79.37 と異なり、この規則が当てはまるか不明）。基準 x を決められない 23 PDF は未計数。したがって 618 は下限寄りの値だが、layout 外の PDF は数えていない。
- Observation（規則の弱点）: 国土交通省の特別会計 `001630395.pdf` は development では候補 8 だが、全ページでは request の最頻 x が別 layout の頁（55.22）に引かれて候補 0 になった。PDF 内に layout が混在すると基準 x が崩れる（PDF 単位の最頻値という凍結規則の限界。修正はしていない）。
- Interpretation: hierarchy 契約のない PDF に、現行 item 97 件全体を上回る item-shaped row が存在する。「現行 hierarchy がないため item として認識できていない」ことと整合するが、候補が正しい項であること、PDF 側の項数が 784 に近いこと（recall）は示していない。organization 行や layout 混在による誤検出・取りこぼしを含む。

## Next step（開始しない）

Full-Corpus DocumentHierarchy の source / schema inventory へ進む候補。その前提として、基準 x が 55.22 の layout（26 PDF）と基準 x を決められない 23 PDF の layout inventory、PDF 内の layout 混在の扱いを先に確認する。

## 検証

tsc エラー 0・lint エラー 0・vitest 122 files / 1,445 tests pass。development・走査・MOF 診断の再実行で artifact 不変。frozen 入力（baseline・hierarchy isolation・MOF jikou）の hash は script が実行時に照合。

今回は、FY2024 概算要求PDFに存在する item-shaped row の規模を hierarchy-independent な既存上流 evidence から確認する population diagnostic である。候補を正式な項GTとは扱わず、MOF 784件をPDF側の正解母数とも仮定していない。DocumentHierarchy、FieldResolver、recordKind、rotate対応、MOF matcher の production変更は行っていない。
