# FieldResolver v0 — 不完全な名称の safety guard 事前登録 補遺

既存の事前登録（`20261003_1321_…_Preregistration.md`、commit `2e9eff1`）に対する補遺。**guard の条件・閾値・発火時の status・評価標本・GO/STOP は変更しない**（1321 の本文が正）。後から届いた指示書（`20261003_1431_field_resolver_v0_incomplete_name_safety_guard_preregistration_instruction.md`）が求めていて 1321 に無かった項目だけを足す。1431 の指示書の既知 HEAD は `756f902` で、1321 はその後（`2e9eff1`）に作成済み。

## 1. 1431 の指示と 1321 の対応

| 1431 の要求 | 1321 での扱い |
|---|---|
| 目的・既知 failure・layer 責任・safety principle | 1321 §1〜§5 に有り（layer 責任は §3 の表と failure isolation 文書。下の §6 に図を補足） |
| evidence の列挙 | 1321 §6（A〜F）。**取得元・決定性・false abstention risk の属性は未記載** → 本補遺 §3 |
| guard trigger の freeze | 1321 §7（A∧B∧¬C∧¬D）。固有条件なし |
| trigger 時の status | 1321 §8（`ambiguous`）。**既存 contract の定義との照合は未記載** → 本補遺 §4 |
| provenance | 1321 §8 に断片 evidence のみ。**schema で何が保持できるかの確認は未記載** → 本補遺 §5 |
| 評価設計・母集団・GT policy・metrics・GO/STOP | 1321 §9〜§12（43 unit・視覚 GT・数値基準）。1431 の「3 クラス」は 1321 の FRI / FAC / CRC に対応 |
| rule freeze と evaluation-set freeze の順序 | 1321 §16（P1 → P2 GT → P3 実装 → P4 評価） |
| P0 existing behavior freeze | **未記録** → 本補遺 §2 |
| P3 implementation plan | **未記録** → 本補遺 §7 |
| unresolved questions / known debt | **未記載** → 本補遺 §8 |

なお、実験工程の P2（視覚 GT 作成）は一度中止・片付け済み（無効）で、GT・実装・評価は未実施。リポジトリは `2e9eff1` のまま変更していない。

## 2. P0 — 現行の振る舞いの記録（コード変更なし）

現行 FieldResolver（freeze `abc57b9` の推論）の artifact（開発用 5 run＋held-out 16 ページ。baseline の sha1 は `baseline-artifacts.json` に凍結済み）から、読み取りのみで記録する。

- 名称 field の status: **resolved 2,720／ambiguous 255／unresolved 171**（record 3,146 件）。非 resolved の理由は `continuation_ambiguous` 255、`no_name_token` 111、`column_layout_unobserved` 60。**guard 対象の「継続の信号が出力に無いまま resolved になった名称」は現行の status からは区別できない**（resolved の中に混ざっている）。
- 既知 failure 3 件（環境省 p75）: すべて `resolved`（`ネイチャーポジティブ（`／`自然環境保全地域等保全`／`世界自然遺産等保全対策`）。標本の `baselineName` に凍結済み。
- candidate pool（baseline で名称が resolved の 17,300 unit、これは failure 件数ではない）: 直下の後続あり・名称 x が整列（guard 発火の predicate が成り立つ）154、直下だが整列しない 1,491、直下の後続なし 15,655。「約 83 件」は別の（古い）数え方の候補で、failure 件数ではない。

## 3. evidence の属性

| 記号 | 取得元（layer / field） | 決定的に取得 | PDF の意味を推測しないか | complete name にも頻出し得るか | false abstention risk |
|---|---|---|---|---|---|
| A 直下 | TableGeometry の physical row の baseline、LogicalRow の `physicalRowIndexes` | はい | はい（幾何のみ） | **はい**（行間が範囲内の隣接は日常的。母集団の約 9.5% が A） | A 単独では高い。単独で発火に使わない |
| B 名称 x の整列 | LogicalRow の `segments`・SourceToken の `bbox`、列の観測の名称領域 | はい | はい | 完全な名称の直下に同じ x のテキストがあるのは稀（母集団で A∧B は 154/17,300）が、注記・見出しの可能性は残る | 中。標本で FAC として測る |
| C code 始まり | SourceToken の `rawText`（既存の code 観測） | はい | 数字の形だけ。意味は見ない | 次の record は code で始まる | 低い（veto として使う） |
| D 金額 | SourceToken の bbox と列の観測 | はい | はい | 次の record は金額を持つことが多い | 低い（veto） |
| E 形状 | — | 安定した定義がない | — | — | 不採用 |
| F 非結合の理由 | LogicalRow の `alignment` | **連鎖で上書きされるため、出力からは取れない**（segment の再計算が必要） | はい | S が別の logical row である時点で成立 | 追加情報にならないので不採用 |

## 4. 発火時の status と既存 contract

