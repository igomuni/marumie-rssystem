# FieldResolver v0 — 環境省 p75 `011` false resolve の failure isolation

コード変更なし（調査のみ）。対象は held-out で見つかった `011 ネイチャーポジティブ…` の名称切れ 1 件の因果の切り分けだけ。2 桁 code・総表・GT locator 転記ミス・DocumentHierarchy は扱わない。

## 結論

- 「5 行で 1 名称」という情報は、**SourceToken と PhysicalRow までは完全に保たれ、LogicalRow の出力で「1 行目の続きかもしれない」という信号が消え、FieldResolver はその信号の不在を「名称は完結している」と読んだ**。
- 原因は 2 層にまたがる。①LogicalRow は 1 行目と 2 行目を**結合しない**という保守的な判断をしたが、その後ろに行が連鎖すると、判断の理由（`ambiguous`・`possibleContinuationOfLogicalRow`）を**上書きして出力から消す**（出力契約上の情報保持の欠け）。②FieldResolver は名称の完全性を「次の logical row が `ambiguous` か」という 1 つの信号だけで判定しており、信号が無いことを完結の証拠として扱った（**完全性判定の不足**。こちらが safety failure の直接の原因）。
- 結合（完全な名称を作る）と guard（不完全な名称を resolved にしない）は別問題で、guard は既存 evidence だけで構成できる（§5）。
- 同じ型の切れは p75 内に**未評価のまま他に 2 件**（`006`・`011`〈世界自然遺産〉）あり、開発用に走らせた範囲でも**候補が 83 件**ある（§6）。

## 1. p75 `011` の分割（実データ）

PDF の視覚の真値: 名称は 5 行（`ネイチャーポジティブ（` / `ＮＰ）の実現に向けた生` / `物多様性保全等のための` / `国際協力・ルール先導推` / `進費`）。金額（124,588 / 124,588 / 0）と code `011` は 1 行目の高さにあり、右の備考欄に `（要求要旨）` の文章が 6 行続く。

| 段階 | 内容 |
|---|---|
| SourceToken | 名称は行ごとに 1 token（x=97〜173、`ＮＰ）…` 以降も各 1 token）。code `011`[71]、1 行目名称[73]、2〜5 行目名称[74][75][76][77]。備考は x=469 から始まる token（`（要` `求` … と長文の 1 token） |
| PhysicalRow（baseline） | P8 y=104.2（`011`＋1 行目名称＋金額 3 列）、P9 111.1（2 行目名称＋備考 `（要求要旨）`）、P10 118.0、P11 125.0、P12 131.9（`進費`＋備考）、P13・P14 は備考のみ。行間は約 6.94pt = 基準フォントの 1.0 倍 |
| LogicalRow | **L7 = [P8]**（`same_physical_row`）、**L8 = [P9, P10, P11, P12, P13, P14]**（`continuation_by_geometry`）。名称の 5 行が L7（1 行目）と L8（2〜5 行目＋備考）に割れている |

## 2. LogicalRow の判断（どこで何が成立したか）

LogicalRow の規則（`resolveLogicalRows`）: 縦の行間が基準フォントの 0.75〜1.5 倍のとき、次の physical row の**すべての水平 segment** の開始 x が、直前の candidate の token の開始 x のどれかと揃えば結合、1 つでも揃わなければ結合せず `ambiguous` の新しい candidate にする。

- **P8→P9**: 行間 1.0 倍で範囲内。P9 は 2 segment（名称 x=97、備考 x=469）。名称 segment は P8 の名称 token（x=97）と揃うが、**備考 segment（x=469）は L7 に揃う token が無い**（1 行目の備考欄が空のため）→ 1/2 が不揃い → 結合せず、`ambiguous`・`possibleContinuationOfLogicalRow=7` の新しい candidate を作った。
- **P9→P10, P10→P11, P11→P12, P12→P13, P13→P14**: どの行も名称 segment（x=97）が直前行の名称 token と、備考 segment（x=469）が直前行の備考 token と揃う → すべて結合（`continuation_by_geometry`）。
- ここで実装は `prev.kind = 'continuation_by_geometry'; prev.evidence = {vertical, alignment}` と**代入で上書き**する。L8 の draft は P9 で `ambiguous`（理由と `possibleContinuationOfLogicalRow=7` つき）として始まったが、P10 が連鎖した時点で kind と evidence が置き換わり、出力された L8 は `continuation_by_geometry`・evidence に `possibleContinuationOfLogicalRow` なし。`diagnostics.ambiguousContinuations`（kind が `ambiguous` の candidate だけを列挙）にも載らない。
- つまり L7→L8（P8→P9）の不確定性は、LogicalRow の出力のどこにも残っていない。LogicalRow が結合しなかったこと自体は規則どおりで（備考欄の x が揃わない）、誤りではないが、「結合できなかった理由が備考 segment の不揃いだけで、名称 segment は揃っていた」という事実も出力から失われる。

