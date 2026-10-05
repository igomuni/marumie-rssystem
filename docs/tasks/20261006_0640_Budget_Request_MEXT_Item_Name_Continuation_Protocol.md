# 文科省 複数行項名称の source-only continuation 連結による coverage 改善 — protocol / baseline

指示: `docs/chats/20261001_2104_概算要求対応の検討/20261006_0615_MEXT_Item_Name_Continuation_Coverage_Implementation.md`。MOF 一般会計 784 項の name-only exact coverage は 717 / 784（unmatched 67、文部科学省 8）。文科省 `_03.pdf` で source 上に full name の構成文字列が確認済みの 3 項について、現行抽出で exact にならない理由を source evidence で確認し、最小の名称 continuation 連結で一致件数を増やす。production（DocumentHierarchy / FieldResolver / recordKind / item detector）、item anchor の意味、内閣府 `0.pdf` profile、既存 8.6pt candidate 条件、rotate・drawing-path 処理、MOF の normalization、MOF を使った candidate 選別は変更しない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-item-layout-anchor/2024/baseline.json`: `68e601fcd16aab9b92ed685ddb11abe6384133233c9bee1b35eb57c09d766f24`
- `tests/fixtures/budget-request-item-layout-anchor/2024/after-evaluation.json`: `fa216afd5da6b42bc90b1c38eae7090d434fabb98b02853e827eb55905f1a2fc`
- `tests/fixtures/budget-request-item-layout-anchor/2024/profile-candidates.jsonl.gz`: `bbd828b2d0005bde638b3f22aa60a4db3056ed502012efdce3c8502cd50f4ce1`
- `tests/fixtures/budget-request-item-layout-anchor/2024/new-exact-matches.jsonl.gz`: `a7b9f42920ff61dd165585ec011abad5f231fc2b45a67c92adf92f789bd815b0`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-universe.jsonl.gz`: `50fb9ac1545e96edfc0b9180b37084479569c43db9d690c7229b13dfec063f66`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-freeze-manifest.json`: `c1450867e9e50112b55148c256e84db4ee83f1539dab38bc2bcdb217d0ecc671`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json`: `4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a`
- `scripts/pipeline-v2/lib/budget-request-field-resolver.ts`: `758eb8f6afdf45bd39c9853623201a4afbac8e8d6883626149d889335c2bb224`
- `scripts/pipeline-v2/lib/budget-request-logical-row.ts`: `6b4bf396032ba0e8e52b25016ce088e6cc2e7e5f500fd7792b975a61ca370326`
- `scripts/pipeline-v2/lib/budget-request-display-page.ts`: `0c31f949cd59ef417ec0e07143faa792e2f4d6deb48fc92a841fc81749477390`
- `scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts`: `da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a`
- `scripts/pipeline-v2/lib/stable-id.ts`: `038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5`
- `data/normalized/mof/fy2024/budget-jikou.jsonl`: `a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e`
- `docs/tasks/20261005_2310_Budget_Request_Item_Layout_Anchor_Coverage_Result.md`: `1fec71880549c927d9cbeee7b0f6c99ea45afee15a380aa2165d82c46a0ac07e`
対象 PDF: `data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf`（path・SHA-256・page 数は baseline artifact に記録）。原本 `data/download/` は変更しない。

## 2. baseline（変更前に freeze）
frozen の前回 after（`after-evaluation.json`、既存 8.6pt candidate + 内閣府 profile candidate）を baseline とする: MOF total 784・exact-covered 717（MOF row の identity を保存）・unmatched 67・文科省 unmatched 8（`SOURCE_FULL_NAME_ABSENT` 5 / 隣接 token をつなぐと存在 3 の分類を含む）・candidate population（1,038）・artifact hash。candidate と MOF の突合を前回と同じ関数で再計算し、717 / 67 / 8 を再現できなければ STOP。以降の before は 717 / 784。

## 3. 段階
- **Phase A（failure isolation。抽出 rule は変更しない）**: 隣接 token をつなぐと full name が存在する 3 項について、原本の token・logical row・bbox を確認し、full name の物理構成を記録する。この 3 項の位置は MOF 名称で特定する（isolation のみ。rule の形成には使わない）。項ごとに: MOF normalized full name・PDF path / page・項 code・現行の抽出名称・continuation 行の token 列と bbox・logical row 境界と LogicalRow の resolution 種別・continuation が同一表セル（name region）内か・continuation 行に code があるか・直前の項名称に物理的に連続するか・右側の金額列・縦罫線との関係・次の item / request 等との境界。分類は `SOURCE_CONTINUATION_STRUCTURALLY_SUPPORTED` / `SOURCE_CONTINUATION_AMBIGUOUS` / `SOURCE_CONTINUATION_NOT_SUPPORTED`（3 項すべてを supported にすることは前提にしない）。
- **Phase B（continuation rule の preregistration）**: Phase A で supported になった構造だけを対象に、source-only の条件を実装前に `…Continuation_Preregistration.md` へ固定して commit する。MOF 名称との一致を終了条件に使わない（「MOF に一致するまで次行を足す」は禁止）。対象 3 件を filename + page + name で hard-code しない。
- **実装・評価**: preregister した rule を現在の evaluable corpus（既存 8.6pt candidate 全体）に deterministic に適用し、発火した全 candidate の before name・追記した source text・after name・PDF / page / row provenance・発火理由・continuation token の bbox・連結した行数を保存する。発火しない candidate の名称は byte-equivalent に維持する。その後に MOF name-only exact を再評価する（720 を GO 条件にも hard-code にもしない。安全に回収できた分だけ採用）。

## 4. 文科省 `SOURCE_FULL_NAME_ABSENT` 5 項（negative evidence として維持）
今回の rule によってこの 5 項が exact になっていないことを必ず確認する。もし exact になった場合は、source token が実際に連続しているか・離れた行や別の項・別セルを連結していないかを確認し、source evidence で説明できなければ regression として STOP。令和 6 年度金額 0 という MOF 情報は名称生成・continuation 判定に使わない。

## 5. regression gates / GO / STOP
before exact 717 の loss 0・unrelated PDF の item candidate identity の変化 0・item code の変化 0・anchor / deltaX の変化 0・continuation 非発火 candidate の name change 0・source にない文字の補完 0・duplicate 0・provenance loss 0。
GO: baseline 717 の再現、3 項のうち 1 項以上で continuation が構造的に supported、preregistered rule でその名称を連結できる、coverage が 717 より増える、loss 0、negative 5 項を生成しない、unrelated regression 0、deterministic rerun で byte 一致、tsc / lint / tests pass。
STOP: continuation 境界を MOF 名称なしでは決められない・3 項が物理的に同じ failure class でない・既存名称を大量に誤連結する・negative 5 項を生成する・baseline が再現しない・production diff・test failure。STOP 時は別 rule を追加して救済しない。結果を見て protocol / continuation 条件を書き換えない。

## 6. commit
protocol + baseline freeze → failure-isolation artifact + preregistration → continuation 実装 + test → frozen after 評価 → result。PR は作成しない。
