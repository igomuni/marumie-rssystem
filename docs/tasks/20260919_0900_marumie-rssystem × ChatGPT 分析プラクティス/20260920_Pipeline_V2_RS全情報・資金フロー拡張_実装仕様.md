# Pipeline V2 RS全情報・資金フロー拡張 実装仕様

作成日: 2026-09-20  
対象: `igomuni/marumie-rssystem` / Pipeline V2  
主対象コード: `scripts/pipeline-v2/`  
関連ドキュメント: `docs/data-pipeline-v2.md`

---

## 1. 目的

Pipeline V2 の RS 側について、現在一部しか利用していない公開CSVおよび `sheets` の情報を、原典情報を極力失わない形で Normalized 層へ取り込み、以下を可能にする。

1. RS事業の基本属性・公式事業URL・開始/終了年度・政策/法令・関連事業・レビュー情報を保持する。
2. 過去実績 → 当年度予算 → 翌年度概算要求を、`sourceYear` と `fiscalYear` を区別したまま表現する。
3. 5-1/5-2/5-3/5-4 を用いて、直接支出・再委託・再々委託・府省庁間移替・融資・保険・外部資金源等を表現できる資金フロー基盤を構築する。
4. 支出フローを「ツリー」や「Sankey前提」ではなく、循環・分岐・合流・複数root・非連結成分を許容する一般有向グラフとして扱う。
5. 既存 V1 および現行 `/budget-flow` の MOF 側を壊さず、将来の RS 詳細・支出先表示に使えるデータ契約を整備する。
6. 現在UIで未使用の情報でも、原典に存在する有用な列を Normalize 時点で極力捨てない。

---

## 2. 非目的

今回の主目的はデータ基盤であり、以下は必須実装範囲外とする。

- `/budget-flow` の大規模UI改修
- 新しい資金フロー可視化コンポーネントの完成
- MOF決算説明PDFの全面パース
- 5-2 のエッジに存在しない金額を推定して埋めること
- 同名法人・同一法人番号のブロックを自動で1ノードに統合すること
- 5-2を国費の会計取引明細として扱うこと

ただし、次段階のUI実装で利用できる Product/Derived 契約は本仕様で定義する。

---

## 3. 現状と確認済み課題

現行 `normalize-rs.ts` は、2025年に公開されている15系統のCSVのうち、主に以下4系統だけを利用している。

- `1-2 基本情報_事業概要等`
- `2-1 予算・執行_サマリ`
- `2-2 予算・執行_予算種別・歳出予算項目`
- `5-1 支出先_支出情報`

現行型も主として以下に限定される。

- `RsProject`
- `RsBudgetEvent`
- `RsBudgetItem`
- `RsExpenditure`

### 3.1 5-1 の情報欠落

現行 `normalizeExpenditures()` は `金額 != 0` の行のみ残すため、ブロック概要行を落としている。

2025年実データ:

- 5-1総行数: **193,912**
- unique `(projectId, blockId)`: **20,497**
- ブロック名を持つ概要行: **20,498**
- `金額` が入った行: **98,537**
- 支出先名を持つ行: **173,211**

ブロック名行と契約金額行は行構造が異なるため、`金額 != 0` のフィルタでは `blockName` 等が必然的に失われる。

また PID:1409 では同じ `blockId=A` にブロック概要行が2行あり、**「1 block = 1 summary row」とも限らない**。

### 3.2 5-2 は単純な再委託表ではない

2025年実データ:

- 5-2総行数: **23,381**
- block間relation行: **20,713**
- 国自らが支出する間接経費行: **2,432**

5-2には以下が含まれる。

- 担当組織 → 一次支出先
- 再委託 / 再々委託
- 予算の配分 / 移替
- 融資
- 保険金支払 / 保険料支払
- 代位弁済
- 事業全体を説明するための参考的資金フロー

したがって、5-2のedgeを「国費の支出額」と定義してはいけない。

### 3.3 `予備費等` の誤った意味付け

現行 `normalize-rs.ts` は `予備費等1〜4` を合算して `eventType='reserve'` にしているが、RS原典上の「予備費等」は予備費だけでなく、移替・流用等を含み得る。

PID:4 では `予備費等1` に約 **-5096.9億円**が入り、実態は主として各府省庁への予算移替と対応している。

