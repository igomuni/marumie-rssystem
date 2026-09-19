# Local TypeScript Pipeline V2 comparison checklist

ローカル実装と参照実装を比較するときは、最終JSONの完全一致より先に以下を比較してください。

## 1. Input inventory

- MOF files: 35
- RS files: 276
- total raw files: 311
- `kessan_06_zenntaibann.pdf` がinventoryに存在すること
- SHA-256 は `sample_run/source-manifest.json` と比較

## 2. FY2024 MOF source-preserving section counts

| phase | general | special | agency | total |
|---|---:|---:|---:|---:|
| initial | 784 | 250 | 22 | 1,056 |
| supplement #1 | 799 | 200 | - | 999 |
| settlement | 978 | 272 | 22 | 1,272 |

## 3. FY2024 legacy code-centric counts

項名をidentityから外し、項コード中心で畳む場合:

| phase | general | special | agency | total |
|---|---:|---:|---:|---:|
| initial | 784 | 248 | 22 | 1,054 |
| supplement #1 | 799 | 198 | - | 997 |
| settlement | 978 | 270 | 22 | 1,270 |

差分は東日本大震災復興特別会計の項コード `01` / `02` の再利用。

この差がローカル実装で消えている場合、`項コード` を一意IDとして扱っていないか確認する。

## 4. FY2024 settlement equations

- checked 目 rows: 8,358
- budget-components → current budget mismatch: 0
- current budget → spent + carryover + unused mismatch: 0

## 5. FY2025 submitted → enacted

今回のrawで提出版が存在する一般会計・特別会計のみ比較:

- changed semantic item groups: 17
- general: 14
- special: 3
- net delta: **-356,655,880,000円**

政府関係機関は提出版rawが無いため、enacted-onlyを国会追加イベントとして扱わないこと。

## 6. RS 2-2 row counts / time axis

- review 2024: 55,609 rows
- review 2025: 70,915 rows

review 2024 fiscalYear distribution:

- 2021: 11,369
- 2022: 11,940
- 2023: 15,954
- 2024: 16,346

review 2025 fiscalYear distribution:

- 2021: 10,841
- 2022: 11,286
- 2023: 15,099
- 2024: 16,646
- 2025: 17,043

`reviewYear == fiscalYear` を前提にしない。

## 7. Diagnostic exact MOF↔RS links

参照実装（fuzzyなし、名称完全一致のみ）:

- review 2024 → FY2024: linked projects 4,673
- review 2025 → FY2024: linked projects 4,537
- review 2025 → FY2025: linked projects 4,851

既存V1と差が出ても自動的に合わせない。snapshot、MOF identity、RS row filter、budgetType filterのどこで差が出たかを分解する。

## 8. Independent checker

```bash
python3 independent_check.py \
  --raw-root data/download \
  --report data/pipeline-v2-reference/validation/report.json
```

`independent check: PASS` になること。
