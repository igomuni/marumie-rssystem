# MOF 事項 parser の一般化（一般会計 FY2025）— 事前登録

状態: 実装・実行の前に commit する事前登録。範囲は**一般会計の FY2025（成立後・提出時）だけ**。規則は足さず、帳票ごとの値（spec）を差し替え可能にするだけ。特別会計は対象外（別段階）。

入力の根拠: XML 構造 inventory（`tests/fixtures/mof-xml-structure-inventory/`、manifest `c0f4b1d0…`）。FY2025 一般会計は、見出し・行の列構成が FY2024 と同じで、年度の文字（`令和7年度`）と DOCTYPE（`202501.dtd`）だけが違う。

## 1. 変更の範囲（これ以外は変えない）

- parser（`scripts/pipeline-v2/lib/mof-budget-xml-items.ts`）の固定値のうち、次の3つを `spec` として入力に持たせる。**省略時は現在の FY2024 の値**（既存の呼び出し・テストは無変更で同じ結果）。
  - `documentId`（`202411001` → FY2025 は `202511001`）
  - DOCTYPE（`202401.dtd` → `202501.dtd`）
  - 見出しの年度の文字（`令和6年度` → `令和7年度`）
- 行の種類・列の文法・金額の文法・組織の整合・失敗の種類は**一切変えない**。
- CSV の列名の年度の文字は、spec の年度の文字から作る（`令和7年度要求額(千円)`）。FY2024 の列名は不変。
- 入力境界（source set の同一性・menu の XML 集合の完全一致・想定件数）は、FY2024 の既存の関数（`mof-jikou-source-boundary.ts`、`normalize-mof-jikou.ts` が使う）を**変更せず**、FY2025 用の境界を別に置く。

## 2. FY2025 の source set（先に凍結する）

- 作り方: inventory の `files.csv`（全ファイルの SHA-256 と `title_for_list`）から機械的に作る。parser の出力は使わない。`title_for_list` が `〔組織別事項別内訳〕` のファイルを target、それ以外を nonTarget とする。
- 対象: `202511001`、版は 成立後（`2025/2025`）と 提出時（`2025/2025_teishutsu`）の2つ。各版で target 94 / nonTarget 234 / 計 328。
- 置き場: `tests/fixtures/mof-xml-parser-general/2025/` と `2025_teishutsu/`。形式は FY2024 の source set と同じ（`targets` / `nonTargets` に `file` と `sha256`）。
- commit した後は、source set の SHA-256 を境界の定数にする（結果を見て変えない）。

## 3. 実行と確認

1. 2つの版それぞれで、凍結した source set・menu の SHA-256 を境界にして、全 328 ファイルを parser に通す。出力は `jikou-general.csv`（FY2024 と同じ列、年度の文字だけ変わる）。
2. 想定件数（失敗条件）: target 94 / nonTarget 234 のみ。**事項件数は想定値を置かず、報告だけ**する（結果を見て規則を直さない）。
3. 項の一致（確認）: CSV の（組織, 項コード, 項名）の集合が、#471 の FY2025 `kou-general.csv`（公式 CSV の項）と一致するかを報告する。不一致は件数と例を示すだけで、修正しない。
4. Σ事項＝Σ目は**記述だけ**（版ごとの総額と差）。parser の調整の目的にしない。

## 4. 回帰条件（すべて満たさなければ STOP）

- FY2024 一般会計の `jikou-general.csv` が、#471 の凍結値（SHA `2b92b50e…`）とバイト単位で同一。ただし `jikou-general-run.json` は parser のファイルの SHA を記録するため変わるので、回帰の対象は CSV。
- 既存の parser 関連のテスト（`mof-budget-xml-items.test.ts`、`mof-budget-xml-parser-v0-fixtures.test.ts`、`mof-jikou-source-boundary.test.ts`、`mof-jikou.test.ts` ほか parser を使うもの）が、無変更で通る。
- FY2025 の2版を2回実行して、出力が同一。

## 5. STOP の条件

parser の例外（`MofXmlParseError`）、`unsupported`、target / nonTarget の件数不一致、回帰条件の不成立のいずれかが起きたら、そこで止めて**そのまま報告**する。その場で規則を足さない・spec 以外の値を直さない。

## 6. 成果物

- `docs/tasks/20261015_1654_MOF_Jikou_Parser_General_Account_FY2025_Result.md`
- `tests/fixtures/mof-xml-parser-general/{2025,2025_teishutsu}/`: source set、`jikou-general.csv`、実行記録、manifest
