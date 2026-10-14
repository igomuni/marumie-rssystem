# 明細表 ↔ MOF 突合 X anchor — FY2025 held-out validation（one-shot）— 結果

状態: 実行済み（事前登録 `e748b66` の契約どおり、1回だけ実行）。結論: **GO。** primary（J1 単一・immediate X なし・anchor あり）は FY2025 で `sectionName == X_anchor` が **306/311（98.39%、Wilson 95% 区間 96.29〜99.31%）** となり、事前に決めた 95% 以上（評価可能な行数 50 以上）を満たした。事前の契約により、K2（anchor carry による項の持ち越し）を採用してよい。

事前登録: `docs/tasks/20261014_1810_Detail_Table_MOF_X_Anchor_FY2025_Validation_Preregistration.md`。下限の 50 はユーザーが実行前に承認した。

## 実行
- `python3 -I scripts/research/validate-detail-table-mof-x-anchor.py 2025 tests/fixtures/detail-table-mof-x-anchor-validation/2025/result.json` を1回だけ実行した（exit 0。入力 hash の照合は通過）。
- スクリプト SHA-256 `7b7558adbc8282d5da9fa41a513c889870a5a4ffd224277f3dd179bc535f4cdc`（commit `e748b66` と同じ）。
- stdout と result.json の SHA-256 はどちらも `04b7a4feee745fe5d2d9b8bc46be4967f404ed2e4e75187140f8253d3774737a`（同一）。
- 入力: 明細表 output-manifest `0bdeeb37…`（source CSV 123）、MOF canonical `9c0a878b…`（1,287件）。

## 母集団
- 対象とした DETAIL 行: 1,285。除外: CONTEXT の無い source 101行、特別会計 483行。DETAIL コードの形が合わない行と、CONTEXT が所管の形に合わない source は 0。
- J1: 単一 986 / 複数 224 / 0候補 75。
- J1 単一の内訳: immediate X あり 675、immediate X なし 311（anchor が取れない行 0）。

## 結果

| 区分 | n | 一致 | 割合 | FY2024（development） |
|---|---:|---:|---:|---|
| **primary: 単一・immediate X なし（X_anchor）** | **311** | **306** | **98.39%** | 216/220（98.18%） |
| secondary: 単一・immediate X あり | 675 | 670 | 99.26% | 471/474 |
| secondary: 単一・source-only X（合計） | 986 | 976 | 98.99% | 687/694 |

- J1 複数 224行に X を適用した後の候補数: immediate X の行は 1候補 54 / 2+ 43、anchor の行は 1候補 93 / 2+ 34。0候補と X 無しはどちらも 0（FY2024 は 57 / 37、88 / 33）。1候補になっても matched には昇格しない。
- primary で一致しなかった5行（記述のみ。規則は変えない）:
  - 文部科学省 `50‑13`: X_anchor「地域イノベーション・エコシステム形成プログラム」/ sectionName「科学技術・学術政策推進費」
  - 国土交通省 `47‑43`: 「離島振興事業費」/「港湾環境整備事業費」
  - 国土交通省 `40‑43`: 「北海道開発事業費」/「港湾環境整備事業費」
  - 国土交通省 `52‑45`: 「北海道開発事業費」/「都市公園防災事業費」
  - 国土交通省 `54‑45`: 「北海道開発事業費」/「下水道事業費」

## 限界
- 確かめたのは「X と MOF の sectionName が exact に一致するか」まで。J1 の対応付け（ministry と事項名の exact）自体の正しさは、この validation の対象外。
- 対象は一般会計で、J1 が単一の行に限る。特別会計（483行）、CONTEXT の無い source（101行）、J1 0候補（75行）には何も言えない。
- FY2025 と FY2024 は同じ書式・同じ pipeline なので、他の年度や書式の違う文書へ一般化できるかは別の問題。
- 不一致5行の原因は分析していない（必要なら別の Task として行う）。

## 次（ユーザーの判断）
- K2 を明細表 ↔ MOF 突合の規則として採用し、実装するか、その範囲（単一だけか、複数の候補絞り込みにも使うか）。複数の候補絞り込みは、今回は記述だけで、採用の判定はしていない。
