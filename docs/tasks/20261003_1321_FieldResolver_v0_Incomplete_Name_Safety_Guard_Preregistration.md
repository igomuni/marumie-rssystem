# FieldResolver v0 — 不完全な名称の safety guard 事前登録

実装しない。guard の条件・閾値・発火時の status・評価標本・視覚 GT の手順・指標・GO/STOP を、実装と評価より前に固定する。この文書のコミットが preregistration commit。以後、本文の規則は変更しない（変更が必要なら理由を残して新しい preregistration にする）。

## 1. Background

held-out の初回評価（STOP）で、環境省 p75 `011` の名称（視覚上 5 行）の先頭 1 行だけが `resolved` になった（false resolve）。failure isolation で、SourceToken・PhysicalRow は 5 行を正しく保ち、LogicalRow は 1 行目（L7）と 2〜5 行目（L8）を結合せず、L8 の連鎖で `ambiguous` / `possibleContinuationOfLogicalRow=7` が上書きで出力から消え、FieldResolver は「次行が `ambiguous` か」の 1 信号だけで名称の完全性を判断していた、と確認済み。p75 内には同型が他に 2 件（`006`、別の `011`）。

## 2. Failure class

**複数行名称の不完全な先頭断片を、完全な名称として `resolved` にする。** 直接の原因は FieldResolver の完全性判定の不足（`absence of continuation evidence` を `evidence of name completeness` と読んだこと）。

## 3. Responsibility boundary

| | 内容 | 今回 |
|---|---|---|
| A. Safety guard | この名称が完全であると言えないとき `resolved` にしない（`resolved → abstain` のみ） | **対象** |
| B. Joining / reconstruction | 後続行のどこまでを名称として結合し、完全な名称を復元する | 対象外。実装案にも含めない |
| LogicalRow の evidence 上書き | 連鎖で `ambiguous` が消える | 対象外（別実験） |

## 4. Frozen layers

SourceToken・TableGeometry・LogicalRow・DocumentHierarchy は変更しない。変更対象は将来の FieldResolver の safety guard のみ。今回の作業では FieldResolver・LogicalRow のコードを変更していない。

## 5. Safety principle

1. 継続の証拠が無いこと ≠ 名称が完結している証拠。
2. guard は `resolved → abstain` の方向だけ。後続行から名称文字列を作らない。
3. 発火しても名称を推測・補完しない。
4. 値フィールド（code・金額・符号・hierarchy・単位）の意味・値を変えない。

## 6. Available evidence（既存出力から安定して取れるもの）

record R（名称が baseline で `resolved`）の logical row を L、同じページの次の logical row を S とする。`ref` = そのページの基準フォントサイズ（TableGeometry・LogicalRow が使うもの）。

| 記号 | 内容 | 定義（すべて既存出力から計算） |
|---|---|---|
| A 近接 | S が L の直下 | S の先頭 physical row の baseline − L の最終 physical row の baseline が `[0.75, 1.5] × ref` |
| B 名称開始の整列 | S の先頭 token が名称領域にあり、L の名称 token と同じ x から始まる | S の先頭 physical row の最初の非空白 token（visual-x 順）の中心が名称領域（列の観測から）にあり、その xMin が、L に含まれる名称領域内の非空白 token（code token は除く）のいずれかの xMin と `0.25 × ref` 以内 |
| C 独立 record の開始 | S の先頭が record の code | 既存の code 観測と同じ規則（行頭が 3 桁以上の数字または `-` を含む code、または要求番号＋`NN-NNNN`） |
| D 金額 | S が金額セルに token を持つ | S の非空白 token の中心が前年度・要求額・増減の列領域にある |
| E 形状 | S が名称の継続として説明しやすい形 | 安定した定義が取れず、A・B・C・D と重複するので**採用しない** |
| F 非結合の理由 | LogicalRow が結合しなかった理由が名称側でなく備考側の不揃い | S が L と別の logical row である時点で成り立つ構造的事実で、発火条件の追加情報にならないので診断としてのみ記録し、**採用しない** |

