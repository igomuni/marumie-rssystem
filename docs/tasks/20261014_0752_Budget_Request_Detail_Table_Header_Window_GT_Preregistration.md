# 明細表: 表頭の窓による空欄列の位置合わせ — 独立GTの preregistration（draft）

状態: **draft（未凍結）**。candidate 集合（140行）は固定済みで、GT・窓の評価は未実施。結論なし。
根拠: #439 の調査（空欄の列が決まらなかった485行のうち、表頭の窓だけで列が一意に決まるのは140行）。窓の規則と、その140行が出る手順は `scripts/research/isolate-detail-table-failures.py` と `scripts/research/build-detail-table-window-gt-candidates.py`。

## 1. 仮説 H（事前固定）

> 実測の右端で列を決められなかった2金額行のうち、表頭の窓だけで列が一意に決まる140行では、その列配置は正しい。

## 2. candidate 集合（固定）

- `tests/fixtures/budget-request-detail-table-window-gt/2024/candidates.csv`（140行、7 source、31ページ）。SHA-256 `5eb726cff22311c4b3c3262a27c00fa863d18931ebd4b36a3ecefab6bc4bd52f`。
- 列: `source_file, source_page, source_line_start, raw_text`。**窓の判定結果・候補列は含めない。** 追加・削除はしない。
- `candidates-manifest.json` に、元PDF 7本の SHA-256 とページ数（plain text のページ数と一致）を記録。元PDFが無い、ページ数が合わない、ハッシュが合わない場合は GT 作成に進まず STOP。

## 3. 独立性（GT作成）

- annotator（Codex Worker、effort high）に渡すのは、**指定された140 targetの、元PDFページ画像だけ**。窓の予測値、算術診断、#439、「窓で一意になった集合」という選定理由は渡さない。
- 画像は、元PDFのページ全体をそのまま render したもの（crop・強調・注釈なし）。render は GT 作成とは別 Task（機械的な準備のみ）。`source_file/source_page` ↔ PDF SHA-256 ↔ PNG SHA-256 を render manifest として凍結。
- 禁止: 算術（`x=y` 等で空欄列を決めること）、raw text の空白配置だけを根拠にすること、ラベルや列の計算コード。必須: `decisions.md`。

## 4. GT の契約（9列に固定）

`source_file / source_page / source_line_start / raw_text / 第1金額の列 / 第2金額の列 / 空欄列 / 状態 / 根拠`

- 列は {前年度予算額, ６年度概算要求額, 対前年度比較増△減}。
- 状態:
  - **RESOLVED**: 3列のどこに各金額が置かれているかを、視覚的に一意に説明できる。「見た目で○列に近い」だけでは不可。
  - **AMBIGUOUS**: 画像は読めるが、視覚的位置だけでは複数の列解釈が残る。
  - **UNREADABLE**: 画像・文字・罫線が不鮮明で、位置判定そのものができない。
- 140件すべてを RESOLVED にする義務はない。見えなければ AMBIGUOUS / UNREADABLE。

## 5. 判定（GT 凍結後に初めて窓の候補と照合）

- 1 unit は、**第1金額の列・第2金額の列・空欄列の3つ全部が一致して初めて correct**。部分一致は correct にしない。
- RESOLVED に対する precision が **100%** なら GO、**誤配置1件でも STOP**（failure isolation に戻る）。AMBIGUOUS / UNREADABLE は coverage から除外し、正解扱いしない。
- RESOLVED が0件なら「100%」とせず **NO EVALUABLE GT / STOP**。
- 最低 coverage は設けない。RESOLVED の件数は結果として報告する。
- GO の場合も、実装は 140件の特例ではなく一般規則（窓で一意なら配置する）。凍結した140件は評価集合。

## 6. 順序

#439 merge（済） → **この preregistration と candidate manifest（本PR）** → render manifest 凍結 → annotation protocol 確定 → blind visual GT 作成 → **ChatGPT pre-freeze review**（preregistration・candidate manifest・render manifest・GT全件・decisions.md・annotation instructions。窓側の評価結果は見ない。見る点: 契約違反、forced resolution、根拠不足、AMBIGUOUS/UNREADABLE の使い分け、candidate leakage）→ GT 凍結 → 窓の評価 → GO/STOP → 実装。

## 7. 未決

- annotation instructions の本文（次のPR）。
- Codex の画像読み取りが、小さな表の列位置を視覚的に判定できるか（できなければ UNREADABLE が多くなる。結果として報告し、無理に RESOLVED にしない）。
