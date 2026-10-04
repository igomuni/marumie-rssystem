# 概算要求PDF × MOF V2 事項 — Reconciliation P1 Result

2026-10-05。既存の概算要求 PDF 抽出 population（item 44・request 123）を、MOF V2 FY2024 一般会計 当初予算の section / jikou と deterministic exact 照合した中間評価。preregistration（commit `7f527af`、`20261005_0608_…_P1_Preregistration.md`）の規則を、matching の結果を見る前に freeze したうえで機械的に適用した。fuzzy matching・FieldResolver 変更・PDF parser 変更・H2・新規の 82 PDF 全文抽出は行っていない。

## 判定: **GO_TO_NEXT_DESIGN**（preregistration §9 の機械適用）

非 exact_unique 68 件のうち 100% が `unknown` 以外に分類され、最多の診断カテゴリ `pdf_name_unavailable`（32 件）が 47.1%（基準は 30% 以上）。**ただし、これは「失敗要因が機械的に分離できた」ことを示すもので、match 率が高いことの判定ではない。**

## Frozen input

- PDF population `tests/fixtures/budget-request-mof-reconciliation/2024/p1-pdf-population.json`（SHA-256 ``）: item 44・request 123、すべて一般会計。
- MOF: #371 の `budget-jikou.jsonl`（1,256 事項・項 784）。SHA-256 は #371 の integration evaluation の記録と一致を確認。
- result artifact: `tests/fixtures/budget-request-mof-reconciliation/2024/p1-reconciliation-result.json`（SHA-256 `66e8ba1d4cf16c298a7c7db083f482c6187b0a8c91ba4c4dc09fe6c607d42697`）。評価 script `scripts/pipeline-v2/evaluate-budget-request-mof-reconciliation.ts`。

## 項（item）

| total | exact_unique | exact_ambiguous | no_exact_match | parent_unresolved | name_unavailable | exact unique rate |
|---:|---:|---:|---:|---:|---:|---:|
| 44 | 43 | 0 | 1 | 0 | 0 | 97.7% |

no_exact_match 1 件: 経済産業省 p91「原子力損害賠償支援対策費エネルギー対策特別会計へ繰入」（組織は MOF に存在し、名称の完全一致がない。診断 `item_name_differs_in_organization`。原因は source evidence だけでは確定できず unknown 相当）。

## 事項（request）

| total | 親が exact_unique | exact_unique | exact_ambiguous | no_exact_match | parent_unresolved | name_unavailable | exact unique rate | 条件付き exact rate（親が解決した 59 件のうち） |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 123 | 59 | 56 | 0 | 3 | 32 | 32 | 45.5% | 94.9% |

- parent_unresolved 32 の内訳: `parent_item_not_item_kind` 21（こども家庭庁 cfa の run。親が item 種別の record として抽出されていない）、`parent_item_not_observed` 7（hierarchy 入力のない run）、`parent_item_unresolved` 3、`parent_item_no_match` 1。
- name_unavailable 32: 名称 status が resolved でない（`column_layout_unobserved` 21・`continuation_ambiguous` 11）。農林水産省 16・経済産業省 9・環境省 5・厚生労働省 1・こども家庭庁 1。
- no_exact_match 3（経済産業省）: p27「…機構出資に必要な経費」（親の項の配下に完全一致なし。`request_name_differs_under_parent`）、p65「地域経済産業活性化に必要な経費」（同上）、p92「…エネルギー需給勘定へ繰入れに必」（PDF の名称が MOF の事項名の真の接頭辞。`request_name_is_prefix_of_mof`＝名称の途中切れの疑い）。

## source 別（item exact_unique / total、request exact_unique / total）

経済産業省 29/30・36/50、厚生労働省 14/14・20/23、こども家庭庁 -・0/24、農林水産省 -・0/18、環境省 -・0/6、国土交通省 -・0/1、防衛省 -・0/1（item のない run は「-」）。

## Failure isolation（診断別。非 exact_unique 68 件）

`pdf_name_unavailable` 32、`parent_unresolved:parent_item_not_item_kind` 21、`parent_unresolved:parent_item_not_observed` 7、`parent_unresolved:parent_item_unresolved` 3、`parent_unresolved:parent_item_no_match` 1、`request_name_differs_under_parent` 2、`request_name_is_prefix_of_mof` 1、`item_name_differs_in_organization` 1。`unknown` は 0。source evidence で確定できたのは「どの前提が欠けているか」（名称の status・親の hierarchy の有無・親の record 種別）であり、名称が異なる 4 件の原因（概算要求→当初予算での名称変更か、抽出の誤りか、MOF 側に対応がないか）は確定できない。

## 観察（post-hoc interpretation。frozen な結果とは区別）

- 照合できた部分は高い一致（親が解決した request で 94.9%、項で 97.7%）で、失敗の大半は「照合の前に抽出側で前提が満たされていない」もの（名称 status・hierarchy 入力・item 種別）。名称が異なる 4 件は少数。
- 次の one-change 仮説の候補（設計は別 phase）: (1) cfa の run で親の項を item 種別として扱えるか、(2) hierarchy 入力のない run（heldout の単一ページ・mhlw の 1 run）への hierarchy の付与、(3) 名称 status `column_layout_unobserved` の原因。
- population は評価用に選ばれた run（11 run・うち hierarchy 入力あり 3）で、82 PDF 全体の代表ではない。一般化はできない。

## Claim boundary / Limitations

主張できるのは「既存の抽出 population を MOF V2 の項・事項と deterministic exact に照合した結果と、その失敗の機械的な分離」まで。概算要求額と当初予算額の比較（金額）、コードの対応、全 PDF への一般化、MOF の特別会計・補正予算は対象外。金額は match key にも指標にも使わず、`previousBudget` と当初予算額の比較可能性は `unresolved` のまま。diagnostics は正式な match に昇格させていない。

## Validation

`tsc` pass・lint error 0・全体 vitest pass（commit C 時点）。frozen artifact（PDF population・MOF jikou）の hash を評価前に確認。

## 次

停止し、次の研究設計を待つ。
