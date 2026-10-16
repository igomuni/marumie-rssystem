# 明細表 ↔ MOF 突合: J1 複数を K2 で1候補に絞った行の blind visual GT — preregistration（draft）

状態: **契約確定（GT 作成前）。** candidate 集合（147行）・render・指示書・primary scope・判定基準（§5）を固定した。GT は未作成で、評価もしていない。
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
- parser の X、MOF の候補、K2 の予測、選定の理由は渡さない。text 層・plain text・コードによる探索は禁止（`annotation-instructions.md`、`100fe50b…`。GT 作成前に、項のコードを「2桁または3桁 `NN[N]`」に直した。K2 の凍結規則 `CODE2/CODE3 + ^([0-9]{2,3}) (.+)$` に合わせる修正で、仮説は変えていない。修正前は `2daa6e71…`）。
- annotator は Codex Worker を2体（A・B）、互いに独立に動かす（前回の窓 GT と同じ形）。A と B が食い違った行は、別の Worker が画像と A/B のラベルだけを見て adjudication する（parser の値は見せない）。
- GT は凍結してから評価する。凍結の前に ChatGPT の pre-freeze review を受ける。

## 4. GT の契約

`target_id, source_file, source_page, source_line_start, raw_text, 項コード, 項名, 状態, 根拠`。状態は RESOLVED / AMBIGUOUS / UNREADABLE / NOT_IN_WINDOW。項名は文字間の空白を除いて紙面どおり。RESOLVED のときだけ項コードと項名を入れる。

## 5. 判定（確定。GT 凍結後に初めて照合する）

- **primary population:** `primary-scope.csv` で `primary_w5 == true` の全 target（102件。immediate 54・anchor 48）。`primary-scope.csv`（SHA-256 `1194cb43b49bf5edf7aa2483c71bc821fd78d20bd8f866ab4961ff925a135301`）は、parser と #461 の source-only X の規則だけから機械的に計算した（target ごとの x_source、target の頁、X の行の頁、頁の差、`primary_w5 = 0 <= 頁の差 <= 5`）。MOF の候補・GT・annotation は使っていない。annotator・adjudicator には渡さない。
- 凍結した final GT に対して、primary の各 target を次のどれかにする:
  - **PASS:** `状態 == RESOLVED` で、GT の項名が K2 で選ばれた唯一の候補の `sectionName` と exact に一致する。
  - **FAIL:** `状態 == RESOLVED` で、exact に一致しない。
  - **UNEVALUABLE:** AMBIGUOUS / UNREADABLE / NOT_IN_WINDOW。
- 判定:
  - **GO:** FAIL = 0 かつ PASS / primary population >= 0.95（102件なら PASS >= 97）。
  - **STOP:** FAIL >= 1。
  - **INCONCLUSIVE:** FAIL = 0 だが PASS / primary population < 0.95。
- immediate と anchor 別の結果を必ず記述する。あわせて、GT の項名に一致する J1 候補の数（0 / 1 / 2+）と、状態別の件数も記述する。
- `primary_w5 == false` の45件は secondary の記述だけにする。GO になっても、production の resolution への昇格の対象にはしない。
- 結果を見て、候補集合・窓・GT・基準を変えない。

## 6. 次の手順

1. 本 draft（とくに §5）の合意。
2. Orca で annotator A・B を dispatch する（この session には Orca のツールが無いため、dispatch はユーザーの操作か、Orca を使える session で行う）。
3. adjudication → ChatGPT の pre-freeze review → GT の凍結 → 評価（1回）。
