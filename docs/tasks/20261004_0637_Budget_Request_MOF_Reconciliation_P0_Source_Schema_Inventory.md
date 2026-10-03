# Budget Request × MOF Reconciliation P0

**判定: NEEDS DESIGN WORK。** PDF×MOF の照合・match率・曖昧一致は一切行っていない。件数は既存 artifact の観測のみ。

## 1. Purpose

概算要求 PDF の抽出結果（項・事項）と MOF 予算書の項・事項を広く照合し、抽出全体の中間的な品質評価に使えるかを、P1 設計前に source evidence から確認する。MOF は ground truth とは定義しない。

## 2. Repository / source state

- base `origin/main` = `11f19d5`（#368 merge 済み）。branch `research/budget-request-mof-reconciliation-p0`、working tree clean。
- 原本は `data/download/`（変更なし）。PDF 82 本は inventory で全件 FOUND（`data/work/budget-request-extraction/2024/inventory.json`）。

## 3. PDF extraction source and pipeline

原本: FY2024（令和6年度）歳出概算要求書 82 PDF（一般会計 50・特別会計/復興特会 32）。pipeline: SourceToken → TableGeometry → LogicalRow →（DocumentHierarchy v2-B を入力に）FieldResolver v0。**全文書の抽出は存在しない。** 抽出 artifact は `data/work/budget-request-field-resolver/` に、評価用に選んだページ範囲だけ（5 run ＋ held-out 16 ページ）がある。FieldResolver は hierarchy 入力が無いと 3 桁コード行を項と判別できない（`unclassified`）。

## 4. PDF 項・事項 schema

`recordKind`（`RecordFieldResolution`）: `organization` / `item` / `request` / `detail_line` / `unclassified`。実データの対応（METI 実例）:

| PDF recordKind | 例 | コード形 | MOF 側の概念 |
|---|---|---|---|
| organization | 経済産業本省 | 3 桁 | 組織 |
| item | 経 済 産 業 本 省 共 通 費 | 3 桁（010, 020, 530…） | 項（項名の形） |
| request | 経済産業本省一般行政に必要な経費 | `NN-NN`（01-95, 01-13…） | 事項（事項名の形） |
| detail_line | 各目的の明細行 | 5 区切りコード等 | 目に近い（対応は未確認） |

フィールド: `rowLocal.{code,name,previousBudget,requestedBudget,difference,…}`（status 付き。`name.value.{raw,normalized}`）、`hierarchyDependent.{parentItemAssociation,parentOrganizationAssociation}`、anchor（page・logicalRowIndex）、evidence（sourceTokenRefs・bbox）。金額は円単位の raw/numeric。

## 5. PDF inventory / counts（既存 artifact の観測。母集団ではない）

| run | ページ | records | organization | item | request | hierarchy 入力 |
|---|---|---:|---:|---:|---:|---|
| cfa | 7–147 | 557 | 7 | 0 | 24 | あり |
| meti | 9–106 | 1,238 | 5 | 30 | 50 | あり |
| mext | 870–880 | 53 | 0 | 0 | 0 | なし |
| mhlw | 1260–1275 | 94 | 0 | 0 | 2 | なし |
| mhlw | 1555–1700 | 998 | 2 | 14 | 21 | あり |

item の unique（code, normalized name）は meti 30・mhlw 14、request の unique は cfa 24・meti 45・mhlw 2+21（run 内）。held-out 16 ページ（単一ページ・hierarchy なし）は item を判別できず request のみ。82 PDF のうち抽出済みはごく一部で、**全 82 文書の項・事項の母数は不明**。

## 6. MOF source and pipeline

