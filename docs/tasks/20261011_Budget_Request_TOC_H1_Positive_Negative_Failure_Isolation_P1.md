# FY2024 概算要求TOC — H1 Positive / Negative Control Failure Isolation P1

## 目的

PR #418でPDF目視により同一項目の継続と分類されたH1 31件を既知Positiveとして固定し、FY2024 TOC全82物理ページからRaw Text構造が近いNegative / near-miss対照を事前固定した手順で探索する。Raw Textだけで所有関係を区別できるか、不足するsource evidenceは何かを観測する。

本研究はpost-hoc development分析であり、精度・汎化を評価しない。ここで目視した候補・ページを未使用のheld-outデータとして扱わない。GT作成、parser/regex/assemblyの変更、最終TOC CSV生成、本番接続は禁止する。

## Source / fixed conditions

- PR #416: Column Segmentation / Primitive Extraction v1
- PR #417: Minimal Assembly v0
- PR #418: Ownership Failure Isolation P0
- 固定Positive: #418のH1 / SAME_ITEM 31観測。ID・primitive・provenanceを維持する。
- 母集団: structure inventory上のTOC 82物理ページ、55 PDF（DIRECT 55 / INHERITED 27）。
- Source of truth: frozen #416/#417 outputs、#418 classification、manifest照合済みPlain Text、PDF原本。
- Negative探索、pair shape、sample、visual review、feature比較の契約: `tests/fixtures/budget-request-toc-h1-control-analysis/2024/preregistration.md`。

## Discovery / review policy

最初に82ページの全 ordered `title_page → later title_only_candidate` pairを機械的に列挙し、#417のexact H1 pairs、固定near-shape strata、out-of-shape pairsを分類する。候補集合・選択ペア・件数・canonical hashをPDF Ownership review前にcommitする。N1 exact-shape setが固定Positive 31件と一致するならN1不在は定義上の制約であり、安全性の証拠にしない。N2–N5はnear/other controlsでありmatched-shape negativesではない。

選ばれたnear controlsはRaw Textを先に確認し、その後PDFを目視する。Ownershipとevidence sufficiencyを別軸で記録し、観察事実と解釈を区別する。分類不能・意見不一致は保持し、多数決で解消しない。

## Freeze boundary

実装前に固定する対象はPositive inventory、Negative discovery procedure、classification contract、比較方法、provenanceである。これらは自動Assembly規則ではない。候補母集団、sampling、hashのcanonical bytesを変更せず、#416/#417/#418 artifactsを変更しない。

## Expected outputs

Git管理下にPositive inventory、探索契約、全pair censusと選択一覧、Ownership/evidence review、feature比較、Failure isolation報告を保存する。監査可能な補助scriptのみ追加できる。Git管理外の再現用exportは`data/work/exports/`に保存し、入力・出力hashを記録する。

## Review status

前提確認とPositive inventoryを完了し、Discovery contractの独立read-onlyレビューが通過した。Positive inventoryと探索契約をfreezeするcommit後にのみnegative candidate enumerationを開始する。

## Mechanical candidate census freeze (before PDF review)

- 82/82 TOC pages and 55/55 PDFs accounted for; DIRECT 55 / INHERITED 27.
- All source PDF/TXT hashes matched the frozen #417 archive and inventory page hashes.
- Full ordered-pair census: 1,001 pairs: EXACT_H1_SHAPE 31, UNKNOWN_SIDE 21, KNOWN_SIDE_MISMATCH 439, SAME_SIDE_INTERVENING_BARRIER 72, SAME_SIDE_INTERVENING_PRIMITIVE 438, OUTSIDE_H1_SHAPE 0.
- Exact H1 pair membership equals the frozen 31 positives. Therefore N1 is unobservable by definition in this frozen exact-shape set; this is not evidence of safety or discrimination.
- Fixed visual sample: 67 near-shape pairs: UNKNOWN_SIDE 4, KNOWN_SIDE_MISMATCH 32, SAME_SIDE_INTERVENING_BARRIER 7, SAME_SIDE_INTERVENING_PRIMITIVE 24. The independent second-review sample contains 7 IDs (ceil(10% of 67)). No visual ownership review had started at the time this census was frozen.
- Census SHA-256: `c75a7bf34dad932ea50bb2faa373eb52f3c0cd81144d4eef75f50d0beaf0ea5c`.
- Selected-list SHA-256: `394153dbcb6468323869d384a562c101de1ae2e3251f26d0c4216456508397a4`.
- Second-review list SHA-256: `28d42b67ad405a2597060e87a025f68d4603c2c1d05ec8074d18b0cfe25b2bb7`.
- The generated census, sample list, second-review list, summary, and validation reproduced byte-for-byte on a second run. An independent mechanical audit found and prompted correction of a validation predicate that initially checked census size instead of selected-sample size; it then confirmed all selection counts and hashes.
- Reproduction utility: `scripts/research/toc-h1-control-census.py`. It reads the frozen #417 ZIP and verifies source PDF/TXT hashes; it does not inspect PDFs visually or make ownership decisions.

## Source review and comparison results

### Fixed population and accounting