したがって Normalized 層では `reserve` と断定せず、原典意味に近い中立的な adjustment として保持する。

### 3.4 `sheets` の未活用

`sheets` には以下の価値がある。

- 公式 `事業URL`
- 事業開始/終了年度
- 翌年度要求
- 新規要求事業
- レビュー所見
- CSV側との整合性検証

2026様式1/2では、公式事業URLを取得できる。

V1の「事業名で検索して原典へ誘導」という回避策は、V2では公式URLへの直接リンクに置き換えられる。

---

## 4. 設計原則

### 4.1 4層構造を維持する

```text
SOURCE / RAW
  ↓
NORMALIZED
  ↓
DERIVED
  ↓
PRODUCTS / APP
```

- RAW: 原本を変更しない。
- NORMALIZED: 原典の意味・粒度を保ちながら型・列名・ID表記を整理する。
- DERIVED: 複数データセットの結合、グラフ生成、identity resolution等を行う。
- PRODUCTS: UI向けに圧縮・シャード化・集約する。

### 4.2 Normalize で情報を静かに捨てない

原則:

> 原典の非空列は、typed fieldへmapするか、明示的な「未使用理由」を持つ。無言で捨てない。

実装上は以下のどちらかを満たすこと。

1. 全有用列をtyped fieldとして保持する。
2. 未マップ列を `extraFields` 等で保持し、validationで未マップ非空列をレポートする。

RAWが残っているからといって、Normalizedで大量に列を落とす設計にはしない。

### 4.3 sourceYear と fiscalYear を混同しない

- `sourceYear`: RSレビュー/公開スナップショット年度
- `fiscalYear`: そのレコードが指す予算年度

例:

```text
sourceYear=2026
├─ fiscalYear=2025 実績
├─ fiscalYear=2026 当初
└─ fiscalYear=2027 要求
```

### 4.4 projectId は文字列として扱う

CSVとsheetsで表記が異なる例がある。

```text
CSV    : 4
sheets : 000004
```

次の2値を保持する。

```ts
projectId: string;     // canonical: 数字のみなら先頭0を除去した文字列
projectIdRaw: string;  // 原典表記
```

JS `number` をidentity用途に使わない。

### 4.5 blockId は事業内ローカルID

資金フローノードのidentityは原則:

```text
(sourceYear, projectId, blockId)
```

とする。

法人番号や名称だけでblockを統合しない。

実データでは同一主体が複数blockとして別役割で登場する。

- PID:18: 同一主体が A/J、B/K、C/L 等に重複
- PID:1675: 同一研究機構が A/B/C に登場

---

## 5. RS公開CSV 15系統の取り込み仕様

2025年 raw で確認した対象は以下の15系統。

| No | データ | 2025行数 | Normalized用途 |
|---|---|---:|---|
| 1-1 | 基本情報_組織情報 | 8,540 | organizations |
| 1-2 | 基本情報_事業概要等 | 6,061 | projects |
| 1-3 | 基本情報_政策・施策、法令等 | 15,821 | policies-laws |
| 1-4 | 基本情報_補助率等 | 6,080 | subsidy-rules |
| 1-5 | 基本情報_関連事業 | 6,302 | project-relations |
| 2-1 | 予算・執行_サマリ | 47,100 | budget-summaries / budget-events |
| 2-2 | 予算・執行_予算種別・歳出予算項目 | 70,915 | budget-items |
| 3-1 | 効果発現経路_目標・実績 | 128,516 | logic-model-nodes / metrics |
| 3-2 | 効果発現経路_目標のつながり | 31,726 | logic-model-relations |
| 4-1 | 点検・評価 | 5,831 | evaluations |
| 5-1 | 支出先_支出情報 | 193,912 | spending-blocks / recipients / contracts |
| 5-2 | 支出先_支出ブロックのつながり | 23,381 | funding-relations / indirect-expenses |
| 5-3 | 支出先_費目・使途 | 34,307 | expense-uses |
| 5-4 | 支出先_国庫債務負担行為等による契約 | 9,716 | multi-year-contracts |
| 6-1 | その他備考 | 5,794 | notes |

### 5.1 1-1 組織情報

保持対象:

- 所管府省庁
- 府省庁 / 局・庁 / 部 / 課 / 室 / 班 / 係
- その他担当組織
- 作成責任者

複数行を無理に1 projectへflattenせず、組織relationとして保持する。