(a) 項・目: 配布 CSV（`data/download/mof.go.jp/archive/2024/2024/csv/DL2024*.zip`）→ V2 normalize（`data/normalized/mof/fy2024/budget-items.jsonl` 19,680 行）→ derive（`data/derived/mof/fy2024/sections.jsonl` 1,311 項、当初 initialYen>0 は一般 739・特別 236・政府関係機関 22）。(b) 事項: Web 帳票 XML（bb.mof.go.jp、`<title_for_list>` で判別）→ `scripts/generate-mof-jikou-data.ts`（V1）→ `public/data/mof-jikou-2024.json`（型 `types/mof-jikou.ts`、API `/api/mof-jikou`、UI `/mof-jikou`）。V2 には事項が無い。事項の XML キャッシュは現在の `data/download/` に無く、再生成にはネットワークが要る（V1 生成 script はローカルで動かない状態）。

## 7. MOF 項・事項 schema

`MOFJikouItem`: `ministry` / `organization` / `specialAccount` / `subAccount` / `agency` / `sectionCode`（項コード）/ `sectionName`（項名）/ `majorExpenseCode`（主要経費別分類コード）/ `name`（事項名）/ `amount`・`previousAmount`・`difference`（円）/ `budgetType` / `documentId` / `key`（内容ベース合成キー）。**事項にも項にも公式 ID は無い**（`docs/mof-budget-data-guide.md` §3-1-1）。項は ministry→organization→項コード→項名、事項は項の下（階層はこの順）。

## 8. MOF inventory / counts（FY2024 `mof-jikou-2024.json`、当初予算）

| 会計 | 事項 | unique 項（ministry/org/勘定/機関/コード/名） | unique 事項名 | key unique |
|---|---:|---:|---:|---:|
| 一般 | 1,256 | 784 | 1,078 | 1,256 |
| 特別 | 360 | 250 | 265 | 360 |
| 政府関係機関 | 48 | 22 | 10 | 48 |

ほかに補正（第1号）・決算の事項がある（同一 JSON 内、`budgetType` で区別）。一般会計は 18 所管・94 組織。

## 9. Fiscal year / budget-stage alignment

- **年度**: PDF は FY2024（令和6年度）概算要求、MOF も FY2024（令和6年度）。同一年度。
- **予算段階: 異なる。** PDF は概算要求（2023 年夏提出）。MOF は 当初予算（成立後の予算書）・補正・決算で、**概算要求の帳票は MOF 側に無い**。MOF `amount` は当初予算額、`previousAmount` は前年度（FY2023）予算額。PDF の `requestedBudget` は要求額、`previousBudget` は前年度予算額。段階の違いにより、金額は等値を期待できない。`previousBudget` と MOF `previousAmount` が同じ基準かは**未確認（unresolved）**。
- 会計 scope: PDF は 一般会計 50 と 特別会計等 32 の 82 文書。MOF 事項は一般・特別・政府関係機関。

## 10. Hierarchy comparison

両側とも 組織 → 項 → 事項 の形（PDF は hierarchy 入力から復元、MOF は帳票の階層）。ただし PDF の item／request が MOF の項／事項と**意味的に同一の node かは名称・形からの観測にとどまる**（確定していない）。特別会計は MOF が 特会→勘定→項、PDF は 会計単位の文書。PDF に事項の下の `detail_line` 層があり、MOF 事項の下は目（事項と目は 1:1 対応しない、MOF 公表の対応表なし）。

## 11. Candidate join keys（判定は観測のみ）

