# 概算要求PDF × MOF V2 事項 — Reconciliation P1 Preregistration（population と matching rule）

2026-10-05。base: `origin/main` `38e5080`（#371 merge 済み）、branch `research/budget-request-mof-reconciliation-p1`。**freeze 前に full matching の結果（match 率・分類件数）は計算していない。** 本書の rule・分類・判定基準は、matching 結果を見たあとに変更しない（観測後に追加できるのは failure category のみで、既存分類の意味は書き換えない）。

## 1. 研究質問

現在すでに抽出済みの FY2024 概算要求 PDF の「項」「事項」は、MOF V2 FY2024 一般会計 当初予算の `section`（項）/ `jikou`（事項）と、名称・階層を使った deterministic な照合でどの程度そのまま対応するか。概算要求額と当初予算額が一致するかの研究ではない。**金額・コード単独は match 条件に使わない**（PDF の項コードと MOF の項コードは体系が別）。

## 2. Source boundary

- MOF 側: #371 の production output `data/normalized/mof/fy2024/budget-jikou.jsonl`（1,256 事項・親の項 784）のみ。V1 は使わない。XML を独自に解析し直さない。項の集合は jikou の `parentSectionId`（組織・項名・項コードを持つ）から作る。
- PDF 側: 既存の FieldResolver 抽出 artifact（`data/work/budget-request-field-resolver/**/field-resolution.json` の 21 run）。新しい PDF 抽出・PDF の目視 GT は作らない。

## 3. PDF population（P1-A。MOF とのマッチ結果は含まない）

- artifact: `tests/fixtures/budget-request-mof-reconciliation/2024/p1-pdf-population.json`（SHA-256 `f726c81b203eb22398cb7fd4c051bd059f40fea6e018a2a78a9e4babdfbd94b6`）。生成 script `scripts/pipeline-v2/build-budget-request-mof-recon-population.ts`（再生成で byte 一致を確認）。
- 対象: 21 run のうち `recordKind = item / request` を持つ 11 run。**item 44・request 123**（すべて一般会計。mext は 0）。source 別: 経済産業省（item 30・request 50）、厚生労働省（item 14・request 23）、こども家庭庁（request 24）、農林水産省（request 18）、環境省（request 6）、国土交通省（request 1）、防衛省（request 1）。
- 各 record の固定項目: run・documentKey・canonicalUrl・source の省庁・domain・会計・ファイルパスと SHA-256・page・logicalRowIndex・recordKind・raw code・名称の status と raw／normalized・親の組織（ref・名称）・親の項（request のみ。ref・record 種別・名称）・run の artifact の SHA-256。
- 観測: locator の重複 0（run 内・source 内とも）。同一名称（raw）の重複は item 0・request 2。item は親の組織名が全件解決。request の名称 status は resolved 91・ambiguous 11・unresolved 21。親の項は resolved 91・unresolved 4・not_observed 28（hierarchy 入力のない run）。
- run 間の重複 unit はない（重複除去はしていない）。FieldResolver の guard（incomplete-name）は既定 off のまま。

## 4. Name normalization

PDF 側は **raw 名称**（artifact の `name.raw`。PDF の normalized field は使わない）、MOF 側は `sectionName`・`jikouName`・`organization` に、同一の関数を適用する: `normalizeKey(s) = s.normalize('NFKC')` のあと**すべての空白文字（半角・全角・改行・タブ）を除去**（V2 の `stable-id.ts` の `normalizeText` と同じ規則。既存表現）。許容する差は Unicode 正規化・空白の除去・PDF の字間スペース除去・折返し改行の連結だけ。**禁止**: 略称展開・同義語置換・語順変更・typo 補正・substring・fuzzy・LLM。

## 5. Matching rule

### Stage 1: 項（PDF の item）

key = `normalizeKey(親の組織名)` + `normalizeKey(項名)`。MOF の section 候補を、同じ key（`organization` と `sectionName`）で列挙する。0 件 → `no_exact_match`、1 件 → `exact_unique`、複数 → `exact_ambiguous`。項コードは key に使わない。

### Stage 2: 事項（PDF の request）