### 5.2 1-2 事業概要等

`projects` の中核。

最低限保持:

- 事業名
- 事業目的
- 現状・課題
- 事業概要
- `事業概要URL`
- 事業区分
- 事業開始年度 / 開始年度不明
- 事業終了予定年度 / 終了予定なし
- 主要経費
- 実施方法各種
- 旧事業番号
- 備考

### 5.3 1-3 政策・施策、法令等

別relationとして保持する。

- 政策 / 施策 / URL
- 法令名 / 法令番号 / 法令ID / 条 / 項 / 号
- 関係する計画・通知
- URL

`project -> policy/law/plan` を将来辿れる形にする。

### 5.4 1-4 補助率等

保持:

- 補助対象
- 補助率
- 補助上限
- 根拠URL

### 5.5 1-5 関連事業

保持:

- relatedProjectIdRaw / canonical
- 関連事業名
- 関連性

関連性には、統合元/先・分割元/先・親/子事業・基金等が現れるため、文字列を捨てず原文保持する。

Derivedで関係種別を分類する場合も、`relationTypeRaw` を残す。

### 5.6 2-1 予算・執行サマリ

現行の合算ロジックを見直す。

#### 必須方針

- blank と explicit zero を区別する。
- 補正1〜5を最初から1値へ潰さない。
- `予備費等1〜4` を `reserve` と決め打ちしない。
- `主な増減理由`、`その他特記事項`、`要望額`、`備考` を保持する。
- 会計/勘定単位の行も保持する。

推奨Event表現:

```ts
interface RsBudgetEvent {
  projectId: string;
  projectIdRaw: string;
  sourceYear: number;
  fiscalYear: number;
  eventType:
    | 'initial'
    | 'supplementary'
    | 'carryover_in'
    | 'adjustment'
    | 'current_budget'
    | 'execution'
    | 'carryover_out'
    | 'request'
    | 'request_preference';
  amount: number;
  revision?: number;
  sourceAmountColumn: string;
  accountCategory?: string;
  account?: string;
  subAccount?: string;
  provenance: Provenance;
}
```

`予備費等N` → `eventType='adjustment'` とし、Derivedで根拠がある場合のみ `reserve / transfer / reallocation` 等へ意味付けする。

### 5.7 2-2 予算種別・歳出予算項目

現行項目に加えて保持:

- 歳出予算項目の補足情報
- 翌年度要求額（歳出予算項目ごと）
- 備考

MOF↔RSのリンク根拠として継続利用する。

### 5.8 3-1 目標・実績

次を分けて保持する。

- logic model node
- KPI metadata
- 年度別 target / actual / achievement rate

2007〜2060列を巨大なflat objectのまま使うより、Normalized後は年度long-formへ変換してよい。

例:

```ts
interface RsMetricObservation {
  projectId: string;
  logicNodeId: string;
  fiscalYear: number;
  valueType: 'target' | 'actual' | 'achievement_rate';
  valueRaw: string;
  provenance: Provenance;
}
```

### 5.9 3-2 目標のつながり

`logicNode -> logicNode` のrelationとして保持。

- source node
- target node
- 後続アウトカムへのつながり
- 複数段階で設定できない理由

### 5.10 4-1 点検・評価

以下を保持する。

- 事業所管部局の点検結果 / 改善方向
- 外部有識者点検
- 公開プロセス結果
- 行政事業レビュー推進チーム所見
- 概算要求への反映状況
- 反映額
- 過去の指摘事項 / 対応状況

### 5.11 5-1 支出情報

**1行=1expenditure とみなさない。**

5-1は疎な階層表なので、最低でも次の意味単位へ分解する。

#### SpendingBlock

```ts
interface RsSpendingBlock {
  projectId: string;
  sourceYear: number;
  blockId: string;
  blockName: string;
  recipientCount?: number;
  role?: string;
  totalAmount?: number;
  evidenceRowIds: string[];
  provenance: Provenance[];
}
```

同じ `(projectId, blockId)` に複数概要行がある場合、勝手に1行を正とせず、compatible fieldはmergeし、全evidence rowを保持する。

#### Recipient

```ts
interface RsRecipient {
  recipientId: string;
  projectId: string;
  sourceYear: number;
  blockId: string;
  recipientName: string;
  corporateNumber?: string;
  location?: string;
  corporateType?: string;
  otherRecipient?: boolean;
  totalAmount?: number;
  provenance: Provenance;
}
```

