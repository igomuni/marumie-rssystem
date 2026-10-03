# FieldResolver v0 held-out 評価 — 初回結果

## 結論

**STOP**（事前登録 §10: false resolved > 0）。初回評価（正式な結果）は 52 target・282 resolvable field で **false resolved 2・wrong source 0・wrong normalization 0**。blank と explicit zero の取り違え 0、備考領域由来の確定 0、blank の precision/recall は 100%（24/24）。

false resolved 2 件のうち **本当の resolver の誤確定は 1 件**（折り返し名称の切れた確定）、もう 1 件は **GT の locator 転記ミス**（隣の行と照合した）で、後者は初回の数字を置き換えず、post-hoc として別記する（§6）。同じ GT を使った修正は汎化の証拠にならない。規則の修正は新しい実験で行う。

## 1. 手順と固定点

| 項目 | 内容 |
|---|---|
| freeze commit | `abc57b9f8296df7dc8eb87bd98a6eaf7f050bee9` |
| 事前登録 | `ce73e00`（`docs/tasks/20261003_0805_FieldResolver_v0_Heldout_Preregistration.md`） |
| selection freeze | `e678ea8`（4 省庁 × 4 カテゴリ = 16 ページ。選定は低解像度の描画を目視しただけで、FieldResolver の出力を使っていない） |
| GT freeze | `539213e276550870d93dd6234adbdabbfe0e9d8b`（52 target。FieldResolver は未実行） |
| 初回評価 | GT freeze の後に推論 → 評価を 1 回実行し、それを正式な結果とした |
| freeze verification | 推論・評価・Golden・Contract の 9 ファイルが `abc57b9` の blob と一致（PASS）、held-out の manifest / GT も `539213e` と一致（PASS）。評価 CLI は不一致なら評価せず STOP する |

対象ページ（物理ページ。カテゴリ A normal / B blank-zero / C auxiliary / D structural）: 防衛省 12 / 505 / 480 / 535、環境省 110 / 40 / 75 / 18、農林水産省 290 / 150 / 220 / 12、国土交通省 560 / 330 / 120 / 780。環境省 18 と農林水産省 12 は **総表レイアウト**（前年度・要求額が 一般行政経費 / その他の経費 / 計 に分かれる別テンプレート。GT は 計(A)・計(B)・比較増△減(B−A) を 3 field とした）。

GT は作業アシスタントが描画ページを目視して作成した（170 dpi の台帳左側、総表は 110 dpi 全体）。独立した人間のレビューは **未実施（humanReview: pending）**。hierarchy 依存 field は held-out の評価対象外（全 target `outside_v0_scope`）なので、hierarchy policy は今回検証していない。

## 2. 情報量（informative）

blank・explicit zero・explicit sign・auxiliary-heavy・wrapped name・template novelty の 6 種がすべて GT に含まれる（要件は 3 種以上）→ **informative**。quota: visual blank **24**（目標 20、達成）、explicit zero **23**（目標 10、達成）。

## 3. 指標（初回・正式）

| 区分 | GT resolvable | exact | correct abstention | false resolved | wrong source | wrong norm. | unresolved | ambiguous | not found | precision | safe coverage | false-resolve rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 282 | 231 | 125 | 2 | 0 | 0 | 49 | 1 | 30 | 99.1% | 81.9% | 0.9% |
| 通常の台帳 | 242 | 225 | 123 | 1 | 0 | 0 | 0 | 1 | 30 | 99.6% | 93.0% | 0.4% |
| 総表 | 40 | 6 | 2 | 1 | 0 | 0 | 49 | 0 | 0 | 85.7% | 15.0% | 14.3% |

カテゴリ別: normal 62/62 exact（false 0）、blank-zero-rich 84/85（false 0・ambiguous 1）、auxiliary-heavy 48/54（false 1・record 未発見 10 field）、structural 37/81（false 1・総表の abstain 49）。

- blank: GT 24 / 出力 24 / exact 24（precision 100%・recall 100%）。blank を 0 として確定 0、0 を blank として確定 0。
- explicit zero accuracy: 17/23。外れ 6 件はすべて確定しなかったもの（総表ページの 0 が 5 件、record 未発見の行の 0 が 1 件）で、誤った値の確定ではない。
- template abstention: 総表 82.5%（33/40）。見出しの形が違うため `column_layout_unobserved` で全 field が unresolved になり、金額の誤確定は無い（安全な abstention）。
- auxiliary isolation: wrong source 0、差額列の右（備考領域）の根拠で確定した金額 0。
- 算術監査（補助。GT・推論・選定に不使用）: 3 金額が確定した 117 件で `要求額 − 前年度 = 増減`（符号込み）の不一致 0。blank の正しさの証拠にはしない。
- 決定性: 同じ freeze と GT で 2 回評価し、field-resolution 16 件・evaluation.json/md・freeze-verification が byte-identical。

## 4. 失敗・未確定（全件）

