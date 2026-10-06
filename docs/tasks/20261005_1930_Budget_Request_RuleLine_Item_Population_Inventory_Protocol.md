# 概算要求PDF 罫線基準「項」population inventory / MOF 突合 — protocol（Phase A の全件 scan の前に固定）

DocumentHierarchy / level-frame / header-support の研究は STOP し、直前の結果（`f02239a`）は書き換えない。本研究は production item detector を作らない。FY2024 概算要求 PDF 全体で **縦罫線 → NNN（plain 3 桁 code）→ 名称 → 金額列** という物理構造を持つ行を source-only で列挙し、NNN の左の罫線から NNN 先頭までの距離を記録し（Phase A）、freeze 後にだけ MOF 由来の項と突合する（Phase B）。既存の `recordKind=item`・organization・hierarchy・manual contract・`requestX − 6.9pt`・MOF を candidate 生成の教師にしない。item detector の採用規則は次研究で事前登録する。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json`: `4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/extraction-baseline.json`: `89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/reconciliation-result.json`: `2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904`
- `tests/fixtures/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`: `4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1`
- `tests/fixtures/budget-request-hierarchy-failure-isolation/2024/transition-evaluation.json`: `b5283cdf6ea918f4817eb3816bc4922f0640c9bacf5d1b93048a8215fe55bacd`
- `tests/fixtures/budget-request-hierarchy-failure-isolation/2024/off-diagnostic.json`: `9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562`
- `tests/fixtures/budget-request-pdf-item-candidate-count/2024/candidate-count.json`: `35ffc096496ff9af7ab62ac5848b2ddef19ae0211f441193bf05598e7990d508`
- `tests/fixtures/budget-request-pdf-item-candidate-count/2024/mof-exact-name-diagnostic.json`: `3a731169b4e826faab10d0110c622e95fa5942c06181c9c5cda2dd18a296855d`
- `tests/fixtures/mof-jikou-normalized/2024/202411001-integration-evaluation.json`: `066dc9cd35e7ab301b409491206c48b4de9a582bb72a0c48c045e65a7cf2973e`
- `scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts`: `50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7`
- `scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts`: `39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262`
- `scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts`: `da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a`
- `scripts/pipeline-v2/lib/stable-id.ts`: `038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5`
- `scripts/pipeline-v2/lib/budget-request-item-candidate.ts`: `fd51578a12c3fbd72660ae054a539cd5dc25b6d17cd288cacf9bd2609b8dc892`
- `scripts/pipeline-v2/lib/budget-request-pdf-page.ts`: `575f667cbd067a62822dfb7b9c0accc826df9edb158911f43305a2339d0461bd`
- `scripts/pipeline-v2/lib/budget-request-field-resolver.ts`: `758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224`
- `data/normalized/mof/fy2024/budget-jikou.jsonl`: `a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e`
- `docs/tasks/20261005_1900_Budget_Request_Header_Support_Provenance_Isolation_Result.md`: `41c3e4325d7a23eea97d4187aaa5d13e8ad2d6ec6ecb1f71afcaaade72e3d7e6`
`budget-jikou.jsonl` と MOF 関連 artifact は Phase B でのみ読む（Phase A の code path は参照しない）。

## 2. Phase 0: mechanism の確認結果（code evidence。実装前）
- **入力 row**: frozen の baseline extraction artifact（`data/work/budget-request-corpus-baseline/2024/<slug>/` の segment ごとの records。row-local な FieldResolver 出力: SourceToken → TableGeometry → LogicalRow）。hierarchy 付き区間（8 PDF の `hierarchy_enabled` segment）は直前研究と同じく hierarchy 非依存の OFF artifact に置き換える（`scan-budget-request-item-candidates.ts` と同じ読み込み・hash 照合）。hierarchy の node / edge / level / root は使わない。新たな PDF 抽出はしない。
- **NNN**: 既存 lexical 定義 `^\d{3}$`（`budget-request-item-candidate.ts` の `RE_ITEM_CODE`）の plain 3 桁 code。code の source は `rowLocal.code`（status = resolved）、codeX = `rowLocal.code.evidence.bboxUnion.xMin`。
- **request exclusion**: record の `recordKind === 'request'`（行頭の request 番号 + code という row-local な lexical 観測で、null hierarchy では hierarchy / MOF / manual contract に依存しない）を request-shaped とし、primary からは除く。`recordKind = item` は参照しない。
- **名称**: `rowLocal.name`（FieldResolver の row-local。code の後ろ・金額列より前の同一 row の source token から構成、hierarchy 非依存）。status が resolved でなければ `name_unavailable`（candidate は消さない）。nameNormalized = `normalizeKey`（NFKC + 空白除去。`budget-request-mof-reconciliation.ts`、既存 frozen normalization）。
- **金額列**: 既存 TableGeometry の column band に基づく `rowLocal.previousBudget` / `requestedBudget` / `difference` の status。numeric source token が band にあり resolved のものを amount evidence とする（blank は 0 にしない・全列が埋まることは要求しない）。列ごとに bit を保存。他の既存 schema 上の金額列は無い（sign は列の付属）。新しい x 閾値は作らない。
- **縦罫線**: 既存 rule-line 研究の `extractDrawingPrimitives`（pdf.js operator list の `constructPath`、CTM 追跡、左上原点）と `mergeVerticalRules`（stroke の垂直線分を x 0.01pt 丸め・y 隙間 0.01pt で merge）をそのまま再利用。長さ・線幅で除外せず、page の全 merged vertical rule を対象とする。OCR / raster は使わない。

## 3. Primary structural universe（罫線の有無とは独立）
次を満たす record を primary structural row とする: (1) baseline で当該 PDF の抽出が成功している、(2) request-shaped でない、(3) code が resolved で `^\d{3}$`、(4) 名称 status は問わず（resolved でなければ name_unavailable として保存）、(5) previousBudget / requestedBudget / difference のいずれか 1 つ以上が resolved（numeric source token あり）。その後、罫線で `rule_linked` / `rule_unavailable` / `rule_ambiguous` / `unavailable_rotate90` に分類する。罫線が取れないことで candidate を消さない。
- **left rule**: candidate の codeX より左（rule.x < codeX）にある merged vertical rule のうち、row bbox（`anchorBBox`）の vertical midpoint `(yMin + yMax) / 2` を rule の y 区間 [yMin, yMax]（端を含む）が含むものを eligible とし、eligible のうち codeX に最も近い（x が最大）ものを `leftRule` とする。eligible が無ければ `rule_unavailable`、最も近い x に複数の merged rule があれば `rule_ambiguous`。
- **距離**: `ruleToCodeDistance = codeX − leftRuleX`（> 0）。距離に閾値は置かない。raw と 0.001pt 丸め・0.1pt 丸めを保存し、primary aggregation key は 0.1pt 丸め。全 distance value を machine-readable に保存し、long tail を削らない。
- **rotate**: page の rotate が 0 でない場合は `unavailable_rotate90`（新規対応しない）。baseline で rotate=90 のため抽出が成功しない PDF は coverage gap（`unscannable_rotate90`）として数える。

## 4. Row-level artifact（candidate ごと）
candidateId（`<localPath>|p<page>|r<logicalRowIndex>`）・localPath・pdfSha256・account（general / special）・ministry（publisherAuthority）・page・logicalRowIndex・requestShaped（常に false）・codeRaw / codeNormalized / codeX・nameRaw / nameNormalized / nameStatus / nameTokenRefs・amount evidence（previous / request / difference の bit と status、amountTokenRefs）・ruleStatus・leftRuleX / YStart / YEnd / lineWidth（merge 後の線幅一覧）/ sourceRefs（merge 元 path index）・ruleToCodeDistanceRaw / 001 / 01・rowBBox・sourceTokenRefs。

## 5. Phase A（source-only）と gate
MOF・`budget-jikou.jsonl`・MOF の項コード / 名称・existing `item`・organization・hierarchy・manual contract / range・existing item 97 を教師にした閾値・`requestX − 6.9pt`・previous candidate 数・page header の意味・人手の意味判定を使わない。出力: coverage（PDF / page、evaluable / unavailable 別）、structural row 数（rule 状態別・name 状態別・amount evidence パターン別・account 別・PDF 別・ministry 別）、`rule_linked` の距離分布（raw の範囲・0.001 / 0.1 丸め別の件数・PDF 数・account 内訳・amount evidence パターン）。
**gate**: candidateId duplicate = 0、source provenance loss = 0、leftRuleX < codeX、distance > 0、選んだ leftRule が eligible 中で codeX に最も近い、rule の raw provenance あり、code / name / amount が source token に遡れる、Phase A の code path が hierarchy / manual contract / MOF を参照していない（source scan test）、再実行で byte 一致。違反があれば Phase B に進まない。Phase A の artifact と生成 script の SHA-256 を保存して commit（freeze）する。MOF diagnostic は freeze 前に実行しない。

## 6. Phase B（freeze 後のみ MOF を読む）
- MOF 項: `budget-jikou.jsonl` の distinct `parentSectionId`（一般会計。sectionCode・sectionName・ministry・organization を保持）を再計数し **784** でなければ STOP。
- 突合（一般会計 candidate のみ。code は MOF の sectionCode と、名称は `normalizeKey` 後の sectionName と完全一致。fuzzy・部分一致・句読点除去の追加・synonym・人手補正は行わない）。分類の優先順: `name_unavailable`（nameStatus ≠ resolved）→ `code_name_exact_unique`（code と名称がともに一致する MOF 項がちょうど 1）/ `code_name_exact_ambiguous`（2 以上）→ `name_exact_ambiguous`（名称一致の MOF 項が 2 以上で code 一致なし）→ `name_exact_code_mismatch`（名称一致が 1 で code 不一致）→ `code_exact_name_mismatch`（code 一致があり名称不一致）→ `no_exact_match`。特別会計の candidate は `special_account_not_evaluated`。MOF の既存 stable key（parentSectionId）を保存。
- distinct MOF coverage: `distinct MOF item exact-overlap count / 784`（recall と呼ばない。784 を PDF 側の正解母数とは仮定しない）。candidate row 数と区別する。primary = code+name exact（unique または ambiguous）の candidate が 1 つ以上ある distinct MOF 項、secondary = unique の candidate のみ。
- 最重要出力: 0.1pt distance bucket ごとに candidate rows・general rows・code+name exact rows・distinct MOF items・exact-overlap share（distinct MOF / 784）・PDF 数・ministry 数。MOF exact-overlap が存在する distance について unique / ambiguous / name unavailable / no exact match / amount evidence pattern。MOF 一致率の高い distance だけを残さず、全 distance を保存する（`rule_unavailable` / `rule_ambiguous` / `unavailable_rotate90` は別行）。
- MOF 側 unmatched inventory: 784 項それぞれを (a) code+name exact の candidate あり、(b) 名称一致のみ、(c) code 一致のみ、(d) candidate universe に対応候補なし、に分類（ministry / account 付き）。(d) を「PDF から取りこぼした」とは断定しない。
- secondary（Phase B 後。candidate rule の変更には使わない）: existing hierarchy item 97（baseline の ON records の `recordKind = item`）、previous range-local candidate、previous 一般会計 candidate（`candidate-count.json`）、previous MOF exact diagnostic との重なり（both / new-only / old-only、old-only の failure reason、new-only の距離と MOF 状態）。

## 7. 記述的結論（機械判定の閾値は置かない）
必要なら `RULE_DISTANCE_SINGLE_DOMINANT_PATTERN_OBSERVED` / `RULE_DISTANCE_MULTIPLE_ITEM_PATTERNS_OBSERVED` / `RULE_DISTANCE_NOT_INFORMATIVE_FOR_MOF_OVERLAP` / `RULE_LINE_COVERAGE_INSUFFICIENT` / `MEASUREMENT_INVALID` を結果後に記述的に使うが、事前登録済みの機械判定として扱わない。距離パターン（8.6pt など）を事前に固定しない。

## 8. 禁止・STOP・commit
production item detector・DocumentHierarchy 改善・level-frame / header-support の追加研究・manual contract 修正・production FieldResolver / recordKind 変更・事項 detector・rotate=90 新規対応・MOF fuzzy・MOF を教師にした distance 閾値・人手の意味分類・MOF 784 が PDF に存在すると仮定すること、結果を見た後の candidate 条件 / rule 選択 / distance bucket / amount 条件 / normalization の変更は行わない。frozen hash 不一致・MOF 784 不一致・production diff・既存 pipeline で一意に決められない場合（新しい x 閾値が必要など）は STOP。測定バグは初回出力を保存し独立 commit で修正して開示する。
Commit A（本書）→ B（Phase A 実装・artifact の freeze）→ C（Phase B MOF diagnostic）→ D（secondary・result・INDEX）。PR は作成しない。