`recipientId` は法人番号だけで生成しない。同一法人が複数blockに存在し得る。

#### Contract

```ts
interface RsContract {
  contractId: string;
  projectId: string;
  sourceYear: number;
  blockId: string;
  recipientId?: string;
  summary?: string;
  amount?: number;
  method?: string;
  methodDetail?: string;
  bidderCount?: number;
  winningRate?: number;
  singleBidReason?: string;
  otherContract?: boolean;
  provenance: Provenance;
}
```

contract rowを直前行のrecipientへ紐付ける場合は、CSVのrow-orderを正式な根拠として扱い、`evidenceRowId`を残す。

### 5.12 5-2 支出ブロックのつながり

2種類へ分ける。

#### FundingRelation

```ts
interface RsFundingRelation {
  relationId: string;
  projectId: string;
  sourceYear: number;
  sourceBlockId?: string;
  sourceBlockName: string;
  fromResponsibleOrganization: boolean;
  targetBlockId: string;
  targetBlockName: string;
  note?: string;
  provenance: Provenance;
}
```

重要:

- edgeに金額を自動付与しない。
- noteをsemantic labelとして使えても原文を必ず残す。
- 同一source-targetが複数行あってもNormalizedでは潰さない。

#### IndirectExpense

```ts
interface RsIndirectExpense {
  projectId: string;
  sourceYear: number;
  categoryRaw: string;
  item: string;
  amount?: number;
  provenance: Provenance;
}
```

block graphとは別レイヤーで保持する。

### 5.13 5-3 費目・使途

5-1の全契約明細と一致する前提を置かない。

独立した `expense-uses` として保持し、以下で可能な範囲のみリンクする。

- projectId
- blockId
- recipient name
- corporate number
- contract summary

不一致は欠損扱いではなく「原典の粒度差」とする。

### 5.14 5-4 国庫債務負担行為等

通常契約と別の `multi-year-contracts` として保持する。

契約額を5-1の年度支出額へ混ぜない。

### 5.15 6-1 その他備考

project noteとして保持する。

---

## 6. sheets の取り込み仕様

`sheets` はCSVと重複が多いが、CSV側にない情報や、公式原典への直接リンク、レビュー年度断面の検証に価値がある。

### 6.1 基本方針

- `download-csv` を機械処理の主データとする。
- `sheets` は補完 + cross-check source とする。
- 同じ意味・同じ値 → canonical fieldに統合し、両方のprovenanceを残す。
- 片方のみ → そのsourceから補完する。
- 同じ意味で値が違う → 自動上書きせず validation difference として残す。

### 6.2 公式事業URL

`sheets` の `事業URL` を保持する。

```ts
officialProjectUrl?: string;
```

UIでは検索URLではなく、原則このURLを一次情報リンクとして利用する。

### 6.3 様式1

既存/新規開始事業について、少なくとも以下を保持/照合する。

- projectId
- projectName
- 事業所管課室
- 開始/終了年度
- 会計区分
- 前年度予算/執行
- 当年度当初
- 翌年度要求
- レビュー所見
- 公式事業URL

### 6.4 様式2

新規要求事業を正規化する。

2026レビューであれば、2027年度新規要求をRS事業候補として保持可能とする。

過去実績が存在しないことを異常扱いしない。

### 6.5 ID照合

`sheets` の `000004` と download CSV の `4` 等をcanonical projectIdで照合する。

raw表記は別途保持する。

---

## 7. Provenance 拡張

現行 `Provenance` に可能なら以下を追加する。

```ts
interface Provenance {
  domain: 'mof.go.jp' | 'rssystem.go.jp';
  dataset: string;
  year: number;
  file: string;
  zipEntry?: string;
  rowNumber?: number;
  sourceUrl?: string;
  sha256?: string;
}
```

最低でも rowNumber を持たせ、5-1/5-2の疎な行構造を後から追跡できるようにする。

---

## 8. Normalized 出力案

