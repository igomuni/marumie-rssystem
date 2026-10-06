# FY2024 概算要求 82 PDF — Full-Corpus Baseline Protocol（preregistration）

2026-10-05。現行の frozen / production PDF extraction pipeline を、**無修正で** FY2024 概算要求書 82 PDF 全体に適用した baseline と、MOF V2 FY2024 一般会計 当初予算との deterministic な照合を行うための protocol。**本書の freeze 前に、82 PDF 全体の抽出件数・照合率は見ていない**（既知の 11 run の結果は既知情報であり、full-corpus 結果の代用にしない）。本書の規則・分類・判定基準は、結果を見たあとに変更しない。精度改善の phase ではない。

## 1. Base / dependency

- branch `research/budget-request-full-corpus-baseline`。base は P1 の research branch（`research/budget-request-mof-reconciliation-p1` `320a418`、**main に未 merge**）。P1 の matcher（`lib/budget-request-mof-reconciliation.ts`、commit `8691dc4`）と preregistration（`7f527af`）に依存するため、この branch を親にした。main への移植・rebase・merge はしていない。main との merge-base は `38e5080`（#371）。
- frozen dependency: #370 の XML parser と #371 の `budget-jikou.jsonl`（MOF V2 側）。P1 の matcher の SHA-256 `da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a`。

## 2. Corpus（Phase A）

- manifest: `tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json`（SHA-256 `4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a`）。生成 script `scripts/pipeline-v2/build-budget-request-corpus-manifest.ts`（再生成で byte 一致を確認）。
- **82 PDF（FOUND 82・欠落 0）・計 9,899 ページ・180,203,393 bytes**（一般会計 50 PDF・8,518 ページ／特別会計 32 PDF・1,381 ページ）。corpus digest `af9b06fa2a71aa07e3f94e22819b98d8155bb64cf9f549a59486055798b3e5dc`（各 PDF の `{sha256} {localPath}` を localPath 昇順に連結した SHA-256）。既存 inventory（`data/work/budget-request-extraction/2024/inventory.json`）の 82 件と一致。Web 検索・再 download はしていない。
- PDF ごとの項目: 省庁・domain・会計・local path・SHA-256・bytes・ページ数・既存 extraction run の有無・実行計画。既存の抽出 run はすべてページ範囲の sample で、full-document run はない。

## 3. 現行 pipeline の runability（Phase B）

- entrypoint `extract-budget-request-field-resolver.ts` は `FIELD_RESOLVER_RUNS`（固定の 5 run）だけを処理し、任意の PDF・ページ範囲を受け付けない。**full-document / 82 PDF の batch を実行する既存 entrypoint はない。** ページ範囲は「走査範囲の選択」で、推論の入力ではない（既存の方針）。
- hierarchy 入力（DocumentHierarchy v2-B）は **view（summary / detail）とページ範囲が入力**で、自動判別されない。FieldResolver は hierarchy を optional に受け付け（`null` なら hierarchy 依存 field が `not_observed`、item は取得できない）、heldout・mhlw 1260 の run が `null` で実行された。FieldResolver は 1 回の呼び出し内で直近の見出し layout をページ間で引き継ぐため、区間を分割しない。
- 既存の hierarchy 契約 = `A2_EXPERIMENTS` の view=detail の実験定義（PDF ごとにページ範囲が最も広いもの。同数なら定義順の先頭）。これがある PDF だけ、その範囲で hierarchy を観測できる。
- したがって research runner（orchestration のみ）を **実装する**: 既存の関数（`extractPageTokens` → `buildTableGeometry` → `resolveLogicalRows` →（hierarchy 区間のみ）`observeDocumentHierarchyV2` → `resolveFields`）を、`extract-budget-request-field-resolver.ts` と同じ順序・同じオプションで PDF ごと・区間ごとに呼ぶ。担当は既存関数の反復呼び出し・入出力パス・status・hash・時間・エラーの記録だけで、recordKind の補正・hierarchy の推測・名称の補完・ページの選別・結果の書き換えはしない。必要性: 既存 entrypoint が固定 5 run しか実行できないため。

## 4. 実行分類（Phase C。実行前に固定）

| 分類 | 定義 | PDF | ページ |
|---|---|---:|---:|
| `runnable_existing_contract` | 既存の hierarchy 契約がある。その範囲を hierarchy 有り、残りのページを null hierarchy の連続区間として実行 | 8 | 4079 |
| `unrunnable_missing_hierarchy` | 既存の hierarchy 契約がない。**item・hierarchy 由来の項目（親の項など）は既存 contract では取得できない。**既存の optional 入力（null hierarchy）で全ページを実行し、名称・金額・layout の status を測る | 74 | 5820 |
| `unrunnable_missing_layout_contract` | 実行前に分かる layout 契約の欠落（実行前の分類基準がないため 0） | 0 | 0 |
| `unrunnable_other` | 原本が FOUND でない・ページ数が取れない・hierarchy 契約の範囲が PDF に収まらない | 0 | 0 |