- Frozen Positive inventory: 31 #418 H1 `SAME_ITEM` observations, 12 PDFs / 13 physical pages. Inventory ID list and source spans match the frozen #418 records; all 31 remain unchanged.
- Full ordered-pair census: 1,001 pairs across the fixed corpus. Exact H1 shape: 31; `UNKNOWN_SIDE`: 21; `KNOWN_SIDE_MISMATCH`: 439; `SAME_SIDE_INTERVENING_BARRIER`: 72; `SAME_SIDE_INTERVENING_PRIMITIVE`: 438; `OUTSIDE_H1_SHAPE`: 0.
- The 31 exact-shape pairs are definitionally identical to the pre-reviewed Positive set. Therefore N1 was not observed; this gives no evidence of safe automatic assembly.
- The frozen near-shape sample has 67 controls: 4 unknown-side, 32 known-side mismatch, 7 same-side/intervening barrier, and 24 same-side/intervening primitive. All 67 received a primary visual review; 903 unsampled near pairs remain unreviewed. N2–N4 are near controls, not matched-shape negatives.

### Ownership review

Primary visual review classified all 67 selected controls as `DISTINCT_ITEMS`. Primary labels were N2 18, N3 19, N4 30. Evidence sufficiency was recorded as `PDF_VISUAL_REQUIRED` for 64 and `RAW_TEXT_SUFFICIENT` for 3.

A second reviewer independently checked the frozen 7-case subset. Ownership matched in 4 cases and differed in 3:

- Reconstruction Agency p3: primary `DISTINCT_ITEMS` / N2; second review `AMBIGUOUS`.
- MOF `2024tousi_2.pdf` p2: primary `DISTINCT_ITEMS` / N2; second review `SAME_ITEM`.
- NPA p2: primary `DISTINCT_ITEMS` / N3; second review `AMBIGUOUS`.

No majority vote or silent adjudication was applied. These three cases have integrated status `AMBIGUOUS` pending review; the original two judgments remain in the evidence record. Thus 64 controls remain `DISTINCT_ITEMS` after integrating the double-reviewed subset, and 3 preserve disagreement. The second reviewer used the free-text evidence label `sufficient`; the report preserves it as reviewer-reported sufficiency without converting it into the preregistered `RAW_TEXT_SUFFICIENT` or `PDF_VISUAL_REQUIRED` categories.

### Raw Text features

The 31 Positive pairs all have a one-line source index gap and known equal sides for 30 pairs; one pair has unknown side. The selected control sample also contains one one-line-gap pair, a cross-column case from Reconstruction Agency p4. Positive and control ranges overlap for line gap, leading U+0020 counts, other-whitespace flags, source offsets, exact page references, H2-target membership, and page boundary status. Page-boundary column offsets have missing values (1 Positive, 4 controls), so that numeric feature is insufficient for complete separation.

Per the frozen contract, side-pair, intervening-unit structure, and primitive kind/raw fragment are marked `NOT_APPLICABLE` as separability features because they define strata or the pair itself. These features must not be presented as independent discrimination evidence. Range overlap is a descriptive check only; it is not a classifier or generalization test.

### Interpretation and limits

The frozen exact H1 candidate set contains only the already reviewed Positive cases. The available controls therefore cannot answer whether a same-shape H1 candidate can be separated into true and false continuations. Some near controls share local features with positives, including immediate raw-line adjacency, but differ on frozen shape conditions. The review shows that nearby title fragments often visually belong to other rows, headings, or the opposite column; it does not establish a new Raw Text rule for ownership.

Evidence is insufficient to preregister a safe automatic H1 assembly rule. The next study could examine whether a distinct, observable relationship primitive (such as column-row/region association) is needed, or retain unresolved status. This is a research option, not an adopted implementation direction.

## Validation and artifacts

- Full source PDF/TXT hashes match the frozen #417 archive and raw-text manifest. All 98 reviewed Positive/control pairs had both source primitive spans checked against the original Plain Text: 196 source fragments checked, 0 UTF-16 span mismatches.
- Census/sample generation reproduced byte-for-byte before visual review; fixed hashes are recorded in the census validation. Visual review remains human/worker evidence and is not treated as deterministic program output.
- No parser, regex, assembly rule, GT, frozen #416/#417/#418 artifact, source PDF, or Raw Text was modified.
- Full application test suite was not run: this change is research documentation and read-only inventory/review tooling. The four Python research utilities passed `py_compile`; the census, review integration, and package utilities were run to regenerate the inventories and package.
- Export: `data/work/exports/20261011_FY2024_TOC_H1_Positive_Negative_Failure_Isolation/` (outside Git). Review evidence, rendered pages, frozen census, classification, feature profiles, and hash manifests are included.
- ZIP: `20261011_FY2024_TOC_H1_Positive_Negative_Failure_Isolation.zip`, SHA-256 `fa220c2f84d597874701e70014ba92298fc671d17415239d7f169edf84be8bdd`.

## Research disposition

This is a completed post-hoc development control study, not a formal held-out evaluation. It did not prove that any observed feature is sufficient for automatic assembly. N1 was not observed; 3 of 7 independent review cases retain ownership disagreement. H1 automatic assembly remains a user/ChatGPT research decision. No parser or production change is proposed by this study.
