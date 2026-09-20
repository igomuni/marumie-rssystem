# Pipeline V2 — main移植 ファイル単位実装計画

作成日: 2026-09-20  
対象: `igomuni/marumie-rssystem`  
基準ブランチ: `main`  
基準コミット: `03e28aadfb9603e51e948e86ec17ff40949132f7`  
参照仕様: `20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md`

## 1. 目的

独立参照実装で検証済みの

```text
raw/download
  ↓
normalized
  ↓
derived
  ↓
validation
  ↓
publish
  ↓
public/data/v2
```

を、`main` のTypeScript Pipeline V2へ移植する。

V1は変更しない。既存の `/integrated-sankey` とV1 public dataは比較基準として残す。

`/budget-flow` は移行期間中、旧 `public/budget-flow-v2` を読める状態を維持し、新 `public/data/v2` の生成・validationが安定した後にreaderを切り替える。

---

## 2. 実装原則

1. **Source / Normalized / Derived / Publish の責務を混ぜない**
2. **V1成果物をV2生成の必須入力にしない**
3. **MOF fiscalYear と RS reviewYear を別軸として保持する**
4. **MOF 項と目を別entityとして保持する**
5. **RS 5-2は一般有向グラフ。tree/DAG/single-rootを前提にしない**
6. **blank と explicit zero を区別する**
7. **RS `予備費等` を normalized 時点で reserve と断定しない**
8. **public IDは入力順依存の連番にしない**
9. **public一覧にfilter/sort用の値を持たせ、detail全shardロードを不要にする**
10. **V2 static dataは `data/server` に複製しない**

---

# 3. 推奨実装順序

実装は5段階に分ける。

## Phase A — 型・共通基盤

まだ既存public/UIを変更しない。

- stable ID
- source/provenance
- blank/zero parser
- year discovery
- canonical project ID
- MOF Section / Item型
- RS全15 CSV型

ここで既存TypeScript V2の出力との互換性は一時的に壊れてもよいが、`npm test`は通す。

## Phase B — Normalize / Derived

- MOF normalizedをsource-preserving化
- RS 15 CSV + sheets normalize
- MOF derive
- RS funding graph derive
- MOF↔RS link derive

この段階でも `public/budget-flow-v2` は触らない。

## Phase C — Validation / Publish

- full-data validation
- stress PID regression
- `public/data/v2` publish
- public cross-reference validation
- public size validation

ここで初めて新publicをGit管理対象にする。

## Phase D — Budget Flow reader移行

- `/budget-flow` を `public/data/v2` readerへ切替
- 一覧はindexのみ取得
- detail選択時にMOF section shard取得
- RSリンクを必要時に取得

旧UIの見た目は極力変えない。

## Phase E — compatibility adapter撤去

新readerのE2Eが安定してからのみ実施。

- `public/budget-flow-v2` 削除
- `generate-budget-flow.py` 削除
- `validate-budget-flow.py` 削除またはlegacy archiveへ移動

---

# 4. 既存ファイル — 変更計画

## `scripts/pipeline-v2/types.ts`

### 現状

- MOFは単一 `MofBudgetEvent`
- RSは `RsProject / RsBudgetEvent / RsBudgetItem / RsExpenditure`
- 5-1を単一Expenditureへflatten

### 変更

共通型を以下に再編する。

```text
SourceRef / Provenance

MOF
├─ MofBudgetItemRecord      # normalized raw-row semantic record
├─ MofSectionIdentity
├─ MofItemIdentity
├─ MofBudgetEvent
├─ MofIdentityRelation
└─ MofStageGap

RS
├─ RsOrganization
├─ RsProject
├─ RsPolicyLaw
├─ RsSubsidyRule
├─ RsProjectRelation
├─ RsBudgetSummary
├─ RsBudgetItem
├─ RsLogicModelNode
├─ RsLogicModelObservation
├─ RsLogicModelRelation
├─ RsEvaluation
├─ RsSpendingBlock
├─ RsRecipient
├─ RsContract
├─ RsFundingRelationEvidence
├─ RsIndirectExpense
├─ RsExpenseUse
├─ RsMultiYearContract
├─ RsNote
└─ RsReviewSheet
```

`number | null` を使い、blank=`null`、explicit `0`=`0` とする。