```text
data/normalized/rs/{sourceYear}/
├── projects.json
├── organizations.json
├── policies-laws.json
├── subsidy-rules.json
├── project-relations.json
├── budget-summaries.json
├── budget-events.json
├── budget-items.json
├── logic-model-nodes.json
├── logic-model-observations.json
├── logic-model-relations.json
├── evaluations.json
├── spending-blocks.json
├── recipients.json
├── contracts.json
├── funding-relations.json
├── indirect-expenses.json
├── expense-uses.json
├── multi-year-contracts.json
├── notes.json
└── review-sheets.json
```

ファイルサイズが大きくなる場合、JSONLへの変更を許容する。形式変更する場合はドキュメントに明記する。

既存consumerが `expenditures.json` を参照している場合は、移行期間中のみ互換生成物として残してよい。

---

## 9. Derived: RS Funding Graph

新規に `build-rs-funding-graph.ts` 相当を実装する。

出力案:

```text
data/derived/rs/{sourceYear}/funding-graphs.json
```

または事業単位shard。

### 9.1 ノード

```ts
interface FundingNode {
  nodeId: string;
  projectId: string;
  nodeType: 'responsible_organization' | 'spending_block';
  blockId?: string;
  name: string;
  block?: RsSpendingBlock;
}
```

`nodeId` の例:

```text
project:1409:block:A
project:1409:responsible-org
```

### 9.2 エッジ

Normalized 5-2の各行は evidence edge として保持する。

Derivedで同一source-targetをsemantic edgeとしてまとめる場合:

```ts
interface FundingEdge {
  edgeId: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  notes: string[];
  evidenceRelationIds: string[];
  amount?: number;
  amountSource?: string;
}
```

**5-2由来edgeへ金額を推定付与しない。**

### 9.3 synthetic responsible organization node

5-2で:

```text
sourceBlockId = blank
担当組織からの支出 = TRUE
```

の場合のみ、担当組織をsynthetic root nodeとして生成してよい。

一方 PID:2776 のように 5-2 が `A → B` から始まり、省庁→Aが記載されない場合、欠損edgeを推定生成しない。

### 9.4 グラフ前提

以下をすべて許容する。

- cycle
- fan-out
- fan-in
- multiple roots
- no responsible-org root
- disconnected components
- duplicate source-target evidence rows
- isolated blocks
- same actor in multiple blocks

「tree」「DAG」「単一root」をschema invariantにしない。

### 9.5 5-1 と 5-2 の責務

```text
5-1 → node/block master + recipient + contract
5-2 → relation evidence
```

2025実データでは:

- 5-1 block: 20,497
- 5-2から参照されない5-1 block: **125 block / 60事業**
- 5-2が参照するblock IDで5-1に存在しないもの: **0**
- 同一project/blockについて5-1と5-2でblockName不一致: **0**

したがって、node集合を5-2だけから作らない。

---

## 10. 必須ストレステストFixture

以下を固定fixtureとして追加する。

| PID | 主な検証パターン |
|---:|---|
| 1 | 単純な担当組織→複数一次支出先 + 間接経費 |
| 4 | 府省庁への予算配分/移替、5-1に契約金額なし、`予備費等`のsemantic誤分類防止 |
| 12 | 再委託 |
| 1409 | **cycle** `A→B→A`、同一blockに複数summary row |
| 2776 | 担当省庁からのroot edgeが5-2にない `A→B` 開始 |
| 142 | 多段・大規模分岐/合流、33 blocks / 40 relations |
| 500 | 複数府省庁へ移替後、同一地方公共団体blockへfan-in |
| 1406 | 一般会計・財政融資資金・回収金等の複数資金源→JICAへ合流 |
| 3339 | 30 blocksあるが有効な5-2 block relationなし |
| 333 | 非連結成分を持つgraph |
| 18 | 同一主体が複数block、深い経路 |
| 747 | 同一source-targetの複数relation evidence、再委託/再々委託 |
| 1082 | 55 blockへの大規模fan-out |
| 4162 | 多数の国自らが支出する間接経費 + 通常graph |
| 1675 | 複数root + 同一主体複数block + fan-in |

加えてデータ領域別fixture:

- 1-5: 統合/分割/親子事業があるPID
- 1-4: 補助率情報があるPID
- 5-4: 国庫債務負担行為等の契約があるPID
- 一般会計＋特別会計が同一事業に現れるPID
- 2026様式2の2027新規要求事業

---

## 11. Validation 必須項目

### 11.1 source completeness

年度ごとに15系統のdownload-csvについて:

- ファイル存在
- row count
- schema/header hash
- 非空列mapping率

を出す。

年度によってファイルが存在しない場合はエラーではなく、availabilityとして明示する。

### 11.2 no silent drop

各source列について:

```text
mapped
ignored_with_reason
unknown_nonempty
```

のどれかに分類する。

`unknown_nonempty` はvalidation warning/errorとする。

### 11.3 5-1 / 5-2 整合性

- 5-2 target/source blockが5-1に存在するか
- blockName不一致
- 5-1 orphan block数
- duplicate relation pair数
- cycle事業数
- disconnected component数
- indirect expense行数

をサマリ出力する。

### 11.4 sheets ↔ download-csv

projectIdで照合し、以下を比較する。

- project name
- start/end year
- prior-year budget/execution
- current initial budget
- next-year request
- review values

差異は自動補正しない。

### 11.5 explicit zero / blank

金額 parser は:

```text
blank -> null
"0" -> 0
"0.0" -> 0
```

を区別する。

0円を理由にレコードを消さない。

---

## 12. Download / Normalize の年度自動追従

現在のスクリプトには no-arg default として `[2024, 2025]` がハードコードされているものがある。

2026公開後も自動取得対象にならない原因になるため修正する。

### 12.1 Download

明示引数がある場合:

```bash
npm run pipeline:v2:download:rs -- 2026
```

を優先。

引数なしの場合は、公式サイトから公開年度をdiscoverし、対応可能年度を列挙する方式を推奨する。

固定 `[2024, 2025]` は廃止する。

### 12.2 Normalize

引数なしの場合は:

```text
data/download/rssystem.go.jp/download-csv/*
data/download/rssystem.go.jp/sheets/*
```

の存在年度をdiscoverする。

2026で `sheets` のみ存在する場合も、そのsourceだけ正常にnormalizeできるようにする。

---

## 13. scripts / npm commands

既存commandは壊さない。

```text
pipeline:v2:download:rs
pipeline:v2:download:rs-sheets
pipeline:v2:normalize:rs
pipeline:v2:derive
pipeline:v2:validate
```

内部実装は分割してよい。

推奨:

```text
scripts/pipeline-v2/
├── normalize-rs.ts                 # entry/orchestrator
├── normalize-rs/
│   ├── common.ts
│   ├── projects.ts
│   ├── budgets.ts
│   ├── logic-model.ts
│   ├── spending.ts
│   └── sheets.ts
├── build-rs-funding-graph.ts
└── validate-rs.ts
```

`pipeline:v2:derive` にRS funding graph生成を追加する場合、MOF deriveの既存挙動を変えない。

---

## 14. Product / Budget Flow への接続方針

Pipeline基盤完成後、Budget FlowのRS detail productには少なくとも以下を供給できるようにする。

```ts
interface RsProjectDetailProduct {
  projectId: string;
  projectName: string;
  officialProjectUrl?: string;
  sourceYear: number;
  ministry: string;
  startYear?: number;
  endYear?: number;
  budgetEvents: RsBudgetEvent[];
  mofLinks: ...[];
  fundingGraphSummary: {
    blockCount: number;
    relationCount: number;
    hasCycle: boolean;
    componentCount: number;
    indirectExpenseCount: number;
  };
}
```

資金フロー本体は必要に応じてproject単位shardにする。

UI側では公式 `事業URL` を「原典」リンクとして表示する。

---

## 15. 実装順序

### Phase 1: data preservation

1. projectId canonicalization
2. Provenance rowNumber等の拡張
3. 15 CSVのschema inventoryをコード化
4. 1-1〜6-1をNormalizedへ取り込む
5. blank/zero区別のamount parser
6. 2-1 `予備費等` の誤分類を修正

### Phase 2: spending model

1. 5-1を block / recipient / contractへ分解
2. 5-2を relation / indirect expenseへ分解
3. 5-3/5-4取り込み
4. Funding Graph生成
5. stress fixture test

### Phase 3: sheets

1. 様式1/2の正規化
2. officialProjectUrl取得
3. CSVとのcross-check
4. 2027新規要求等の将来年度event対応

### Phase 4: validation/docs

1. 全source completeness report
2. graph anomaly summary
3. `docs/data-pipeline-v2.md` 更新
4. 再生成手順更新
5. V1/V2比較維持

### Phase 5: app product

