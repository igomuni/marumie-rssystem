# Pipeline V2 — MOF↔RS Linkage 先行検証 / Sonnet引継ぎ

Date: 2026-09-20
Input: `pipeline-v2-normalized-latest.tar.gz`（最新Sonnet TypeScript Normalize / MOF Derived）
Reference: `pipeline-v2-full-output.zip` / unified Python reference implementation

## 結論

最新Sonnet Normalize出力を入力として、MOF↔RS exact-name linkageを再計算したところ、既存Python参照実装のsummaryと**完全一致**した。
したがって、`budgetMinistry`分離後もlinkage semanticsは壊れていない。

重要: RS側のMOF突合キーには `ministry`（RS共通列「府省庁」）ではなく `budgetMinistry`（2-2列「所管」）を使うこと。

## Acceptance values

### review-2025 ↔ FY2024

- linkGroupCount: **4,914**
- linkedProjectCount: **4,537**
- linkedRsRecordCount: **13,087**
- unlinkedRsRecordCount: **1,093**
- unsupportedBudgetTypeRecordCount: **2,466**
- mofAmountAcrossGroupsYen: **132,282,025,855,000**
- rsAmountAcrossGroupsYen: **131,634,536,373,813**

### review-2025 ↔ FY2025

- linkGroupCount: **5,086**
- linkedProjectCount: **4,851**
- linkedRsRecordCount: **14,017**
- unlinkedRsRecordCount: **1,034**
- unsupportedBudgetTypeRecordCount: **1,992**
- mofAmountAcrossGroupsYen: **136,591,411,159,000**
- rsAmountAcrossGroupsYen: **135,391,998,467,250**

上記は `pipeline-v2-full-output.zip/derived/links/*summary.json` と一致。

## Link semantics

### MOF side
対象stageは以下のみ。

- `phase=initial && budgetStatus=enacted` → `(initial, null)` / amount=`amountYen`
- `phase=supplement` → `(supplement, revision)` / amount=`supplementDeltaYen`

Settlementはこのlinkageには含めない。

MOF natural key:

- general: `general | ministry | organization | sectionName | subItemName`
- special: `special | ministry | specialAccount | subAccount | sectionName | subItemName`

各要素は既存 `normalizeText` 相当で正規化。

### RS side
対象budgetType:

- `当初予算` → `(initial, null)`
- `第N次補正予算` → `(supplement, N)`
- その他（繰越、予備費等、空欄等）は `unsupportedBudgetTypeRecordCount`

RS natural key:

- general: `general | budgetMinistry | organizationOrAccount | sectionName | subItemName`
- special: `special | budgetMinistry | account | subAccount | sectionName | subItemName`

**`budgetMinistry`を使用する。`ministry`で上書き・代用しない。**

## Output model

1 link group = `(reviewYear, fiscalYear, phase/revision, naturalKey)`。

最低限保持:

- linkId（stable deterministic ID）
- reviewYear
- fiscalYear
- phase
- revision
- matchMethod=`exact-name-key`
- naturalKey
- mofRecordIds[]
- rsRecordIds[]
- projectIds[]
- mofAmountYen
- rsAmountYen
- differenceYen

これは「MOF 1項目 = RS 1事業」を仮定しない。1 natural keyに複数RS projectが乗る場合をgroupとして保持する。

## 実装上の推奨

`derive-integrated.ts`（または `derive-links.ts`）としてRS Derivedと分離する。

```
derive:mof
  ↓
derive:rs
  ↓
derive:integrated
  └─ MOF↔RS exact linkage
```

Normalized 3GB規模なので、全RSデータを一括ロードしない。ただし `budget-items.jsonl` はlinkage対象だけ fiscalYear / budgetTypeでstream filterし、MOF側は対象FYのinitial-enacted/supplementだけkey mapに載せれば十分。

## Validation

最低限、上記2組のsummaryをgolden acceptanceとして固定する。

さらに以下を検査:

1. link内の `mofRecordIds` が実在する
2. `rsRecordIds` が実在する
3. `projectIds` がRS recordから再構成した集合と一致
4. `mofAmountYen - rsAmountYen == differenceYen`
5. 同じRS recordが同一FY/stageで複数link groupへ重複所属しない
6. `budgetMinistry` と `ministry` が異なるrecordでもMOF linkが維持されるfixtureを1件固定
7. blank/unsupported budgetTypeを勝手にinitial扱いしない

## 2026

review-2026はreview sheets中心のpartial snapshotで、2-2 budget-itemsに実質的なlink対象がない。MOF↔RS exact budget linkageを「0件の完全データ」と表現しない。

publish manifestでは例:

```json
{
  "reviewYear": 2026,
  "completeness": "partial",
  "linkage": {
    "mofBudgetExact": "unavailable"
  }
}
```

とし、未公開/未取得とゼロ件を区別する。

## Publicへの投影

link detail全量をproject indexへ埋め込まない。

推奨:

```
public/data/v2/links/review-2025-fy2024/
  manifest.json
  summary.json
  by-project/00..ff.json.gz

public/data/v2/links/review-2025-fy2025/
  ...
```

RS project indexには `hasMofLink`, `mofLinkCount` 程度を持たせ、詳細を開いた時だけlink shardを読む。

## Sonnetへの実装順

1. `derive-rs.ts`（別引継ぎ資料のFunding Graph acceptance）
2. `derive-integrated.ts` / MOF↔RS linkage
3. golden summary acceptance（本資料の数値）
4. integrated validation
5. publish

この順なら探索は不要。Python referenceのlinkage semanticsをTypeScriptへ移植し、上記summary一致をacceptanceにする。
