# 項の物理 anchor 拡張による MOF 名称 exact coverage の増加 — protocol / baseline

指示: `docs/chats/20261001_2104_概算要求対応の検討/20261005_2231_Budget_Request_Item_Coverage_Layout_Anchor_Implementation.md`。診断で終わらせず、確認済みの物理構造を最小限の変更として既存の full-corpus item candidate 抽出へ反映し、MOF 一般会計 784 項に対する name-only exact coverage が実際に増えることを frozen before / after で確認する。production（DocumentHierarchy / FieldResolver / recordKind / item detector）は変更しない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-summary.json`: `0d3d02b0a04eb850f7e69c74bb4693faf9f4d2216dabaff69e736ba96be792fa`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-universe.jsonl.gz`: `50fb9ac1545e96edfc0b9180b37084479569c43db9d690c7229b13dfec063f66`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-freeze-manifest.json`: `c1450867e9e50112b55148c256e84db4ee83f1539dab38bc2bcdb217d0ecc671`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseB-diagnostic.json`: `080419b590f183152fe9a49e5d0454a284c82b3c98ce41d1ccfe4fd7479b3fac`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseB-exact-matches.jsonl.gz`: `6dcdf24ff664550ed07aea6dc05907beae53bed9514dc83fda4da829c609ec78`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json`: `4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a`
- `scripts/pipeline-v2/lib/budget-request-rule-line-item-population.ts`: `d0ef587ffc9c76e7e8785c63fe93e3a7ee73b17736ebf17e073e714e14fbe247`
- `scripts/pipeline-v2/lib/budget-request-rule-8p6-candidate.ts`: `d6b3fc5eb423f085067e7d302070ff4e099efec7c02c271bdf1b29b14788fd31`
- `scripts/pipeline-v2/lib/budget-request-display-page.ts`: `0c31f949cd59ef417ec0e07143faa792e2f4d6deb48fc92a841fc81749477390`
- `scripts/pipeline-v2/lib/budget-request-drawing-primitives.ts`: `50f62f5c1e227452f1e6de4c72821ced6b6402835a048d53fb497909fb675cc7`
- `scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts`: `39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262`
- `scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts`: `da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a`
- `scripts/pipeline-v2/lib/stable-id.ts`: `038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5`
- `data/normalized/mof/fy2024/budget-jikou.jsonl`: `a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e`
- `data/normalized/mof/fy2024/budget-items.jsonl`: `56b82f5aefcad43848b9f21994ca90ea49e024b56168ebd28f5559333f4c7c93`
- `docs/tasks/20261005_2130_Budget_Request_8p6pt_Full_Corpus_With_Rotate90_Result.md`: `a75a21d4453f8854d73fd12a277182872024cd4bdb24d7694eb23db2f035f5bb`
## 2. baseline（変更前に freeze）
現在 branch の既存評価（Phase B、`research/budget-request-rule-8p6-full-corpus-with-rotate90`）を baseline とする: MOF total 784・exact-covered MOF rows 661・unmatched 123・内閣府 unmatched 66・candidate rows（973、うち一般会計 710）・PDF 別 candidate 数・PDF 別 exact 数・unmatchedMof 全件・artifact hash・candidate を持つ PDF の path と SHA-256 を `baseline.json` に保存する。既存 Phase B の再実行が byte 一致することを確認する。再現できなければ STOP。

## 3. one change（これだけを変更する）
PDF / layout によって項の物理 anchor が 1 段シフトしている場合に、**source evidence で確認した** layout profile の項 anchor から plain 3 桁 NNN + 名称を item candidate として取得できるようにする。対象は確認済みの内閣府 `data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf` のみ（profile の置き場所は research evaluation 内の明示的・決定的な profile。production の architecture は作らない）。
やらないこと: 全 corpus への `8.6 ± 3pt OR 15.53 ± 3pt` の適用、MOF 名称が一致する距離の探索・MOF coverage が最大になる band の選択、PDF filename だけを根拠にした意味の hard-code、15.53 のような値の hard-code（値は source から導出する）。