閾値は LogicalRow の既存定数（行間 0.75〜1.5 倍、x 許容 0.25 倍）をそのまま使う。新しい閾値は作らない。

## 7. Proposed guard

**発火条件: A ∧ B ∧ ¬C ∧ ¬D**（S は L の直下で、先頭が同じ名称 x から始まり、独立 record の code で始まらず、金額を持たない）。

| 区分 | 条件 | 位置づけ |
|---|---|---|
| 継続の positive evidence | A（直下）、B（名称 x の整列） | 発火に必要。2 つが揃って初めて「継続として説明できる」 |
| absence（弱い） | ¬C、¬D | 単独では発火させない。A∧B が成り立つときの、独立した record を誤って継続と見なさないための否認（veto） |
| evidence against | S が範囲外、先頭が名称領域外、名称 x が揃わない、先頭が code、金額がある | 発火しない |

対象は直後の logical row S のみ（ページをまたぐ継続は扱わない）。既存の「S が `ambiguous` で名称領域に token がある」ときの `ambiguous` は変更しない（baseline のまま）。S が L に既に結合済み（名称が複数行）のときは、その結合済み名称の後ろの S を同じ条件で見る（名称が更に続く場合を拾う）。

### なぜ各条件が必要か

- A: 離れた位置の整列したテキストは別の記述。直下であることが継続の最小条件。
- B: 折り返しは同じ x から始まる。これが継続の積極的な幾何証拠。
- ¬C: code で始まる行は新しい record。**現在の標本の母集団（17,300 unit）では、B が成り立つ unit で C が不成立になる例は 0**（code の x は名称の x と異なる）。実質的には B が兼ねているが、他のテンプレートでの防御として固定する。
- ¬D: 金額を持つ行は record。母集団では D が不成立になる例も 0。同様に防御として固定する。
- 最小性: 6 条件の AND にはしない。E・F は採用せず、C・D は防御（veto）に限る。

## 8. Guard output status

発火時の `rowLocal.name` は**既存 status の `ambiguous`**に固定する（新 status は追加しない）。`value: null`、`reasonCode: 'name_continuation_evidence_unmerged'`、`candidates` には baseline で resolved だった**断片の evidence（既存 token のみ、文字列の連結なし）**を 1 つだけ保持する。後続行の文字列は candidate にも入れない。

`ambiguous` を選ぶ理由: 既存の `continuation_ambiguous`（継続候補があり確定できない）と同じ意味で、`unresolved`（観測できない）とは違う。

**他 field への影響の禁止**: blank の判定は `name.status === 'resolved'` を前提にしている（baseline）。guard の発火で blank が `unresolved` に変わらないよう、blank 判定の rowOk は guard 適用前の name status で決める。code・金額・符号・hierarchy・単位・補助 evidence は baseline と同一（byte 単位）でなければならない。

## 9. Evaluation dataset

単位（unit）は「baseline で名称が `resolved` の record」。PDF・ページ・record は次の標本で固定する（`tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/sample.json`。選定は `select-budget-request-incomplete-name-guard-sample.ts`、sha1 昇順の決定的な抽出）。

| 層 | predicate（§6 の記号、現在の baseline 出力で計算） | 母集団 | 標本 |
|---|---|---:|---:|
| known-failure | p75 の `011`・`006`・別の `011` | 3 | 3（全件） |
| G（guard が発火する） | A∧B∧¬C∧¬D（known を除く） | 151（meti 38・mhlw 1・cfa 3・moe 9・mod 6・maff 63・mlit 31） | 24（群ごと最大 4） |
| NB（直下だが名称 x が整列しない） | A∧¬B（備考だけの行など） | 1,491 | 8（群ごと 1） |
| NC / ND（直下・整列・code あり／金額あり） | A∧B∧C̄ / A∧B∧C∧D | 0 / 0 | 0（母集団に例が無い） |
| P（直下の後続なし） | ¬A または後続なし | 15,655 | 8（群ごと 1） |
| H（金額がすべて空欄の見出し） | 上記のうち amount なしの行を最低 6 件含める | — | 標本中 7 件（追加の選出は不要） |