`EventType`の `reserve` はMOF公式予備費用として残してよいが、RS `予備費等` 用には `adjustment` / `reserve_or_other` 等のneutral typeを追加する。

---

## `scripts/pipeline-v2/lib/csv.ts`

### 変更

既存CSV parserは維持。

追加:

```ts
parseNullableAmount(raw): number | null
canonicalProjectId(raw): string
normalizeText(raw): string
```

`parseAmount()` を既存V1互換用途で残す場合、V2 normalizedでblank/zeroを扱う箇所では使用しない。

---

## `scripts/pipeline-v2/lib/match-key.ts`

### 変更

既存 exact-key logic を維持しつつ、命名を明確化する。

- `mofRsItemMatchKey()`
- `mofSectionNaturalKey()`
- `mofItemNaturalKey()`

RSにはsectionCodeがないため、MOF↔RS item linkはcodeを含めないexact structured keyであることを型・関数名で明示する。

---

## `scripts/pipeline-v2/normalize-mof.ts`

### 現状

`budget-events.json`へ直接flattenし、提出版を除外する部分がある。

### 変更

主出力をsource-preservingなrowレベルへ変更する。

```text
data/normalized/mof/fy{year}/
├─ budget-items.jsonl
└─ source-summary.json
```

保持する主な情報:

- fiscalYear
- phase: initial / supplement / settlement / provisional
- budgetStatus: submitted / enacted / settled / published
- revision
- accountType
- ministry / organization / specialAccount / subAccount / agency
- sectionCode / sectionName
- subItemCode / subItemName
- sectionNaturalKey
- itemNaturalKey
- source amount columns
- amountYen / supplementDeltaYen / revisedAmountYen
- settlement accounting columns
- source path / zip entry / row number

FY2025の `_teishutsu` を捨てず、submitted→enacted比較に使用する。

---

## `scripts/pipeline-v2/normalize-rs.ts`

### 現状

1-2 / 2-1 / 2-2 / 5-1 の一部のみ。

### 変更

15 CSVをdataset-specific normalized productへ分離する。

```text
data/normalized/rs/review-{year}/
├─ organizations.jsonl
├─ projects.jsonl
├─ policies-laws.jsonl
├─ subsidy-rules.jsonl
├─ project-relations.jsonl
├─ budget-summaries.jsonl
├─ budget-items.jsonl
├─ logic-model-nodes.jsonl
├─ logic-model-observations.jsonl
├─ logic-model-relations.jsonl
├─ evaluations.jsonl
├─ spending-blocks.jsonl
├─ recipients.jsonl
├─ contracts.jsonl
├─ funding-relations.jsonl
├─ indirect-expenses.jsonl
├─ expense-uses.jsonl
├─ multi-year-contracts.jsonl
├─ notes.jsonl
└─ review-sheets.jsonl
```

重要:

- 5-1は block / recipient / contract を分離
- amount=blank blockを消さない
- 5-2はevidence rowを全保持
- duplicate source→target rowsを保持
- `担当組織からの支出` をsemantic metadataとして保持
- edge金額を推定しない
- `予備費等` はneutral adjustment
- canonical PIDとraw PIDを両方保持

---

## `scripts/pipeline-v2/build-identities.ts`

### 推奨

ファイル名を残したwrapperにして、実処理を新しい `derive-mof.ts` に移す。

旧呼出し互換:

```ts
import { deriveMof } from './derive-mof';
```

### 新しいMOF derive

```text
data/derived/mof/fy{year}/
├─ sections.jsonl
├─ items.jsonl
├─ budget-events.jsonl
├─ identity-relations.jsonl
├─ identity-summary.json
└─ stage-gaps.jsonl
```

Section ID / Item IDはSHA-256ベースstable ID。

提出→成立、当初→補正→決算のidentity relationはevidence method付きで保持する。

`unresolvedPreSettlementDeltaYen` はここで算出してよいが、`transfer`とは分類しない。

---

## `scripts/pipeline-v2/build-links.ts`

### 推奨

legacy wrapperとして残し、新 `derive-links.ts` へ委譲。

### 変更

入力:

```text
normalized/mof/fy{FY}/budget-items.jsonl
normalized/rs/review-{RY}/budget-items.jsonl
```

出力:

```text
data/derived/links/
└─ mof-rs-review-{RY}-fy{FY}.jsonl
```

link record:

- reviewYear
- fiscalYear
- phase
- revision
- matchMethod
- projectIds
- MOF item IDs
- MOF section IDs
- source RS record IDs
- source MOF record IDs
- amount/evidence where source semantics supports it

単一 `data/derived/{year}/project-links.json` は廃止方向。

---

## `scripts/pipeline-v2/validate.ts`

### 変更

orchestrator化する。

```text
validate:mof
validate:rs
validate:links
validate:public
```

V1比較は残すが、V1値へ自動補正しない。

検証値として固定:

- FY2024 source-preserving section counts: 1056 / 999 / 1272
- FY2024 settlement equation: 8358 rows, mismatch 0
- FY2025 submitted→enacted changed groups: 17
- FY2025 submitted→enacted net: -356,655,880,000円
- RS review2025 project count: 5798（今回snapshot）
- review2025→FY2024 linked projects: 4537
- review2025→FY2025 linked projects: 4851

snapshot-dependent値はmanifest SHAとセットで検証する。

---

## `package.json`

### 追加/再編

```text
pipeline:v2:download
pipeline:v2:normalize
pipeline:v2:derive
pipeline:v2:validate
pipeline:v2:publish
pipeline:v2

pipeline:v2:normalize:mof
pipeline:v2:normalize:rs
pipeline:v2:derive:mof
pipeline:v2:derive:rs
pipeline:v2:derive:links
pipeline:v2:validate:mof
pipeline:v2:validate:rs
pipeline:v2:validate:links
pipeline:v2:validate:public
pipeline:v2:publish:mof
pipeline:v2:publish:rs
pipeline:v2:publish:links
```

`pipeline:v2` のfull commandはdownloadを含める版と、local rebuild用にdownload無し版を分けてもよい。

推奨:

```text
pipeline:v2           # normalize → derive → validate → publish
pipeline:v2:refresh   # download → pipeline:v2
```

政府サイトアクセスを通常buildに入れない。

---

## `.gitignore`

### 必須変更

現行 `!/public/data/*.gz` ではnested V2を追跡できない。

追加:

```gitignore
!/public/data/v2/
!/public/data/v2/**/
!/public/data/v2/**/*.json.gz
!/public/data/v2/**/manifest.json
!/public/data/v2/manifest.json
```

`data/normalized` / `data/derived` / `data/validation` は `/data/` ignoreのまま。

---

## `scripts/decompress-data.sh`

### 原則機能変更不要

現行は `public/data/*.json.gz` のroot-levelだけを `data/server`へcopyするため、nested `public/data/v2/**` は自動ではserver bundleに入らない。

ただしコメントを追加し、V2 static productを意図的にserverへcopyしないことを固定する。

V2を一括gunzipする処理は追加しない。

---

## `next.config.ts`

### 原則機能変更不要

`outputFileTracingExcludes['*'] = ['./public/data/**', ...]` は新V2にも適用されるため望ましい。

ドキュメントコメントだけ更新し、`public/data/v2`をbrowser-static専用と明記する。

---

# 5. 新規ファイル — 追加計画

## `scripts/pipeline-v2/lib/stable-id.ts`

内容:

- canonical JSON serialization
- SHA-256 stable ID
- prefix support
- shard helper（先頭2hex）

IDは配列順ではなくidentity tupleから生成する。

---

## `scripts/pipeline-v2/lib/discover-years.ts`

raw treeから利用可能年度を検出。

- MOF fiscalYears
- RS reviewYears
- sheets-only years

CLIで年度指定された場合のみrestrictする。

---

## `scripts/pipeline-v2/derive-mof.ts`

MOF Section / Item / Budget Event / Identity Relation / Stage Gapを構築。

---

## `scripts/pipeline-v2/derive-rs.ts`

RS normalizedから:

- project-level budget events
- funding graph
- semantic edge aggregation
- graph metrics
- orphan blocks
- disconnected component情報

を生成。

raw duplicate evidenceはderived semantic edgeから参照可能にする。

---

## `scripts/pipeline-v2/derive-links.ts`

`reviewYear × fiscalYear` 単位でMOF↔RS linkを構築。

---

## `scripts/pipeline-v2/publish.ts`

publish orchestrator。

出力root:

```text
public/data/v2/
```

実行前にV2 outputだけcleanし、V1 `public/data/*.gz` を触らない。

---

## `scripts/pipeline-v2/publish-mof.ts`