## 4. profile の導出（MOF・名称の意味を使わない。source evidence のみ）
- 入力（対象 PDF 全 page）: (a) FieldResolver の row-local records のうち plain 3 桁 code の非要求 row（`rowLocal.code`）と request-shaped row（code `NN-NN`）、(b) 各 row の縦罫線 link（既存の `selectLeftRule`: codeX より左・row の vertical midpoint を含む最近傍の merged vertical rule）と `deltaX = codeX − ruleX`、(c) page の source token から検出する「組織計」marker（同じ縦位置に token「組」「織」「計」が揃う行）。
- level の割り当て（indent 順だけで決めない）: 文書順（page → y）に走査し、「組織計」marker の後（および文書の先頭）の最初の plain 3 桁 row を **組織**、それ以降の plain 3 桁 row を **項**、request-shaped row を **事項**とする。
- profile = {source path・source sha256・ruleX（linked rule の x の最頻値）・組織 / 項 / 事項の deltaX（各 cluster の最頻値）・cluster の件数と spread・anchor tolerance・evidence（marker のある page・各 level の row 件数・代表 row）}。
- 有効条件（sanity、結果を見て変更しない）: 3 cluster が空でなく、deltaX が 組織 < 項 < 事項 の順で、各 cluster の spread ≤ 0.1pt、linked rule の x が一意（0.01pt 以内）。
- **tolerance は source から導出**: 隣り合う level の中心間距離の最小値の半分（= 項と組織・項と事項を分ける境界）。MOF や coverage を見て調整しない。

## 5. 項 candidate の抽出（profile PDF のみ）
profile PDF の全 page で、request-shaped でない plain 3 桁 code row のうち、link した罫線の x が profile の ruleX（0.01pt 以内）で、`|deltaX − 項 deltaX| ≤ tolerance`、かつ名称が非空のものを項 candidate とする。名称は FieldResolver が解決しない（文字間が空いた表記）ため、source token から決定的に構成する: 同じ行（縦中心が row bbox の y 区間内）の token のうち、code token の右端より右・次の縦罫線（code の右側で最も近い罫線）より左のものを x 昇順に連結（推測・補完なし）。normalized name は frozen の `normalizeKey`（NFKC + 空白除去）。保存: PDF path・filename・page・raw row text・nameRaw・nameNormalized・plain 3 桁 code・ruleX・codeX・deltaX・profile / anchor provenance・candidateId。
integrity: 組織の行・事項の行を項として混ぜない、duplicate なし、名称非空、deltaX が 項 cluster 内。直前測定の 65 行にならない場合は閾値を調整せず原因を報告する。

## 6. MOF 再照合（candidate freeze 後）
前回と同じ name-only exact（`normalizeKey`、code 不問、一般会計 784 項）。before / after / delta（exact-covered MOF rows・unmatched・distinct normalized names・candidate rows）。新規に exact になった MOF 項を全件保存。53 や 714 は hard-code しない。
regression: before で exact だった MOF row の loss、既存 8.6pt candidate の消失、既存 candidate の名称変更、unrelated PDF の candidate 変化（期待値はすべて 0）。予期しない regression があれば STOP し、別 rule を足さない。

## 7. 文科省 `施設整備費` 系
今回 coverage に追加しない（名称連結 rule は実装しない）。after の unmatched inventory で、文科省の未一致を、source（`_03.pdf`）に full MOF name が (a) 単一 token に literal で存在 / (b) 隣接 token をつなぐと存在（source 上で分割）/ (c) full name が存在しない（`SOURCE_FULL_NAME_ABSENT`）に区別して記録する。MOF artifact に当初予算額・要求額が明示されていれば診断列として併記するが、「当初予算 0 → 概算要求に項がない」という因果は確定しない。

## 8. GO 条件・commit
GO: baseline 661/784 の再現、profile の再現、項 candidate の安全な取得、coverage が 661 より実際に増える、loss 0、unrelated PDF の変化 0、provenance 保存、deterministic rerun、tests / typecheck / lint pass。期待値 53 は GO 条件ではない。regression があれば STOP。
commit: baseline / protocol → layout anchor 実装 + test → frozen after 評価 → result。PR は作成しない。production code と `data/download/` は変更しない。