## 3. FieldResolver が参照した情報・しなかった情報

- 参照した: L7 の token（`011`・1 行目名称・金額）、**次の logical row L8 の `resolution.kind === 'ambiguous'` かつ `possibleContinuationOfLogicalRow === 7` か**（名称の ambiguity 判定は、この 1 条件で、さらに L8 の token が名称領域にあること）。
- 実際: L8 は `continuation_by_geometry`・`possibleContinuationOfLogicalRow` なし → 条件不成立 → name を `resolved`（根拠 token は 1 行目の[73]だけ、associationClass `same_row`）。
- 参照しなかった（既存の evidence で入手可能だったもの）: L8 の先頭 physical row が L7 の最終 physical row の直下（行間 1.0 倍）にあること、L8 の先頭 segment が L7 の名称 token と同じ x（97）で始まること、L8 に row-leading の code token が無いこと、L8 に金額 token が無いこと。FieldResolver は code の無い logical row を record 化せず読み捨てる（`observeCode` が null）ので、L8 の名称領域の token はどの record の evidence にもならなかった。

## 4. LogicalRow の誤りか、FieldResolver の判定不足か

| 層 | 判断 | 評価 |
|---|---|---|
| LogicalRow の結合判断 | P9 を L7 に結合しなかった | 規則どおりで保守的（備考 segment が揃わない）。誤りとは言えない |
| LogicalRow の出力 | 連鎖後に kind と evidence を上書きし、最初の `ambiguous`・`possibleContinuationOfLogicalRow` が消える | **情報保持の欠け**（`ambiguousContinuations` の診断も欠ける）。下位層は凍結だが、これは今後の層の契約として記録すべき |
| FieldResolver | 名称の完全性を「次行が `ambiguous`」という 1 信号だけで判定し、無ければ完結と見なす | **完全性判定の不足（直接の原因）**。「継続の証拠が無い」と「完結の証拠がある」を区別していない。Contract（継続は LogicalRow の evidence があるときだけ結合する）は、結合しないことは要求するが、不完全かもしれない名称を resolved にしないことまでは求めていない |

下位層の出力を直さなくても、FieldResolver 側は既存 evidence だけで guard できる（§5）。

## 5. false resolve を防ぐために使える既存 evidence（実装はしない）

次はすべて SourceToken / TableGeometry / LogicalRow の既存出力から計算できる（Golden・他ページ・辞書は不要）。

| # | evidence | 取り方 | 強さ・注意 |
|---|---|---|---|
| E1 | 次の logical row の先頭 physical row が、この record の最終 physical row の直下（行間が LogicalRow の継続範囲内） | `physicalRows` の baseline の差 | 必要条件。範囲内でも独立した行はあり得る |
| E2 | 次の logical row の先頭 segment の開始 x が、この record の名称 token の開始 x と揃う（LogicalRow と同じ許容） | `segments`・token の bbox | 強い。名称の折り返しは同じ x から始まる |
| E3 | 次の logical row に row-leading の code token が無い | 既存の code 観測（`observeCode`）を次行にも適用 | 強い。新しい record は必ず code から始まる。code の無い名称領域のテキストは孤児になる |
| E4 | 次の logical row の金額セルに token が無い | 列領域との照合 | 補助。継続行は金額を持たない |
| E5 | 非結合の理由が名称 segment ではなく備考（右側）segment の不揃いだけ | 次 candidate の先頭 physical row の segment ごとに、直前 candidate の token との x の揃いを再計算（LogicalRow の `alignment` は連鎖後に上書きされるため再計算が必要） | 強い。「名称側は揃っていて、備考が揃わないために結合しなかった」を識別できる |
| E6 | 1 行目が名称領域の幅を使い切っている（1 行目の xMax がそのページの名称 token の最大 xMax と一致） | ページ内の名称 token の xMax 分布 | 弱い補助（11 字で折り返す設計だが、ちょうど 11 字の完結名もある）。単独では使わない |
| E7 | 名称が閉じていない括弧（`（` のみ）で終わる | 文字列の簡単な検査 | 弱い補助。言語依存の字句ヒューリスティックで、名称の正規化・補正ではないが一般性が低い。推奨しない |
| E8 | 名称の evidence が 1 physical row だけで、LogicalRow 上は直後に未結合の candidate がある | `physicalRowIndexes` と隣接 candidate | 構造的な事実として使える |

