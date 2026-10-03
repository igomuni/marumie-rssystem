# FieldResolver v0 PoC — 結果

## 結論

**GO（次段階へ。ただし下記の限界つき）。** Golden 20 target・112 の評価対象 field で **false resolved 0 / wrong source 0 / wrong normalization 0**、false-resolve rate 0%、safe coverage 99.1%（exact 111/112）。確定しなかったのは 3 件で、いずれも reasonCode で説明できる abstention（§6）。

ただし Golden は開発中に観測した 8 ページと同じものであり、**未観測データでの汎化の証拠ではない**（§8 に独立の算術監査を併記）。

## 1. 基本情報

| 項目 | 内容 |
|---|---|
| base commit | `4445b57`（Golden human review 記録）。branch `research/budget-request-field-resolver-v0-poc` |
| 実装 commit | `99342b4` feat: FieldResolver v0 PoC（row-local・hierarchy policy・evaluator・境界テスト） |
| schema | `budget-request-field-resolver-poc/v0`（評価: `…-evaluation/v0`） |
| Golden / Contract | **変更なし**（`git diff 4445b57` が空。`docs/tasks/20261003_0648_FieldResolver_v0_*.md`・`golden.json`） |

## 2. ファイル

- `scripts/pipeline-v2/lib/budget-request-field-resolver.ts` — 推論本体（型・列の観測・row-local・hierarchy policy・決定的 serialize）
- `…-field-resolver-runs.ts` / `…-paths.ts` — 実行単位（ページ範囲）と出力先
- `scripts/pipeline-v2/extract-budget-request-field-resolver.ts` — 推論 CLI（Golden を読まない）
- `…-field-resolver-evaluator.ts` + `evaluate-budget-request-field-resolver.ts` — 評価（Golden を読むのはここだけ）
- テスト: `…field-resolver.test.ts`（19）、`…field-resolver-boundary.test.ts`（静的境界・評価・実artifact）
- 既存の `…field-resolver-golden.test.ts` の静的境界テストは、PoC の評価側ファイルを許可するよう書き換えた（検査対象を「fixture/validator への参照」に絞り、推論側の禁止は維持）。
- artifact: `data/work/budget-request-field-resolver/<run>/field-resolution.json`、`evaluation/golden-v0.{json,md}`（gitignored・再生成可能）

## 3. アルゴリズム

- **anchor** = LogicalRowCandidate（ページ全体の x ソートはしない）。code = 行頭の code-like token（請求番号の後に `NN-NNNN` が続く行は後者）。
- **列** = ページの見出し token（`概 算 要 求 額` と、`前年度`/`対前年度…` の文字 token）から前年度・要求額・増減の x 範囲を観測し、token 中心でセルに割り当てる。見出しはテーブル先頭ページにしか無いため、**見出しの無いページは前方の見出しを引き継ぎ、そのページの TableGeometry の右端揃い帯が 3 列それぞれのセル領域にあるときだけ採用**（無ければ `column_layout_not_corroborated_on_page`）。
- **金額** = セル内の数字 chunk を x 順に連結し `^(0|[1-9]\d{0,2}(,\d{3})*)$` を満たすときだけ resolved（`magnitudeNumeric` はカンマ除去のみ）。明示 `0` は `explicitZero: true`。セルに token が無ければ blank（証拠は「anchor 行＋セル帯＋token 無し」を再現できる `cellBand`）。非数字 token があれば unresolved。
- **符号** = `△▲` / 単独 `-` の token が、同じ物理行・同じセルで数字の左にあるときだけ。数字と △ が 1 token の場合（例 `0 △`）は文字位置の比例で分割し、`geometryNote` に残す。符号 token が無ければ `not_observed`、金額が blank なら `not_applicable`。算術・値の大小・備考の △ は使わない。
- **補助**: 見出しの右側（備考領域）・列の間の token は金額/符号の根拠にしない（`auxiliaryEvidenceRefs` に参照のみ）。
- **継続**: 次行が LogicalRow で `ambiguous`（継続候補）のとき、その行の token が名前領域にあれば name は `ambiguous`、金額セルにあれば blank としない。
- **pageUnitLabel** = 台帳の見出し領域（最初のレコード行より上）にある単位 token のみ。本体の途中の単位 token は補助表のものとして `not_observed`。
- **hierarchy**（Contract §9）= DocumentHierarchy v2-B の観測結果を消費するだけ。Safe = edge `resolved_by_indent_sequence` かつ child/parent に強い header 衝突 evidence（2 種以上かつ `page_edge_row` を含む）が無い。request→organization は 2 hop とも Safe のときだけ。3 桁コードのみの行の種別は、観測済み edge から決める（root=organization、親が organization=item、親が request/item=明細行、それ以外=`unclassified` で abstain）。

## 4. 入力境界

推論 module が読む: SourceToken / TableGeometry / LogicalRow / DocumentHierarchy v2-B（型と観測結果）。静的テストで、推論 3 ファイル＋CLI が Golden・human-observations・hierarchy GT・SpatialRegion 以降の凍結層・評価 module を import / 参照しないこと、ministry 名・target id・ページ番号の特例が無いことを検査。Golden を読むのは評価 CLI のみ。

## 5. 評価結果（Golden 20 target）

