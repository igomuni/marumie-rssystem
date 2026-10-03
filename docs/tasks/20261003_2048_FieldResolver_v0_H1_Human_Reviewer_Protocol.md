# 概算要求 PDF 名称継続の視覚分類 — Reviewer Protocol

この文書は reviewer に渡す手順書です。reviewer は、この文書・`h1-human-validation-worklist.json`・原本 PDF 7 本だけを使います。

## 1. 目的

worklist の 65 unit（全数）について、原本 PDF の見た目だけから、対象 record の名称が「その行で完結しているか、直下に続いているか」を独立に分類します。65 件すべてを処理してください。

## 2. 事前の確認（reviewer declaration）

作業を始める前に、次を確認し、匿名の reviewer ID とともに記録してください（氏名は記録しません）。

> 私は、この作業の前に、次のいずれも見ていません。
> - これらの unit に対する、機械または AI による分類ラベル
> - これら 65 unit の分類結果の集計
> - 機械・AI との一致／不一致に関する情報
> - 個々の unit が機械・AI にどう分類されたかを示す文書
>
> 私は、与えられた原本 PDF・locator・本 protocol の分類規則だけから、各 unit を分類します。

上のどれかを見ている、または見てしまった場合は、作業を始めず（または直ちに中断して）、何を見たかを記録して研究担当に伝えてください。

## 3. 渡されるもの

1. `h1-human-validation-worklist.json`
2. この protocol
3. worklist の `sources` に載っている原本 PDF 7 本（SHA-256 と page count は worklist のとおり）
4. 必要なら package manifest

これ以外の資料（リポジトリ、履歴、他の fixture など）は見ません。

## 4. 対象 unit の探し方

各 unit は `canonicalUrl`（→ 対応する原本 PDF）、`physicalPage`（PDF の物理ページ、1 始まり）、`code`、`anchorYPt` を持ちます。`anchorYPt` は、ページ上端から測った対象行の範囲（pt、`[上, 下]`）です。
1. `physicalPage` を開く。
2. `code` と `anchorYPt` の範囲で対象 record を特定する。`anchorYPt` の範囲が「当該行」です。
3. 当該行の直下の見た目を確認する。

`code` と `anchorYPt` を使っても対象を一意に特定できない場合は、推測で選ばず、その unit にはラベルを付けず作業を中断して報告してください（これは `unclear` とは別扱いです）。

## 5. 3 つのラベル

- `complete_on_current_logical_row`: 対象 record の名称が当該行で完結しており、直下に同一名称の続きが無いと、PDF の視覚情報から判断できる場合のみ。「続きが見つからなかった」だけでは付けません。
- `incomplete_continues_below`: 対象 record の名称が、直下に同一名称として続いていると、PDF の視覚情報から判断できる場合。続きが同一 record・同一名称に属すると視覚構造から判断できることが必要です。
- `unclear`: 対象 unit は特定できるが、視覚情報だけでは名称継続の有無・所属を断定できない場合。推測が必要なら `unclear` にします。

## 6. 視覚のみの規則

使ってよい: 原本 PDF、worklist の locator、PDF 上で実際に見える文字、行・列・罫線・位置関係・code・金額などの視覚構造、単純な拡大表示、170 dpi 程度の通常の描画。
使わない: テキスト抽出、OCR、一般知識による名称の補完、「日本語として自然だから続くはず」「括弧が閉じていないから続くはず」といった推測、他ページの類似名称、機械・AI の出力や説明。見えないものは補わず、所属を断定できなければ `unclear` にします。

## 7. 記録するもの

各 unit について `unitId` と `label`（上の 3 つのうち 1 つ）を記録します。予定する形式は次のとおりです。

```json
{ "reviewerId": "<匿名ID>", "units": [ { "unitId": "...", "label": "...", "reviewerType": "human" } ] }
```

ラベル以外の自由記述の理由は不要です。

## 8. 作業中の注意

- 作業中に、機械・AI の結果や集計を示す情報を見てしまったら、その場で中断し、何を・いつ・どの unit について見たかを報告してください。続行しないでください。
- 全件の分類が終わったあとも、reviewer 自身が機械・AI の結果と照合する必要はありません。比較は別の手順で行われます。
