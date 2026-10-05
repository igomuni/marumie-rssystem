# 概算要求PDF 罫線基準 8.6pt 項候補の全 corpus 抽出 — protocol（全件評価の前に固定）

DocumentHierarchy / activation range / level frame の研究は横に置き、**単純な source-only 条件で項を高 recall で拾えるか**を直接確認する。candidate = 左の縦罫線 → 5.6〜11.6pt（8.6pt ± 3.0pt）→ 行頭の plain 3 桁 `NNN` → 非空の名称文字列、かつ要求番号行ではない logical row。**金額列は eligibility から完全に外す**（前回の「罫線 → NNN → 名称 → 金額列」は使わない）。MOF・hierarchy・manual range・既存 `recordKind=item`・既存 item 97・request x − 6.9pt detector・人手の正解・総表 GT・PDF 名ごとの特別ルールは Phase A に使わない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json`: `4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/extraction-baseline.json`: `89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/reconciliation-result.json`: `2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904`
- `tests/fixtures/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`: `4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1`
- `tests/fixtures/budget-request-hierarchy-failure-isolation/2024/transition-evaluation.json`: `b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd`
- `tests/fixtures/budget-request-hierarchy-failure-isolation/2024/off-diagnostic.json`: `9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562`
- `tests/fixtures/budget-request-pdf-item-candidate-count/2024/mof-exact-name-diagnostic.json`: `3a731169b4e826faab10d0110c622e95fa5942c06181c9c5cda2dd18a296855d`
- `tests/fixtures/mof-jikou-normalized/2024/202411001-integration-evaluation.json`: `066dc9cd35e7ab301b409491206c48b4de9a582bb72a0c48c045e65a7cf2973e`
- `tests/fixtures/budget-request-rule-line-item-population/2024/phaseA-summary.json`: `410e9383f48d0876c21832fdcd6815980859c3cb13887edd5a10fdb9a1332a5f`
- `tests/fixtures/budget-request-rule-line-item-population/2024/phaseA-candidates.jsonl.gz`: `f5e36b1664fc50d8069093859e27849fb7b7d3e1aea5a339a926b0c38af42156`
- `scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts`: `50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7`
- `scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts`: `39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262`
- `scripts/pipeline-v2/lib/budget-request-rule-line-item-population.ts`: `d0ef587ffc9c76e7e8785c63fe93e3a7ee73b17736ebf17e073e714e14fbe247`
- `scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts`: `da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a`
- `scripts/pipeline-v2/lib/stable-id.ts`: `038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5`
- `scripts/pipeline-v2/lib/budget-request-field-resolver.ts`: `758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224`
- `data/normalized/mof/fy2024/budget-jikou.jsonl`: `a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e`
- `docs/tasks/20261005_2000_Budget_Request_RuleLine_Item_Population_Inventory_Result.md`: `798dc6bae984d3caebea71aca103c2e7db206a12f389350044c733066d83099a`
`budget-jikou.jsonl` と MOF 関連 artifact は Phase B / C でのみ読む。

## 2. Candidate rule（変更しない）
- 入力 row: frozen baseline の row-local records（前回と同じ読み込み: baseline の segment、hierarchy 区間は hierarchy 非依存の OFF artifact、hash 照合）。corpus は manifest の 82 PDF 全件。rotate=90 で upstream が評価できない PDF は fail-closed の coverage（`unavailable_rotate90`、`unavailable_upstream` 等）として明示し、新規対応しない。
- plain 3 桁: 前回までの既存定義 `^\d{3}$`（`RE_PLAIN3`）。code は FieldResolver の row-local な「行頭 token の code 観測」（`rowLocal.code`、status resolved）で、source に無い補完は無い。`NN-NN`・要求番号・3 桁以外・code の前に別 token がある行は含まれない。
- 要求番号行ではない: `recordKind === 'request'`（行頭の request 番号 + code の row-local lexical 観測。hierarchy / MOF 非依存）を除外。
- 名称: records に名称断片の text は無い（実装前に corpus 全体の plain 3 桁 non-request 行を集計して確認: name status は resolved 9,652・ambiguous（`continuation_ambiguous`）3,326・unresolved 3,035（`no_name_token` 1,428・`column_layout_unobserved` 1,550・`column_layout_not_corroborated_on_page` 57）で、`candidates` の断片は無い）。そのため candidate の名称条件は、(a) `rowLocal.name` が resolved で `value.raw` が非空（`nameComplete = true`）、または (b) status が ambiguous で reasonCode が `continuation_ambiguous`（名称 token は存在するが継続行を安全に連結できない。`nameComplete = false`、`nameRaw` / `nameNormalized` は null）。unresolved（名称 token なし、または名称列の layout が未観測 / 未裏付け）の行は名称が非空と確認できないため candidate にせず、pre-band universe に `name_unresolved` として保存する。名称の意味・辞書・MOF は eligibility に使わない。金額 token の有無・個数・列位置は条件にしない。(この項は protocol commit 直後・全件評価の前に、上の確認結果に合わせて訂正した。)
- 縦罫線: 前回の deterministic linker をそのまま再利用（pdf.js operator list → `extractDrawingPrimitives` → `mergeVerticalRules`、page の全 merged vertical rule。candidate の codeX より左で row bbox の vertical midpoint を y 区間が含む rule のうち最も近いもの = `selectLeftRule`）。`rule_unavailable` / `rule_ambiguous` / `unavailable_rotate90`（page の rotate ≠ 0）は status を分けて保存し、補完しない。
- band: `deltaX = codeX − ruleX` が **5.6 ≤ deltaX ≤ 11.6**（raw 値で判定、端を含む）のとき candidate。それ以外は pre-band universe（保存するが candidate ではない）。band は結果を見て変更しない。

## 3. Phase A（source-only）
出力: coverage（PDF / page。evaluable・unavailable 別）、pre-band universe 全行（plain 3 桁・非要求・名称 text あり。rule status・deltaX raw / 0.001 / 0.1 丸め・candidate か）、candidate 全行（localPath・page・logicalRowIndex・code・nameRaw・nameNormalized・nameComplete・ruleX・codeX・deltaX・rule provenance・row / token provenance）、PDF 別・page 別 candidate 件数、deltaX の実測分布（全 value）。
**gate**: candidate id の duplicate 0、unjoinable 0（row が records に遡れる）、provenance loss 0、`ruleX < codeX`・deltaX > 0、選んだ rule が eligible 中で最近傍、Phase A の code path が MOF / hierarchy / manual / 既存 item を参照しない（source scan test）、再実行 byte 一致。違反は STOP。Phase A の artifact と script の hash を保存して commit（freeze）してから MOF を読む。

## 4. Phase B（freeze 後。MOF 名称 only exact）
- MOF 一般会計の項: `budget-jikou.jsonl` の distinct `parentSectionId`（`accountType = general`）を再計数し **784** でなければ STOP。名称 normalization は frozen の `normalizeKey`（NFKC + 空白除去）をそのまま使い、結果に合わせて追加・変更しない。code は診断表示のみで match 条件に使わない。
- 対象 candidate: 一般会計の PDF の candidate（特別会計の PDF は MOF 一般会計と突合しない）。candidate 側分類（`nameComplete = false` は `name_unavailable`）: `name_exact_unique`（その正規化名称が MOF のちょうど 1 行に対応）/ `name_exact_ambiguous`（2 行以上）/ `no_exact_name_match` / `name_unavailable`（nameComplete = false。断片名称は exact 照合に使わない）。
- 主集計: MOF 784 行それぞれ `candidate_name_exact_present` / `absent`。**MOF row coverage**（名称 exact の candidate が 1 件以上ある MOF row 数 / 784）と **distinct normalized MOF name coverage**（candidate に存在する distinct 名称数 / MOF の distinct 名称総数）。precision / recall とは呼ばない。MOF name exact の candidate は全件 artifact に保存（MOF code・name、PDF localPath・page・logicalRowIndex・PDF code・raw name・normalized・ruleX・codeX・deltaX）。PDF 別の exact 件数も出す。

## 5. Phase C（A/B freeze 後の diagnostic。candidate rule の変更には使わない）
Phase B で absent だった MOF row についてだけ、同じ source corpus（一般会計 PDF の records）から名称 exact（normalizeKey 一致、nameComplete = true の名称）の行を **deltaX の制限なし**で検索し、次に分類する（優先順）: (1) pre-band universe に exact 名称の行があり rule が linked で band の外 → `exact_name_found_outside_8p6_band`（実測 deltaX を全件出力）、(2) universe に exact 名称の行があるが rule が unavailable / ambiguous / rotate → `exact_name_found_but_rule_unavailable`、(3) universe には無いが records に exact 名称の行がある（code が plain 3 桁でない・request-shaped・code 無し等）→ `exact_name_found_but_not_plain_3digit_structure`、(4) どこにも無い → `no_exact_name_found_in_source_universe`。rotate=90 等で評価不能な PDF は coverage として別記し、(4) は「PDF 側に無い」と断定しない。ここを見て band を広げたり別クラスタを足したりしない。

## 6. 報告と記述的分類
中心の数: A band の candidate row 総数、B candidate を持つ PDF 数 / evaluable PDF 数、C MOF name-only exact coverage X / 784、D distinct MOF normalized name coverage X / Y、E band 外に exact 名称が見つかった MOF row 数、F source universe に exact 名称が無い MOF row 数。数値 threshold は置かず、結果後に `SIMPLE_RULE_HIGH_COVERAGE_SUPPORTED` / `SIMPLE_RULE_PARTIAL_COVERAGE` / `SIMPLE_RULE_INSUFFICIENT` のいずれかを記述的に付ける（事前登録済みの機械判定ではない）。candidate に item 以外が混じること・code が MOF と一致しないことを理由に rule を狭めない。MOF name exact = 正しい item、MOF 未一致 = PDF 抽出失敗、とは断定しない。

## 7. 禁止・STOP・commit
DocumentHierarchy・activation range・level frame・FieldResolver / recordKind / item detector の変更・MOF を使った閾値調整・manual contract・金額条件・blank を 0 とみなす・名称や code の補完・見えない値の推測は行わない。frozen hash 不一致・corpus 件数の変化・MOF 784 不一致・Phase A が MOF / hierarchy / manual を参照・production diff・provenance を保持できない・既存 linker を安全に再利用できない場合は STOP。測定バグは初回出力を保存し、rule / population / gate を変えずに独立 commit で修正する。
Commit: protocol → Phase A 実装 + freeze → Phase B → Phase C → result。PR は作成しない。
