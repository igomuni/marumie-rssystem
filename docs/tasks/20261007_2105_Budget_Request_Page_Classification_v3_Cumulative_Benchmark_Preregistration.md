# 概算要求 Page Classification v3 — Cumulative Pre-Implementation Benchmark Preregistration

classifier 未実装・未評価。新規 visual GT は作らない。本 doc・builder・test を commit した後に mechanical freeze（fixture 生成）を行う。commit 後に threshold・mapping・scope を変更しない。

## 1. 保存する既存結果（不変）

v0・v1・v2 の evaluation design はいずれも `INSUFFICIENT`（v2 は `INSUFFICIENT / STOP`、open-set safety は `NOT EVALUATED`）。v0 classifier specification は frozen のまま変更しない。v0/v1/v2 の candidate・GT・task doc・判定は書き換えない。v3 が ADEQUATE でも、過去判定を GO に読み替えない。

## 2. 設計経緯の開示

v3 は v2 の結果を見た後に設計されている。v2 では STAFFING continuation が 1 row で不足した。既存 v0 GT に continuation evidence が存在することは既に観測済みである。したがって v3 は「未知の結果を予測する fresh evaluation design」ではなく、classifier 実装前に既存 evidence を cumulative benchmark として利用可能かを固定ルールで確認する工程である。threshold を通すために新設したように見えないよう、**threshold は v2 の値をそのまま継承**する。

**手順上の逸脱の開示**: builder の dry-run（fixture を書かない）を、この preregistration を commit する前に 1 回実行した。mapping と threshold は実行前にコードで固定してあり、実行後に変更していない。dry-run の出力は adequacy が全項目充足（STAFFING continuation はちょうど閾値の 5）であることを示していた。したがって本 preregistration は「結果を見る前の凍結」ではなく、「規則を固定したうえで、結果を既に一度見た後に commit した」ものとして扱う。

## 3. claim / non-claim

claim: v0 specification を一切変更せず実装する前提で、既存の pre-implementation labeled evidence を cumulative に扱ったとき、FY2024 known-form routing の実装・一回評価へ進むための benchmark adequacy が既存 threshold を満たすか。**fresh held-out generalization test ではない**。v0 の `DEVELOPMENT` row を含むため、431 row 全体を `FROZEN_EVALUATION` や held-out と呼ばない。全体の呼称は `CUMULATIVE_PRE_IMPLEMENTATION_BENCHMARK_V3`。

NOT CLAIMED / NOT EVALUATED: open-set safety、OTHER・未知 form の検出、FY2024 corpus 外／他年度への generalization、publisher generalization、MOJ/FSA fully-EMPTY page・MEXT raster-only page の semantic classification、OCR/Route C、項・事項・金額抽出、MOF 照合、search index、Structured Text の downstream correctness。OTHER/UNRESOLVED が 0 件でも `openSetSafety = NOT_EVALUATED`。

## 4. cumulative benchmark の構築

- union key: `(localPdfPath, physicalPage)`。v0 172・v1 89・v2 170 の既知件数は参考で、pairwise overlap と unique 数は fixture から再計算する（431 でなければ STOP）。
- 各 row は sourceVersion・sourceEvaluationRole（original role をそのまま保存。v0 の DEVELOPMENT を昇格しない）・sourceStrata・GT・machine evidence を保持する。machine evidence は candidate fixture を key join して取得し、GT label から逆算しない。
- 実装: `scripts/pipeline-v2/lib/budget-request-page-classification-v3-cumulative.ts`（純関数）、`build-budget-request-page-classification-v3-cumulative-benchmark.ts`（builder）。

### version ごとの mapping（freeze）

| version | DIRECT stratum / machine directFamily | CONTINUATION stratum / machine activeStateFamily・bucket |
|---|---|---|
| v0 | `DIRECT` / `strataDetail.DIRECT.family` | `CONTINUATION` / `strataDetail.CONTINUATION.stateFamily`・`distanceBucket` |
| v1 | `DIRECT_BALANCED` / `samplingObservation.directResult.family`（`kind=DIRECT`） | `CONTINUATION_BALANCED` / `samplingObservation.activeStateFamily`、bucket は `strataDetail.CONTINUATION_BALANCED.distanceBucket` |
| v2 | `DIRECT_BALANCED_V2` / `samplingObservation.directResult` | `CONTINUATION_BALANCED_V2` / `samplingObservation.activeStateFamily`・`distanceBucket` |

stratum に属するのに machine evidence が得られない row があれば推測せず throw（STOP）。

### 厳密な family match（v2 review で指摘された点の解消）

- DIRECT row として数える条件: (1) DIRECT stratum 所属、(2) machine `directFamily` が known family、(3) `GT pageType === directFamily`。
- CONTINUATION row として数える条件: (1) CONTINUATION stratum 所属、(2) machine `activeStateFamily` が known inheritable family、(3) `GT pageType === activeStateFamily`。
- 「GT family + stratum」だけでは数えない。

## 5. adequacy gate（v2 threshold を継承）

- core（COVER・TOC・SUMMARY・DETAIL・STAFFING）が cumulative GT で各 ≥ 10。
- DIRECT matched が core 5 family 各 ≥ 5。
- CONTINUATION matched が TOC・SUMMARY・DETAIL・STAFFING 各 ≥ 5。
- PRIORITY_* は rare form limitation として別集計（STOP 条件に含めず、評価済みと書かない）。
- OTHER/UNRESOLVED は件数のみ別集計。open-set GO claim は作らない。

判定: ADEQUATE / STOP FOR REVIEW（input hash mismatch 0・duplicate/ambiguous join 0・core/DIRECT/CONTINUATION 充足・既存 artifact 変更 0・決定的再生成・tests/typecheck/lint pass）。INSUFFICIENT / STOP（いずれかの threshold 未達。新規 GT 追加・threshold 低下・STAFFING continuation の scope 外し・v4 の独自設計をしない）。INVALID / STOP（hash mismatch・overlap/identity 不整合・mapping 曖昧・既存 artifact 変更・source 不一致）。ADEQUATE でも classifier は実装せず STOP FOR REVIEW。ADEQUATE の場合に記録するのは「別の research/implementation unit で、v0 frozen specification を変更せず classifier と evaluator を実装し、cumulative benchmark に対して一度だけ評価可能」という事実のみ。

## 6. contamination guard

この PR は benchmark aggregation と adequacy 計算のみ。GT を読むことは必要だが、classifier 設計入力にしない。禁止: GT mismatch を見た v0 matcher の変更、v1/v2 risk row を救う新ルール、title literal・DIRECT window・reset・blank bridge・継承規則の変更、family/publisher 固有の例外、page-number rule、look-ahead classifier、GT label からの辞書生成、MOF・manifest role の evidence 化。

## 7. 禁止事項

classifier 実装・性能評価、v0 rule・v0/v1/v2 GT の変更、新規 visual GT・GT の追加探索、OCR、Route C、Summary/Detail/Cover/TOC parser、項・事項・金額抽出、MOF 照合、search index、RS integration、`data/download/` 変更、merge、PR comment / approve。

## 8. 備考（PR #383 の取り込みに関する事実）

PR #383 は squash merge のため head commit `967bcd5` は main の ancestor ではない。代わりに、`967bcd5` と main（`8f36e8e`）で `tests/fixtures/budget-request-page-classification`・`scripts/pipeline-v2`・`docs/tasks` の差分が空であること（内容同一）を確認した。