合計 **43 unit・39 ページ・8 省庁**（METI・MHLW・MEXT・CFA・MOD・MOE・MAFF・MLIT）。出所の区別: **development**（METI・MHLW・MEXT・CFA の開発用 run。16 unit）、**held-out v0 のページ**（環境省 p75 の既知 failure 3 unit。今後は regression 扱い）、**additional**（これまで FieldResolver を実行していなかった防衛省・環境省・農水省・国交省のページ。24 unit）。summary 形式・総表レイアウトは resolver が名称を確定しないため母集団に無く、評価対象外。

開示: ①母集団・層の件数は baseline の出力と幾何から計算した記述的な件数で、failure の件数ではない（候補 83 件を failure として扱わない）。②標本の層の predicate は guard の predicate と同じ定義で、標本選定ツールで計算した（FieldResolver・LogicalRow のコードは変更していない）。③この標本が guard の設計と無関係な未見データであるとは言えない（G の件数を見たうえで条件を固定している）。「additional」も baseline の出力を選定ツールで見た範囲に限られる。

## 10. Visual GT procedure

ラベル: `complete_on_current_logical_row`（名称は当該 logical row で完結し、直下に同じ名称の続きは無い）／`incomplete_continues_below`（直下に同じ名称の続きがある）／`unclear`（視覚で決められない。positive にも negative にも入れず、評価から除く）。

- GT は GT 作成前に実装も評価もしない状態で、原本 PDF を描画して視覚で作る（`pdftoppm`、台帳左側 170 dpi）。baseline の名称・guard の predicate・Treatment の出力は見ない。
- GT 作成者には層・predicate・baseline の名称を含まない作業リスト（`gt-worklist.json`。unit の位置〈ページ・code・y〉のみ、sha1 順）だけを渡す。
- 作成者は作業アシスタントで、標本の層を設計した本人でもある。作業リストで層を伏せることで影響を減らすが、独立した人間のレビューは GT freeze 時点では未実施になり得る（その場合は `humanReview: pending` と記録）。
- GT freeze commit の後に実装に進む。GT を見た後に条件・閾値を変えない。

## 11. Metrics

unit ごとに baseline と Treatment の名称の扱い（resolved / ambiguous）と GT を突き合わせる。

- **FRI**（false-resolved incomplete name）: Treatment が `resolved`、GT が incomplete。**主要な safety 指標**。
- **FAC**（false-abstained complete name）: Treatment が abstain、GT が complete。guard の過剰。
- **CRC**（correctly-resolved complete name）: Treatment が `resolved`、GT が complete。
- **CAI**（correctly-abstained incomplete name）: Treatment が abstain、GT が incomplete。
- guard precision = CAI / (CAI + FAC)、guard recall = CAI / (CAI + FRI)。層別（known / G / NB / P / 出所別 / 省庁別）にも報告。
- 不変条件の差分: 全 record について Treatment と baseline を比較し、name 以外の field の差、および発火していない record の差を数える。

## 12. GO / STOP criteria（数値を固定）

**Safety**: known failure 3 件の FRI = 0。全体の FRI ≤ 2 かつ incomplete（decisive）の 10% 以下。

**Regression**: FAC ≤ 2 かつ「Treatment が発火した decisive unit」の 10% 以下。発火していない unit（NB・P）の名称は baseline と同一（FAC・状態変化 0）。

**Informative**: incomplete が 10 件以上、`unclear` が 20% 以下。G 層の complete が 3 件未満なら guard の過剰は十分に測れていないので `GO-WITH-SCOPE`（範囲を明記）。満たさなければ `NON-INFORMATIVE`。

**既存の不変条件**（すべて満たす）: name 以外の field の差 0（blank を含む）、発火した record の name は `resolved → ambiguous`・value null の変化だけ、development Golden（20 target）の評価が baseline と同一（false resolved 0・wrong source 0・wrong normalization 0）、held-out の記録（初回の artifact）に対して Treatment で wrong source 0・wrong normalization 0・blank↔zero 0・符号推論 0・計算した差額 0・見えない補完 0、決定性（2 回で byte-identical）。