既存 contract の status 定義: `ambiguous` = 「複数の候補があり 1 つに決められない（例: 折返し名称が複数の行にまたがる）」、`unresolved` = 観測できない、`not_observed` = ページに無い。本 guard の状態は「断片は観測できているが、同じ名称の続きが直下にある可能性があり、完全な名称に決められない」であり、contract の `ambiguous` の例そのものに当たる。さらに contract の name の行（「折返しは continuation の根拠があるときだけ連結。無ければ ambiguous」）とも整合する。よって `ambiguous` に固定する（`unresolved` は「名称 token が観測できない」場合のため意味が違う）。新 status は追加しない。

## 5. provenance — 既存 schema で保持できるもの

`FieldResult.candidates: FieldEvidence[]` に、`sourceTokenRefs`（断片の token）・`sourceRowRefs`（logicalRowIndex・physicalRowIndexes）・`rawText`・`associationClass`・`bboxUnion`・`geometryNote` を保持できる。`reasonCode` は文字列 1 つ。

- 保持できる: 断片の token と行、発火理由（reasonCode）、`geometryNote` の自由文。
- 保持できない（構造化された形では）: **後続 logical row の識別子、行間 dy、整列した token の参照**（continuation-risk の根拠）。`geometryNote` に文字列で書けば残せるが、機械可読ではない。
- 設計上の必要性（今回は実装しない）: 根拠を機械的に検証・集計したいなら `FieldEvidence` に `continuationRisk?: { successorLogicalRowIndex; dy; alignedToTokenRef }` のような任意 field が要る。1321 の実装計画（P3）は schema を変えず、`geometryNote` に固定書式で入れる案を第一とし、schema 拡張は必要性が確認できたときに別実験で扱う。

## 6. layer 責任

```text
SourceToken
  OK: 見えた文字列を補正せず保持
PhysicalRow
  OK: 物理行（5行）を保持
LogicalRow
  結合判断: 規則どおりで、必ずしも誤りではない
  情報保持: 連鎖で ambiguous / possibleContinuationOfLogicalRow が上書きされ、
            継続の可能性の信号が失われる -> 既知の下位層の debt（独立して残す）
FieldResolver
  unsafe assumption: 継続の信号が無い => 名称は完結している
  -> この guard 実験の直接の対象
```

FieldResolver を修正対象にすることは、LogicalRow の情報損失を正当化しない。LogicalRow に触れない理由: ①凍結した下位層で、別の評価（結合規則・診断の契約）が要る、②修正しても他の層（FieldResolver）が「信号なし＝完結」と読む脆さは残る、③原因を切り分けて 1 変更ずつ測るため。

## 7. P3 — 次の実装実験の計画（今回は実装しない）

- 変更予定のファイル・関数（最小）: `scripts/pipeline-v2/lib/budget-request-field-resolver.ts` の `nameField`（名称の確定箇所）と、`resolveFields` 内の name・rowOk の算出（約 620 行付近）。
- guard の挿入点: `nameField` が `resolved` を返す直前。次の logical row S を `page.logical.logicalRowCandidates[index+1]` から取り、1321 §6 の A・B・C・D を既存出力（geometry の baseline・segments・token・列の観測）から計算する。
- 状態遷移（期待）: 発火した record の name だけ `resolved → ambiguous`（value null、reasonCode `name_continuation_evidence_unmerged`、candidates=断片の evidence）。それ以外の field・record は不変。
- 追加する option: `resolveFields` の入力に `incompleteNameGuard?: boolean`（既定 off。off の出力は baseline と byte-identical）。
- rowOk: blank 判定の `rowOk` は guard 適用前の name status で決める（guard で blank を unresolved に変えない）。
- テスト: 合成ページで発火／非発火（直下でない・x 不整列・code 始まり・金額あり）、off のとき baseline artifact（sha1 凍結の 21 件）を再現、name 以外の差 0、guard が候補に後続行の文字列を入れない。評価コマンドは 1321 §13。
- 範囲外: LogicalRow・結合・2 桁 code・総表・hierarchy・schema 拡張。

## 8. 未解決の問いと既知の debt

- **LogicalRow の information-loss**（連鎖で `ambiguous` が上書きされる）: 下位層の debt。別実験で、出力契約として継続リスクを保持する案を検討する。
- ページをまたぐ名称の継続（S が次ページの先頭）: 本 guard は同一ページの直後の行のみ。
- 次の logical row が直下でも x が揃わない継続（段付き・インデント違い）は拾えない（recall の限界）。
- 視覚 GT の作成手順: 一度試行して中止した（無効）。再開するか、手順そのものを再設計するかは未決定。
- 1321 の標本は guard の predicate と同じ定義で層を作っており、設計と無関係な未見データではない（開示済み）。

## 9. 変更した範囲

本補遺の追加と INDEX の追記のみ。FieldResolver・LogicalRow・GT・P1 の fixture / 標本・baseline は変更していない。