| 候補 | 判定 | 根拠 |
|---|---|---|
| 項コード（単独） | **not viable** | PDF は 010, 020, 040…、500, 530 の飛び番。MOF は 001, 002, 003…の組織内連番。実例: 経済構造改革推進費 PDF=500 / MOF=003、経済産業本省共通費 PDF=010 / MOF=001。体系が別 |
| 項名（正規化後 exact） | partially viable | 両側にある。PDF は raw に字間スペース・折返し改行があり `normalized` で除去済み。同名項が複数組織にある（MOF 一般で 30 名）ため 組織 との複合が要る |
| 組織名 + 項名 | partially viable | PDF の組織は hierarchy 入力がある run のみ。組織名の表記が両側で一致するかは**未確認** |
| 事項名（正規化後 exact） | partially viable | 両側にある。PDF は名称切れリスク（incomplete-name guard は既定 OFF）、MOF の同名事項は複数項に存在（一般で 107 名） |
| 事項コード（PDF `NN-NN`）の後半 = MOF 主要経費別分類コード | **unresolved** | METI の観測例で 95・60・13 が MOF `majorExpenseCode` と同じ体系に見える。分類コードは識別子ではない（MOF guide §3-1-1）。前半は PDF 内の連番 |
| 金額（previous/requested vs amount） | not viable（key としては） | 段階が異なる。差分や一致を key にしない |

## 12. Duplicate / uniqueness observations

- MOF（一般・当初）: key は 1,256 件で重複なし。事項名は 1,078 unique、107 名が複数の項に出る。項名は 30 名が複数組織に出る。項コードは組織内で一意（特別会計で同一コードに複数項名が 2 件）。
- PDF: item／request の組（code, normalized name）は run 内で ほぼ unique。run 間・文書間の一意性は未確認。

## 13. Observed representation differences

PDF の name は raw に字間スペース（"経 済 産 業 本 省 共 通 費"）と折返し改行（"…に\n必要な経費"）を含み、`normalized` で除去済み（resolved 71 件中 raw≠normalized が 67）。MOF の項名・事項名にはスペース・改行は無く、全角括弧は少数。金額は両側とも円（MOF は千円→円変換済み）。「観測」のみで、同一性の根拠にはしない。

## 14. Reconciliation feasibility

構造上は項（組織＋名称）と事項（名称、＋分類コード）で比較できる見込みがある。ただし 1:1 は期待できない（MOF の同名事項が複数項に存在、事項の分割・統合・改称、PDF の名称切れ）。1:N / N:1 が構造的にある。比較できる population は、現状の抽出 artifact では「評価用に選んだ 5 run の一部」に限られ、抽出済みの母数が小さい。

## 15. Unresolved questions

1. PDF 側の全文書の項・事項を抽出する工程（hierarchy 入力の与え方を含む）をどう用意するか
2. 組織名の表記・粒度が両側で一致するか
3. PDF `NN-NN` の後半と MOF 主要経費別分類コードの対応が一般に成り立つか
4. PDF の `previousBudget` と MOF `previousAmount` の基準が同じか
5. 特別会計・復興特会・政府関係機関の PDF と MOF の対応
6. MOF 事項の再生成（V1 script・XML 取得）を P1 の前提にするか、既存 `mof-jikou-2024.json` を固定入力にするか

## 16. Recommendation for P1

**NEEDS DESIGN WORK**。P1 の前に決めること: (1) PDF 側の母集団（既存 run 限定か、対象文書・ページ範囲を拡げるか。拡げる場合の抽出手順と hierarchy view の与え方）、(2) MOF 側は `mof-jikou-2024.json` を hash 付きで固定入力にする、(3) 照合単位を 項（組織＋正規化名）と 事項（項＋正規化名）に分け、1:1 を前提にせず 1:N／N:1／曖昧を別カテゴリで凍結、(4) 項コードは key にしない、(5) 金額は key にも補完にも使わない、(6) fuzzy は primary に入れない。比較の価値自体はある（抽出崩れ・名称切れ・階層誤りの検出）が、不一致を PDF 側の誤りと断定しない。

## 17. Explicit non-actions

PDF×MOF の join、match率、unmatched/ambiguous率、fuzzy・部分一致・編集距離・embedding・LLM、データ補正（名称・コード・金額・hierarchy）、blank→0、FieldResolver・LogicalRow・GT の変更、PDF の目視、H2 は行っていない。#368 の凍結 artifact と `data/download/` は変更していない。残る debt（#368 の Low 2 件）は別扱いのまま。
