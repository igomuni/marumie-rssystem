# MOF 未一致 59 項の source failure-class inventory — protocol（全件確認の前に固定）

指示: `docs/chats/20261001_2104_概算要求対応の検討/20261006_0648_Budget_Request_Unmatched_59_Source_Failure_Inventory.md`。MOF 一般会計 name-only exact は 725 / 784、unmatched 59。新しい抽出 rule・anchor・continuation 変更・OCR・drawing-path 認識・MOF に合わせた補完・filename / page / name の hard-code は行わず、残り 59 項を 1 項ずつ source evidence で分類する inventory のみ。production と `data/download/` は変更しない。

## 1. 依存 artifact（実行時に hash guard）
- `tests/fixtures/budget-request-mext-continuation/2024/baseline.json`: `b8362971a408304d37065a753183a2c3b0e969db40797de004673794b6ad4a90`
- `tests/fixtures/budget-request-mext-continuation/2024/after-evaluation.json`: `005df9f4b059855bdce8fa43a3b00e38af54d0802af12d8c9796a6115298528f`
- `tests/fixtures/budget-request-mext-continuation/2024/continuation-fired.jsonl.gz`: `263e0514a39238faceb77a8cf3c5cba6f47429e5f78e71f7a9f39512ab41365c`
- `tests/fixtures/budget-request-mext-continuation/2024/new-exact-matches.jsonl.gz`: `b9e6b20c5de797c9a108b15ec98204df8b2bf80b5698ad5c1c0e1f417f408cd6`
- `tests/fixtures/budget-request-item-layout-anchor/2024/profile-candidates.jsonl.gz`: `bbd828b2d0005bde638b3f22aa60a4db3056ed502012efdce3c8502cd50f4ce1`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-universe.jsonl.gz`: `50fb9ac1545e96edfc0b9180b37084479569c43db9d690c7229b13dfec063f66`
- `tests/fixtures/budget-request-rule-8p6-rotate90/2024/phaseA-summary.json`: `0d3d02b0a04eb850f7e69c74bb4693faf9f4d2216dabaff69e736ba96be792fa`
- `tests/fixtures/budget-request-full-corpus-baseline/2024/corpus-manifest.json`: `4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a`
- `scripts/pipeline-v2/lib/budget-request-display-page.ts`: `0c31f949cd59ef417ec0e07143faa792e2f4d6deb48fc92a841fc81749477390`
- `scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts`: `da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a`
- `scripts/pipeline-v2/lib/stable-id.ts`: `038d26cac9b53ff6a73e9e83a1f5a39b67c93b8f1dbd445fa97206103b1b03c5`
- `data/normalized/mof/fy2024/budget-jikou.jsonl`: `a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e`
- `docs/tasks/20261006_0735_Budget_Request_MEXT_Item_Name_Continuation_Result.md`: `39f883445f9a39a113c9e15a8753f48888edd76779de6e2602f73cc6f63a9f06`
## 2. baseline
前回 after（既存 8.6pt candidate 973 + 内閣府 profile candidate 65、continuation 発火 9 件の名称更新を適用）を同じ突合関数で再計算し、exact 725・unmatched 59・文科省 unmatched 5・所管別件数を再現する（exact 725 と unmatched 59 の MOF row identity を保存）。再現できなければ STOP。「子ども・子育て支援年金特別会計へ繰入」が unmatched に残っていたら STOP。母集団はこの 59 項のみ。

## 3. source の確認方法（全 82 PDF。新しい抽出 rule は作らない）
- 各 PDF の各 page を、既存の pdf.js 抽出（rotate ≠ 0 は表示向きに座標正規化する既存の research 経路）で token 化し、MOF 正規化名称（`normalizeKey` = NFKC + 空白除去）を page の token 連結 text から検索する。ヒットごとに: 単一 token の全体一致か・複数 token にまたがるか・またがる場合に名称セル内の継続か（各 token の xMin が先頭 token と 0.25 × 基準フォントサイズ以内で揃い、y が 0.75〜1.5 × フォントサイズ刻みで下がる）・同じ行の左隣に plain 3 桁 code があるか（item らしい行か）・既存 candidate（現在の candidate population）が同じ行にあるか・candidate の名称状態、を記録する。MOF 名になるよう別行・別セル・別 page を恣意的に連結しない。
- PDF の representation（PDF 単位）: token 総数・ASCII 数字 token 数・token のない page 数・rotate の内訳・（token が無い PDF のみ）サンプル page の画像 / path operator 数から、`TEXT_GEOMETRY_AVAILABLE`（token と数字が取れる）/ `TEXT_PRESENT_UNICODE_UNRESOLVED`（token はあるが ASCII 数字が 0）/ `DRAWING_PATH_TEXT`（token 0・画像なし・path 大量）/ `RASTER_IMAGE_ONLY`（token 0・画像が主）/ `OTHER` / `UNKNOWN`。

## 4. 分類（1 MOF row = 1 record、結果を見て定義を変更しない）
- **sourceAssignment**: `SOURCE_ASSIGNMENT_RESOLVED`（名称が item らしい行〔左隣に plain 3 桁 code〕で見つかり PDF・page が確定）/ `SOURCE_ASSIGNMENT_PARTIAL`（名称は読める PDF に存在するが item らしい行とは確認できない、または所管レベルの証拠のみ）/ `SOURCE_ASSIGNMENT_UNRESOLVED`。所管が同じことだけで PDF を確定しない。確定できなければ sourcePdfPath / page は null（推測値を入れない）。
- **sourceFullNameStatus**: `SOURCE_FULL_NAME_SINGLE_LINE`・`…_MULTILINE_CONTIGUOUS`・`…_PRESENT_ELSEWHERE`・`…_ABSENT`（「検索で見つからない」だけでは付けない。名称の存在が確認できる評価可能な source を特定でき、かつ前回までの独立確認〔文科省 5 項の `SOURCE_FULL_NAME_ABSENT`〕など positive な evidence がある場合のみ）・`SOURCE_TEXT_UNREADABLE`（所管に対応しうる PDF が読めない representation の場合）・`SOURCE_FULL_NAME_UNRESOLVED`。
- **currentCandidateStatus**: `CANDIDATE_PRESENT_NAME_EXACT`（出たら baseline / join を疑う）・`CANDIDATE_PRESENT_NAME_MISMATCH`・`CANDIDATE_PRESENT_NAME_UNAVAILABLE`・`SOURCE_ITEM_PRESENT_CANDIDATE_MISSING`・`SOURCE_ITEM_NOT_OBSERVED`・`CANDIDATE_STATUS_UNRESOLVED`。
- **primary failure class（1 つ）**: F1 `REPRESENTATION_BLOCKED`（drawing-path / raster / Unicode 復号不能で現 pipeline では評価不能。所管レベルの対応しか示せない場合は assignment を PARTIAL とし item レベルの assignment は主張しない）、F2 `SOURCE_FULL_NAME_ABSENT`、F3 `SOURCE_ITEM_PRESENT_CANDIDATE_MISSING`（source 上に項として存在し名称も読めるが candidate に入らない）、F4 `CANDIDATE_PRESENT_NAME_FAILURE`、F5 `SOURCE_SCHEMA_DIFFERENCE`（対応は確認できるが単純 full-name exact では同一表現にならない。意味的同一性を推測だけで認定しない）、F6 `SOURCE_ASSIGNMENT_UNRESOLVED`、F7 `OTHER_EVIDENCED`、F0 `UNRESOLVED`（evidence 不足。無理に分類しない）。
- **recoverability**: `RECOVERABLE_WITH_CURRENT_TEXT_GEOMETRY`（F3 / F4 など、通常 text + geometry で source に項があり名称も読める）・`REQUIRES_NEW_REPRESENTATION_SUPPORT`（F1）・`NOT_CURRENTLY_RECOVERABLE_FROM_SOURCE`（F2）・`UNRESOLVED`。

## 5. artifact・routing
`unmatched-59-inventory.jsonl.gz`（59 件全件。mofRowId・mofCode・mofNameRaw / Normalized・mofOrganization・sourceAssignmentStatus・sourcePdfPath・sourcePage・sourceEvidence・pdfRepresentationClass・sourceFullNameStatus・currentCandidateStatus / Name / Page・failureClass / Detail・recoverabilityClass・evidenceRefs）、`unmatched-59-summary.json`（by 所管 / assignment / representation / full-name / failure class / recoverability、各 recoverability 件数）、`source-pdf-inventory.json`（確認した全 PDF の path・SHA-256・page 数・rotate の内訳・representation・assigned する MOF row・evidence）。行別 inventory を freeze してから集計し、F3 と F4 は全件を一覧する。次研究の routing は 1 つだけ: Route A（F3 ≥ 1 件 → 共通 physical pattern を調べる）、Route B（F4 ≥ 1 件 → 名称 failure を分離）、Route C（通常 text / geometry の候補がほぼ無く representation blocker 支配 → drawing-path 等を別研究）、Route D（unresolved が多い → source assignment を先に解く）。複数成立しても 1 route。
validation: baseline 725 / 784・unmatched 59・duplicate / missing inventory row 0・provenance 欠落件数の明示・byte 一致の再実行・tsc・lint・full vitest・production diff 0・`data/download/` diff 0。commit: protocol → 実装 freeze → 行別 inventory → summary / routing → result。PR は作成しない。
