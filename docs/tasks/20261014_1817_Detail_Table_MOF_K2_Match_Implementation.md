# 明細表 ↔ MOF 突合: J1 単一候補への K2（exact な項の制約）の実装

状態: 実装契約（実装の前に commit）。結果は本 doc の末尾に追記する。
前提: #460（FY2025 held-out で GO、306/311）。ChatGPT の研究判断（ユーザー経由）: K2 は採用する。範囲は J1 単一候補への exact な項の制約まで。J1 複数の resolution への昇格はまだ STOP。O・K3 などは入れない。

## 範囲（変えない規則は #452 / #460 と同じ）
- 対象: 一般会計で、CONTEXT が `^NN 〇〇所管` の source。J1 は `(ministry, 事項名) == (ministry, jikouName)` の exact。正規化しない。
- X: immediate X。無ければ、凍結済みの anchor carry で取る。MOF は探索に使わない。
- 状態（DETAIL 行ごと）:
  - `K2_SUPPORTED`: J1 単一、X あり、`sectionName == X`。このときだけ MOF の事項を出力する。
  - `UNRESOLVED_SECTION_MISMATCH`: J1 単一で `sectionName != X`。J1 単独へは fallback しない。
  - `UNRESOLVED_NO_X`: J1 単一で X が取れない。
  - `AMBIGUOUS_J1_MULTI`: J1 複数。K2 を適用した後の候補数（0 / 1 / 2+）は diagnostic として出すだけで、1候補でも matched にしない。
  - `UNRESOLVED_J1_NO_CANDIDATE`: J1 0候補。
  - 対象外（理由別）: CONTEXT の無い source、特別会計、CONTEXT が所管の形に合わない source、DETAIL コードの形が合わない行。
- K3・O・金額・NFKC・部分一致・source 固有の例外は使わない。
- 文書では「J1 + K2 で正解が確定した」とは書かない（J1 自体の正しさは validation していない）。

## 合格条件（実装の前に固定）
件数が validation と完全に一致すること。
- FY2025（明細表 `0bdeeb37…`、MOF canonical `9c0a878b…`）: K2_SUPPORTED 976 / SECTION_MISMATCH 10 / NO_X 0 / AMBIGUOUS 224（diagnostic: immediate 1→54・2+→43、anchor 1→93・2+→34）/ NO_CANDIDATE 75 / 対象外 CONTEXT なし 101・特別会計 483。
- FY2024（明細表 `7989885b…`、MOF V2 `a63f5050…`）: K2_SUPPORTED 687 / SECTION_MISMATCH 7 / NO_X 0 / AMBIGUOUS 215（57・37・88・33）/ NO_CANDIDATE 73 / 対象外 213・446。
- 一致しなければ、実装を直す（規則は変えない）。

## 実装
- `scripts/pipeline-v2/lib/budget-request-detail-table-mof-match.ts`（純関数）とテスト、runner `scripts/pipeline-v2/build-budget-request-detail-table-mof-match.ts`、仕様書 `docs/budget-request-detail-table-mof-match.md`。