親の項が `exact_unique` のものだけ。key = 一意に解決した MOF section（`parentSectionId`）+ `normalizeKey(事項名)`。その section 配下の jikou から完全一致を探す（0 / 1 / 複数）。**事項名だけの global な検索による救済はしない。**

PDF request の親は artifact の `parentItemAssociation`（同一 run 内の anchor）で、親が `recordKind = item` の record であること。

## 6. Classification（pre-registered）

| 分類 | 定義 |
|---|---|
| `exact_unique` | 候補がちょうど 1 件 |
| `exact_ambiguous` | 候補が 2 件以上 |
| `no_exact_match` | 名称・親が揃い、候補が 0 件 |
| `parent_unresolved` | item: 親の組織名が解決していない。request: 親の項が (a) hierarchy 入力がない（not_observed）(b) PDF 側で未解決 (c) item 種別の record でない (d) 名称が未解決 (e) MOF で `no_exact_match` (f) MOF で `exact_ambiguous` のいずれか（理由を併記） |
| `name_unavailable` | 自身の名称 status が resolved でない（照合する名称がない。抽出側の問題として別に数える） |
| `out_of_scope` | 会計が一般会計でない |

判定の優先順: out_of_scope → name_unavailable → parent_unresolved → 候補数による 3 分類。

## 7. Evaluation（実施後に出す指標）

- item: total・exact_unique・exact_ambiguous・no_exact_match・parent_unresolved・name_unavailable・exact unique rate（= exact_unique / total）。
- request: total・親が exact_unique の件数・exact_unique・exact_ambiguous・no_exact_match・parent_unresolved（理由別）・name_unavailable・exact unique rate、条件付き exact rate（親が exact_unique の request のうち exact_unique の割合）。
- source / 省庁別の breakdown。金額は match key にも指標にも使わない（previousBudget と当初予算額の比較可能性は `unresolved` のまま）。

## 8. Failure isolation（機械的・source evidence のみ。根拠がなければ unknown）

`exact_unique` 以外の record に、次の決定的な診断を付ける（正式な match には昇格させない）。

- `pdf_name_unavailable`: name_unavailable
- `parent_unresolved:<理由>`: parent_unresolved
- `mof_organization_absent`: item で、PDF の組織名が MOF のどの section の organization にも存在しない
- `item_in_other_organization`: item で、同じ項名が MOF の別の組織にだけ存在する
- `item_name_differs_in_organization`: item で、組織は MOF に存在するが項名の完全一致がない
- `request_name_is_prefix_of_mof`: request で、PDF の名称が親 section 配下の MOF 事項名のちょうど 1 件の真の前方部分（接頭辞）になっている（名称の途中切れの疑い）
- `mof_name_is_prefix_of_pdf`: 同様に MOF 事項名が PDF の名称の真の接頭辞
- `request_name_differs_under_parent`: 親は解決し、上記のいずれにも当たらない
- `unknown`: 上記のどれにも当たらない

候補との文字列類似度などは diagnostic として計算してよいが、正式な分類には使わない。

## 9. Decision（match 率の高さでは判定しない）

- **GO_TO_NEXT_DESIGN**: `exact_unique` 以外の record の 90% 以上が `unknown` 以外に分類でき、かつ 1 つの診断カテゴリが全体の 30% 以上を占め、次の one-change 仮説を限定できる。
- **NEEDS_MORE_ISOLATION**: 上を満たさない（failure が複数原因に混在）。
- **STOP**: 一般会計・名称解決済みの比較可能な record が 0 件など、PDF extraction population が MOF との比較 population として成立しない重大な構造問題がある。
- exact match 率が低いこと自体は STOP 理由ではない（概算要求と当初予算は別段階。negative result も成果として保存する）。

## 10. Non-goals

V1 の使用、新しい 82 PDF の全文抽出、PDF GT の大量作成、fuzzy / LLM / substring による正式 match、金額による match、PDF コードと MOF コードの同一視、FieldResolver・PDF parser・MOF XML parser・MOF normalized schema・`budget-jikou.jsonl` の変更、H2、UI/API。

## 11. Git の単位

commit A（本書と population）→ commit B（照合の実装とテスト）→ commit C（frozen evaluation と結果）。A は結果を見たあとに書き換えない。