| 区分 | GT resolvable | exact | correct abstention | false resolved | wrong source | wrong norm. | unresolved | ambiguous | precision | safe coverage | false-resolve rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| row-local | 104 | 103 | 56 | 0 | 0 | 0 | 0 | 1 | 100% | 99.0% | 0% |
| hierarchy | 7 | 7 | 25 | 0 | 0 | 0 | 2 | 0 | 100% | 100% | 0% |
| overall | 112 | 111 | 88 | 0 | 0 | 0 | 2 | 1 | 100% | 99.1% | 0% |

context 別（false resolved は全て 0）: blank 9 target（exact 47/47）、explicit-sign 3 target（20/20）、explicit-zero 5 target（26/27）、hierarchy-risky 4 target（23/23・unresolved 2）、hierarchy-unresolved 3 target（15/15・unresolved 1）、auxiliary-heavy 9 target（53/54）。field 別・全 outcome は `evaluation/golden-v0.md`。

per-sample の必須挙動（指示書 §13）: METI p9 の org 010・req 01-95・符号付き差額・0 差額・全空欄行、p10 の `0 △` 分割（前年度 explicit 0 ＋要求額 △173,380 ＋差額 △、備考 `△27人` は不使用）、p96 の前年度 blank＋要求 704、explicit 0/0/0、全 blank、`庁費 177/177`（右側 177 は auxiliary）、p105 の blank 行＋risky hierarchy で organization abstain、MHLW p1268 item 020 の blank（右側の表の数値/△は不使用）、p1555 org/item/request、MEXT p876 の `464/464/0`（計 464 は不使用）、CFA p136 req 17 の △差額と organization abstain、がすべて満たされた。

## 6. 確定しなかった field（全件）

| target | field | 結果 | 理由 |
|---|---|---|---|
| mext-p876-line015 | name | ambiguous / `continuation_ambiguous` | 折り返し 2 行目が LogicalRow で `ambiguous`（備考側 segment が揃わない）。Contract「LogicalRow の継続 evidence が無ければ連結しない」に従い連結しない。全角 code point の Unicode 保留（空白除去＋NFKC で比較する評価方針）は未到達のため検証されていない |
| meti-p105-item063 | parentItemAssociation | unresolved / `record_kind_undetermined` | edge が `level_gap` のため、3 桁コード行が item か明細行か確定できない。Golden は not_applicable を期待（親は断定していない＝安全側の差異） |
| cfa-p136-item085 | parentItemAssociation | unresolved / `record_kind_undetermined` | 同上（`resolved_risky`） |

後 2 件は hierarchy の `level_gap` / risky で種別が確定しない行で、hierarchy を直さずに abstain した結果。

## 7. 開発経緯の開示（Golden は held-out ではない）

最初の評価で false resolved 3・unresolved 7 などが出て、次を追加した: ①3桁コード行の種別を hierarchy の edge 形から決める（明細行を item と誤認して親を主張していた）、②単位 token を台帳の見出し領域に限定（p96 の本体途中の単位 token を採っていた）、③継続候補行の扱いを「名前領域/金額セルに token があるときだけ」に絞る（右側の補助表の行で name が ambiguous になり blank も確定できなかった）、④見出しの無いページは前方の見出しを帯で裏付けて引き継ぐ（初版は全件 unresolved）。いずれも Golden の値・target id・ページ特例は使っていないが、**評価を見て規則を直しているため、Golden の結果は規則の開発セットに対するもの**。

## 8. Golden 外の独立監査（推論には不使用）

全 artifact（5 run・2,940 record）のうち 3 金額がすべて確定した 2,218 件で、`要求額 − 前年度 = 増減`（符号込み）が **不一致 0 件**。符号や列の割当を誤ると破れる検査で、推論はこの算術を使っていない（テスト `実PDFのartifact` で常時検査）。

## 9. 決定性・検証

- 2 回生成した artifact（5 run ＋評価 json/md）の sha1 は一致（時刻・絶対パス・乱順なし）。
- `npx tsc --noEmit` OK / `npm run lint` エラーなし（既存 warning のみ）/ `npx vitest run` 88 files・1,225 tests pass（FieldResolver 58 tests）/ `npm run build` OK / `git diff --check` OK。実 PDF artifact を使うテスト 2 件は `data/work` が無い環境では skip。

## 10. 既知の限界

- 列の観測は見出し token の形（文字ごとの token ＋ `概 算 要 求 額`）に依存。観測できなければ abstain。他テンプレートは未検証。
- 空欄は「セル帯に token が無い」ことの観測。text layer に出ない画像の数値は検出できない（false blank の可能性は残る）。
- 3 桁コード行の種別は hierarchy の edge に依存し、`level_gap` では `unclassified`。
- 評価対象は 8 ページ・20 target。実行範囲は run 定義（METI 9–106 等）で、Golden 外ページは上記の算術監査のみ。
- `auxiliary-heavy` context は備考がある target 全般を含み広め。
- 差額が欠ける行（difference だけ blank など）の Golden は未収録（元から NOT FOUND）。

## 11. GO / STOP（次の FieldResolver 段階について）

**GO**。STOP 条件（Golden 特例・hierarchy 修正・A2/A3 再開・人手ラベル・算術による blank/符号推論・Contract 変更）はいずれも発生していない。次段階は、Golden 外ページを独立に目視確認する held-out 評価（算術監査で不一致が 0 でも、blank の誤りは検出できないため）と、`level_gap` 行の扱い・LogicalRow ambiguous な継続の扱いの検討が候補。PR・merge は未実施。
