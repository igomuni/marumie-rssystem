# 明細表 ↔ MOF 突合: J1 複数を K2 で1候補に絞った行の blind visual GT — preregistration（draft）

状態: **draft（未凍結）。** candidate 集合（147行）・render・指示書は固定済み。GT は未作成で、評価もしていない。判定基準（§5）は案で、ユーザーと ChatGPT の合意で確定する。
前提: #461（K2 は J1 単一候補にだけ適用。J1 複数は AMBIGUOUS のまま）。ChatGPT の研究判断（ユーザー経由）: 次は J1 複数の resolution を、blind な visual GT で検証する。窓の幅（W=5）はユーザーが決めた。

## 1. 仮説 H（事前固定）

> FY2025 の J1 複数のうち、K2（source から取った項 X と sectionName の exact 一致）で候補がちょうど1件に絞れる行では、その1件が正しい（source 上でその事項が属する項と、候補の sectionName が一致する）。

## 2. candidate 集合（固定）

- `tests/fixtures/detail-table-j1-multi-k2-visual-gt/2025/candidates.csv`（147行、13 source）SHA-256 `9a1266bbfd778661ffa8be98d7bda7ba85fe8f675d3267887bc364cd5bced4d1`。
- 選定規則: #461 の FY2025 出力（output-manifest `5b17a565…`）で `status == AMBIGUOUS_J1_MULTI` かつ `k2_candidates == 1` の全件。追加・削除しない。内訳は immediate X 54・anchor 93（annotator には渡さない）。
- 列は `source_file, source_page, source_line_start, raw_text` だけ。X、MOF の候補、K2 の結果、x_source は含めない。
- `candidates-manifest.json`（`a3266fd7…`）に、入力 hash（#461 出力、明細表 `0bdeeb37…`、plain text zip `11909d76…`、PDF corpus）と、元 PDF 13本の SHA-256・頁数を記録した。
- 生成: `python3 -I scripts/research/build-j1-multi-k2-visual-gt.py`（`216e0400…`）。

## 3. 独立性（GT 作成）

- annotator に渡すのは、各 target の頁と、同じ PDF のその前の最大5頁（W=5、対象ごとに変えない）の画像だけ。PNG 461枚、150 dpi、crop・強調・注釈なし。`render-manifest.json`（`8b0f868b…`）に PDF/PNG の SHA-256 を固定した。
- 窓の幅はユーザーが決めた。設計時に、parser の位置から数えた「項の行が窓の中にある行」は 102/147（参考値。annotator には渡さない）。窓の外の項は `NOT_IN_WINDOW` になり、評価から外れる。そのため結論は「項が対象行から5頁以内にある行」に限られる。
- parser の X、MOF の候補、K2 の予測、選定の理由は渡さない。text 層・plain text・コードによる探索は禁止（`annotation-instructions.md`、`2daa6e71…`）。
- annotator は Codex Worker を2体（A・B）、互いに独立に動かす（前回の窓 GT と同じ形）。A と B が食い違った行は、別の Worker が画像と A/B のラベルだけを見て adjudication する（parser の値は見せない）。
- GT は凍結してから評価する。凍結の前に ChatGPT の pre-freeze review を受ける。

## 4. GT の契約

`target_id, source_file, source_page, source_line_start, raw_text, 項コード, 項名, 状態, 根拠`。状態は RESOLVED / AMBIGUOUS / UNREADABLE / NOT_IN_WINDOW。項名は文字間の空白を除いて紙面どおり。RESOLVED のときだけ項コードと項名を入れる。

## 5. 判定（案。GT 凍結後に初めて照合する）

- 評価の単位は RESOLVED の行。**正しい** = GT の項名が、K2 で選ばれた1候補の `sectionName` と exact に一致する（K2 の定義上、parser の X とも一致する）。
- あわせて記述として出すもの: GT の項名に一致する J1 候補の数（0 / 1 / 2+）、immediate 54 と anchor 93 別の結果、状態別の件数（NOT_IN_WINDOW を含む）。
- **案:** RESOLVED が 50 件以上で、正しい割合が 95% 以上なら GO（`K2_REDUCED_SINGLE` などの別 status として実装してよい）。95% 未満なら STOP。RESOLVED が 50 件未満なら INCONCLUSIVE。（#460 と同じ基準。厳しくするなら、前回の窓 GT のように「誤り1件で STOP」も選べる）
- 結果を見て、候補集合・窓・GT・基準を変えない。

## 6. 次の手順

1. 本 draft（とくに §5）の合意。
2. Orca で annotator A・B を dispatch する（この session には Orca のツールが無いため、dispatch はユーザーの操作か、Orca を使える session で行う）。
3. adjudication → ChatGPT の pre-freeze review → GT の凍結 → 評価（1回）。