`unrunnable_missing_hierarchy` は「実行しない」ではなく、上記の限定された実行を意味する（結果を見たあとにこの意味を変えない）。区間の計画は manifest の各 PDF の `plan.segments` に固定した。

## 5. Extraction metrics（実行後に出す。実際の型に存在するものだけ）

PDF ごと: ページ総数・試行・処理、status（success / hard_failure / exception / not_runnable）、区間ごとの status・時間、SourceToken 数・LogicalRow 候補数（ページ別の合計）、record 数（`recordKind` = organization / item / request / detail_line / unclassified）、名称 status（kind 別・reasonCode 別。`name.value` の有無 = raw の有無、`name.value.normalized` の有無）、親の項の status（request）・親の組織の status、hierarchy の有無（区間の方式）、例外メッセージ。

## 6. 照合（Phase F）の規則

P1 の matcher（`7f527af` の規則・`8691dc4` の実装）を**そのまま**使う（正規化は NFKC + 全空白除去、項は組織＋項名、事項は一意に解決した項の配下での名称。事項名だけの global な救済・fuzzy・substring・LLM・金額・コードの同一視は行わない）。P1 の規則を変える必要が見つかったら照合を開始せず STOP する。

- 会計の scope: PDF 側の会計は manifest の `accountType`（既存 metadata）だけで決める。名称・金額から推測しない。`general` → MOF 一般会計と比較可能（denominator に入れる）。`special` → `out_of_scope_mof_general_account`。`accountType` が general / special でない → `account_scope_unresolved`（現 manifest では 0 件のはず）。
- MOF 側は #371 の `budget-jikou.jsonl`（SHA-256 は #371 の integration evaluation の記録と照合）。

## 7. 評価

- funnel: 82 PDF → runnable → 抽出に成功した PDF → item / request が検出された PDF → name available → parent resolved → 一般会計で比較可能 → MOF `exact_unique`（件数と率。各段階の denominator を明記し、P1 の 56/59 と混同しない）。
- document level・record level・item・request・省庁別（PDF 数・ページ・item 数・request 数・name unavailable・parent unresolved・comparable・exact_unique・no_exact_match・run failure）。
- failure distribution: A. document / run の境界、B. record 検出（item 未検出・request 未検出・recordKind）、C. 名称（`column_layout_unobserved`・`continuation_ambiguous`・その他）、D. hierarchy（`parent_item_not_observed`・`parent_item_not_item_kind`・hierarchy 不在・orphan / ambiguous）、E. 照合（P1 の診断カテゴリ。`unknown` を含む）。存在しない status を後付けで作らない。
- extraction-only の結果を **先に** artifact として freeze し、その後に照合する。

## 8. Decision（match 率の高さでは判定しない）

- **STOP**: corpus が 82 / hash に一致しない・frozen dependency（P1 artifact・MOF input）が一致しない・原本の欠落や変更。
- **NEEDS_BASELINE_INFRASTRUCTURE**: PDF の 25% 以上（21 以上）が hard_failure / exception、または一般会計で比較可能な request が 30 件未満（baseline を公平に測れない）。
- **GO_TO_FAILURE_PRIORITIZATION**: 上のどちらにも当たらず、82 PDF すべての結果 / status が記録され、failure distribution が得られた。
- runnable な PDF が少ないこと、exact match 率が低いことは、それ自体では STOP / NEEDS ではない（baseline result）。

## 9. 次の failure の選び方（観測後にも変えない）

失敗の分類（上記 C・D・E と record 検出）ごとに、full corpus で影響する record 数（降順）、影響する PDF / 省庁の数（降順）を並べ、上位 3 候補までを報告する。**原因の推測と修正はしない。**P1 で目立った件数を理由に優先しない。各候補の failure stage（SourceToken / geometry / LogicalRow / hierarchy / FieldResolver / reconciliation）は、artifact の status が示す範囲だけで付ける。

## 10. 成果物と Git

commit A（本書・manifest・実行計画・test）→ commit B（runner と抽出 artifact）→ commit C（extraction baseline evaluation）→ commit D（照合と最終 result）。A は結果を見たあとに書き換えない。生成物は `data/work/budget-request-corpus-baseline/`（git 管理外）に保存し、再現に必要な manifest・集計・hash・compact な record artifact だけを commit する。raw PDF・`data/download/`・既存の production / frozen output は変更しない。

## 11. 禁止事項

FieldResolver・TableGeometry・LogicalRow・DocumentHierarchy・PDF parser・name normalization・MOF の XML parser・normalized output の変更、recordKind の補正、hierarchy の補完、fuzzy / substring / LLM、金額 match、blank→0、差額補完、PDF コードと MOF コードの同一視、V1、human GT の大量作成、H2、UI / API。baseline 観測後の同一 phase 内での精度改善。
