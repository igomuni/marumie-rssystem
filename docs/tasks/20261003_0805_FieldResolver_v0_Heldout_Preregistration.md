# FieldResolver v0 Held-out 評価 — 事前登録

ページの選定・GT 作成・FieldResolver の評価より前に固定する計画。この文書のコミットが「preregistration commit」。以後、本文の規則は変更しない（変更が必要になった場合は、理由を結果 doc に残して新しい preregistration にする）。

## 1. 目的

development Golden（8 ページ・20 target）は規則の開発中に見たものなので、99.1% は汎化の証拠ではない。freeze した FieldResolver が、**まだ出力を見ていない PDF ページ**で、どこまで安全に確定し、どこで abstain するかを測る。coverage を上げる実験ではない。abstain は観測結果、false resolve は safety failure として扱う。

## 2. Freeze

| 項目 | 内容 |
|---|---|
| freeze commit | `abc57b9f8296df7dc8eb87bd98a6eaf7f050bee9`（branch `research/budget-request-field-resolver-v0-poc`） |
| held-out branch | `research/budget-request-field-resolver-v0-heldout`（freeze commit から分岐） |
| freeze 対象 | `scripts/pipeline-v2/lib/budget-request-field-resolver{,-runs,-paths,-evaluator}.ts`、`scripts/pipeline-v2/extract-budget-request-field-resolver.ts`、`scripts/pipeline-v2/evaluate-budget-request-field-resolver.ts`、`tests/fixtures/budget-request-field-resolver/v0/golden.json`、Contract・Golden Samples doc |
| 検証 | 各ファイルの `abc57b9` 時点の blob SHA と現在の blob SHA を機械的に比較し JSON に出す。1 つでも不一致なら held-out 評価を**実行せず STOP**（評価 CLI の冒頭で実行。テストでも固定） |

追加してよいのは held-out 専用の新規ファイル（manifest・GT fixture・wrapper・verifier・テスト・doc）だけ。既存の inference / Golden / Contract / 既存 evaluator の意味は変えない。DocumentHierarchy は CLOSED のまま（B の調整・A2/A3・B+A2・Future C・親の補完をしない）。

## 3. 対象文書（eligible）

development Golden に含まれない省庁の概算要求 PDF（各省の一般会計の本体 PDF）。

| 省庁 | PDF | ページ数 |
|---|---|---:|
| 防衛省 | `mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf` | 540 |
| 環境省 | `env.go.jp/content/000157010.pdf` | 193 |
| 農林水産省 | `maff.go.jp/j/budget/attach/pdf/230901-2.pdf` | 378 |
| 国土交通省 | `mlit.go.jp/page/content/001630995.pdf` | 1097 |

最低 3 省庁、可能なら 4 省庁すべて。development Golden の 4 省庁（METI / MHLW / MEXT / CFA）のページは使わない。FieldResolver の出力・診断を見たページも使わない（本計画の時点で、上記 4 PDF に FieldResolver を実行したことはない。これらの PDF は DocumentHierarchy の実験では扱った）。

**template novelty**: 既存の列見出し形（`概 算 要 求 額` の token と文字ごとの見出し token）と同じとは仮定しない。見出しを観測できず abstain するページも評価対象で、テンプレートが違うことを理由に除外しない。

## 4. 標本の大きさ

- 主評価: 4 省庁 × 4 ページ = 最大 16 ページ。最低 3 省庁 × 4 ページ = 12 ページ。
- 1 ページ最大 4 target 程度（原則 3）。目標 36–48 target。該当する行が無ければ減ってよい。target 数のために不自然な行を選ばない。

## 5. ページ選定（FieldResolver の出力を使わない）

各省庁で、PDF を人間（作業者）が視覚で見るだけで、次の 4 カテゴリのページを 1 ページずつ選ぶ。

| 区分 | 内容 |
|---|---|
| A. Normal | 通常の要求明細が複数並ぶページ |
| B. Blank / Zero rich | 空欄の金額セル、または明示的な `0` を視覚的に含む（可能なら両方） |
| C. Auxiliary-heavy | 右側・行間に積算・備考・過年度表・数量×単価・別表・補助数値が多い |
| D. Structural / template boundary | 見出し配置が通常と違う／ページ途中から表が始まる／長い折返し名称／符号がある／organization・item・request 境界付近／複数表が同居、のいずれか |

選定に使ってよい情報: 省庁名、ファイル名、ページ数、目次、印刷ページ番号、PDF を普通に見て分かる帳票種別、既存 manifest。

選定に使ってはならない情報: FieldResolver の出力・reasonCode・resolved/unresolved 率・内部診断・金額抽出結果・列検出結果・算術監査・Golden evaluator の出力。「失敗しそうなページ」も「成功しそうなページ」も探さない。

選定の実作業は、`pdftoppm` で低解像度に描画した画像を目視して行い、選んだページを manifest に封印する（selection freeze commit）。封印後はページを入れ替えない。PDF 破損・ページ番号誤記など実験不能な場合のみ、理由を明記して replacement を新たに事前登録する。

## 6. GT 作成

selection freeze 後、FieldResolver の出力を見ずに、原本 PDF を高解像度で描画して視覚で GT を作る（`pdftoppm`・全体 130dpi、読み取りにくい行は 220dpi の切り抜き）。