```text
public/data/v2/mof/fy{FY}/
├─ manifest.json
├─ index.json.gz
└─ sections/00..ff.json.gz
```

indexには一覧filter/sortに必要な値をすべて保持。

特に:

```text
initialSubmittedYen
initialEnactedYen
initialYen
supplementDeltaYen
settlementBudgetYen
currentBudgetYen
spentYen
carryoverOutYen
unusedYen
unresolvedPreSettlementDeltaYen
rsLinkCount
rsProjectCount
```

`initialYen = enacted優先、なければsubmitted`。

---

## `scripts/pipeline-v2/publish-rs.ts`

```text
public/data/v2/rs/review-{RY}/
├─ manifest.json
├─ index.json.gz
├─ core/00..ff.json.gz
├─ context/00..ff.json.gz
└─ spending/00..ff.json.gz
```

### index

- canonical projectId
- projectName
- ministry/bureau
- amount summary
- MOF linked/unlinked
- shard

### core

- project basic
- project budget summary
- funding graph
- graph metrics
- MOF link refs

### context

- budget items
- policy/law/plan
- subsidy rules
- related projects
- logic model
- evaluation
- notes

### spending

- spending blocks
- recipients
- contracts
- expense uses
- multi-year contracts
- indirect expenses

---

## `scripts/pipeline-v2/publish-links.ts`

```text
public/data/v2/links/review-{RY}-fy{FY}/
├─ manifest.json
└─ links.json.gz
```

MOF→RS / RS→MOF双方から検索できる索引を同じproduct内に持たせる。

---

## `scripts/pipeline-v2/validate-public.ts`

必須検査:

- 全gzip parse
- top manifest refs
- MOF index → section shard ref
- RS index → core shard ref
- core → context/spending shard consistency
- links → MOF section existence
- links → RS project existence
- duplicate IDs
- shard deterministic consistency
- max static file size
- total public size

size guardはwarningとhard limitを分ける。

初期推奨:

```text
warning: single file > 1 MiB
error:   single file > 5 MiB
warning: public/data/v2 total > 75 MiB
error:   public/data/v2 total > 150 MiB
```

実測45.4 MiBから十分余裕を取る。

---

# 6. テスト追加

## `scripts/pipeline-v2/lib/*.test.ts`

- stable ID deterministic
- NFKC
- blank vs zero
- canonical PID
- shard deterministic

## `scripts/pipeline-v2/normalize-rs.test.ts`

fixtureで15 dataset parserを最低1ケースずつ確認。

重点:

- 5-1 block summary amount blank
- contract amount nonzero
- 5-2 duplicate edge
- 5-2 cycle
- `担当組織からの支出=false`
- indirect expense

## `scripts/pipeline-v2/derive-rs.test.ts`

stress fixtureを固定する。

```text
PID 1
PID 4
PID 12
PID 1409
PID 2776
PID 142
PID 500
PID 1406
PID 3339
PID 333
PID 18
PID 747
PID 1082
PID 4162
PID 1675
```

最低限assert:

- cycle preserved
- fan-in/fan-out preserved
- multiple roots allowed
- disconnected components allowed
- orphan block preserved
- duplicate evidence preserved
- same-name different-block not merged
- indirect expense preserved

## `scripts/pipeline-v2/derive-mof.test.ts`

- same code / different name remains separate
- FY2025 submitted vs enacted separate
- initialYen enacted preference
- PID:4相当のsection gapはunresolvedになる
- transfer=0から「移替なし」を推論しない

---

# 7. Budget Flow UI移行

データパイプライン完了後に実施する。

## `app/budget-flow/model.ts`

現在のreference-adapter schema型を、新publish schema型へ置換。

新規のUI-facing型をこのファイルに直書きしすぎず、できれば:

```text
app/lib/pipeline-v2/public-types.ts
```

へ共有型を置く。

`initialEnactedAmount(events)` のようにdetail読込前提の関数は不要になる。indexに `initialYen` があるため一覧は直接使用する。

---

## `app/budget-flow/page.tsx`

### 現在

```text
index取得
↓
16 detail shardsを全取得
↓
金額filter/sort
```

### 変更後

```text
manifest取得
↓
選択FY index取得
↓
filter/sort完了
↓
選択sectionの1 shard取得
```

RSタブ追加時:

```text
選択reviewYear RS index
↓
選択project core shard
↓
必要時のみ context / spending shard
```