**guard と結合は別問題**: guard は「E1∧E2∧E3（＋E5）が成立したら、name を `resolved` にせず `ambiguous`（候補として「1 行目のみ」「1 行目＋続き」を保持）にする」という**抑制だけ**で足り、false resolve を 0 にできる（recall は下がる）。結合（完全な名称で resolved にする）は、続きの行をどこまで取るか（備考への混入、次の record の名称との境界）を決める必要があり、E1〜E5 に加えて終端の判断が要る。結合は guard とは独立の、別の実験で扱うべき。

## 6. 影響範囲（既存出力の読み取りのみ）

- p75 内で同型の切れが**他に 2 件**: `006`（`自然環境保全地域等保全`、正しくは「…保全対策費」で `対策費` が欠ける）、`011`（世界自然遺産）（`世界自然遺産等保全対策`、`費` が欠ける）。いずれも出力は `resolved`。GT の target に入っていないため、初回評価では見えていなかった。`016` は L14 に続きが結合されて完全な名称（正しい）。
- held-out 16 ページの 550 の隣接境界のうち、「行間が継続範囲内で、かつ `ambiguous` として残っていない（連鎖で消えた）」境界は 5 件。うち code が無く先頭 x が前の candidate の token と揃うもの（名称の継続候補）が 3 件（すべて p75）。
- 開発用に走らせた範囲（METI 9–106・MHLW 1555–1700 ほか、15,382 境界）では同条件の境界が 222 件、うち名称の継続候補（code 無し・x が揃う）が **83 件**（`必要な経費`・`に必要な経費`・`庁費` など、要求や項の名称の後半と見られる）。これは**候補の数で、PDF との照合はしていない**（上限の見積り）。development Golden の 8 ページでは、これらは target に当たらなかったため顕在化しなかった。

## 7. 情報の保持（段階ごと）

| 段階 | 「5 行で 1 名称」の保持 | 失われた/使われなかった所 |
|---|---|---|
| PDF visual truth | 5 行・1 名称（左の名称列で x=97 から同じ幅で折り返し、金額・code は 1 行目のみ） | — |
| SourceToken | 保持（行ごとの token・x・y。文字列は補正なし） | 行をまたぐ関係は表現しない（設計どおり） |
| PhysicalRow | 保持（5 行が行間 1.0 倍で縦に並ぶ。名称 x=97 が揃う） | 行をまたぐ関係は表現しない |
| LogicalRow | **半分だけ保持**。2〜5 行目は 1 つの candidate（L8）に連鎖。1 行目との関係は「非結合」としか出ない | L7→L8 の `ambiguous`・`possibleContinuationOfLogicalRow=7`・「名称 segment は揃っていた」が上書きで消失。`ambiguousContinuations` にも載らない |
| FieldResolver | 1 行目だけで名称を確定 | 消費したのは「次行が ambiguous か」の 1 信号のみ。E1〜E5（直下・x の揃い・code 無し・金額無し・備考側だけの不揃い）は既に手元にあったが未使用。code の無い L8 は record 化されず捨てられた |

境界: 情報は LogicalRow の出力（上書き）で弱まり、FieldResolver が「信号なし＝完結」と解釈した所で安全側に倒れなかった。