Pipelineが安定した後に、Budget Flow RS detail向けproductを生成する。

---

## 16. Acceptance Criteria

### データ取り込み

- [ ] 2025の15 CSV系統がすべてNormalize対象になっている。
- [ ] 非空source列が無言で捨てられない。
- [ ] 2024/2025/2026の存在sourceを固定年度リストなしで認識できる。
- [ ] sheetsの公式事業URLを取得・保持できる。
- [ ] 新規要求事業を過去実績なしでも保持できる。

### 予算イベント

- [ ] blankと0を区別する。
- [ ] 補正1〜5の原典区分を保持する。
- [ ] `予備費等` を自動で `reserve` と断定しない。
- [ ] sourceYear/fiscalYearの区別を維持する。

### 支出構造

- [ ] 5-1のblock summaryを金額0/blankを理由に落とさない。
- [ ] block / recipient / contract を区別する。
- [ ] 5-2 relationを全行evidenceとして保持する。
- [ ] indirect expensesを別レイヤーで保持する。
- [ ] cycleを許容する。
- [ ] multiple rootsを許容する。
- [ ] disconnected graphを許容する。
- [ ] orphan blockを捨てない。
- [ ] duplicate source-target relationを証拠付きで保持する。
- [ ] 同一法人をblockを跨いで自動統合しない。

### Regression

- [ ] V1を変更しない。
- [ ] 現行MOF Pipeline V2のテストが通る。
- [ ] 現行Budget FlowのMOF表示が壊れない。
- [ ] `npm test` が通る。
- [ ] `pipeline:v2:validate` が既存比較を維持する。

---

## 17. 実装時に避けるべきアンチパターン

以下は禁止。

```text
5-1 row == expenditure
5-2 edge == money transfer amount
block name == unique entity identity
corporate number == graph node id
funding graph == tree
funding graph == DAG
root == ministry
予備費等 == reserve
sourceYear == fiscalYear
0円 == 不要レコード
sheets == CSVの単なる重複なので不要
```

---

## 18. 今回の設計判断を支える代表例

### PID:4

- 予算配分/各府省庁への移替
- 5-1に通常の契約金額がない
- `予備費等` をreserve扱いすると意味を誤る

### PID:1409

```text
財務省 → A 日本政策金融公庫
A → B 信用保証協会
B → A 日本政策金融公庫
B → C 金融機関
C → D 中小企業等
```

cycleが存在するためDAG前提不可。

### PID:2776

```text
A 都道府県 → B 市区町村
```

担当省庁→A edgeが5-2に記録されていないため、単一省庁root前提不可。

### PID:1406

```text
一般会計出資金 ─┐
財政融資資金 ───┼→ JICA → 開発途上地域政府等
回収金等 ───────┘
```

国予算以外の資金源が同一graphへ合流する。

### PID:3339

5-1に30 blockあるが5-2 block relationがない。

5-2だけからnodeを作ってはいけない。

### PID:747

同じ source-target が複数行存在する。

Normalizedで全evidence rowを保持し、Derivedで必要なら集約する。

---

## 19. docs/data-pipeline-v2.md 更新事項

実装完了時、少なくとも以下を更新する。

1. Normalized RSの出力一覧
2. 15 CSVを利用すること
3. sheetsを「将来利用」ではなく正式sourceとして記載
4. funding graphの責務
5. `予備費等` の扱い
6. sourceYear/fiscalYear/review snapshotの説明
7. official project URL
8. stress test / validationの考え方
9. 年度discover方式
10. 再生成コマンド

---

## 20. Codexへの実装指示要約

この仕様を実装する際は、既存V1・Integrated Sankey・現行MOF Budget Flowを変更しないこと。

まずPipeline V2 RSのNormalized層を拡張し、公開CSV15系統とsheetsを、原典情報を失わない形で取り込む。その後、5-1をblock/recipient/contract、5-2をrelation/indirect expenseとして正規化し、循環・分岐・合流・複数root・非連結成分を許容する一般有向 Funding Graph をDerivedで生成する。

PID:1, 4, 12, 1409, 2776, 142, 500, 1406, 3339, 333, 18, 747, 1082, 4162, 1675をfixtureとして必ず検証する。

実装後は、生成件数、graph anomaly、CSV↔sheets差分、未map列をValidation summaryとして出力すること。

