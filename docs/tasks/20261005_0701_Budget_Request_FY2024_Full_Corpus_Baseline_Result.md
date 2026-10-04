# FY2024 概算要求 82 PDF — Full-Corpus Baseline Result

2026-10-05。現行の frozen / production PDF extraction pipeline を、**無修正で** FY2024 概算要求書 82 PDF 全体に適用した baseline と、MOF V2 FY2024 一般会計 当初予算との deterministic な照合（P1 の matcher を無修正で使用）。protocol は結果の観測前に freeze 済み（`4d76dbc`、`20261005_0650_…_Protocol_Preregistration.md`）。baseline 観測後の FieldResolver・hierarchy・parser・normalization の修正、fuzzy matching、H2 は行っていない。

## 判定: **GO_TO_FAILURE_PRIORITIZATION**

preregistration §8: 失敗 PDF 8（< 21）、一般会計で比較可能な request 101（≥ 30）→ NEEDS_BASELINE_INFRASTRUCTURE の条件に当たらず、82 PDF すべての結果 / status と failure distribution が得られた。

## Corpus / Git

82 PDF（FOUND 82）・9,899 ページ・一般会計 50 PDF / 特別会計 32 PDF。corpus digest `af9b06fa2a71aa07e3f94e22819b98d8155bb64cf9f549a59486055798b3e5dc`、manifest SHA-256 `4a2a10ec…de7a`。base は P1 の research branch（`320a418`、main に未 merge。P1 の matcher に依存）。commit: A `4d76dbc`（protocol・manifest・実行計画）、B `3ae5c81`（runner）、C `23c0ce6`（extraction-only の評価）、D（本結果）。

## 実行分類（実行前に固定）と結果

| 分類 | PDF | ページ | success | hard_failure |
|---|---:|---:|---:|---:|
| `runnable_existing_contract`（既存の hierarchy 契約あり） | 8 | 4,079 | 8 | 0 |
| `unrunnable_missing_hierarchy`（契約なし。null hierarchy でのみ実行） | 74 | 5,820 | 66 | 8 |
| `unrunnable_missing_layout_contract` / `unrunnable_other` | 0 | 0 | — | — |

runner（orchestration のみ）の hierarchy 区間は、既存の meti の artifact と record が 1,238 / 1,238 一致することを確認した（既存関数の呼び出しが faithful）。

## Extraction baseline

- **success 74 / hard_failure 8 / exception 0 / unsupported 0 / not_runnable 0**。ページは試行 9,899・処理 8,663（1,236 ページが未処理）。
- hard_failure 8 は**すべて同一の原因**: `回転ページ(rotate=90)は未対応です`（SourceToken の前段 `extractPageTokens` が例外）。該当は公正取引委員会（p138）・文部科学省（p1）・財務省 5 件（一般会計 p292、特別会計 p9・p11・p16・p20）・法務省（p1）。FieldResolver は区間ごとに 1 回呼ぶ契約のため、1 ページの失敗でその区間（PDF 全体）の record が 0 になる（その PDF の結果は「失敗」として記録し、修正して再実行していない）。
- record（成功した 74 PDF）: detail_line 29,793・unclassified 15,304・**request 4,245**・**item 97**・organization 20。item・organization は hierarchy 区間（8 PDF）にだけある。hierarchy 区間: request 274・item 97・unclassified 1,078、null 区間: request 3,971・unclassified 14,226。
- item 97: 名称あり 95・なし 2、親の組織は 97 件すべて解決。request 4,245: 名称あり 1,446（34.1%）・なし 2,799。親の項は `not_observed` 3,971（null 区間）・`resolved` 227（うち親が item 種別 158、organization 13、unclassified 56）・`unresolved` 47。

## MOF scope

manifest の `accountType`（既存 metadata）だけで決めた。一般会計 3,074 record（item 81・request 2,993）、**特別会計 1,268 record は `out_of_scope_mof_general_account`**、`account_scope_unresolved` は 0。名称・金額から会計を推測していない。

## Reconciliation（一般会計のみ）

| | 一般会計 total | exact_unique | no_exact_match | parent_unresolved | name_unavailable | 比較可能（親まで解決） | 条件付き exact rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| 項 | 81 | 77（95.1%） | 2 | 0 | 2 | 79 | 97.5%（77/79） |
| 事項 | 2,993 | 98（3.3%） | 3 | 898 | 1,994 | 101 | 97.0%（98/101） |

事項の全抽出 4,245 に対する exact_unique は 2.3%（denominator が異なる 3 つの率: 全抽出 2.3%・一般会計 3.3%・比較可能 97.0%。P1 の 56/59 とは denominator が違う）。

### Funnel（事項。denominator を段階ごとに明記）

82 PDF → 抽出成功 74 → item / request が検出された PDF 73 → request 4,245 → 一般会計 2,993（特別会計 1,252 は scope 外）→ 名称あり 999 → 親が item 種別の record として解決 103 → 親が MOF の項に exact_unique で解決 101 → **事項が MOF exact_unique 98**。