- field: code / name / previousBudget / requestedBudget / difference / 3 つの sign / pageUnitLabel / source association class。hierarchy 依存 field は、凍結済み DocumentHierarchy artifact と Contract §9 から評価できる場合だけ対象にする。
- 禁止: FieldResolver の出力、抽出された金額、差額の算術補完、大小関係からの符号推測、他ページからの blank/0 補完、一般知識。
- 符号は `△` `▲` `-` が実際に見えるときだけ。
- 各金額セルを `explicit number` / `explicit zero` / `visual blank` / `visually uncertain` に分ける。`visual blank` はセル領域を確認できたときだけ。不明なら `visually uncertain` とし、blank の GT にしない（評価から除く）。
- 補助表に同じ値があるときは、core 行の値として見えている source を記録する。折り返し名称は raw lines を保存。Unicode の code point を視覚で確定できないものは MEXT Golden と同様に明記し、評価は空白除去（＋必要なら NFKC）で行う。
- GT 作成者は作業アシスタントで、独立した人間の目視レビューは GT freeze の時点では未実施になり得る。その場合は `humanReview: pending` と記録し、レビューで値が変わっても初回評価の数字は置き換えず、差分として別記する。

target の選び方（出力を見ずに）: ①空欄を含む行 ②明示的な 0 を含む行 ③明示的な符号を含む行 ④補助と同値・類似値がある行 ⑤折り返し名称 ⑥通常の 3 金額行、の優先順。似た通常行を大量に選ばない。

## 7. Blank / explicit zero の quota

GT 全体で、visual blank の金額 field **20**、explicit zero の金額 field **10** を目標とする。選定済みページに自然に無ければ、selection freeze 後にページを追加・変更しない。その場合は `observed blank = N / observed explicit zero = N / quota not met` と記録する。quota は評価の情報量を確認する目標で、ページ選定を歪めるためのものではない。

## 8. First-run rule

order: freeze verify → 本 preregistration → selection freeze commit → GT 作成 → **GT freeze commit**（manifest・GT fixture・human review metadata・評価基準）→ freeze verification → FieldResolver run → **最初の評価を正式な held-out 結果とする** → result commit。

初回の結果が悪くても、規則を直した再評価の数字で置き換えない。STOP でも初回結果を保存する。同じ held-out set を使った修正版は、もはや held-out ではなく development / regression set として扱う。

## 9. 指標

development と同じ: exact resolved / exact blank / false resolved / wrong normalization / wrong source / correct abstention / unresolved / ambiguous / precision / safe coverage / false-resolve rate（分母は resolved または blank の出力）。

追加:

- blank precision = exact blank / blank と出力した全数
- blank recall = exact blank / GT の visual blank
- explicit-zero accuracy = exact explicit zero / GT の explicit zero
- template abstention rate（未検証 template のページ）= unresolved または ambiguous の field / 評価対象の resolvable field（failure と決めつけず、安全な abstention と false resolve を分けて報告）
- auxiliary isolation = wrong-source 数、auxiliary 由来の false-resolve 数（独立に報告）
- 算術監査（要求−前年度＝増減）は補助指標として別節で報告。GT 作成・inference・target 選定・blank の正しさの証拠には使わない。

## 10. 成功・STOP 基準

**primary safety（最優先）**: false resolved = 0、wrong source = 0、wrong normalization = 0、auxiliary 由来の core 値 = 0、blank→explicit zero の誤り = 0、explicit zero→blank の誤り = 0。coverage は測るが 100% を要求しない。

**informative 要件**: GT に次のうち最低 3 種類が実際に含まれる — blank / explicit zero / explicit sign / auxiliary-heavy / wrapped name / template novelty。満たさなければ `NON-INFORMATIVE`（成功扱いにしない）。

**GO**: false resolved 0・wrong source 0・blank/zero の取り違え 0・GT 汚染なし・freeze 違反なし・informative。coverage の低下だけでは STOP にしない。abstention が極端に多ければ `GO-WITH-SCOPE` として範囲を明記。

**STOP**: false resolved > 0／wrong source > 0／blank を 0 として確定／0 を blank として確定／freeze violation／GT を見た後の inference rule 変更／held-out 選定に FieldResolver の出力を使用／GT 作成中に FieldResolver の出力を閲覧。STOP でもその場で規則を直さず、結果 doc に failure field・視覚の真値・出力・provenance・reasonCode・failure class・推定される構造的原因を記録する。改善は新しい task / branch / preregistration で行い、同じ GT を改善後の汎化の証拠に使わない。

## 11. 成果物

- `tests/fixtures/budget-request-field-resolver/heldout-v0/{manifest,golden}.json`
- `data/work/budget-request-field-resolver/heldout-v0/{freeze-verification.json,evaluation.json,evaluation.md}`（gitignored・決定的。同じ freeze と GT で 2 回評価して byte-identical を確認）
- `docs/tasks/<timestamp>_FieldResolver_v0_Heldout_Result.md`
- 検証: tsc / lint / vitest / build / `git diff --check`、freeze verifier・GT 汚染の静的テスト・manifest と GT の validation・決定性。

## 12. 範囲外

「概算要求の事項・目の細分 ↔ MOF 事項・目」の対応調査は混ぜない。held-out GT に MOF のデータを真値として使わない。DocumentHierarchy 側の failure を見つけても、FieldResolver の結果（abstention / 誤った親の関連付け）として記録するだけで、hierarchy の規則は変えない。