| target | field | 結果 | 視覚の真値 | 出力 | provenance / reasonCode | 分類 | 推定される構造的原因 |
|---|---|---|---|---|---|---|---|
| moe-p75-line-011-nature-positive | name | **false resolved** | 5 行の名称「ネイチャーポジティブ（／ＮＰ）の実現に向けた生／物多様性保全等のための／国際協力・ルール先導推／進費」 | resolved「ネイチャーポジティブ（」（1 行目だけ） | name の evidence は 1 行目の token のみ（reasonCode なし） | **resolver の false resolve（名称の切れ）** | LogicalRow が 1 行目（金額のある行）と、続く 4 行（`continuation_by_geometry` の別 logical row）を分けた。FieldResolver は「次行が `ambiguous` で名称領域に token がある」ときだけ name を ambiguous にするため、この分割（ambiguous ではない）を見逃した。金額・符号・code は正しい |
| maff-p12-req69-total-sheet | code | false resolved（**GT locator の転記ミス**） | 要求番号 69 の `06-95` | 隣の要求番号 70 の行の `11-95` と照合された | 出力の 69 の行（L11・y=118pt）は `06-95` を正しく出している | GT 側の誤り（resolver の誤りではない） | GT の `approxYPt` を 185 px でなく隣の行の 206 px で換算した |
| mlit-p120-line-1010-chohi | 全 field | not found（**GT locator の転記ミス**） | `95016-2123-09-1010` 庁費 2,335 / 2,640 / 305 | 出力 L28 は 2,335 / 2,640 / 305・符号 not_observed で一致 | — | GT 側の誤り | pt の 357 を px として換算し直した（233.7pt になった） |
| mlit-p780-line-01-zero-prev-sign | 全 field | not found | `01` 人件費 0 / △100,083 / △100,083 | その行は record 化されなかった | — | recall loss | code が 2 桁（`01`）の行は code と認識しない（行頭 token が 3 桁以上か `-` を含むときだけ code とする規則） |
| mod-p535-line-14-sonota | 全 field | not found | `14` そ の 他 28,947,421 / 47,566,136 / 18,618,715 | record 化されず | — | recall loss | 同上（2 桁の code） |
| mod-p505-line-05-0050-zero-wrapped | name | ambiguous / `continuation_ambiguous` | 3 行の名称 | 確定せず（金額・符号は exact） | 継続候補行が `ambiguous` | 正しい abstention（recall loss） | 継続が LogicalRow で確定していない |
| 総表（moe-p18 ×4・maff-p12 ×3） | 名称・金額・符号のすべて | unresolved / `column_layout_unobserved` | 計(A)・計(B)・比較増△減 | 確定せず | 見出し token の形が通常の台帳と異なる | 安全な abstention（template 非対応） | 列の観測が「概 算 要 求 額」＋文字ごとの見出し token の形に依存 |

## 5. 解釈

- 通常の台帳（4 省庁・12 ページ）では、金額・blank・explicit zero・符号・補助数値の分離は 1 件の例外を除いて一般化した（blank 24/24、zero の誤確定 0、備考領域由来 0）。
- 失敗の構造は 3 つ: ①LogicalRow の継続分割が `ambiguous` でない形で出たとき、名称が切れて確定する（**safety failure**）、②2 桁 code の行を record にしない（recall）、③総表レイアウトに非対応（abstain。誤確定は無い）。
- development Golden の 99.1% は汎化の数字ではなかった: development では名称の継続が全件 `ambiguous` か 1 つの logical row に収まっていた。

## 6. POST-HOC（参考。正式な結果ではない）

GT の転記ミス 2 件の locator だけを評価の呼び出し側で差し替えて同じ出力を再集計した（`evaluate-budget-request-field-resolver-heldout-posthoc.ts`。GT fixture と初回の artifact は変更していない）: false resolved **1**（上記の名称の切れのみ）、record 未発見 2 target（2 桁 code の行）、exact 237/282、safe coverage 84.0%、precision 99.6%。正式な結果は §3 の数字のままで、STOP 判定は変わらない。

## 7. 開示

- GT 作成者は作業アシスタントで、人間の独立レビューは未実施。GT の locator 転記ミスが 2 件あった（§4）。それ以外の値は見直していない。
- 初回評価の後、held-out の推論 CLI から `export` を 1 語外した（`HELDOUT_WORK_DIR`。他の CLI から import すると main が走るため）。推論・評価の意味は変えていない。
- 選定の前に FieldResolver をこれらの PDF で実行したことはない。DocumentHierarchy の実験ではこれらの PDF を扱っていた。
- 失敗の分析（§4 の原因調査）は初回評価の後に出力を見て行った。規則は直していない。

## 8. GO / STOP と次

**STOP**（false resolved > 0）。freeze violation・GT 作成中の出力閲覧・選定への出力使用はない。この held-out set は、今後は development / regression set として扱う。次の改善（例: 継続分割への guard、2 桁 code、総表レイアウト）は、新しい preregistration・branch・新しい held-out で行う。DocumentHierarchy は CLOSED のまま。PR・merge は未実施。

検証: `npx tsc --noEmit` / `npm run lint`（既存 warning のみ）/ `npx vitest run`（92 files・1,241 tests）/ `npm run build` / `git diff --check` すべて OK。