### 省庁別（一般会計。抜粋）

経済産業省: 比較可能な事項 39（exact 36・no match 3）、項 30（exact 29）。厚生労働省: 事項 20/20・項 14/14。文部科学省: 事項 20/20・項 17/17。環境省: 事項 18（exact 18）・項 17（exact 16）。防衛省: 事項 4/4・項 1/1。他の一般会計 PDF は比較可能な record が 0（hierarchy 契約がなく親の項が `not_observed`、または名称が取れていない）。全 PDF の表は artifact `byMinistry`。

## Failure distribution（修正せず分布だけ。stage は artifact の status が示す範囲）

- **A. document / run**: rotate=90 の hard_failure 8 PDF（1,236 ページ）。それ以外の unsupported・exception は 0。
- **B. record 検出**: `unclassified` 15,304 record（3 桁コードだけの行で、hierarchy がないと項・組織を判別できない）。item が 0 の成功 PDF は 67（hierarchy 契約のない 66 + 契約はあるが item 0 の 1）。
- **C. 名称**（全 kind）: `continuation_ambiguous` 4,739、`column_layout_unobserved` 4,308（request 2,685 を含む）、`no_name_token` 1,445、`column_layout_not_corroborated_on_page` 73。一般会計 request の名称なし 1,994 のうち hierarchy 区間は 19、null 区間は 1,975。
- **D. hierarchy**: request の親の項が `not_observed` 3,971（null 区間）、`unresolved` 47、親が item 種別でない 69（organization 13・unclassified 56）。照合上の `parent_item_not_item_kind` 68（一般会計。こども家庭庁 20・環境省 20・防衛省 27・経済産業省 1）— **CFA 固有ではなく複数省庁**。
- **E. 照合**（一般会計 request）: `pdf_name_unavailable` 1,994、`parent_item_not_observed` 783、`parent_item_not_item_kind` 68、`parent_item_unresolved` 45、`parent_item_no_match` 2、`request_name_differs_under_parent` 2、`request_name_is_prefix_of_mof` 1。項: `item_name_differs_in_organization` 2、名称なし 2。`unknown` は 0。

## P1 との比較（P1 は評価用の sample。代表性を仮定しない）

- spacing: 名称が解決した 1,446 request のうち raw に ASCII space を持つのは 79、**normalized に空白が残るのは 0**。full corpus でも spacing は照合失敗の要因になっていない（P1 と同じ）。
- 名称なし（`name_unavailable`）は P1 の 26% に対し、full corpus の request で 66%（2,799/4,245）。`parent_unresolved` は null 区間が 3,971 を占め、P1 の sample（hierarchy ありの run が中心）とは構成が異なる。
- 比較可能な record の exact rate は P1（項 97.7%・事項 94.9%）と同程度（項 97.5%・事項 97.0%）だが、比較可能な事項は 101 件で、全抽出の 2.4% にとどまる。率の違いだけで regression とは言えない。

## Decision と次の候補（修正はしない）

**GO_TO_FAILURE_PRIORITIZATION。** preregistration §9（影響 record 数の降順）の上位 3 候補（分類間で record は重なり得る）:

1. `unclassified` 15,304 record — stage: hierarchy / record detection（hierarchy 契約のない PDF では item・組織を判別できない）
2. 名称 `continuation_ambiguous` 4,739 — stage: FieldResolver（名称の継続）
3. 名称 `column_layout_unobserved` 4,308 — stage: FieldResolver（column layout）

参考（record 数が測れず規則上は下位）: rotate=90 の hard_failure（8 PDF・1,236 ページ。stage: SourceToken 前段）、request の親の項 `not_observed` 3,971（hierarchy 入力の契約）。次の one-change 仮説の設計は別 phase。

## Artifacts / Validation

- `tests/fixtures/budget-request-full-corpus-baseline/2024/extraction-baseline.json`（SHA-256 `89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f`）、`extraction-population.json`（`3ec53c133117033ea0c8a8f23a3196f5b28ff18120957c7531c48c6df15fdbf8`）、`reconciliation-result.json`（`2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904`）。生成物の全量は `data/work/budget-request-corpus-baseline/`（git 管理外）。
- 再生成の determinism（manifest・extraction 評価・照合）、raw PDF の hash（runner が実行前に manifest と照合）、MOF V2 の入力 hash（#371 の記録と一致）、既存の production output（`budget-items.jsonl`・`manifest.json`・`sections.jsonl`）の SHA-256 が実行前後で不変であることを確認した。

## Claim boundary

現行 pipeline の無修正 baseline の観測まで。MOF 照合は FY2024 一般会計 当初予算の項・事項に限り、概算要求額と当初予算額の比較・コードの対応・精度改善・特別会計の照合は行っていない。