**GO**: 上記すべてを満たす。**GO-WITH-SCOPE**: safety・regression・不変条件を満たし、informative の一部が不足。**STOP**: safety または regression の基準を超える、不変条件が 1 つでも崩れる、page・ministry・文字列・x 座標の特例が必要になる、GT 作成前に Treatment や guard の出力を見た、GT を見た後に条件・閾値を変える。STOP 後もその場で直さず、新しい preregistration で行う。

## 13. Baseline / treatment plan

- **Baseline**: current FieldResolver v0（freeze `abc57b9` の推論）。コマンド: `npx tsx scripts/pipeline-v2/extract-budget-request-field-resolver.ts` と `npx tsx scripts/pipeline-v2/extract-budget-request-field-resolver-heldout.ts`。生成物の sha1 を `baseline-artifacts.json`（21 件）に凍結した。標本の各 unit の baseline 名称は `sample.json` の `baselineName` に凍結した。
- **Treatment**: baseline + 本 guard（`incompleteNameGuard` の option を追加し、既定は off。off のときの出力は baseline と byte-identical であること）。同一標本に対し baseline（guard off）と Treatment（guard on）を同じ評価コマンドで比較する予定: `npx tsx scripts/pipeline-v2/evaluate-budget-request-incomplete-name-guard.ts --gt-freeze-commit=<GT freeze commit>`（実装時に作成。まだ存在しない）。
- LogicalRow を修正した版との比較は含めない。

## 14. Risks

- **過剰な abstain**: 名称 x に揃う code・金額なしの独立した行（注記・見出しなど）を継続と誤認し、完全な名称を abstain にする。METI の候補が多い（G の母集団 151 のうち meti 38・maff 63）ので、省庁の偏りに注意。
- **取りこぼし**: ページをまたぐ継続、S が直下でない場合（行間が範囲外）、名称 x が揃わない継続は拾わない。NB・P 層で incomplete があれば recall の限界として報告する。
- **GT の限界**: 同一作成者、層の既知性（作業リストで緩和）、`unclear` の扱い。
- **標本の偏り**: G は母集団の 16%（24/151）、他の層は少数。

## 15. Explicit non-goals

FieldResolver・LogicalRow のコード変更／後続行の結合・完全名称の復元／MOE p75・`011`・`006` 専用の条件／ministry・page の例外／rawText の特定語句による判定／GT の推論への利用／評価後の閾値変更／候補 83 件の自動的な failure 扱い／2 桁 code の record 化・総表対応・GT locator の転記ミスの扱い・DocumentHierarchy／PR・merge。

## 16. Freeze sequence

1. **P1（この commit）**: 本文書、標本 `sample.json`、作業リスト `gt-worklist.json`、`baseline-artifacts.json`、選定ツール。
2. **P2**: 視覚 GT を作業リストから作成（baseline・guard の出力を見ない）→ GT freeze commit。**未実施**。
3. **P3**: guard の実装（P2 の後）。
4. **P4**: 初回評価。初回の結果を正式な結果とする。

## 17. Frozen preregistration

| 項目 | 固定した内容 |
|---|---|
| guard 条件 | A∧B∧¬C∧¬D（§6・§7。E・F は不採用） |
| 閾値 | 行間 `[0.75, 1.5] × ref`、x 許容 `0.25 × ref`（LogicalRow の既存定数） |
| 発火時の status | `ambiguous`、value null、reasonCode `name_continuation_evidence_unmerged`、candidates は断片 evidence のみ |
| 評価標本 | 43 unit・39 ページ・8 省庁（`sample.json`） |
| 視覚 GT | 3 ラベル（§10）、層を伏せた作業リスト |
| 指標 | FRI・FAC・CRC・CAI・precision・recall・不変条件の差分（§11） |
| GO/STOP | §12 の数値 |
| baseline コマンド | §13（baseline artifact の sha1 を凍結） |
| treatment コマンド（予定） | §13 |