gzip helperは共通化する。

---

## 新規 `app/lib/pipeline-v2/read-gzip-json.ts`

現在 `page.tsx` 内にある `DecompressionStream('gzip')` helperを共通化。

- abort signal
- HTTP error
- schema/version check hook

を持たせる。

---

## `tests/e2e/budget-flow.spec.ts`

旧 `/budget-flow-v2/2025.json.gz` route前提を新URLへ変更。

追加assert:

- 初期表示でMOF detail shardを全件読まない
- amount sort/filterでdetail shard fetchが増えない
- section選択後のみ1 shard取得
- RS context/spendingタブはlazy load
- manifestのavailableYearsがUIに反映される

---

# 8. Compatibility adapterの扱い

## `scripts/generate-budget-flow.py`
## `scripts/validate-budget-flow.py`
## `public/budget-flow-v2/**`

Phase D完了までは残す。

新public移行後:

1. E2E PASS
2. new public validation PASS
3. Vercel preview PASS
4. Integrated V1画面に差分なし

を確認してから削除する。

削除PRはPipeline本体PRと分けてもよい。

---

# 9. docs更新

## `docs/data-pipeline-v2.md`

全面更新。

必須:

- 4層 + publish
- normalized/derived directory新構造
- 15 RS datasets
- MOF section/item
- reviewYear/fiscalYear
- funding graph semantics
- stage gap
- public schema
- regeneration commands
- validation values

## `docs/budget-flow.md`

`独立reference ZIPを読む画面`という説明を廃止し、`public/data/v2` consumerとして更新。

V1 comparisonはUI上のリンクとして残せるが、V2 data generation dependencyではないことを明記。

## `docs/tasks/...`

以下をrepo内の正本として保存推奨:

- `20260920_Pipeline_V2_RS全情報・資金フロー拡張_実装仕様.md`
- `20260920_Pipeline_V2_RS_public_publish仕様.md`
- `20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md`
- 本ファイル

---

# 10. PR分割案

5時間制限をUIに温存するなら、データ側は大きな1PRより次の3PRがレビューしやすい。

### PR-A: normalized/derived model

- types
- MOF normalize/derive
- RS 15 CSV normalize/derive
- link derive
- unit/stress tests

public/UI変更なし。

### PR-B: publish/validation

- publish modules
- public/data/v2
- .gitignore
- package scripts
- public validator
- docs/data-pipeline-v2

旧Budget Flowはそのまま。

### PR-C: Budget Flow data reader migration

- app reader/types
- page/model
- E2E
- docs/budget-flow
- compatibility adapter撤去はこのPR末尾または別PR

Codexの利用時間をUIに寄せるなら、PR-A/BはChatGPT側の参照実装・仕様をほぼ機械的に移植し、PR-CのUI調整をCodexへ集中させる。

---

# 11. 完了条件

Pipeline側の完了条件:

```text
npm run pipeline:v2:normalize
npm run pipeline:v2:derive
npm run pipeline:v2:validate
npm run pipeline:v2:publish
npm run pipeline:v2:validate:public
```

がローカル実データでPASS。

さらに:

- V1 build/output不変
- FY2024 MOF settlement equation PASS
- FY2025 submitted/enacted regression PASS
- RS stress 15 PID PASS
- MOF↔RS review/fiscal pair validation PASS
- public cross refs PASS
- public totalの実測が参照値45.4 MiBから説明不能な大幅増加をしない
- 最大static file 1MiB前後以下を維持
- Vercel buildで`public/data/v2`がserver function bundleへ入らない

UI移行完了条件:

- `/budget-flow`が`public/data/v2`だけで動作
- 一覧filter/sortで全detail shardを取得しない
- selected sectionのみdetail取得
- RS profile lazy-load
- current Integrated V1 comparison linkは維持
- E2E PASS

---

# 12. 実装時に「やらないこと」

- V1の既存生成物の再設計
- public schemaにraw provenance全文を詰め込む
- RS funding edgeの金額推定
- 同名法人をblock IDを無視して統合
- `sectionCode`単独canonical化
- `reviewYear == fiscalYear` 仮定
- `予備費等 == reserve` 仮定
- unresolved MOF stage gapを自動transfer分類
- build/Vercel中の政府サイトdownload
- V2 publicの`data/server`コピー

